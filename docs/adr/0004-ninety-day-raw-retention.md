---
status: accepted
---

# Raw Readings are kept for 90 days, then deleted

At a 30-second Report interval each Device writes about a million Readings a year. The tool exists to answer "what is this Closet doing now and what did it do recently," not long-term climatology, so we decided the backend deletes Readings older than 90 days in a nightly job, with no rollup. 90 days covers a full season and any incident review. If trends ever matter, a daily-average rollup table is the intended path; raising the retention window is a one-line change.

## Consequences

- Data older than 90 days is gone for good. Anyone wanting it must export before then.
- History queries are always bounded by a date range and a row limit; the page never loads a whole Device's history.
- The job deletes by recorded time alone, in bounded batches, so `readings` carries an index on `recorded_at` beside the one on Device and recorded time. Every insert pays for it; at one Reading per Device per 30 seconds that is negligible.
