import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getDashboardData, getLocations } from '../api';
import type { DashboardData, Location } from '../types';
import NumberFlow from '@number-flow/react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isMoldRisk } from '@/lib/moldRisk';
import TemperatureCard from '@/components/TemperatureCard';
import { 
  Building2, 
  AlertTriangle, 
  Thermometer, 
  Droplets,
  RefreshCw
} from "lucide-react";

const Dashboard: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
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
                humidity: message.data.humidity,
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

  const handleFilterChange = (value: string) => {
    if (value === 'all') {
      setSearchParams({});
    } else {
      setSearchParams({ filter: value });
    }
  };

  // Calculate summary stats
  const totalLocations = dashboardData.length;
  const activeAlerts = dashboardData.filter(d => isMoldRisk(d.temperature, d.humidity)).length;
  const avgTemp = dashboardData.length > 0
    ? Math.round(dashboardData.reduce((sum, d) => sum + (d.temperature || 0), 0) / dashboardData.length)
    : 0;
  const avgHumidity = dashboardData.length > 0
    ? Math.round(dashboardData.reduce((sum, d) => sum + (d.humidity || 0), 0) / dashboardData.length)
    : 0;

  return (
    <div className="flex-1 space-y-4">
      {/* Header with Filters */}
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
        <Button onClick={loadData} variant="outline" size="sm">
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      <Tabs value={filter || 'all'} onValueChange={handleFilterChange}>
        <TabsList>
          <TabsTrigger value="all">All Locations</TabsTrigger>
          {locations.map((location) => (
            <TabsTrigger key={location.ID} value={location.SHORTCODE}>
              {location.NAME}
            </TabsTrigger>
          ))}
        </TabsList>
        
        <TabsContent value={filter || 'all'} className="space-y-4">
          {loading && (
            <div className="flex items-center justify-center p-8">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
                <p className="mt-2 text-sm text-muted-foreground">Loading...</p>
              </div>
            </div>
          )}
          
          {error && (
            <div className="bg-destructive/20 text-destructive border border-destructive rounded-lg p-4">
              {error}
            </div>
          )}
          
          {!loading && !error && (
            <>
              {/* Summary Cards */}
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">Total Locations</p>
                        <h3 className="text-2xl font-bold">{totalLocations}</h3>
                      </div>
                      <Building2 className="h-8 w-8 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">Active Alerts</p>
                        <h3 className="text-2xl font-bold">{activeAlerts}</h3>
                      </div>
                      <AlertTriangle className="h-8 w-8 text-yellow-500" />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">Avg Temperature</p>
                        <h3 className="text-2xl font-bold">
                          <NumberFlow value={avgTemp} suffix="°F" />
                        </h3>
                      </div>
                      <Thermometer className="h-8 w-8 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">Avg Humidity</p>
                        <h3 className="text-2xl font-bold"><NumberFlow value={avgHumidity} suffix="%" /></h3>
                      </div>
                      <Droplets className="h-8 w-8 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Location Detail Cards */}
              {dashboardData.length === 0 ? (
                <div className="text-center p-8 border-2 border-dashed rounded-lg">
                  <p className="text-muted-foreground">No devices configured for this location.</p>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3">
                  {dashboardData.map((data) => (
                    <TemperatureCard 
                      key={data.id} 
                      data={data}
                      countdown={countdowns[data.id] || 0}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Dashboard;
