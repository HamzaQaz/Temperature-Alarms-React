import type { Migration } from './index';
import { columnExists } from './introspect';

/**
 * Which WiFi network each board last said it is on (deviceInfo.ts, firmware 7 and later): its name,
 * and which of the two in its config.h, 1 the first or 2 the second (its fallback network). NULL
 * until it says. Guarded, so a run that died before being recorded can repeat.
 */
export const deviceNetworkSchema: Migration = {
  id: '0020-device-network',
  async up(conn) {
    if (await columnExists(conn, 'devices', 'wifi_network')) return;
    await conn.query(`ALTER TABLE devices
      ADD COLUMN wifi_ssid VARCHAR(32) NULL,
      ADD COLUMN wifi_network TINYINT UNSIGNED NULL`);
  },
};
