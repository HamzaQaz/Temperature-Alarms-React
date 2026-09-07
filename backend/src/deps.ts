import type { Pool } from 'mysql2/promise';
import type { Config } from './config';
import type { Broadcaster } from './sse';

/** What every route module and background job is handed at startup. */
export interface AppDeps {
  config: Config;
  pool: Pool;
  /** The current time. Defaults to the wall clock; tests pin it. */
  now?: () => Date;
  /** The one client set for live updates. createApp makes one if none is given; tests pass their own. */
  sse?: Broadcaster;
}

/** AppDeps once createApp has filled in what the routes need. */
export interface RouteDeps extends AppDeps {
  sse: Broadcaster;
}
