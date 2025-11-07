import type { DashboardData } from '../types';

interface TemperatureCardProps {
  data: DashboardData;
}

const TemperatureCard: React.FC<TemperatureCardProps> = ({ data }) => {
  const formatTime = (time: string | null) => {
    if (!time) return '';
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
    <div className="col-sm" style={{ marginBottom: '20px' }}>
      <div className="card" style={{ width: '250px', marginTop: '40px' }}>
        <div className="card-header">
          <p style={{ marginBottom: 0, float: 'left' }}>
            <strong>{data.campus}</strong>
          </p>
          <p style={{ marginBottom: 0, float: 'right' }}>
            <strong>{data.location}</strong>
          </p>
          <div style={{ clear: 'both' }}></div>
        </div>
        <div className="card-body">
          <h1 className="card-text" style={{ fontSize: '72px', textAlign: 'center' }}>
            {data.temperature !== null ? `${data.temperature}°` : 'N/A'}
          </h1>
        </div>
        <div className="card-footer text-muted">
          <span style={{ fontSize: '12px', display: 'inline-block', paddingTop: '7px' }}>
            {data.date && data.time ? `${data.date} ${formatTime(data.time)}` : 'No data'}
          </span>
          <a 
            href={`/history?device=${data.name}&date=${data.date || ''}`}
            className="btn btn-primary btn-sm"
            style={{ float: 'right', margin: '0px' }}
          >
            History
          </a>
          <div style={{ clear: 'both' }}></div>
        </div>
      </div>
    </div>
  );
};

export default TemperatureCard;
