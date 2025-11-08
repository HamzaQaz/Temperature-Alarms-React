import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { getDashboardData, getLocations } from '../api';
import type { DashboardData, Location } from '../types';
import TemperatureCard from '../components/TemperatureCard';

const Dashboard: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const filter = searchParams.get('filter') || '';
  
  const [dashboardData, setDashboardData] = useState<DashboardData[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [countdowns, setCountdowns] = useState<Record<number, number>>({});

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [data, locs] = await Promise.all([
        getDashboardData(filter || undefined),
        getLocations()
      ]);
      setDashboardData(data);
      setLocations(locs);
      setError(null);
    } catch (err) {
      setError('Failed to load data. Please make sure the backend server is running.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Countdown timer effect
  useEffect(() => {
    const interval = setInterval(() => {
      setCountdowns(prev => {
        const updated = { ...prev };
        Object.keys(updated).forEach(id => {
          if (updated[Number(id)] > 0) {
            updated[Number(id)] -= 1;
          }
        });
        return updated;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Initialize countdowns when dashboard data loads
  useEffect(() => {
    const newCountdowns: Record<number, number> = {};
    dashboardData.forEach(device => {
      if (countdowns[device.id] === undefined) {
        newCountdowns[device.id] = 30;
      } else {
        newCountdowns[device.id] = countdowns[device.id];
      }
    });
    setCountdowns(newCountdowns);
  }, [dashboardData.length]);

  // Setup SSE for live updates
  useEffect(() => {
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
    const eventSource = new EventSource(`${apiUrl}/api/dashboard/stream`);

    eventSource.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        
        if (message.type === 'connected') {
          console.log('Connected to live updates');
        } else if (message.type === 'update') {
          // Update the specific device data
          setDashboardData(prev => prev.map(device => {
            if (device.name === message.device) {
              // Reset countdown to 30 when new data arrives
              setCountdowns(prevCountdowns => ({
                ...prevCountdowns,
                [device.id]: 30
              }));
              
              return {
                ...device,
                temperature: message.data.temperature,
                date: message.data.date,
                time: message.data.time
              };
            }
            return device;
          }));
        }
      } catch (err) {
        console.error('Error parsing SSE message:', err);
      }
    };

    eventSource.onerror = (err) => {
      console.error('SSE error:', err);
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, []);

  const handleFilterClick = (shortcode: string) => {
    if (shortcode === filter) {
      navigate('/');
    } else {
      navigate(`/?filter=${shortcode}`);
    }
  };

  // Group cards into rows of 4
  const rows: DashboardData[][] = [];
  for (let i = 0; i < dashboardData.length; i += 4) {
    rows.push(dashboardData.slice(i, i + 4));
  }

  return (
    <div>
      {/* Header */}
      <div className="jumbotron jumbotron-fluid bg-light" style={{ marginBottom: 0, paddingBottom: '5px' }}>
        <h1 style={{ textAlign: 'center', marginBottom: 0 }}>Temperature Alarms</h1>
      </div>

      {/* Navigation */}
      <nav className="navbar navbar-expand-md navbar-light bg-light" style={{ marginTop: 0 }}>
        <div className="d-flex w-50 order-0">
          <button
            className="navbar-toggler"
            type="button"
            data-toggle="collapse"
            data-target="#collapsingNavbar"
          >
            <span className="navbar-toggler-icon"></span>
          </button>
        </div>
        <div className="navbar-collapse collapse justify-content-center order-2" id="collapsingNavbar">
          <ul className="navbar-nav">
            <li className="nav-item">
              <a
                className={`nav-link ${!filter ? 'active' : ''}`}
                href="/"
                onClick={(e) => {
                  e.preventDefault();
                  navigate('/');
                }}
              >
                All
              </a>
            </li>
            {locations.map((location) => (
              <li key={location.ID} className="nav-item">
                <a
                  className={`nav-link ${filter === location.SHORTCODE ? 'active' : ''}`}
                  href={`/?filter=${location.SHORTCODE}`}
                  onClick={(e) => {
                    e.preventDefault();
                    handleFilterClick(location.SHORTCODE);
                  }}
                >
                  {location.NAME}
                </a>
              </li>
            ))}
            <li className="nav-item">
              <a
                className="nav-link"
                href="/settings"
                onClick={(e) => {
                  e.preventDefault();
                  navigate('/settings');
                }}
              >
                Settings
              </a>
            </li>
          </ul>
        </div>
        <span className="navbar-text small text-truncate mt-1 w-50 text-right order-1 order-md-last"></span>
      </nav>

      {/* Content */}
      <div className="container">
        {loading && <p className="text-center mt-4">Loading...</p>}
        {error && <div className="alert alert-danger mt-4">{error}</div>}
        {!loading && !error && dashboardData.length === 0 && (
          <p className="text-center mt-4">No devices configured.</p>
        )}
        {!loading && !error && rows.map((row, idx) => (
          <div key={idx} className="row">
            {row.map((data) => (
              <TemperatureCard key={data.id} data={data} countdown={countdowns[data.id] || 0} />
            ))}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="footer bg-light" style={{ bottom: 0, width: '100%', textAlign: 'center', marginTop: '10px' }}>
        <p>{new Date().getFullYear()} &copy;</p>
      </div>
    </div>
  );
};

export default Dashboard;
