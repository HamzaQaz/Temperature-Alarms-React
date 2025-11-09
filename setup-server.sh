#!/bin/bash

# Temperature Alarms - Initial Server Setup Script
# Run this script ONCE on a fresh Ubuntu server

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

echo_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

echo_error() {
    echo -e "${RED}✗ $1${NC}"
}

echo_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

clear
echo "================================================"
echo "  Temperature Alarms - Server Setup"
echo "================================================"
echo ""
echo_warning "This script will install and configure:"
echo "  • Node.js 20.x"
echo "  • Nginx"
echo "  • MySQL"
echo "  • PM2"
echo "  • Certbot (Let's Encrypt SSL)"
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Setup cancelled."
    exit 1
fi

# Update system
echo ""
echo_info "Updating system packages..."
sudo apt update && sudo apt upgrade -y
echo_success "System updated"

# Install Node.js
echo ""
echo_info "Installing Node.js 20.x..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
echo_success "Node.js installed: $(node --version)"

# Install Nginx
echo ""
echo_info "Installing Nginx..."
sudo apt install -y nginx
echo_success "Nginx installed"

# Install MySQL
echo ""
echo_info "Installing MySQL..."
sudo apt install -y mysql-server
echo_success "MySQL installed"

# Install PM2
echo ""
echo_info "Installing PM2..."
sudo npm install -g pm2
echo_success "PM2 installed"

# Install Certbot
echo ""
echo_info "Installing Certbot..."
sudo apt install -y certbot python3-certbot-nginx
echo_success "Certbot installed"

# Install Git
echo ""
echo_info "Installing Git..."
sudo apt install -y git
echo_success "Git installed"

# Create app directory
echo ""
echo_info "Creating application directory..."
sudo mkdir -p /var/www/temperature-alarms
sudo chown -R $USER:$USER /var/www/temperature-alarms
echo_success "Directory created: /var/www/temperature-alarms"

# MySQL Setup
echo ""
echo_info "Setting up MySQL database..."
echo ""
echo_warning "Please create a secure MySQL password when prompted"
echo ""
read -p "Press Enter to start MySQL secure installation..."
sudo mysql_secure_installation

# Create database and user
echo ""
echo_info "Creating database and user..."
echo ""
read -p "Enter MySQL root password: " -s MYSQL_ROOT_PASS
echo ""
read -p "Enter new database user password: " -s DB_USER_PASS
echo ""

sudo mysql -u root -p"$MYSQL_ROOT_PASS" << EOF
CREATE DATABASE IF NOT EXISTS temperature_alarms;
CREATE USER IF NOT EXISTS 'tempuser'@'localhost' IDENTIFIED BY '$DB_USER_PASS';
GRANT ALL PRIVILEGES ON temperature_alarms.* TO 'tempuser'@'localhost';
FLUSH PRIVILEGES;
EOF

if [ $? -eq 0 ]; then
    echo_success "Database created: temperature_alarms"
    echo_success "User created: tempuser"
else
    echo_error "Database setup failed"
    exit 1
fi

# Clone repository
echo ""
echo_info "Cloning repository..."
cd /var/www/temperature-alarms
read -p "Enter your GitHub repository URL: " REPO_URL
git clone "$REPO_URL" .
echo_success "Repository cloned"

# Backend setup
echo ""
echo_info "Setting up backend..."
cd /var/www/temperature-alarms/backend

# Create .env file
cat > .env << EOF
NODE_ENV=production
PORT=3001
DB_HOST=localhost
DB_USER=tempuser
DB_PASSWORD=$DB_USER_PASS
DB_NAME=temperature_alarms
CORS_ORIGIN=https://envn.celinaisd.tech
EOF

echo_success "Backend .env file created"

# Install backend dependencies
npm install
echo_success "Backend dependencies installed"

# Build backend
npm run build
echo_success "Backend built"

# Start with PM2
pm2 start ecosystem.config.js
pm2 save
pm2 startup | tail -n 1 | bash
echo_success "Backend started with PM2"

# Frontend setup
echo ""
echo_info "Setting up frontend..."
cd /var/www/temperature-alarms/frontend

# Create .env.production file
cat > .env.production << EOF
VITE_API_URL=https://envnapi.celinaisd.tech
EOF

echo_success "Frontend .env.production file created"

# Install frontend dependencies
npm install
echo_success "Frontend dependencies installed"

# Build frontend
npm run build
echo_success "Frontend built"

