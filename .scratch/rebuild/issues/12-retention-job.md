# 12 — 90-day retention job

**What to build:**
Readings older than the retention window disappear on their own, once a day, without locking the table for long. Per ADR 0004.

**Blocked by:** 06 — Reading ingest with the Device token

**Status:** done

- [x] A job inside the backend runs once a day and deletes Readings older than the configured retention, default 90 days, in bounded batches
- [x] Retention days is a config value with a default
- [x] The job logs how many rows it removed
- [x] A test seeds Readings either side of the window, runs the job, and asserts only the old rows are gone
