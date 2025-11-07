import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Database configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'T3mp12',
  database: process.env.DB_NAME || 'temp'
};

// Helper function to get database connection
async function getConnection() {
  return await createConnection(dbConfig);
}

// ==================== DEVICE ROUTES ====================

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
    
    // Insert device
    const [result] = await connection.execute<ResultSetHeader>(
      'INSERT INTO devices (Name, Campus, Location) VALUES (?, ?, ?)',
      [name, campus, location]
    );
    
    // Create table for device
    await connection.execute(
      `CREATE TABLE IF NOT EXISTS \`${name}\` (
        \`ID\` int(11) NOT NULL AUTO_INCREMENT,
        \`CAMPUS\` varchar(20) NOT NULL,
        \`LOCATION\` varchar(20) NOT NULL,
        \`DATE\` varchar(20) NOT NULL,
        \`TIME\` varchar(20) NOT NULL,
        \`TEMP\` int(20) NOT NULL,
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
    if (name) {
      await connection.execute(`TRUNCATE TABLE \`${name}\``);
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
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT * FROM \`${deviceName}\` ORDER BY id DESC LIMIT 1`
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
    let query = `SELECT * FROM \`${deviceName}\` ORDER BY id DESC`;
    const params: any[] = [];
    
    if (date) {
      query = `SELECT * FROM \`${deviceName}\` WHERE DATE = ? ORDER BY id DESC`;
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

// Get temperature data for all devices (dashboard)
app.get('/api/dashboard', async (req: Request, res: Response) => {
  const { filter } = req.query;

  try {
    const connection = await getConnection();
    const [devices] = await connection.execute<RowDataPacket[]>(
      'SELECT * FROM devices ORDER BY Campus, Location'
    );
    
    const dashboardData = await Promise.all(
      devices.map(async (device) => {
        try {
          const [tempData] = await connection.execute<RowDataPacket[]>(
            `SELECT * FROM \`${device.Name}\` ORDER BY id DESC LIMIT 1`
          );
          
          return {
            id: device.ID,
            name: device.Name,
            campus: device.Campus,
            location: device.Location,
            temperature: tempData.length > 0 ? tempData[0].TEMP : null,
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
            date: null,
            time: null
          };
        }
      })
    );
    
    await connection.end();
    
    // Filter by campus if filter parameter is provided
    const filteredData = filter 
      ? dashboardData.filter(d => d.campus === filter)
      : dashboardData;
    
    res.json(filteredData);
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

// ==================== WRITE ENDPOINT (for NodeMCU) ====================

// Write temperature data (from NodeMCU)
app.post('/api/write', async (req: Request, res: Response) => {
  const { device, campus, location, date, time, temp } = req.body;
  
  if (!device || !campus || !location || !date || !time || temp === undefined) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    const connection = await getConnection();
    
    // Check if device table exists, create if not
    await connection.execute(
      `CREATE TABLE IF NOT EXISTS \`${device}\` (
        \`ID\` int(11) NOT NULL AUTO_INCREMENT,
        \`CAMPUS\` varchar(20) NOT NULL,
        \`LOCATION\` varchar(20) NOT NULL,
        \`DATE\` varchar(20) NOT NULL,
        \`TIME\` varchar(20) NOT NULL,
        \`TEMP\` int(20) NOT NULL,
        PRIMARY KEY (\`ID\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8`
    );
    
    // Insert temperature data
    await connection.execute(
      `INSERT INTO \`${device}\` (CAMPUS, LOCATION, DATE, TIME, TEMP) VALUES (?, ?, ?, ?, ?)`,
      [campus, location, date, time, temp]
    );
    
    await connection.end();
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
