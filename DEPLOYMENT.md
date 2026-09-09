# Deployment

The supported way to run the system is the Docker Compose stack at the repo root (ADR 0005): one `compose.yaml` runs the database, the backend, and nginx serving the dashboard on one port, and the same file is the laptop demo and the district server. The manual PM2 and nginx install stays at the [bottom](#manual-install-without-docker) for a server that cannot run Docker.

Throughout this guide, replace `YOUR_DOMAIN` with the hostname the site is served on.

## Docker Compose

The stack is three services on a private network:

| Service | What it is | Reachable from |
| --- | --- | --- |
| `db` | MySQL 8.4 with its data on the named volume `db-data` | `api` only, or `docker compose exec db` |
| `api` | The backend, one process (ADR 0001), built from `backend/Dockerfile` | `web` only, or `docker compose exec api` |
| `web` | nginx serving the built frontend and proxying `/api/` to `api` with the SSE settings, built from `frontend/Dockerfile` | `http://<host>:WEB_PORT`, port 80 by default |

Every service restarts unless stopped, logs are capped at three files of 10 MB each, and the dashboard's own origin serves the API, so no CORS setting is needed. The frontend is built with no API address on purpose: one image works on any hostname.

### Setup

Install Docker: Docker Desktop on a laptop, or on Ubuntu Server [Docker Engine with the Compose plugin](https://docs.docker.com/engine/install/ubuntu/) (`docker compose version` should print a v2 number). Then:

```bash
git clone <repo-url> temperature-alarms
cd temperature-alarms
cp .env.example .env
nano .env
```

Set the three secrets; `docker compose up` refuses to start and names any that is empty:

| Variable | Value |
| --- | --- |
| `ADMIN_TOKEN` | The secret the Settings page sends with every change. Generate it with `openssl rand -hex 32` and hand it to the people who administer Campuses and Devices |
| `DEVICE_TOKEN` | The secret every Device sends with every Reading. Generate another one; it goes into each board's `config.h`, so rotating it means reflashing every Device (ADR 0003) |
| `DB_PASSWORD` | The password of the database user, and of MySQL root inside the stack. Generate a third one; nothing outside the stack can reach the database |

`WEB_PORT` is the only port published; leave it at 80 so boards and browsers need no port in their URL. Every other setting in `.env.example` is the backend's and has the default shown; set `LEGACY_TIME_ZONE` only when [migrating an old database in](#migrating-an-old-database-in). `.env` is gitignored.

### First run

```bash
docker compose up -d --build
docker compose ps        # wait until db and api say "healthy" and web is "running"
```

The first build downloads the base images and compiles both packages, a couple of minutes; later builds reuse the layers. On start, `api` waits for `db` to answer, creates or upgrades the schema itself through its migration runner, and `web` starts once `api` answers `/api/health`. Then open `http://<host>/` (with `:WEB_PORT` only if you changed it).

Walk the whole path once, before any Device is flashed. Open `http://<host>/settings`, paste the Admin token, add a Campus and a Device, and with the dashboard open in another tab post a Reading for that Device from the host:

```bash
set -a; source .env; set +a
curl http://localhost/api/health                       # {"status":"ok","database":"connected"}
curl -N http://localhost/api/dashboard/stream          # stays open and prints events; Ctrl-C
curl -i http://localhost/api/readings -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $DEVICE_TOKEN" -d '{"device":"ESP_A1B2C3","temp":72,"humidity":40}'   # 201
curl -i http://localhost/api/readings -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer wrong' -d '{"device":"ESP_A1B2C3","temp":72,"humidity":40}'             # 401
```

The card should update without a reload, and the History link on it should show that Reading in today's list. For a card that keeps moving, run the virtual Device that ships in the `api` image; it reads the Device token and port from the container's environment, so only the hostname you registered is needed:

```bash
docker compose exec api node scripts/mock-device.mjs --hostname ESP_A1B2C3
docker compose exec api node scripts/mock-device.mjs --hostname ESP_A1B2C3 --count 3   # three Readings, then watch the card go Offline
```

Reset history on the Device's History page removes every Reading of the Device, so use it before the real Device starts reporting; or register a throwaway Device for the test and delete it afterwards, since its Readings go with it.

Useful commands:

```bash
docker compose logs -f api        # migrations, retention, legacy: lines
docker compose logs -f web        # nginx access and error log
docker compose restart api
docker compose down               # stop; the data stays on the volume
docker compose down -v            # stop and wipe the database
```

Once a day, and once at every start, the backend deletes Readings older than `RETENTION_DAYS` (90 unless `.env` says otherwise; see ADR 0004) and logs a line like `retention: removed 12480 readings older than ...`. Nothing is archived first: export anything you want to keep before it ages out.

### Upgrades

```bash
git pull
docker compose up -d --build
docker image prune -f             # drop the previous images
```

Compose rebuilds what changed and recreates only those containers. New schema migrations run on the first start of the new `api`, and the data on the volume is untouched. A change to `.env` needs `docker compose up -d` as well; Compose recreates the containers whose environment changed.

### Backups and restore

Everything lives in the `db-data` volume. Dump it through the `db` container:

```bash
set -a; source .env; set +a
docker compose exec db mysqldump -uroot -p"$DB_PASSWORD" temperature_alarms | gzip > backup_$(date +%Y%m%d_%H%M%S).sql.gz
```

For a nightly copy on a server, put that line in a script and run it from cron, keeping the last week:

```bash
sudo tee /usr/local/bin/backup-temperature-db.sh >/dev/null <<'EOS'
#!/bin/bash
cd /path/to/temperature-alarms || exit 1
set -a; source .env; set +a
DIR=/var/backups/temperature-alarms
mkdir -p "$DIR"
docker compose exec -T db mysqldump -uroot -p"$DB_PASSWORD" temperature_alarms | gzip > "$DIR/backup_$(date +%Y%m%d_%H%M%S).sql.gz"
find "$DIR" -name 'backup_*.sql.gz' -mtime +7 -delete
EOS
sudo chmod +x /usr/local/bin/backup-temperature-db.sh
# crontab -e:  0 2 * * * /usr/local/bin/backup-temperature-db.sh
```

Restore into a running stack (the `-T` matters, it lets the file stream in):

```bash
docker compose stop api
gunzip -c backup_20260909_020000.sql.gz | docker compose exec -T db mysql -uroot -p"$DB_PASSWORD" temperature_alarms
docker compose start api
```

To move to another machine, copy the repo, the `.env`, and a dump; `up -d --build` there, then restore.

### Migrating an old database in

A database from the PHP era or the first Node backend holds `devices`, `locations`, `alarms`, and one `ESP_xxxxxx` table per Device with the date and time as strings. The backend converts it on its first start (see [Upgrading a database from the old per-Device tables](#upgrading-a-database-from-the-old-per-device-tables) for what that does and how to verify it). With the stack, the order is: restore the old dump into the volume first, then let `api` start against it.

1. Dump the old database on the old server: `mysqldump temperature_alarms > old.sql`.
2. In `.env`, set `LEGACY_TIME_ZONE=America/Chicago`, the zone the old writer used. The container's own zone is UTC, so the default would parse every old timestamp six hours wrong.
3. Start only the database and restore into it:

   ```bash
   docker compose up -d --wait db
   docker compose exec -T db mysql -uroot -p"$DB_PASSWORD" temperature_alarms < old.sql
   ```

4. Start the rest: `docker compose up -d --build`. The first start of `api` renames the old tables, builds the new ones, and copies every row; watch `docker compose logs api` for lines starting `legacy:`, each naming a row it could not read and skipped.
5. If an old writer keeps adding rows to an `ESP_` table after that (a board not yet reflashed, still posting to the old PHP endpoint), run the legacy migrations again; each run copies only rows added since:

   ```bash
   docker compose exec api npm run migrate:legacy
   ```

6. Verify the counts with the SQL in the section linked above, run through `docker compose exec db mysql -uroot -p"$DB_PASSWORD" temperature_alarms`, then drop the legacy tables by hand.

### TLS in front of the stack

The stack serves plain HTTP on purpose: a certificate needs a public hostname, and a laptop demo or a closet network has none. On the district server, put a TLS proxy on the host in front of the one published port. Move the stack off port 80 and keep it on the loopback address so only the proxy reaches it, `WEB_PORT=127.0.0.1:8080` in `.env`, then `docker compose up -d`.

The shortest proxy is [Caddy](https://caddyserver.com/docs/install), which obtains and renews the certificate itself. `/etc/caddy/Caddyfile`:

```
YOUR_DOMAIN {
    reverse_proxy 127.0.0.1:8080 {
        flush_interval -1
    }
}
```

`flush_interval -1` keeps the SSE stream unbuffered. `sudo systemctl reload caddy`, open the firewall (`sudo ufw allow OpenSSH`, `sudo ufw allow 80,443/tcp`, `sudo ufw enable`), and the site is on `https://YOUR_DOMAIN`. With nginx and certbot instead, use the server block from the [manual install](#5-nginx) with a single `location /` carrying the same `proxy_*` lines as its `/api/` block, pointed at `http://127.0.0.1:8080`.

No Device needs to change at certificate renewal: one with an `https://` server URL sends over TLS without checking the certificate (see the firmware section of the README). Devices on the closet network can also keep posting to the stack's own port over plain HTTP if the host allows it.

## Upgrading a database from the old per-Device tables

Both paths share this. The first start of the new backend against an old database (see ADR 0002):

1. renames `devices` and `locations` to `legacy_devices` and `legacy_locations`, then builds the new `campuses`, `devices`, and `readings` tables;
2. copies each legacy location into `campuses` and each legacy device into `devices`, matching the old free-text `Campus` column against a shortcode first and a name second;
3. copies every row of every `ESP_xxxxxx` table into `readings`, parsing the string date and time in `LEGACY_TIME_ZONE`, which defaults to the server's own zone. The PHP writer pinned America/Chicago, so set `LEGACY_TIME_ZONE=America/Chicago` in `.env` if the server (or the container, which is always UTC) is not on Central time.

Nothing legacy is dropped. Every row that cannot be read (an unparseable date or time, a device whose campus is unknown, a table with no device row) is logged with its table and id and skipped, so watch the backend log for lines starting `legacy:` on that first start. The runner applies each migration once; `npm run migrate:legacy` from `backend/` (or through `docker compose exec api`) runs the legacy migrations again by hand. It is safe to repeat: each `ESP_` table's progress is kept in `legacy_readings_progress`, so a later run copies nothing twice and picks up only rows added since.

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

Once the counts agree, drop the legacy tables by hand, one `DROP TABLE` per `ESP_xxxxxx` table plus `legacy_devices`, `legacy_locations`, `alarms`, and `legacy_readings_progress`. Take a backup first. `CONVERT_TZ` with a named zone needs the MySQL time zone tables loaded (`mysql_tzinfo_to_sql /usr/share/zoneinfo | mysql mysql` as root; the MySQL image ships without zoneinfo); use a fixed offset like `'-06:00'` otherwise.

## Manual install (without Docker)

The fallback for a server that cannot run Docker. A single Ubuntu server runs everything: nginx serves the built frontend and proxies `/api/` to the backend, PM2 keeps the backend running as one process, and MySQL holds the data. Replace `/path/to/frontend/dist` with wherever you copy the frontend build.

### 1. Server packages

```bash
sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs nginx mysql-server certbot python3-certbot-nginx git
sudo npm install -g pm2
```

### 2. MySQL

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

The backend creates and upgrades the schema itself: every start runs its migration runner, which applies whatever has not run yet and records it in `schema_migrations`. A fresh database needs nothing beyond the `CREATE DATABASE` above. An old database is converted on the first start; see [Upgrading a database from the old per-Device tables](#upgrading-a-database-from-the-old-per-device-tables), and watch `pm2 logs temperature-api` for the `legacy:` lines.

### 3. Clone and build

```bash
sudo mkdir -p /var/www/temperature-alarms
sudo chown -R $USER:$USER /var/www/temperature-alarms
git clone <repo-url> /var/www/temperature-alarms
cd /var/www/temperature-alarms
npm run install:all
```

#### Backend

```bash
cd backend
cp .env.example .env
nano .env
npm run build
```

The backend refuses to start until these are set, naming whatever is missing:

| Variable | Value |
| --- | --- |
| `DB_USER`, `DB_PASSWORD`, `DB_NAME` | The MySQL user and database from step 2 (`DB_HOST` and `DB_PORT` default to `localhost:3306`) |
| `ADMIN_TOKEN`, `DEVICE_TOKEN` | The two shared secrets, as in the Compose [setup](#setup) table |

`CORS_ORIGIN` can stay unset: through the nginx below the dashboard and the API share one origin, which the backend always accepts. Set it only if the dashboard is served from somewhere else. Leave `REPORT_INTERVAL_SECONDS` at 30 unless the firmware interval changes with it, and set `LEGACY_TIME_ZONE` only when upgrading an old database (step 2). Every other setting has a default that `.env.example` shows.

#### Frontend

```bash
cd ../frontend
cp .env.example .env.production
nano .env.production   # VITE_API_URL=https://YOUR_DOMAIN
npm run build          # output lands in frontend/dist
sudo mkdir -p /path/to/frontend/dist
sudo cp -r dist/* /path/to/frontend/dist/
```

### 4. PM2

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

The retention job runs here exactly as in the stack: once a day and once at every start, logging a `retention:` line.

### 5. nginx

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

### 6. TLS

```bash
sudo certbot --nginx -d YOUR_DOMAIN
sudo certbot renew --dry-run
```

Certbot adds its own `ssl_certificate` lines to the nginx file (delete the two commented placeholders afterwards) and installs a systemd timer that renews the certificate before it expires and reloads nginx; `systemctl list-timers certbot.timer` shows the next run, and the dry run above proves the renewal works. No Device needs to change at renewal: one with an `https://` server URL sends over TLS without checking the certificate (see the firmware section of the README).

### 7. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

### Updating

```bash
cd /var/www/temperature-alarms
git pull
npm run install:all
npm run build:all
sudo cp -r frontend/dist/* /path/to/frontend/dist/
pm2 restart temperature-api
```

### Checks

```bash
curl https://YOUR_DOMAIN/api/health
curl -N https://YOUR_DOMAIN/api/dashboard/stream   # should stay open and print events
pm2 logs temperature-api
sudo tail -f /var/log/nginx/error.log
```

Then walk the same path as the Compose [first run](#first-run), with `https://YOUR_DOMAIN` in place of `http://localhost` and the virtual Device run from `backend/` on the server: `node scripts/mock-device.mjs --hostname ESP_A1B2C3 --token "$DEVICE_TOKEN"`.

### Database backups

```bash
sudo tee /usr/local/bin/backup-temperature-db.sh >/dev/null <<'EOS'
#!/bin/bash
DIR=/var/backups/temperature-alarms
mkdir -p "$DIR"
mysqldump --defaults-extra-file=/root/.my.cnf temperature_alarms | gzip > "$DIR/backup_$(date +%Y%m%d_%H%M%S).sql.gz"
find "$DIR" -name 'backup_*.sql.gz' -mtime +7 -delete
EOS
sudo chmod +x /usr/local/bin/backup-temperature-db.sh
# crontab -e:  0 2 * * * /usr/local/bin/backup-temperature-db.sh
```

Put the database credentials in `/root/.my.cnf` (mode 600) rather than in the script.
