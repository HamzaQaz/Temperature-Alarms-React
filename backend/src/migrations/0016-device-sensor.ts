import type { Migration } from './index';
import { columnExists } from './introspect';

/**
 * Which sensor each board last said it carries (deviceInfo.ts, firmware 6 and later): `DHT11`, `DHT22`
 * or `SHT31`, NULL until it says. Guarded, so a run that died before being recorded can repeat.
 */
export const deviceSensorSchema: Migration = {
  id: '0016-device-sensor',
  async up(conn) {
    if (await columnExists(conn, 'devices', 'sensor')) return;
    await conn.query('ALTER TABLE devices ADD COLUMN sensor VARCHAR(16) NULL');
  },
};
