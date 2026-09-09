# Deployment

A single Ubuntu server runs everything: nginx serves the built frontend and proxies `/api/` to the backend, PM2 keeps the backend running as one process, and MySQL holds the data.

Throughout this guide, replace:

- `YOUR_DOMAIN` with the hostname the site is served on
- `/path/to/frontend/dist` with wherever you copy the frontend build

## 1. Server packages

```bash
sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs nginx mysql-server certbot python3-certbot-nginx git
sudo npm install -g pm2
```

## 2. MySQL

```bash
sudo mysql_secure_installation
sudo mysql -u root -p
```

```sql
CREATE DATABASE temperature_alarms;
CREATE USER 'tempuser'@'localhost' IDENTIFIED BY 'choose-a-strong-password';
GRANT ALL PRIVILEGES ON temperature_alarms.* TO 'tempuser'@'localhost';
FLUSH PRIVILEGES;
```

The backend creates and upgrades the schema itself: every start runs its migration runner, which applies whatever has not run yet and records it in `schema_migrations`. A fresh database needs nothing beyond the `CREATE DATABASE` above.

### Upgrading a database from the old per-Device tables

A database from the PHP era or the first Node backend holds `devices`, `locations`, `alarms`, and one `ESP_xxxxxx` table per Device with the date and time as strings. The first start of the new backend against it (see ADR 0002):

1. renames `devices` and `locations` to `legacy_devices` and `legacy_locations`, then builds the new `campuses`, `devices`, and `readings` tables;
2. copies each legacy location into `campuses` and each legacy device into `devices`, matching the old free-text `Campus` column against a shortcode first and a name second;
3. copies every row of every `ESP_xxxxxx` table into `readings`, parsing the string date and time in `LEGACY_TIME_ZONE`, which defaults to the server's own zone. The PHP writer pinned America/Chicago, so set `LEGACY_TIME_ZONE=America/Chicago` in `.env` if the server is on UTC.

Nothing legacy is dropped. Every row that cannot be read (an unparseable date or time, a device whose campus is unknown, a table with no device row) is logged with its table and id and skipped, so watch `pm2 logs temperature-api` for lines starting `legacy:` on that first start. The runner applies each migration once. If an old writer keeps adding rows to an `ESP_` table after that (a board not yet reflashed, still posting to the old PHP endpoint), run the legacy migrations again by hand from `backend/`:

```bash
npm run migrate:legacy
```

It is safe to repeat: each `ESP_` table's progress is kept in `legacy_readings_progress`, so a later run copies nothing twice and picks up only rows added since.

Before dropping anything, verify the numbers. For each Device, the legacy row count should equal the copied count plus the skipped count in `legacy_readings_progress`, and the copied count should match the readings that carry a legacy timestamp. Reflashed boards start adding new readings at once, so bound the readings count by the time the new backend first started:

```sql
SELECT table_name, last_id, copied, skipped FROM legacy_readings_progress;
SELECT COUNT(*) FROM `ESP_2EB804`;
SELECT COUNT(*) FROM readings r JOIN devices d ON d.id = r.device_id
 WHERE d.hostname = 'ESP_2EB804' AND r.recorded_at < 'YYYY-MM-DD HH:MM:SS';   -- first start of the new backend, in UTC
```

Then compare one legacy row with its reading, rendered back in the legacy zone, to confirm the timestamps read the right way round:

```sql
SELECT DATE, TIME, TEMP FROM `ESP_2EB804` ORDER BY ID DESC LIMIT 1;
SELECT CONVERT_TZ(r.recorded_at, '+00:00', 'America/Chicago') AS local_time, r.temp_f
  FROM readings r JOIN devices d ON d.id = r.device_id
 WHERE d.hostname = 'ESP_2EB804' ORDER BY r.recorded_at DESC LIMIT 1;
```

Once the counts agree, drop the legacy tables by hand, one `DROP TABLE` per `ESP_xxxxxx` table plus `legacy_devices`, `legacy_locations`, `alarms`, and `legacy_readings_progress`. Take a backup first (see below). `CONVERT_TZ` with a named zone needs the MySQL time zone tables loaded (`mysql_tzinfo_to_sql /usr/share/zoneinfo | sudo mysql mysql`); use a fixed offset like `'-06:00'` otherwise.

## 3. Clone and build

```bash
sudo mkdir -p /var/www/temperature-alarms
sudo chown -R $USER:$USER /var/www/temperature-alarms
git clone <repo-url> /var/www/temperature-alarms
cd /var/www/temperature-alarms
npm run install:all
```

### Backend

```bash
cd backend
cp .env.example .env
nano .env        # database credentials, CORS_ORIGIN=https://YOUR_DOMAIN
npm run build
```

### Frontend

```bash
cd ../frontend
cp .env.example .env.production
nano .env.production   # VITE_API_URL=https://YOUR_DOMAIN
npm run build          # output lands in frontend/dist
sudo mkdir -p /path/to/frontend/dist
sudo cp -r dist/* /path/to/frontend/dist/
```

## 4. PM2

The backend must run as exactly one process (see ADR 0001). `backend/ecosystem.config.js` is already set to a single fork-mode instance; do not raise `instances`.

```bash
cd /var/www/temperature-alarms/backend
pm2 start ecosystem.config.js
pm2 save
pm2 startup     # run the command it prints
```

Useful commands:

```bash
pm2 logs temperature-api
pm2 restart temperature-api
pm2 monit
```

## 5. nginx

Create `/etc/nginx/sites-available/YOUR_DOMAIN`:

```nginx
server {
    listen 80;
    server_name YOUR_DOMAIN;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name YOUR_DOMAIN;

    # Certbot fills these in when you run it (step 6)
    # ssl_certificate     /etc/letsencrypt/live/YOUR_DOMAIN/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/YOUR_DOMAIN/privkey.pem;

    root /path/to/frontend/dist;
    index index.html;

    # Backend API, including the SSE stream
    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Required for Server-Sent Events: no buffering, long read timeout
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
    }

    # React Router: every unknown path serves index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Hashed build assets can be cached forever
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

Enable it:

```bash
sudo ln -s /etc/nginx/sites-available/YOUR_DOMAIN /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

## 6. TLS

```bash
sudo certbot --nginx -d YOUR_DOMAIN
sudo certbot renew --dry-run
```

## 7. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

## Updating

```bash
cd /var/www/temperature-alarms
git pull
npm run install:all
npm run build:all
sudo cp -r frontend/dist/* /path/to/frontend/dist/
pm2 restart temperature-api
```

## Checks

```bash
curl https://YOUR_DOMAIN/api/health
curl -N https://YOUR_DOMAIN/api/dashboard/stream   # should stay open and print events
pm2 logs temperature-api
sudo tail -f /var/log/nginx/error.log
```

## Database backups

```bash
sudo tee /usr/local/bin/backup-temperature-db.sh >/dev/null <<'EOF'
#!/bin/bash
DIR=/var/backups/temperature-alarms
mkdir -p "$DIR"
mysqldump --defaults-extra-file=/root/.my.cnf temperature_alarms | gzip > "$DIR/backup_$(date +%Y%m%d_%H%M%S).sql.gz"
find "$DIR" -name 'backup_*.sql.gz' -mtime +7 -delete
EOF
sudo chmod +x /usr/local/bin/backup-temperature-db.sh
# crontab -e:  0 2 * * * /usr/local/bin/backup-temperature-db.sh
```

Put the database credentials in `/root/.my.cnf` (mode 600) rather than in the script.
