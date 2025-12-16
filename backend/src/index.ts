import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import rateLimit from 'express-rate-limit';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.set('trust proxy', true);
// CORS configuration
const allowedOrigins = [
  process.env.CORS_ORIGIN
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, curl, Postman)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1 || allowedOrigins.includes('*')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Rate limiting middleware
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // Limit each IP to 500 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests from this IP, please try again later.',
  validate: false
});

const writeLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 20, // Limit each IP to 20 write requests per minute (NodeMCU updates)
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many write requests from this IP, please try again later.',
  validate: false
});

// Apply rate limiting to all routes
app.use('/api/', limiter);

// Database configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'temp'
};

// Check that required database password is set
if (!dbConfig.password) {
  console.error('ERROR: DB_PASSWORD environment variable is required');
  process.exit(1);
}

// Helper function to get database connection
async function getConnection() {
  return await createConnection(dbConfig);
}

// Helper function to safely escape table/column names
function escapeIdentifier(identifier: string): string {
  // Only allow alphanumeric characters and underscores, but not starting with underscore
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(identifier)) {
    throw new Error('Invalid table or column name');
  }
  return `\`${identifier}\``;
}

// ==================== DEVICE ROUTES ====================

// Health check route
app.get('/api/health', async (req: Request, res: Response) => {
  try {
    const connection = await getConnection();
    await connection.ping();
    await connection.end();
    res.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(503).json({ status: 'error', database: 'disconnected' });
  }
});

// Get all devices
app.get('/api/devices', async (req: Request, res: Response) => {
  try {
    const connection = await getConnection();
    const [rows] = await connection.execute<RowDataPacket[]>(
      'SELECT * FROM devices ORDER BY Campus, Location'
    );
    await connection.end();
    res.json(rows);
  } catch (error) {
    console.error('Error fetching devices:', error);
    res.status(500).json({ error: 'Failed to fetch devices' });
  }
});

// Add a new device
app.post('/api/devices', async (req: Request, res: Response) => {
  const { name, campus, location } = req.body;
  
  if (!name || !campus || !location) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    const connection = await getConnection();
    
    // Validate table name
    const safeName = escapeIdentifier(name);
    
    // Insert device
    const [result] = await connection.execute<ResultSetHeader>(
      'INSERT INTO devices (Name, Campus, Location) VALUES (?, ?, ?)',
      [name, campus, location]
    );
    
    // Create table for device with escaped name
    await connection.execute(
      `CREATE TABLE IF NOT EXISTS ${safeName} (
        \`ID\` int(11) NOT NULL AUTO_INCREMENT,
        \`CAMPUS\` varchar(20) NOT NULL,
        \`LOCATION\` varchar(20) NOT NULL,
        \`DATE\` varchar(20) NOT NULL,
        \`TIME\` varchar(20) NOT NULL,
        \`TEMP\` int(20) NOT NULL,
        \`HUMIDITY\` int(20) DEFAULT NULL,
        PRIMARY KEY (\`ID\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8`
    );
    
    await connection.end();
    res.status(201).json({ id: result.insertId, name, campus, location });
  } catch (error) {
    console.error('Error adding device:', error);
    res.status(500).json({ error: 'Failed to add device' });
  }
});

// Delete a device
app.delete('/api/devices/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name } = req.query;

  try {
    const connection = await getConnection();
    
    // Delete device
    await connection.execute('DELETE FROM devices WHERE ID = ? LIMIT 1', [id]);
    
    // Truncate device table if name provided
    if (name && typeof name === 'string') {
      const safeName = escapeIdentifier(name);
      await connection.execute(`TRUNCATE TABLE ${safeName}`);
    }
    
    await connection.end();
    res.json({ message: 'Device deleted successfully' });
  } catch (error) {
    console.error('Error deleting device:', error);
    res.status(500).json({ error: 'Failed to delete device' });
  }
});

// ==================== LOCATION ROUTES ====================

// Get all locations
app.get('/api/locations', async (req: Request, res: Response) => {
  try {
    const connection = await getConnection();
    const [rows] = await connection.execute<RowDataPacket[]>(
      'SELECT * FROM locations ORDER BY ID'
    );
    await connection.end();
    res.json(rows);
  } catch (error) {
    console.error('Error fetching locations:', error);
    res.status(500).json({ error: 'Failed to fetch locations' });
  }
});

// Add a new location
app.post('/api/locations', async (req: Request, res: Response) => {
  const { name, shortcode } = req.body;
  
  if (!name || !shortcode) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    const connection = await getConnection();
    const [result] = await connection.execute<ResultSetHeader>(
      'INSERT INTO locations (NAME, SHORTCODE) VALUES (?, ?)',
      [name, shortcode]
    );
    await connection.end();
    res.status(201).json({ id: result.insertId, name, shortcode });
  } catch (error) {
    console.error('Error adding location:', error);
    res.status(500).json({ error: 'Failed to add location' });
  }
});

