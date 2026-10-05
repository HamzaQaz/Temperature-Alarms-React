/**
 * How far ahead of the server's clock a Reading may be stamped and still be a Device's latest.
 *
 * Ingest stamps Readings with the server's clock. When the host clock jumped 5 h ahead for a few
 * seconds, the Readings stamped then sorted after every real one: their cards froze on them and
 * the Offline sweep could not see those Devices go silent until the clock caught up
 * (.scratch/prodtest/load.md, S3). Readings further ahead than this are passed over until real
 * time reaches them; a few minutes leaves room for a clock slewing into place.
 */
export const FUTURE_SLACK_MS = 5 * 60_000;

/** The latest a Reading may be stamped, at `now`, and still count. */
export const latestAllowed = (now: Date): Date => new Date(now.getTime() + FUTURE_SLACK_MS);

/**
 * A Device's latest Reading's id, as a correlated subquery on `d.id`; its one `?` is
 * latestAllowed(now). It walks ix_readings_device_recorded_temp backwards one step from the
 * bound. The order starts with device_id, a constant here, so MySQL sees the index gives it:
 * ordered by recorded_at alone it walks ix_readings_recorded (retention's) backwards instead,
 * through every Reading since a silent Device's last.
 */
export const LATEST_READING_ID = `
  SELECT r2.id FROM readings r2
  WHERE r2.device_id = d.id AND r2.recorded_at <= ?
  ORDER BY r2.device_id DESC, r2.recorded_at DESC, r2.id DESC
  LIMIT 1`;
