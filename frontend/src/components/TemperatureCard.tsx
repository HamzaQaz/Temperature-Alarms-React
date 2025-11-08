import { Link } from 'react-router-dom';
import type { DashboardData } from '../types';
import NumberFlow from '@number-flow/react'

interface TemperatureCardProps {
  data: DashboardData;
  countdown?: number;
}
type Temp = number | null;
const TemperatureCard: React.FC<TemperatureCardProps> = ({ data, countdown = 0 }) => {
  
  
  const temp: Temp = data.temperature;

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
            <NumberFlow
              value={temp ?? 0}
              format={{notation: "compact"}}
              locales="en-US"
              willChange
              suffix="°"
            />
          </h1>
        </div>
        <div className="card-footer text-muted">
            <span style={{ fontSize: '12px', display: 'inline-block', paddingTop: '7px' }}>
            {data.date && data.time ? (
              <>
              {data.date}{' '}
              <NumberFlow
                value={parseInt(data.time.split(':')[0])}
                format={{ minimumIntegerDigits: 2 }}
                locales="en-US"
              />
              :
              <NumberFlow
                value={parseInt(data.time.split(':')[1])}
                format={{ minimumIntegerDigits: 2 }}
                locales="en-US"
              />
              {' '}{parseInt(data.time.split(':')[0]) >= 12 ? 'AM' : 'PM'}
              </>
            ) : 'No data'}
            
            </span>
            <span style={{ fontSize: '12px', display: 'inline-block', paddingTop: '7px' }}>
            Next update in{' '}
            <NumberFlow
              value={countdown}
              format={{notation: "compact"}}
              locales="en-US"
              willChange
              suffix="s"
            />
            </span>
          <Link 
            to={`/history?device=${data.name}&date=${data.date || ''}`}
            className="btn btn-primary btn-sm"
            style={{ float: 'right', margin: '0px' }}
          >
            History
          </Link>
          
          <div style={{ clear: 'both' }}></div>
        </div>
      </div>
    </div>
  );
};

export default TemperatureCard;