# Deploy to nginx directory
sudo mkdir -p /var/www/html/temperature-frontend
sudo cp -r dist/* /var/www/html/temperature-frontend/
sudo chown -R www-data:www-data /var/www/html/temperature-frontend
echo_success "Frontend deployed to nginx"

# Nginx configuration
echo ""
echo_info "Configuring Nginx..."

# Backend API config
sudo tee /etc/nginx/sites-available/envnapi.celinaisd.tech > /dev/null << 'EOF'
server {
    listen 80;
    server_name envnapi.celinaisd.tech;

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
EOF

# Frontend config
sudo tee /etc/nginx/sites-available/envn.celinaisd.tech > /dev/null << 'EOF'
server {
    listen 80;
    server_name envn.celinaisd.tech;

    root /var/www/html/temperature-frontend;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
EOF

# Enable sites
sudo ln -sf /etc/nginx/sites-available/envn.celinaisd.tech /etc/nginx/sites-enabled/
sudo ln -sf /etc/nginx/sites-available/envnapi.celinaisd.tech /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

echo_success "Nginx configured"

# Test nginx configuration
sudo nginx -t
if [ $? -eq 0 ]; then
    echo_success "Nginx configuration is valid"
    sudo systemctl restart nginx
    echo_success "Nginx restarted"
else
    echo_error "Nginx configuration test failed"
    exit 1
fi

# Configure firewall
echo ""
echo_info "Configuring firewall..."
sudo ufw allow 'Nginx Full'
sudo ufw allow OpenSSH
echo "y" | sudo ufw enable
echo_success "Firewall configured"

# SSL Certificates
echo ""
echo_info "Setting up SSL certificates..."
echo ""
echo_warning "Make sure your domains point to this server's IP address!"
echo ""
read -p "Continue with SSL setup? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    read -p "Enter your email for Let's Encrypt: " EMAIL
    sudo certbot --nginx -d envn.celinaisd.tech -d envnapi.celinaisd.tech --email "$EMAIL" --agree-tos --non-interactive --redirect
    
    if [ $? -eq 0 ]; then
        echo_success "SSL certificates installed"
    else
        echo_warning "SSL setup failed. You can run this manually later:"
        echo "  sudo certbot --nginx -d envn.celinaisd.tech -d envnapi.celinaisd.tech"
    fi
else
    echo_warning "Skipping SSL setup. Run manually later:"
    echo "  sudo certbot --nginx -d envn.celinaisd.tech -d envnapi.celinaisd.tech"
fi

# Create backup script
echo ""
echo_info "Creating backup script..."
sudo tee /usr/local/bin/backup-temperature-db.sh > /dev/null << EOF
#!/bin/bash
DATE=\$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/var/backups/temperature-alarms"
mkdir -p \$BACKUP_DIR

mysqldump -u tempuser -p'$DB_USER_PASS' temperature_alarms | gzip > \$BACKUP_DIR/backup_\$DATE.sql.gz

# Keep only last 7 days of backups
find \$BACKUP_DIR -name "backup_*.sql.gz" -mtime +7 -delete

echo "Backup completed: backup_\$DATE.sql.gz"
EOF

sudo chmod +x /usr/local/bin/backup-temperature-db.sh
echo_success "Backup script created"

# Setup cron job for backups
echo ""
read -p "Setup daily database backups at 2 AM? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    (sudo crontab -l 2>/dev/null; echo "0 2 * * * /usr/local/bin/backup-temperature-db.sh") | sudo crontab -
    echo_success "Daily backup scheduled"
fi

# Display summary
echo ""
echo "================================================"
echo "  ✓ Setup Complete!"
echo "================================================"
echo ""
echo_success "Services Status:"
echo "  • Backend:  $(pm2 list | grep temperature-api | grep online > /dev/null && echo 'Running ✓' || echo 'Not Running ✗')"
echo "  • Nginx:    $(systemctl is-active nginx)"
echo "  • MySQL:    $(systemctl is-active mysql)"
echo ""
echo_info "URLs:"
echo "  • Frontend: https://envn.celinaisd.tech"
echo "  • Backend:  https://envnapi.celinaisd.tech"
echo ""
echo_info "Useful Commands:"
echo "  • View backend logs:  pm2 logs temperature-api"
echo "  • View nginx logs:    sudo tail -f /var/log/nginx/error.log"
echo "  • Restart backend:    pm2 restart temperature-api"
echo "  • Restart nginx:      sudo systemctl restart nginx"
echo "  • PM2 monitoring:     pm2 monit"
echo "  • Manual backup:      /usr/local/bin/backup-temperature-db.sh"
echo ""
echo_info "Next Steps:"
echo "  1. Test frontend: https://envn.celinaisd.tech"
echo "  2. Test backend:  curl https://envnapi.celinaisd.tech/api/dashboard"
echo "  3. Update NodeMCU code with new API URL"
echo "  4. Set up monitoring and alerts"
echo ""
echo_warning "Important: Save this information securely!"
echo "  • Database Password: [HIDDEN]"
echo "  • Database Backups: /var/backups/temperature-alarms/"
echo ""