// Delete a location
app.delete('/api/locations/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const connection = await getConnection();
    await connection.execute('DELETE FROM locations WHERE ID = ? LIMIT 1', [id]);
    await connection.end();
    res.json({ message: 'Location deleted successfully' });
  } catch (error) {
    console.error('Error deleting location:', error);
    res.status(500).json({ error: 'Failed to delete location' });
  }
});

// ==================== ALARM ROUTES ====================

// Get all alarms
app.get('/api/alarms', async (req: Request, res: Response) => {
  try {
    const connection = await getConnection();
    const [rows] = await connection.execute<RowDataPacket[]>(
      'SELECT * FROM alarms ORDER BY ID'
    );
    await connection.end();
    res.json(rows);
  } catch (error) {
    console.error('Error fetching alarms:', error);
    res.status(500).json({ error: 'Failed to fetch alarms' });
  }
});

// Add a new alarm
app.post('/api/alarms', async (req: Request, res: Response) => {
  const { email, temp } = req.body;
  
  if (!email || !temp) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    const connection = await getConnection();
    const [result] = await connection.execute<ResultSetHeader>(
      'INSERT INTO alarms (EMAIL, TEMP) VALUES (?, ?)',
      [email, temp]
    );
    await connection.end();
    res.status(201).json({ id: result.insertId, email, temp });
  } catch (error) {
    console.error('Error adding alarm:', error);
    res.status(500).json({ error: 'Failed to add alarm' });
  }
});

// Delete an alarm
app.delete('/api/alarms/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const connection = await getConnection();
    await connection.execute('DELETE FROM alarms WHERE ID = ? LIMIT 1', [id]);
    await connection.end();
    res.json({ message: 'Alarm deleted successfully' });
  } catch (error) {
    console.error('Error deleting alarm:', error);
    res.status(500).json({ error: 'Failed to delete alarm' });
  }
});

// ==================== TEMPERATURE DATA ROUTES ====================

