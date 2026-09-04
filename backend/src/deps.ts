import type { Pool } from 'mysql2/promise';
import type { Config } from './config';

/** What every route module and background job is handed at startup. */
export interface AppDeps {
  config: Config;
  pool: Pool;
}
