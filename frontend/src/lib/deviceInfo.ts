/** WiFi signal in words a technician acts on: below -75 dBm a board drops Readings now and then. */
export function formatSignal(rssi: number | null): string {
  if (rssi === null) return '—';
  const word = rssi >= -60 ? 'strong' : rssi >= -67 ? 'good' : rssi >= -75 ? 'fair' : 'weak';
  return `${rssi} dBm, ${word}`;
}

/** Uptime as the two largest units: "3 d 4 h", "2 h 5 min", "45 s". */
export function formatUptime(seconds: number | null): string {
  if (seconds === null) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min`;
  return `${seconds} s`;
}

/** Free memory in KB, one decimal: what TLS and an update need is about 25 KB. */
export const formatHeap = (bytes: number | null): string => (bytes === null ? '—' : `${(bytes / 1024).toFixed(1)} KB`);
