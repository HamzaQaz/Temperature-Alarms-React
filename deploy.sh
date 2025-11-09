#!/bin/bash

# Temperature Alarms Deployment Script
# Run this script on your Ubuntu server after initial setup

set -e  # Exit on any error

echo "🚀 Starting deployment process..."

# Variables
APP_DIR="/var/www/temperature-alarms"
FRONTEND_DIR="$APP_DIR/frontend"
BACKEND_DIR="$APP_DIR/backend"
NGINX_FRONTEND_DIR="/var/www/html/temperature-frontend"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
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

# Check if running from correct directory
if [ ! -d "$APP_DIR" ]; then
    echo_error "App directory not found: $APP_DIR"
    exit 1
fi

# Navigate to app directory
cd $APP_DIR

echo "📥 Pulling latest code from git..."
git pull origin master
echo_success "Code updated"

# Backend deployment
echo ""
echo "🔧 Deploying Backend..."
cd $BACKEND_DIR

# Install dependencies
echo "Installing backend dependencies..."
npm install
echo_success "Dependencies installed"

# Build TypeScript
echo "Building TypeScript..."
npm run build
echo_success "Build completed"

# Restart PM2 process
echo "Restarting backend service..."
pm2 restart temperature-api
echo_success "Backend restarted"

# Check PM2 status
pm2 info temperature-api > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo_success "Backend is running"
else
    echo_error "Backend failed to start. Check logs with: pm2 logs temperature-api"
    exit 1
fi

# Frontend deployment
echo ""
echo "🎨 Deploying Frontend..."
cd $FRONTEND_DIR

# Install dependencies
echo "Installing frontend dependencies..."
npm install
echo_success "Dependencies installed"

# Build for production
echo "Building frontend..."
npm run build
echo_success "Build completed"

# Deploy to nginx directory
echo "Deploying to nginx..."
sudo rm -rf $NGINX_FRONTEND_DIR/*
sudo cp -r dist/* $NGINX_FRONTEND_DIR/
sudo chown -R www-data:www-data $NGINX_FRONTEND_DIR
echo_success "Frontend deployed"

# Test nginx configuration
echo ""
echo "🔍 Testing nginx configuration..."
sudo nginx -t
if [ $? -eq 0 ]; then
    echo_success "Nginx configuration is valid"
    
    # Reload nginx
    echo "Reloading nginx..."
    sudo systemctl reload nginx
    echo_success "Nginx reloaded"
else
    echo_error "Nginx configuration test failed"
    exit 1
fi

# Display status
echo ""
echo "📊 Deployment Status:"
echo "===================="
echo ""
echo "Backend Service:"
pm2 list | grep temperature-api
echo ""
echo "Nginx Status:"
sudo systemctl status nginx --no-pager | head -n 5
echo ""

echo_success "Deployment completed successfully! 🎉"
echo ""
echo "URLs:"
echo "  Frontend: https://envn.celinaisd.tech"
echo "  Backend:  https://envnapi.celinaisd.tech"
echo ""
echo "Useful commands:"
echo "  View backend logs: pm2 logs temperature-api"
echo "  View nginx logs:   sudo tail -f /var/log/nginx/error.log"
echo "  PM2 monitoring:    pm2 monit"
