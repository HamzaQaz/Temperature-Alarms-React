# Security Notice

This repository has been cleaned of sensitive information before being made public.

## Removed Files
- `setup-server.sh` - Server setup script with domain-specific configuration
- `deploy.sh` - Deployment script with domain-specific paths
- `fix-nginx.sh` - Nginx fix script with domain information

## Configuration Files
All configuration examples use placeholder values:
- Domains: `your-frontend-domain.com` and `your-api-domain.com`
- Passwords: `your_secure_password_here`
- Database credentials: Use `.env.example` files as templates

## Before Deployment
1. Copy `.env.example` to `.env` in both backend and frontend directories
2. Update all placeholder values with your actual configuration
3. Never commit `.env` files to the repository
4. Follow the DEPLOYMENT_GUIDE.md for step-by-step deployment instructions

## Production Security Checklist
- [ ] Change all default passwords
- [ ] Use strong, unique passwords for database
- [ ] Configure firewall (UFW)
- [ ] Setup SSL certificates with Let's Encrypt
- [ ] Enable rate limiting
- [ ] Configure CORS with your actual domains
- [ ] Keep system packages updated
- [ ] Setup regular database backups
- [ ] Monitor logs regularly
