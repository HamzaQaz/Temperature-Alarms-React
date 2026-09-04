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

Schema provisioning is moving into the backend's own migration runner. Until that lands, this guide cannot bring up a fresh database from scratch; existing deployments keep the schema they already have.

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
