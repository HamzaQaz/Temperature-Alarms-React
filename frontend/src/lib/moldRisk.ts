/**
 * Determines if conditions are at risk for mold growth
 * Mold typically grows when:
 * - Relative humidity is above 60%
 * - Temperature is between 32°F and 100°F (0°C - 38°C)
 * - Optimal conditions: 77-86°F (25-30°C) with >70% humidity
 */
export function isMoldRisk(temperature: number | null, humidity: number | null): boolean {
  if (temperature === null || humidity === null) {
    return false;
  }

  // Temperature range where mold can grow (32°F - 100°F)
  const tempInRange = temperature >= 32 && temperature <= 100;
  
  // High risk if humidity is above 60%
  const highHumidity = humidity > 60;
  
  // Critical risk if in optimal mold growth range
  const optimalTemp = temperature >= 77 && temperature <= 86;
  const criticalHumidity = humidity > 70;
  
  if (optimalTemp && criticalHumidity) {
    return true; // Critical risk
  }
  
  return tempInRange && highHumidity;
}

export function getMoldRiskLevel(temperature: number | null, humidity: number | null): 'none' | 'moderate' | 'high' {
  if (temperature === null || humidity === null) {
    return 'none';
  }

  const tempInRange = temperature >= 32 && temperature <= 100;
  const optimalTemp = temperature >= 77 && temperature <= 86;
  
  if (optimalTemp && humidity > 70) {
    return 'high';
  }
  
  if (tempInRange && humidity > 60) {
    return 'moderate';
  }
  
  return 'none';
}
