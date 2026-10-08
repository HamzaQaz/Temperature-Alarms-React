import type { RequestHandler } from 'express';
import type { Pool } from 'mysql2/promise';
import type { Config } from './config';
import type { Broadcaster } from './sse';
import type { IngestHealth } from './ingestHealth';
import type { Listening } from './listening';
import type { TokenRotation } from './tokenRotation';
import type { DeviceSightings } from './deviceSightings';
import type { Mailer } from './mailer';

/** What every route module and background job is handed at startup. */
export interface AppDeps {
  config: Config;
  pool: Pool;
  /** The current time. Defaults to the wall clock; tests pin it. */
  now?: () => Date;
  /** The one client set for live updates. createApp makes one if none is given; tests pass their own. */
  sse?: Broadcaster;
  /** How the latest Reading ingest went. createApp makes one if none is given. */
  ingest?: IngestHealth;
  /**
   * Since when the server could hear Devices (listening.ts). index.ts passes one from the process
   * start; without one, silence counts from each Device's last Reading alone.
   */
  listening?: Listening;
  /** Which Device token each Device reports with, during a rotation. createApp makes one if none is given. */
  rotation?: TokenRotation;
  /** Which Devices were last refused for their token. createApp makes one if none is given. */
  sightings?: DeviceSightings;
  /** How email leaves the server. createApp makes the SMTP one when notifications are on; tests may pass their own. */
  mailer?: Mailer;
  /** True once the process has begun to stop (shutdown.ts); health then answers 503. Never, without one. */
  stopping?: () => boolean;
}

/** AppDeps once createApp has filled in what the routes need. */
export interface RouteDeps extends AppDeps {
  sse: Broadcaster;
  ingest: IngestHealth;
  rotation: TokenRotation;
  sightings: DeviceSightings;
  /** Undefined when notifications are off (no SMTP_HOST). */
  mailer: Mailer | undefined;
  /** The Device token check and its wrong-token limit, shared by every route a Device calls (deviceAuth.ts). */
  deviceAuth: RequestHandler[];
}
