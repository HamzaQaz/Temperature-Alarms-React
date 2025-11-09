# Deployment Guide - Ubuntu Server with Nginx

## Prerequisites
- Ubuntu Server (20.04 or newer)
- Root or sudo access
- Domains pointing to your server:
  - `your-frontend-domain.com` → Frontend
  - `your-api-domain.com` → Backend API

## Step 1: Initial Server Setup

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install nginx
sudo apt install -y nginx

# Install MySQL
sudo apt install -y mysql-server

# Install PM2 (process manager)
sudo npm install -g pm2

# Install certbot for SSL
sudo apt install -y certbot python3-certbot-nginx

# Install git
sudo apt install -y git
```

## Step 2: MySQL Database Setup

```bash
# Secure MySQL installation
sudo mysql_secure_installation

# Login to MySQL
sudo mysql -u root -p

# Create database and user (in MySQL prompt)
CREATE DATABASE temperature_alarms;
CREATE USER 'tempuser'@'localhost' IDENTIFIED BY 'your_secure_password_here';
GRANT ALL PRIVILEGES ON temperature_alarms.* TO 'tempuser'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

## Step 3: Clone and Setup Project

```bash
# Create app directory
sudo mkdir -p /var/www/temperature-alarms
sudo chown -R $USER:$USER /var/www/temperature-alarms

# Clone your repository
cd /var/www/temperature-alarms
git clone https://github.com/HamzaQaz/Temperature-Alarms-React.git .

# Or upload files via SCP/SFTP
```

## Step 4: Backend Setup

```bash
cd /var/www/temperature-alarms/backend

# Install dependencies
npm install

# Create production environment file
cat > .env << EOF
NODE_ENV=production
PORT=3001
DB_HOST=localhost
DB_USER=tempuser
DB_PASSWORD=your_secure_password_here
DB_NAME=temperature_alarms
CORS_ORIGIN=https://your-frontend-domain.com
EOF

# Build TypeScript
npm run build

# Start with PM2
pm2 start dist/index.js --name temperature-api
pm2 save
pm2 startup
```

## Step 5: Frontend Setup

```bash
cd /var/www/temperature-alarms/frontend

# Install dependencies
npm install

# Create production environment file
cat > .env.production << EOF
VITE_API_URL=https://your-api-domain.com
EOF

# Build for production
npm run build

# Move build to nginx directory
sudo mkdir -p /var/www/html/temperature-frontend
sudo cp -r dist/* /var/www/html/temperature-frontend/
```

## Step 6: Nginx Configuration

### Backend API Configuration

```bash
# Create nginx config for API
sudo nano /etc/nginx/sites-available/your-api-domain.com
```

Add this configuration:

