import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { getTemperatureHistory } from '../api';
import type { TemperatureData } from '../types';

const History: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const device = searchParams.get('device') || '';
  const date = searchParams.get('date') || '';

  const [history, setHistory] = useState<TemperatureData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    if (!device) return;
    
    try {
      setLoading(true);
      const data = await getTemperatureHistory(device, date || undefined);
      setHistory(data);
      setError(null);
    } catch (err) {
      setError('Failed to load history data');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [device, date]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const formatTime = (time: string) => {
    // Remove seconds and add AM/PM formatting
    const parts = time.split(':');
    if (parts.length >= 2) {
      const hour = parseInt(parts[0]);
      const minute = parts[1];
      const ampm = hour >= 12 ? 'PM' : 'AM';
      const displayHour = hour % 12 || 12;
      return `${displayHour}:${minute} ${ampm}`;
    }
    return time;
  };

  return (
    <div>
      {/* Header */}
      <div className="jumbotron jumbotron-fluid bg-light" style={{ marginBottom: 0, paddingBottom: '5px' }}>
        <h1 style={{ display: 'inline', marginLeft: '20px', float: 'left' }}>
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>
            <i className="fas fa-chevron-left"></i>
          </a>
        </h1>
        <h1 style={{ textAlign: 'center', marginBottom: 0 }}>
          History: {device}
        </h1>
        <br />
        <br />
      </div>

      {/* Content */}
      <div className="container mt-4">
        {loading && <p className="text-center">Loading...</p>}
        {error && <div className="alert alert-danger">{error}</div>}
        {!loading && !error && history.length === 0 && (
          <p className="text-center">No history data available for this device.</p>
        )}
        {!loading && !error && history.length > 0 && (
          <table className="table table-striped">
            <thead>
              <tr>
                <th>Date</th>
                <th>Time</th>
                <th>Campus</th>
                <th>Location</th>
                <th>Temperature</th>
              </tr>
            </thead>
            <tbody>
              {history.map((record) => (
                <tr key={record.ID}>
                  <td>{record.DATE}</td>
                  <td>{formatTime(record.TIME)}</td>
                  <td>{record.CAMPUS}</td>
                  <td>{record.LOCATION}</td>
                  <td>{record.TEMP}°</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default History;
