# Temperature Alarms - React + TypeScript + Vite

This project utilizes NodeMCU SOCs & Temperature Sensors (DS18B20) to report temperatures of specified locations every 30 minutes. The application has been completely rewritten in React with TypeScript using Vite for the frontend and Node.js/Express for the backend.

## Technology Stack

- **Frontend**: React 18 + TypeScript + Vite
- **Backend**: Node.js + Express + TypeScript
- **Database**: MySQL
- **UI**: Tailwind CSS + Shadcn UI
- **Hardware**: NodeMCU + DHT11 Temperature Sensors

---

## Prerequisites

- Node.js (v16 or higher)
- MySQL/MariaDB Server
- npm or yarn package manager

---

## Installation & Setup

### 1. Database Setup

Execute the SQL commands from the `data.sql` file to create the required database and tables:

```bash
mysql -u root -p < data.sql
```

Update database credentials in `backend/.env` (see step 3).

### 2. Backend Setup

```bash
cd backend
npm install
cp .env.example .env
```

Edit `backend/.env` and configure your database settings:
```
PORT=3001
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=temp
```

### 3. Frontend Setup

```bash
cd frontend
npm install
cp .env.example .env
```

Edit `frontend/.env` if needed:
```
VITE_API_URL=http://localhost:3001
```

---

## Running the Application

### Development Mode

Start the backend server:
```bash
cd backend
npm run dev
```

In a separate terminal, start the frontend:
```bash
cd frontend
npm run dev
```

The frontend will be available at `http://localhost:5173` (Vite's default port).
The backend API will be available at `http://localhost:3001`.

### Production Build

Build the frontend:
```bash
cd frontend
npm run build
```

Build the backend:
```bash
cd backend
npm run build
```

Start the backend:
```bash
cd backend
npm start
```

Serve the frontend build from nginx.

The use the nginx config in the envn.celinaisd.tech file.

Run the following commands:

```bash
sudo apt update && sudo apt upgrade
sudo apt install nginx
sudo rm -rf /etc/nginx/sites-enabled/default
sudo nano /etc/nginx/sites-avalible/your-domain
Paste in config from file.
sudo ln /etc/nginx/sites-avalible/your-domain /etc/nginx/sites-enabled/your-domain
sudo nginx -t
if ok:
sudo systemctl restart nginx
if not:
retrace steps
```
make sure port 443 (certbot) & port 80 (http) is allowed from ufw.
---

## Configuration

### Web Interface

1. Navigate to the Settings page (accessible via the navigation menu)
2. **Configure Locations**: Add location names and shortcodes
3. **Configure Devices**: 
   - Name: Device hostname (default is ESP_XXXXXX where XXXXXX are the last 6 digits of the MAC address)
   - Campus/Shortcode: Must match a configured location shortcode
   - Location: Descriptive location name
4. **Configure Alarms**: Set email addresses and temperature thresholds for notifications

### NodeMCU Configuration

1. Modify the Arduino code in the `arduino/` directory:
   - Update WiFi network credentials
   - Update the backend API server URL (point to `http://your-server:3001/api/write`)
2. Flash your NodeMCU with the modified code
3. Connect the DS18B20 temperature sensor according to the pinout diagram

---

## API Endpoints

### Devices
- `GET /api/devices` - Get all devices
- `POST /api/devices` - Add a new device
- `DELETE /api/devices/:id` - Delete a device

### Locations
- `GET /api/locations` - Get all locations
- `POST /api/locations` - Add a new location
- `DELETE /api/locations/:id` - Delete a location

### Alarms
- `GET /api/alarms` - Get all alarms
- `POST /api/alarms` - Add a new alarm
- `DELETE /api/alarms/:id` - Delete an alarm

### Temperature Data
- `GET /api/dashboard` - Get temperature data for all devices
- `GET /api/temperature/:deviceName` - Get latest temperature for a device
- `GET /api/temperature/:deviceName/history` - Get temperature history
- `POST /api/write` - Write temperature data (used by NodeMCU)

---

## Project Structure

```
.
├── backend/              # Backend API (Node.js + Express + TypeScript)
│   ├── src/
│   │   └── index.ts     # Main API server
│   ├── package.json
│   └── tsconfig.json
├── frontend/            # Frontend (React + TypeScript + Vite)
│   ├── src/
│   │   ├── components/  # React components
│   │   ├── pages/       # Page components
│   │   ├── api.ts       # API client
│   │   ├── types.ts     # TypeScript types
│   │   └── App.tsx      # Main App component
│   ├── package.json
│   └── vite.config.ts
├── arduino/             # Arduino code for NodeMCU
├── data.sql            # Database schema
└── README.md
```

---

## Migration from PHP

This project has been completely rewritten from PHP to a modern React + TypeScript stack. The legacy PHP files are still present in the repository root for reference but are no longer used. The new application provides the same functionality with improved:

- Type safety with TypeScript
- Modern React component architecture
- RESTful API design
- Better separation of concerns
- Improved development experience with Vite

---

## License

ISC

---

## Copyright

2018 ©

