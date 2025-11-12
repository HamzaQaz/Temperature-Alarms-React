import { Link } from 'react-router-dom';
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

  return (
    <Card className={`${hasMoldRisk ? 'border-2 border-destructive' : ''}`}>
      <CardContent className="p-6">
        <div className="flex justify-between items-start mb-1">
          <div>
            <h6 className="font-semibold flex items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              {data.campus} - {data.location}
            </h6>
          </div>
          <div className="flex gap-2">
            {/* Connection Status Badge */}
            <span className={`px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1 ${
              deviceStatus === 'online' 
                ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                : deviceStatus === 'pinging'
                ? 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-500'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
            }`}>
              {deviceStatus === 'online' && <Wifi className="h-3 w-3" />}
              {deviceStatus === 'pinging' && <RefreshCw className="h-3 w-3 animate-spin" />}
              {deviceStatus === 'offline' && <WifiOff className="h-3 w-3" />}
              {deviceStatus === 'online' ? 'Online' : deviceStatus === 'pinging' ? 'Pinging' : 'Offline'}
            </span>
            
            {/* Mold Risk Badge */}
            {hasMoldRisk && (
              <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                riskLevel === 'high'
                  ? 'bg-destructive/20 text-destructive animate-pulse'
                  : 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-500 animate-pulse'
              }`}>
                <AlertTriangle className="inline h-3 w-3 mr-1 animate-bounce" />
                {riskLevel === 'high' ? 'High Risk' : 'Moderate Risk'}
              </span>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Thermometer className="h-5 w-5 text-muted-foreground" />
                <span className="text-sm">Temperature</span>
              </div>
              <span className="font-semibold text-lg">
                <NumberFlow value={data.temperature || 0} suffix="°F" />
              </span>
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Droplets className="h-5 w-5 text-muted-foreground" />
                <span className="text-sm">Humidity</span>
              </div>
              {data.humidity !== null ? (
                <span className="font-semibold text-lg">
                  <NumberFlow value={data.humidity} suffix="%" />
                </span>
              ) : (
                <span className="font-semibold text-lg">--</span>
              )}
            </div>
            {data.humidity === null && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Minus className="h-3 w-3" />
                <span>No data available</span>
              </div>
            )}
          </div>

          {hasMoldRisk && (
            <div className={`text-xs px-3 py-2 rounded-lg ${
              riskLevel === 'high' 
                ? 'bg-destructive/20 text-destructive' 
                : 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-500'
            }`}>
              <p className="font-medium">
                ⚠️ Mold Risk Alert
              </p>
              <p className="mt-1">
                This location is at risk of mold growth due to {riskLevel === 'high' ? 'high' : 'elevated'} temperature and humidity levels.
              </p>
            </div>
          )}

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm">Last Updated</span>
            </div>
            <span className="font-semibold text-sm">
              {formatTimeAgo(data.date || '', data.time || '')}
            </span>
          </div>

          <div className="flex items-center justify-between pt-2 border-t">
            <span className="text-xs text-muted-foreground">
              Next update in{' '}
              <NumberFlow
                value={countdown}
                suffix="s"
              />
            </span>
            <Button asChild size="sm" variant="outline">
              <Link to={`/history?device=${data.name}&date=${data.date || ''}`}>
                <History className="mr-2 h-4 w-4" />
                History
              </Link>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default TemperatureCard;
