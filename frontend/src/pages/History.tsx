import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { getTemperatureHistory, resetTemperatureHistory } from '../api';
import type { TemperatureData } from '../types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, TrendingUp, TrendingDown, Thermometer, Trash2 } from "lucide-react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import type { ChartConfig } from "@/components/ui/chart";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import NumberFlow from '@number-flow/react';

const History: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const device = searchParams.get('device') || '';
  const date = searchParams.get('date') || '';

  const [history, setHistory] = useState<TemperatureData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [isResetting, setIsResetting] = useState(false);
  const itemsPerPage = 50;

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

  const handleResetHistory = async () => {
    if (!device) return;
    
    try {
      setIsResetting(true);
      await resetTemperatureHistory(device);
      await loadHistory(); // Reload to show empty state
    } catch (err) {
      setError('Failed to reset history');
      console.error(err);
    } finally {
      setIsResetting(false);
    }
  };

  // Set up SSE connection for live updates
  useEffect(() => {
    if (!device) return;

    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
    const eventSource = new EventSource(`${apiUrl}/api/dashboard/stream`);
    let reloadTimeout: number | null = null;

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        // Data can be either an array or a single object
        const devices = Array.isArray(data) ? data : [data];
        // If this device got updated, reload history (debounced)
        const updatedDevice = devices.find((d: any) => d.name === device);
        if (updatedDevice) {
          // Clear existing timeout
          if (reloadTimeout) clearTimeout(reloadTimeout);
          // Debounce reload to prevent too many requests
          reloadTimeout = setTimeout(() => {
            loadHistory();
          }, 2000); // Wait 2 seconds before reloading
        }
      } catch (err) {
        console.error('Error parsing SSE data:', err);
      }
    };

    eventSource.onerror = (error) => {
      console.error('SSE Error:', error);
      eventSource.close();
    };

    return () => {
      if (reloadTimeout) clearTimeout(reloadTimeout);
      eventSource.close();
    };
  }, [device, loadHistory]);

  const formatTime = (time: string) => {
    const parts = time.split(':');
    if (parts.length >= 2) {
      const hour = parseInt(parts[0]);
      const minute = parts[1];
      const ampm = hour >= 12 ? 'AM' : 'PM';
      const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
      return `${displayHour}:${minute} ${ampm}`;
    }
    return time;
  };

  // Transform data for chart - sample if too many points to avoid freezing
  const maxChartPoints = 100;
  const sampledHistory = history.length > maxChartPoints 
    ? history.filter((_, i) => i % Math.ceil(history.length / maxChartPoints) === 0)
    : history;

  const chartData = sampledHistory
    .slice()
    .reverse() // Reverse so oldest is on left, newest on right
    .map((record) => ({
      time: formatTime(record.TIME),
      temperature: record.TEMP,
      fullDate: record.DATE,
    }));

  const chartConfig = {
    temperature: {
      label: "Temperature",
      color: "hsl(217.2 91.2% 59.8%)", // Blue color
    },
  } satisfies ChartConfig;

  // Calculate stats
  const avgTemp = history.length > 0
    ? Math.round(history.reduce((sum, h) => sum + h.TEMP, 0) / history.length)
    : 0;
  
  const maxTemp = history.length > 0 ? Math.max(...history.map(h => h.TEMP)) : 0;
  const minTemp = history.length > 0 ? Math.min(...history.map(h => h.TEMP)) : 0;
  
  const tempTrend = history.length >= 2
    ? history[history.length - 1].TEMP - history[0].TEMP
    : 0;

  // Pagination
  const totalPages = Math.ceil(history.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedHistory = history.slice(startIndex, endIndex);

  return (
    <div className="flex-1 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="icon"
            onClick={() => navigate('/')}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Temperature History</h2>
            <p className="text-muted-foreground">{device}</p>
          </div>
        </div>
        
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm" disabled={loading || history.length === 0}>
              <Trash2 className="h-4 w-4 mr-2" />
              Reset History
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete all temperature history for <strong>{device}</strong>. 
                This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleResetHistory} disabled={isResetting}>
                {isResetting ? 'Resetting...' : 'Reset History'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {loading && (
        <div className="flex items-center justify-center p-8">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
            <p className="mt-2 text-sm text-muted-foreground">Loading history...</p>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-destructive/20 text-destructive border border-destructive rounded-lg p-4">
          {error}
        </div>
      )}

      {!loading && !error && history.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">No history data available for this device.</p>
          </CardContent>
        </Card>
      )}

      {!loading && !error && history.length > 0 && (
        <>
          {/* Stats Cards */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Average</p>
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
                    <p className="text-sm text-muted-foreground">Maximum</p>
                    <h3 className="text-2xl font-bold">
                      <NumberFlow value={maxTemp} suffix="°F" />
                    </h3>
                  </div>
                  <TrendingUp className="h-8 w-8 text-red-500" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Minimum</p>
                    <h3 className="text-2xl font-bold">
                      <NumberFlow value={minTemp} suffix="°F" />
                    </h3>
                  </div>
                  <TrendingDown className="h-8 w-8 text-blue-500" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Trend</p>
                    <h3 className={`text-2xl font-bold ${tempTrend > 0 ? 'text-red-500' : tempTrend < 0 ? 'text-blue-500' : ''}`}>
                      <NumberFlow value={Math.abs(tempTrend)} suffix="°" prefix={tempTrend > 0 ? '+' : tempTrend < 0 ? '-' : ''} />
                    </h3>
                  </div>
                  {tempTrend > 0 ? (
                    <TrendingUp className="h-8 w-8 text-red-500" />
                  ) : tempTrend < 0 ? (
                    <TrendingDown className="h-8 w-8 text-blue-500" />
                  ) : (
                    <Thermometer className="h-8 w-8 text-muted-foreground" />
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Chart Card */}
          <Card>
            <CardHeader>
              <CardTitle>Temperature Over Time</CardTitle>
              <CardDescription>
                {date || 'Showing all recorded temperatures'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={chartConfig}>
                <LineChart
                  accessibilityLayer
                  data={chartData}
                  margin={{
                    left: 12,
                    right: 12,
                    top: 12,
                    bottom: 12,
                  }}
                >
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="time"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    minTickGap={32}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    tickFormatter={(value) => `${value}°F`}
                  />
                  <ChartTooltip
                    cursor={false}
                    content={<ChartTooltipContent 
                      hideLabel 
                      formatter={(value) => `${value}°F`}
                    />}
                  />
                  <Line
                    dataKey="temperature"
                    type="monotone"
                    stroke="var(--color-temperature)"
                    strokeWidth={2}
                    dot={{
                      fill: "var(--color-temperature)",
                    }}
                    activeDot={{
                      r: 6,
                    }}
                  />
                </LineChart>
              </ChartContainer>
            </CardContent>
          </Card>

          {/* Data Table Card */}
          <Card>
            <CardHeader>
              <CardTitle>Detailed Records</CardTitle>
              <CardDescription>
                Showing {startIndex + 1}-{Math.min(endIndex, history.length)} of {history.length} records
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="relative w-full overflow-auto">
                <table className="w-full caption-bottom text-sm">
                  <thead className="[&_tr]:border-b">
                    <tr className="border-b transition-colors hover:bg-muted/50">
                      <th className="h-12 px-4 text-left align-middle font-medium">Date</th>
                      <th className="h-12 px-4 text-left align-middle font-medium">Time</th>
                      <th className="h-12 px-4 text-left align-middle font-medium">Campus</th>
                      <th className="h-12 px-4 text-left align-middle font-medium">Location</th>
                      <th className="h-12 px-4 text-left align-middle font-medium">Temperature</th>
                    </tr>
                  </thead>
                  <tbody className="[&_tr:last-child]:border-0">
                    {paginatedHistory.map((record) => (
                      <tr
                        key={record.ID}
                        className="border-b transition-colors hover:bg-muted/50"
                      >
                        <td className="p-4 align-middle">{record.DATE}</td>
                        <td className="p-4 align-middle">{formatTime(record.TIME)}</td>
                        <td className="p-4 align-middle">{record.CAMPUS}</td>
                        <td className="p-4 align-middle">{record.LOCATION}</td>
                        <td className="p-4 align-middle font-semibold">
                          {record.TEMP}°F
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              {/* Pagination Controls */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-2 py-4">
                  <div className="text-sm text-muted-foreground">
                    Page {currentPage} of {totalPages}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

export default History;
