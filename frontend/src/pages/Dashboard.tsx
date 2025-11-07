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
              <TemperatureCard key={data.id} data={data} />
            ))}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="footer bg-light" style={{ bottom: 0, width: '100%', textAlign: 'center', marginTop: '10px' }}>
        <p>2018 &copy;</p>
      </div>
    </div>
  );
};

export default Dashboard;