// Get latest temperature data for a device
app.get('/api/temperature/:deviceName', async (req: Request, res: Response) => {
  const { deviceName } = req.params;

  try {
    const connection = await getConnection();
    const safeName = escapeIdentifier(deviceName);
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT * FROM ${safeName} ORDER BY id DESC LIMIT 1`
    );
    await connection.end();
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'No data found' });
    }
    
    res.json(rows[0]);
  } catch (error) {
    console.error('Error fetching temperature:', error);
    res.status(500).json({ error: 'Failed to fetch temperature' });
  }
});

// Get temperature history for a device
app.get('/api/temperature/:deviceName/history', async (req: Request, res: Response) => {
  const { deviceName } = req.params;
  const { date } = req.query;

  try {
    const connection = await getConnection();
    const safeName = escapeIdentifier(deviceName);
    let query = `SELECT * FROM ${safeName} ORDER BY id DESC`;
    const params: any[] = [];
    
    if (date) {
      query = `SELECT * FROM ${safeName} WHERE DATE = ? ORDER BY id DESC`;
      params.push(date);
    }
    
    const [rows] = await connection.execute<RowDataPacket[]>(query, params);
    await connection.end();
    res.json(rows);
  } catch (error) {
    console.error('Error fetching temperature history:', error);
    res.status(500).json({ error: 'Failed to fetch temperature history' });
  }
});

// Get temperature history (alternative endpoint used by frontend)
app.get('/api/history', async (req: Request, res: Response) => {
  const { device, date } = req.query;

  if (!device || typeof device !== 'string') {
    return res.status(400).json({ error: 'Device parameter is required' });
  }

  try {
    const connection = await getConnection();
    const safeName = escapeIdentifier(device);
    let query = `SELECT * FROM ${safeName} ORDER BY id DESC`;
    const params: any[] = [];
    
    if (date && typeof date === 'string') {
      query = `SELECT * FROM ${safeName} WHERE DATE = ? ORDER BY id DESC`;
      params.push(date);
    }
    
    const [rows] = await connection.execute<RowDataPacket[]>(query, params);
    await connection.end();
    res.json(rows);
  } catch (error) {
    console.error('Error fetching temperature history:', error);
    res.status(500).json({ error: 'Failed to fetch temperature history' });
  }
});

// Delete/reset temperature history for a device
app.delete('/api/temperature/:deviceName/history', async (req: Request, res: Response) => {
  const { deviceName } = req.params;

  try {
    const connection = await getConnection();
    const safeName = escapeIdentifier(deviceName);
    
    // Delete all records from the device table
    await connection.execute(`DELETE FROM ${safeName}`);
    await connection.end();
    
    res.json({ message: 'Temperature history reset successfully' });
  } catch (error) {
    console.error('Error resetting temperature history:', error);
    res.status(500).json({ error: 'Failed to reset temperature history' });
  }
});

// Get temperature data for all devices (dashboard)
app.get('/api/dashboard', async (req: Request, res: Response) => {
  const { filter } = req.query;
  const filterStr = typeof filter === 'string' ? filter : undefined;

  try {
    const connection = await getConnection();
    const [devices] = await connection.execute<RowDataPacket[]>(
      'SELECT * FROM devices ORDER BY Campus, Location'
    );
    
    const dashboardData = await Promise.all(
      devices.map(async (device) => {
        try {
          const safeName = escapeIdentifier(device.Name);
          const [tempData] = await connection.execute<RowDataPacket[]>(
            `SELECT * FROM ${safeName} ORDER BY id DESC LIMIT 1`
          );
          
          return {
            id: device.ID,
            name: device.Name,
            campus: device.Campus,
            location: device.Location,
            temperature: tempData.length > 0 ? tempData[0].TEMP : null,
            humidity: tempData.length > 0 ? (tempData[0].HUMIDITY || null) : null,
            date: tempData.length > 0 ? tempData[0].DATE : null,
            time: tempData.length > 0 ? tempData[0].TIME : null
          };
        } catch (error) {
          console.error(`Error fetching data for device ${device.Name}:`, error);
          return {
            id: device.ID,
            name: device.Name,
            campus: device.Campus,
            location: device.Location,
            temperature: null,
            humidity: null,
            date: null,
            time: null
          };
        }
      })
    );
    
    await connection.end();
    
    // Filter by campus if filter parameter is provided (case-insensitive)
    const filteredData = filterStr 
      ? dashboardData.filter(d => d.campus?.toLowerCase() === filterStr.toLowerCase())
      : dashboardData;
    
    res.json(filteredData);
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

// ==================== SSE ENDPOINT (Server-Sent Events) ====================

// Store connected SSE clients
const sseClients = new Set<Response>();

// SSE endpoint for live dashboard updates
app.get('/api/dashboard/stream', (req: Request, res: Response) => {
  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Add client to set
  sseClients.add(res);
  console.log(`SSE client connected. Total clients: ${sseClients.size}`);

  // Send initial connection message
  res.write('data: {"type":"connected"}\n\n');

  // Remove client on disconnect
  req.on('close', () => {
    sseClients.delete(res);
    console.log(`SSE client disconnected. Total clients: ${sseClients.size}`);
  });
});

// Helper function to broadcast updates to all SSE clients
function broadcastUpdate(deviceName: string, data: any) {
  const message = `data: ${JSON.stringify({ type: 'update', device: deviceName, data })}\n\n`;
  sseClients.forEach(client => {
    try {
      client.write(message);
    } catch (error) {
      console.error('Error broadcasting to client:', error);
      sseClients.delete(client);
    }
  });
}

// ==================== WRITE ENDPOINT (for NodeMCU) ====================

// Write temperature data (from NodeMCU) - separate rate limiter for IoT devices
app.post('/api/write', writeLimiter, async (req: Request, res: Response) => {
  const { table, temp, humidity } = req.body;

  if (!table || temp === undefined) {
    return res.status(400).json({ error: 'Table and temp fields are required' });
  }
  const tableName = table.replace(/-/g, '_');

  try {
    const connection = await getConnection();
    
    // Get device info from devices table
    const [deviceRows] = await connection.execute<RowDataPacket[]>(
      'SELECT Campus, Location FROM devices WHERE Name = ? LIMIT 1',
      [tableName]
    );
    
    if (deviceRows.length === 0) {
      await connection.end();
      return res.status(404).json({ error: 'Unknown device' });
    }
    
    const { Campus: campus, Location: location } = deviceRows[0];
    const date = new Date().toLocaleDateString();
    const time = new Date().toLocaleTimeString();
    
    const safeName = escapeIdentifier(tableName);
    
    // Check if device table exists, create if not (with humidity column)
    await connection.execute(
      `CREATE TABLE IF NOT EXISTS ${safeName} (
        \`ID\` int(11) NOT NULL AUTO_INCREMENT,
        \`CAMPUS\` varchar(20) NOT NULL,
        \`LOCATION\` varchar(20) NOT NULL,
        \`DATE\` varchar(20) NOT NULL,
        \`TIME\` varchar(20) NOT NULL,
        \`TEMP\` int(20) NOT NULL,
        \`HUMIDITY\` int(20) DEFAULT NULL,
        PRIMARY KEY (\`ID\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8`
    );
    
    // Insert temperature and humidity data
    await connection.execute(
      `INSERT INTO ${safeName} (CAMPUS, LOCATION, DATE, TIME, TEMP, HUMIDITY) VALUES (?, ?, ?, ?, ?, ?)`,
      [campus, location, date, time, temp, humidity || null]
    );
    
    await connection.end();
    
    // Broadcast update to all connected SSE clients
    broadcastUpdate(tableName, {
      campus,
      location,
      temperature: temp,
      humidity: humidity || null,
      date,
      time
    });
    
    res.status(201).json({ message: 'Temperature data recorded' });
  } catch (error) {
    console.error('Error writing temperature data:', error);
    res.status(500).json({ error: 'Failed to write temperature data' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
