import { Link } from 'react-router-dom';
import type { DashboardData } from '../types';
import NumberFlow from '@number-flow/react';
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { History, MapPin } from "lucide-react";

interface TemperatureCardProps {
  data: DashboardData;
  countdown?: number;
}

type Temp = number | null;

const TemperatureCard: React.FC<TemperatureCardProps> = ({ data, countdown = 0 }) => {
  const temp: Temp = data.temperature;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="bg-muted/50 pb-3">
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-muted-foreground" />
            <span className="font-semibold text-sm">{data.campus}</span>
          </div>
          <span className="text-xs text-muted-foreground">{data.location}</span>
        </div>
      </CardHeader>
      
      <CardContent className="pt-6 pb-4">
        <div className="text-center">
          <div className="text-7xl font-bold tracking-tight">
            <NumberFlow
              value={temp ?? 0}
              format={{ notation: "compact" }}
              locales="en-US"
              willChange
              suffix="°"
            />
          </div>
          <p className="text-sm text-muted-foreground mt-2">
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
                {' '}{parseInt(data.time.split(':')[0]) >= 12 ? 'PM' : 'AM'}
              </>
            ) : (
              'No data'
            )}
          </p>
        </div>
      </CardContent>
      
      <CardFooter className="bg-muted/30 flex justify-between items-center pt-3">
        <span className="text-xs text-muted-foreground">
          Updates in{' '}
          <NumberFlow
            value={countdown}
            format={{ notation: "compact" }}
            locales="en-US"
            willChange
            suffix="s"
          />
        </span>
        <Button asChild size="sm" variant="outline">
          <Link to={`/history?device=${data.name}&date=${data.date || ''}`}>
            <History className="mr-2 h-4 w-4" />
            History
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
};

export default TemperatureCard;