```nginx
server {
    listen 80;
    server_name your-api-domain.com;

    # Redirect to HTTPS (will be configured with certbot)
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-api-domain.com;

    # SSL certificates (will be added by certbot)
    # ssl_certificate /etc/letsencrypt/live/your-api-domain.com/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/your-api-domain.com/privkey.pem;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Proxy settings
    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # SSE specific settings
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

**Note:** Rate limiting should be configured in `/etc/nginx/nginx.conf` in the `http` block (see Additional Nginx Optimization section below).

### Frontend Configuration

```bash
# Create nginx config for frontend
sudo nano /etc/nginx/sites-available/your-frontend-domain.com
```

Add this configuration:

```nginx
server {
    listen 80;
    server_name your-frontend-domain.com;

    # Redirect to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-frontend-domain.com;

    # SSL certificates (will be added by certbot)
    # ssl_certificate /etc/letsencrypt/live/your-frontend-domain.com/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/your-frontend-domain.com/privkey.pem;

    root /var/www/html/temperature-frontend;
    index index.html;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/x-javascript application/javascript application/xml+rss application/json;

    # React Router - handle client-side routing
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

### Enable Sites and Test Configuration

```bash
# Enable both sites
sudo ln -s /etc/nginx/sites-available/your-frontend-domain.com /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/your-api-domain.com /etc/nginx/sites-enabled/

# Remove default site
sudo rm /etc/nginx/sites-enabled/default

# Test nginx configuration
sudo nginx -t

# Restart nginx
sudo systemctl restart nginx
```

## Step 7: SSL Certificates with Let's Encrypt

```bash
# Obtain SSL certificates for both domains
sudo certbot --nginx -d your-frontend-domain.com -d your-api-domain.com

# Follow the prompts:
# - Enter email address
# - Agree to terms of service
# - Choose to redirect HTTP to HTTPS (option 2)

# Test automatic renewal
sudo certbot renew --dry-run
```

## Step 8: Firewall Configuration

```bash
# Enable UFW firewall
sudo ufw allow 'Nginx Full'
sudo ufw allow OpenSSH
sudo ufw enable

# Check status
sudo ufw status
```

## Step 9: Backend Environment Update

Update backend to use production settings:

```bash
cd /var/www/temperature-alarms/backend
nano src/index.ts
```

Update CORS configuration:

```typescript
// Update CORS origins
const allowedOrigins = [
  'https://your-frontend-domain.com',
  'http://localhost:5173' // Keep for local development
];
```

Then rebuild and restart:

```bash
npm run build
pm2 restart temperature-api
```

## Step 10: Frontend Environment Update

Update the API URL in frontend:

```bash
cd /var/www/temperature-alarms/frontend
nano src/api.ts
```

Update the base URL:

```typescript
const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://your-api-domain.com';
```

Rebuild and deploy:

```bash
npm run build
sudo cp -r dist/* /var/www/html/temperature-frontend/
```

## Monitoring and Maintenance

### View Backend Logs
```bash
pm2 logs temperature-api
pm2 monit
```

### View Nginx Logs
```bash
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

### Restart Services
```bash
# Restart backend
pm2 restart temperature-api

# Restart nginx
sudo systemctl restart nginx

# Restart MySQL
sudo systemctl restart mysql
```

### Update Application
```bash
# Pull latest code
cd /var/www/temperature-alarms
git pull

# Backend
cd backend
npm install
npm run build
pm2 restart temperature-api

# Frontend
cd ../frontend
npm install
npm run build
sudo cp -r dist/* /var/www/html/temperature-frontend/
```

## Security Checklist

- [ ] Change MySQL root password
- [ ] Create strong password for database user
- [ ] Configure firewall (UFW)
- [ ] SSL certificates installed
- [ ] Rate limiting configured
- [ ] Security headers added
- [ ] Keep system updated: `sudo apt update && sudo apt upgrade`
- [ ] Monitor logs regularly
- [ ] Backup database regularly

## Backup Script

Create a backup script:

```bash
sudo nano /usr/local/bin/backup-temperature-db.sh
```

Add:

```bash
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/var/backups/temperature-alarms"
mkdir -p $BACKUP_DIR

mysqldump -u tempuser -p'your_secure_password_here' temperature_alarms | gzip > $BACKUP_DIR/backup_$DATE.sql.gz

# Keep only last 7 days of backups
find $BACKUP_DIR -name "backup_*.sql.gz" -mtime +7 -delete
```

Make executable and add to cron:

```bash
sudo chmod +x /usr/local/bin/backup-temperature-db.sh
sudo crontab -e

# Add this line for daily backup at 2 AM
0 2 * * * /usr/local/bin/backup-temperature-db.sh
```

## Testing

### Test Backend API
```bash
curl https://your-api-domain.com/api/dashboard
```

### Test Frontend
Open browser: `https://your-frontend-domain.com`

### Test SSE Connection
```bash
curl -N https://your-api-domain.com/api/dashboard/stream
```

## Troubleshooting

### Backend not starting
```bash
pm2 logs temperature-api
# Check for database connection errors
```

### Nginx errors
```bash
sudo nginx -t
sudo tail -f /var/log/nginx/error.log
```

### SSL certificate issues
```bash
sudo certbot certificates
sudo certbot renew --force-renewal
```

### Database connection issues
```bash
sudo systemctl status mysql
sudo mysql -u tempuser -p
```

## NodeMCU Configuration Update

Update your Arduino code to use the new API endpoint:

```cpp
const char* serverUrl = "https://your-api-domain.com/api/write";
```

Note: You may need to add SSL fingerprint verification or use HTTP if HTTPS causes issues with NodeMCU.

## Additional Nginx Optimization

Add to `/etc/nginx/nginx.conf` in the `http` block:

```nginx
http {
    # ... existing configuration ...

    # Rate limiting zones (add this in http block)
    limit_req_zone $binary_remote_addr zone=api_limit:10m rate=100r/m;

    # Connection optimization
    keepalive_timeout 65;
    keepalive_requests 100;

    # Buffer sizes
    client_body_buffer_size 10K;
    client_header_buffer_size 1k;
    client_max_body_size 8m;
    large_client_header_buffers 2 1k;

    # Timeouts
    client_body_timeout 12;
    client_header_timeout 12;
    send_timeout 10;

    # Hide nginx version
    server_tokens off;

    # ... rest of configuration ...
}
```

Then, to apply rate limiting to your API, add this inside the API server block in `/etc/nginx/sites-available/your-api-domain.com`:

```nginx
server {
    listen 443 ssl http2;
    server_name your-api-domain.com;

    # ... other configuration ...

    location / {
        # Apply rate limiting
        limit_req zone=api_limit burst=20 nodelay;

        # ... proxy settings ...
    }
}
```

## PM2 Ecosystem File (Optional)

Create `ecosystem.config.js` in backend directory:

```javascript
module.exports = {
  apps: [{
    name: 'temperature-api',
    script: './dist/index.js',
    instances: 2,
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3001
    },
    error_file: '/var/log/temperature-api/error.log',
    out_file: '/var/log/temperature-api/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    max_memory_restart: '500M',
    autorestart: true,
    watch: false
  }]
};
```

Then start with:
```bash
pm2 start ecosystem.config.js
```

---

## Quick Reference

**Start/Stop Services:**
- Backend: `pm2 start/stop/restart temperature-api`
- Nginx: `sudo systemctl start/stop/restart nginx`
- MySQL: `sudo systemctl start/stop/restart mysql`

**Logs:**
- Backend: `pm2 logs temperature-api`
- Nginx Access: `sudo tail -f /var/log/nginx/access.log`
- Nginx Error: `sudo tail -f /var/log/nginx/error.log`
- MySQL: `sudo tail -f /var/log/mysql/error.log`

**Domains:**
- Frontend: https://your-frontend-domain.com
- Backend API: https://your-api-domain.com

**Important Files:**
- Nginx Frontend: `/etc/nginx/sites-available/your-frontend-domain.com`
- Nginx Backend: `/etc/nginx/sites-available/your-api-domain.com`
- Backend Env: `/var/www/temperature-alarms/backend/.env`
- Frontend Build: `/var/www/html/temperature-frontend/`
