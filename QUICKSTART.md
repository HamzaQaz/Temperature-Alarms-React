# Quick Start Guide

This guide will help you get the Temperature Alarms React application up and running quickly.

## Prerequisites

- Node.js v16 or higher
- MySQL/MariaDB Server
- npm (comes with Node.js)

## Quick Setup (5 minutes)

### 1. Database Setup (1 minute)

```bash
# Login to MySQL
mysql -u root -p

# Run the schema from data.sql
mysql -u root -p < data.sql
```

### 2. Backend Setup (2 minutes)

```bash
# Navigate to backend directory
cd backend

# Install dependencies
npm install

# Create environment file
cp .env.example .env

# Edit .env and set your database password
# Required: DB_PASSWORD=your_mysql_password
nano .env  # or use your preferred editor
```

### 3. Frontend Setup (2 minutes)

```bash
# Navigate to frontend directory
cd ../frontend

# Install dependencies
npm install

# Create environment file (optional - defaults work for local development)
cp .env.example .env
```

## Running the Application

### Development Mode (Recommended for testing)

Open two terminal windows:

**Terminal 1 - Backend:**
```bash
cd backend
npm run dev
```
This starts the API server on http://localhost:3001

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
```
This starts the development server (usually http://localhost:5173)

Open your browser to the URL shown in Terminal 2 (typically http://localhost:5173)

## Production Build

### Build Both Applications

```bash
# From project root
npm run build:all
```

### Run Backend in Production

```bash
cd backend
npm start
```

### Deploy Frontend

The frontend build is in `frontend/dist/` - serve these static files with nginx, Apache, or any static file server.

Example nginx configuration:
```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    # Frontend
    location / {
        root /path/to/frontend/dist;
        try_files $uri /index.html;
    }
    
    # Backend API
    location /api {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## Configure NodeMCU Devices

Update your Arduino code to point to the new API endpoint:

```cpp
// Replace with your server details
const char* serverName = "http://your-server-ip:3001/api/write";
```

The API expects the same data format as the PHP version:
- device: Device name (e.g., ESP_123456)
- campus: Campus/location shortcode
- location: Location name
- date: Date string
- time: Time string
- temp: Temperature value

## Verify Everything Works

1. **Check Backend:** Visit http://localhost:3001/api/devices (should return [] or your devices)
2. **Check Frontend:** Visit http://localhost:5173 (should show the dashboard)
3. **Add Test Data:**
   - Navigate to Settings
   - Add a Location (e.g., Name: "Main Building", Shortcode: "MAIN")
   - Add a Device (e.g., Name: "ESP_123456", Campus: "MAIN", Location: "Room 101")

## Troubleshooting

### Backend won't start
- Check that MySQL is running: `mysql -u root -p`
- Verify DB_PASSWORD is set in backend/.env
- Check port 3001 is not in use: `lsof -i :3001`

### Frontend can't connect to backend
- Ensure backend is running on port 3001
- Check VITE_API_URL in frontend/.env (should be http://localhost:3001)
- Check browser console for CORS errors

### Database connection errors
- Verify database credentials in backend/.env
- Ensure database 'temp' exists: `mysql -u root -p -e "SHOW DATABASES;"`
- Check MySQL user has proper permissions

## Next Steps

- Configure your NodeMCU devices to use the new API
- Set up production environment variables
- Configure a reverse proxy (nginx/Apache) for production
- Set up HTTPS with Let's Encrypt
- Review SECURITY_SUMMARY.md for production security recommendations

## Getting Help

- Check the main README.md for detailed information
- Review SECURITY_SUMMARY.md for security configuration
- Open an issue on GitHub for bugs or questions

## Development Tips

- Backend changes auto-reload with nodemon
- Frontend has Hot Module Replacement (HMR) for instant updates
- Use `npm run lint` in frontend to check code quality
- Run `npm audit` periodically to check for dependency vulnerabilities
