//import { Link } from 'react-router-dom';
import type { DashboardData } from '../types';
import NumberFlow from '@number-flow/react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { History, MapPin, Thermometer, Droplets, Clock, AlertTriangle, Minus, Wifi, WifiOff, RefreshCw } from "lucide-react";
import { isMoldRisk, getMoldRiskLevel } from "@/lib/moldRisk";
import '../index.css';

interface TemperatureCardProps {
  data: DashboardData;
  countdown?: number;
}

const TemperatureCard: React.FC<TemperatureCardProps> = ({ data, countdown = 0 }) => {
  const hasMoldRisk = isMoldRisk(data.temperature, data.humidity);
  const riskLevel = getMoldRiskLevel(data.temperature, data.humidity);

  // Calculate device status based on last update time
  const getDeviceStatus = (date: string, time: string): 'online' | 'pinging' | 'offline' => {
    if (!date || !time) return 'offline';
    const now = new Date();
    const deviceTime = new Date(`${date} ${time}`);
    const diffMs = now.getTime() - deviceTime.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'online';
    if (diffMins < 2) return 'pinging';
    return 'offline';
  };

  const deviceStatus = getDeviceStatus(data.date || '', data.time || '');

  const formatTimeAgo = (date: string, time: string) => {
    if (!date || !time) return 'No data';
    const now = new Date();
    const deviceTime = new Date(`${date} ${time}`);
    const diffMs = now.getTime() - deviceTime.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    return `${diffHours}h ago`;
  };

  // Tailwind "status-badge" styles to mimic the location card look
  const baseBadge = "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium";
  const statusBadgeClass =
    deviceStatus === 'online'
      ? `${baseBadge} bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400`
      : deviceStatus === 'pinging'
      ? `${baseBadge} bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400`
      : `${baseBadge} bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400`;

  const moldBadgeClass =
    riskLevel === 'high'
      ? `${baseBadge} bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400`
      : `${baseBadge} bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400`;

  // Tailwind "metric-row" styles to mimic the location card look
  const metricRow = "flex items-center justify-between py-2 border-t first:border-t-0";
  const metricLeft = "flex items-center gap-2";
  const metricIconWrap = "flex items-center justify-center h-8 w-8 rounded-full bg-muted text-muted-foreground";

  return (
    <Card className={`${hasMoldRisk ? 'border-2 border-destructive' : 'border'} rounded-lg shadow-sm`}>
      <CardContent className="p-4">
        {/* Header: Title and status badges (styled like location card header) */}
        <div className="flex justify-between items-center mb-3">
          <h6 className="text-sm font-semibold flex items-center gap-2">
            <MapPin className="h-4 w-4 text-muted-foreground" />
            {data.campus} - {data.location}
          </h6>

          <div className="flex items-center gap-2">
            <span className={statusBadgeClass}>
              {deviceStatus === 'online' && <Wifi className="h-3 w-3 mr-1" />}
              {deviceStatus === 'pinging' && <RefreshCw className="h-3 w-3 mr-1 animate-spin" />}
              {deviceStatus === 'offline' && <WifiOff className="h-3 w-3 mr-1" />}
              {deviceStatus === 'online' ? 'Online' : deviceStatus === 'pinging' ? 'Pinging' : 'Offline'}
            </span>

            {hasMoldRisk && (
              <span className={moldBadgeClass}>
                <AlertTriangle className="h-3 w-3 mr-1" />
                {riskLevel === 'high' ? 'High Risk' : 'Moderate Risk'}
              </span>
            )}
          </div>
        </div>

        {/* Body: Metric rows (Temperature, Humidity, Last Updated) styled like location card metric rows */}
        <div className="mb-2">
          {/* Optional detail line similar to 'location-details' */}
          {/* Keeping data the same; this lightly surfaces device name without changing logic */}
          {data.name && (
            <div className="text-xs text-muted-foreground mb-2">
              Device: <span className="font-medium text-foreground">{data.name}</span>
            </div>
          )}

          {/* Temperature */}
          <div className={`${metricRow} pt-0`}>
            <div className={metricLeft}>
              <div className={metricIconWrap}>
                <Thermometer className="h-4 w-4" />
              </div>
              <span className="text-sm">Temperature</span>
            </div>
            <span className="text-sm font-semibold">
              <NumberFlow value={data.temperature || 0} suffix="°F" />
            </span>
          </div>

          {/* Humidity */}
          <div className={metricRow}>
            <div className={metricLeft}>
              <div className={metricIconWrap}>
                <Droplets className="h-4 w-4" />
              </div>
              <span className="text-sm">Humidity</span>
            </div>
            {data.humidity !== null ? (
              <span className="text-sm font-semibold">
                <NumberFlow value={data.humidity} suffix="%" />
              </span>
            ) : (
              <span className="text-sm font-semibold">--</span>
            )}
          </div>
          {data.humidity === null && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Minus className="h-3 w-3" />
              <span>No data available</span>
            </div>
          )}

          {/* Mold Risk Alert block (keep same logic, styled to fit card) */}
          {hasMoldRisk && (
            <div
              className={`text-xs px-3 py-2 rounded-lg mt-2 ${
                riskLevel === 'high'
                  ? 'bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-400'
                  : 'bg-yellow-100 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400'
              }`}
            >
              <p className="font-medium">⚠️ Mold Risk Alert</p>
              <p className="mt-1">
                This location is at risk of mold growth due to {riskLevel === 'high' ? 'high' : 'elevated'} temperature and humidity levels.
              </p>
            </div>
          )}

          {/* Last Updated */}
          <div className={metricRow}>
            <div className={metricLeft}>
              <div className={metricIconWrap}>
                <Clock className="h-4 w-4" />
              </div>
              <span className="text-sm">Last Updated</span>
            </div>
            <span className="text-xs font-semibold">
              {formatTimeAgo(data.date || '', data.time || '')}
            </span>
          </div>
        </div>

        {/* Footer: Next update + History button (kept same) */}
        <div className="flex items-center justify-between pt-3 border-t">
          <span className="text-xs text-muted-foreground">
            Next update in{' '}
            <NumberFlow value={countdown} suffix="s" />
          </span>
          <Button asChild size="sm" variant="outline">
            <Link to={`/history?device=${data.name}&date=${data.date || ''}`}>
              <History className="mr-2 h-4 w-4" />
              History
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default TemperatureCard