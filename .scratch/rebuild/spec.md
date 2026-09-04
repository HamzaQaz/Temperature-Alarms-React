---
title: Rebuild Temperature Alarms around DHT11 Devices, a single readings table, and server-side Conditions
labels: [ready-for-agent]
status: open
---

## Problem Statement

The Temperature Alarms site monitors network closets across campuses, but the code behind it no longer matches the hardware or the intent.

- The only firmware in the repo is for a DS18B20 probe and talks to a PHP endpoint that no longer exists. The DHT11 firmware that was actually flashed is lost. The README contradicts itself about which sensor is used.
- The dashboard, the status badge, and the old firmware each assume a different report interval, so "Online" and "Next update in" are wrong most of the time.
- Live updates are unreliable because the backend runs two PM2 processes and each keeps its own list of browser connections. A Reading arriving at one process never reaches browsers attached to the other.
- The database has one table per Device, created at runtime from a form field, with timestamps stored as locale-formatted text. Every query is string-built. The History page fetches a Device's whole table and paginates in the browser.
- The site is on the public internet with no authentication. Anyone can delete Devices, wipe history, or post fake Readings.
- The Alarms tab collects emails and thresholds that nothing ever reads. The only real warning is a mold-risk badge computed in the browser, and there is no warning for a closet that is simply too hot.
- Half the frontend is unused scaffolding and duplicate dependencies; the build script runs `git pull` and writes to a hardcoded server path; six overlapping markdown files describe the project; 3.4 MB of PHP-era Bootstrap and jQuery is still committed.
- There are no tests.

## Solution

Rebuild all three parts around the vocabulary in `CONTEXT.md` and the four ADRs, keeping the pages and the look the user already knows.

- New DHT11 firmware that sends a Reading every 30 seconds as a token-authenticated HTTP POST and reconnects without rebooting.
- A backend with one `readings` table, real timestamps, a connection pool, Admin token and Device token middleware, a Conditions module that computes Hot, Cold, Dry, Mold risk, and Offline on the server, SSE for browsers from a single process, and a nightly 90-day retention job. A re-runnable migration brings existing per-Device tables across.
- A frontend with the same Dashboard, History, and Settings pages, rendering Conditions the backend sends, querying History by day, and asking once for the Admin token.
- A repo with the dead assets, dead code, duplicate dependencies, and stale docs removed, a domain-agnostic deploy guide, and tests at the API seam.

## User Stories

### Viewing the dashboard

1. As a technician, I want to see every Device's latest temperature and humidity on one page, so that I can check all closets at a glance.
2. As a technician, I want to filter the dashboard by Campus, so that I only see the closets I am responsible for.
3. As a technician, I want the Campus filter to survive a page reload via the URL, so that I can bookmark my campus.
4. As a technician, I want each card to show the Campus and Closet name and an IDF or MDF tag, so that I can find the right room.
5. As a technician, I want a new Reading to appear on the dashboard within seconds of the Device sending it, without refreshing, so that I am looking at live data.
6. As a technician, I want the live connection to recover on its own after a network blip, so that a dashboard left on a wall screen stays current.
7. As a technician, I want each card to show how long ago the last Reading arrived, so that I can tell stale data from fresh.
8. As a technician, I want a card to show Online or Offline based on the Report interval, so that a dead Device is obvious.
9. As a technician, I want a Device to be marked Offline only after three consecutive missed reports, so that one dropped packet does not raise a false alarm.
10. As a technician, I want a "next update" countdown that matches the real Report interval, so that the number means something.
11. As a technician, I want the summary tiles to show total Devices, how many are in a warning or critical Condition, and average temperature and humidity, so that I get the headline before the detail.
12. As a technician, I want the summary averages to ignore Devices with no Reading, so that an empty closet does not drag the average to zero.

### Conditions

13. As a technician, I want a Hot warning when a closet reaches 82 °F, so that I can act before equipment is at risk.
14. As a technician, I want a Hot critical state at 90 °F, so that it is clear someone needs to go now.
15. As a technician, I want a Cold warning at or below 50 °F, so that a failed HVAC or an open door is caught.
16. As a technician, I want a Dry warning at or below 20 percent humidity, so that static-discharge risk is visible.
17. As a technician, I want the existing Mold risk rule kept unchanged with its moderate and high levels, so that current behaviour is preserved.
18. As a technician, I want a card to show every Condition that is active at once, so that a closet that is both hot and humid says so.
19. As a technician, I want the card border to reflect the worst active Condition, so that the grid can be scanned by colour.
20. As a technician, I want Conditions computed on the server and delivered with the dashboard data, so that every page and any future alerting agree.
21. As a technician, I want Conditions to be based on the latest Reading only, so that an old spike does not keep a card red.
22. As a developer, I want every threshold in one place, so that changing a number is a one-line edit.

### History

23. As a technician, I want to open a Device's history from its card, so that I can see what led up to the current state.
24. As a technician, I want history shown as a chart and a table for a single day, so that the page stays fast and readable.
25. As a technician, I want to step to the previous or next day, so that I can follow an incident across midnight.
26. As a technician, I want the chart to include humidity as well as temperature, so that I can see both series together.
27. As a technician, I want times in history shown correctly in 12-hour format with the right AM or PM, so that I trust the timeline.
28. As a technician, I want the history page to refresh when a new Reading for that Device arrives, so that I can watch a live incident.
29. As a technician, I want the daily minimum, maximum, and average shown for the selected day, so that I get the summary without reading the table.
30. As an admin, I want to reset a Device's history behind a confirmation, so that a test board's junk data can be cleared.
31. As a technician, I want to know that Readings older than 90 days are deleted, so that I export anything I need before then.

### Settings and administration

32. As an admin, I want to add a Device by hostname, Campus, and Closet name, so that a newly flashed board shows on the dashboard.
33. As an admin, I want the Campus chosen from a dropdown of existing Campuses, so that I cannot mistype a shortcode.
34. As an admin, I want a Device hostname validated against the `ESP_` plus six hex digits pattern, so that typos are caught before a board silently never matches.
35. As an admin, I want to delete a Device and have its Readings go with it, so that nothing is orphaned.
36. As an admin, I want to add and delete Campuses with a name and shortcode, so that the dashboard filter reflects the district.
37. As an admin, I want to be prevented from deleting a Campus that still has Devices, so that Devices never point at nothing.
38. As an admin, I want to be asked once for the Admin token on the Settings page and have it remembered in my browser, so that I do not retype it per action.
39. As an admin, I want a clear "wrong token" message when a change is rejected, so that I know it was auth and not a server fault.
40. As a technician, I want to view the dashboard and history without any token, so that the wall screen and anyone on the team can see the data.
41. As an admin, I want the Alarms tab and its endpoints gone, so that nobody configures a notification that will never be sent.

### Devices and firmware

42. As an installer, I want a single DHT11 sketch in the repo, so that there is no question which firmware to flash.
43. As an installer, I want a pinout image for the DHT11 on GPIO 5, so that wiring matches the sketch.
44. As an installer, I want SSID, password, server URL, Device token, and interval in one gitignored config header with a committed example, so that secrets never land in git.
45. As an installer, I want the board to identify itself by its `ESP_` hostname, so that no per-board configuration is needed beyond the shared header.
46. As an installer, I want the board to keep trying to reconnect to WiFi and resume posting without a reboot, so that a router restart does not require a site visit.
47. As an installer, I want a failed POST to be logged to serial and skipped until the next interval, so that a server outage does not produce a retry storm.
48. As an installer, I want failed DHT11 samples skipped rather than sent as zero, so that the history is not polluted.
49. As an installer, I want the old on-device web page removed, so that there is one UI to maintain and more free RAM on the board.
50. As a security-minded admin, I want a Reading without a valid Device token rejected, so that fake data cannot be posted.
51. As an admin, I want a Reading from an unregistered hostname rejected with a clear status, so that a new board is not silently dropped and I know to add it.

### Operations

52. As an operator, I want the backend to run as a single process, so that live updates reach every browser.
53. As an operator, I want a health endpoint that checks the database, so that a monitor can alert on outages.
54. As an operator, I want the backend to refuse to start without the database password, Admin token, and Device token set, so that a misconfigured deploy fails loudly.
55. As an operator, I want a database connection pool, so that a burst of Devices does not exhaust connections.
56. As an operator, I want a nightly job that deletes Readings older than 90 days, so that the table stays bounded.
57. As an operator, I want a re-runnable migration that copies every existing per-Device table into the readings table, so that history survives the schema change.
58. As an operator, I want the migration to leave the old tables in place, so that I can verify counts before dropping them by hand.
59. As an operator, I want a deploy guide with no domain baked in and an nginx template with a placeholder, so that moving domains is a config change.
60. As an operator, I want `npm run build` to be a pure build with no `git pull` and no hardcoded output path, so that I can build anywhere.

### Developer experience

61. As a developer, I want the backend split into small modules with one responsibility each, so that I can find the code for a behaviour.
62. As a developer, I want every SQL statement parameterised with no string-built identifiers, so that there is no injection surface to audit.
63. As a developer, I want backend API tests that run against a real MySQL in Docker, so that stability is proven rather than assumed.
64. As a developer, I want the test suite to accept an existing MySQL via an environment variable, so that Docker is not mandatory.
65. As a developer, I want unit tests on the Conditions module at every threshold boundary, so that the rules cannot regress silently.
66. As a developer, I want a single README that is correct about the hardware, so that the first paragraph does not lie.
67. As a developer, I want unused components, hooks, and duplicate dependencies removed, so that the frontend contains only what it uses.
68. As a developer, I want the PHP-era CSS and JS directories removed, so that the repo is the React app and nothing else.
69. As a developer, I want the frontend types to match the API's camelCase shape rather than database column casing, so that the wire format is the only contract.
70. As a developer, I want sidebar navigation to use router links, so that navigation does not reload the page and page transitions actually run.

## Implementation Decisions

### Domain and vocabulary

- All code, API fields, and docs use the terms in `CONTEXT.md`: Device, Reading, Report interval, Online/Offline, Campus, Closet, IDF/MDF, Admin token, Device token, Condition. The old table called `locations` becomes `campuses`; the field called `location` on a Device becomes `closet`.
- ADRs 0001 through 0004 govern transport, schema, auth, and retention respectively. Nothing in this spec overrides them.

### Schema

- Three tables: `campuses` (id, name, shortcode unique), `devices` (id, hostname unique, campus_id foreign key, closet, created_at), `readings` (id, device_id foreign key with cascade delete, temp_f integer, humidity integer nullable, recorded_at datetime). Index on `(device_id, recorded_at)`.
- Temperature is stored as an integer in Fahrenheit. Humidity is an integer percent. Both match DHT11 resolution.
- Timestamps are stored in UTC and rendered in the browser's local zone.
- Schema is created by a versioned migration runner inside the backend, not by hand-run SQL files. The first migration creates the new tables; the second, guarded so it is re-runnable, discovers every `ESP_*` table, parses its string DATE and TIME columns once, and inserts into `readings`. Old tables are not dropped.

### Backend structure

- Modules with one job each: configuration and startup validation, database pool and migrations, Campuses routes, Devices routes, Readings routes (dashboard, history, write), Conditions, SSE broadcast, retention job, auth middleware.
- Configuration is read once at startup. Required: database credentials, Admin token, Device token. Optional with defaults: port, CORS origin, Report interval, retention days, thresholds.
- Startup fails with a clear message if any required value is missing.
- The backend runs as one process. The PM2 config is a single fork-mode instance.

### API contract

All responses are JSON in camelCase. Mutating routes require the Admin token in an `Authorization: Bearer` header. `POST /api/readings` requires the Device token in the same header. Reads require nothing.

- `GET /api/health` returns database status.
- `GET /api/campuses`, `POST /api/campuses` (name, shortcode), `DELETE /api/campuses/:id` (409 if Devices remain).
- `GET /api/devices`, `POST /api/devices` (hostname, campusId, closet), `DELETE /api/devices/:id`.
- `POST /api/readings` body `{device, temp, humidity}`, where `device` is the hostname. 401 on bad token, 404 on unknown hostname, 422 on non-numeric values. Records the Reading, broadcasts it, returns 201.
- `GET /api/dashboard?campus=SHORTCODE` returns one entry per Device: id, hostname, campus (name and shortcode), closet, closetType (IDF, MDF, or null), latest Reading (tempF, humidity, recordedAt) or null, online boolean, secondsSinceReading, and `conditions`, a list of `{name, level}`.
- `GET /api/dashboard/stream` is SSE. Sends `{type: "reading", device: hostname, reading, online, conditions}` per Reading. The `filter` case-insensitivity from the existing code is preserved.
- `GET /api/devices/:id/history?date=YYYY-MM-DD` returns Readings for that local day, oldest first, capped at one day, plus min, max, and average for temp and humidity.
- `DELETE /api/devices/:id/history` deletes that Device's Readings.
- The old `/api/write`, `/api/history`, `/api/temperature/*`, `/api/locations`, and `/api/alarms` routes are removed.

### Conditions

- A pure module: given the latest Reading and seconds since it arrived, return the list of active Conditions with levels. Thresholds live in one configuration object with the defaults agreed: Hot warning 82, Hot critical 90, Cold warning 50, Dry warning 20, Mold risk per the existing rule, Offline after three Report intervals.
- Level ordering for "worst": critical, high, warning, moderate. The dashboard uses the worst to colour the card border.
- The browser never computes a Condition. The existing mold-risk module in the frontend is removed.

### SSE

- One in-process set of connected responses. A heartbeat comment every 25 seconds keeps proxies from closing idle streams. Clients rely on the browser's built-in EventSource reconnect.
- The response sets only the headers SSE needs; CORS is handled by the shared middleware, not an ad hoc wildcard.

### Retention

- A timer inside the backend runs once a day and deletes Readings older than the configured retention, default 90 days, in batches so it never holds a long lock.

### Frontend

- Same three pages, same shadcn look. Dashboard, History, Settings.
- A single API client module that attaches the Admin token from local storage on mutating calls and surfaces 401 as a distinct error.
- Settings gains a small token prompt shown when no token is stored or when a request returns 401. Alarms tab removed.
- Device form uses a Campus dropdown and validates the hostname pattern client-side, with the server as the authority.
- Cards render `conditions` from the payload as badges and pick the border from the worst level. The countdown is seeded from the Report interval the API reports, not a constant.
- History takes a device id and a date, offers previous and next day, charts temperature and humidity, and shows the day's summary. Live refresh listens to the same SSE stream and matches on hostname.
- Sidebar uses router links. Page transitions stay.
- Removed: unused nav components, unused hooks and helpers, the mold-risk module, the Bootstrap and Font Awesome dependencies, whichever of the duplicate motion and number-flow packages is not imported, the `radix-ui` meta-package in favour of the individual packages actually used.
- Build script is `tsc -b && vite build` with the default output directory.
- Every frontend ticket is executed under the `/impeccable` skill. The three pages and the shadcn component set stay, but each page gets a proper pass on hierarchy, spacing, loading, empty, and error states, badge legibility, and the wall-screen case where the dashboard is read from across a room. Any change that alters the information shown, rather than how it is shown, is out of that pass and needs its own decision.

### Firmware

- One sketch using the ESP8266 core and a DHT library. Reads on GPIO 5 with the configured interval, default 30 seconds. Skips NaN samples. POSTs JSON with the Device token in the Authorization header. Logs the HTTP status to serial. Reconnects WiFi in the loop when disconnected. No on-device web server.
- `config.h` is gitignored; `config.example.h` is committed.
- The sketch is organised as a folder of small files that the Arduino IDE compiles together, each with one job: the main sketch holding only setup and loop, a WiFi module (connect, reconnect, hostname), a sensor module (read, validate, skip NaN), a reporter module (build JSON, POST with token, log status), and the config header. No function longer than a screen; no globals shared across modules except through their headers.
- The firmware directory has its own README section: wiring, library dependencies with versions, board settings, flashing steps, and the bench checklist.
- New pinout image showing DHT11 on GPIO 5, 3.3 V, and ground, with a note about the 10 kΩ pull-up for bare four-pin sensors.

### Repository

- Delete the `css/` and `js/` directories, `.DS_Store`, the standalone SQL files, the `MIGRATION_SUMMARY`, `SECURITY_SUMMARY`, `SECURITY`, and `QUICKSTART` documents, and the domain-named nginx file.
- Keep a README covering what it is, the hardware, local dev, and the API, plus a `DEPLOYMENT.md` with the generic nginx template and PM2 instructions.
- Root `package.json` scripts stay as the convenience entry points.

## Testing Decisions

A good test exercises the system at a seam a user or another system would actually touch, asserts on observable outcomes, and does not know how the code inside is organised. There is no prior art in this repo; the suites below establish it.

- **Backend API tests at the HTTP seam.** Every route is exercised through the Express app with a real MySQL, provisioned by Docker Compose for the test run or by a `TEST_DATABASE_URL` pointing at an existing server. Each test starts from a clean schema via the migration runner. Covered: happy paths, token rejection, unknown hostname, validation errors, cascade delete, campus-with-devices refusal, dashboard payload shape including `online` and `conditions`, history day bounds and summary, SSE receiving a broadcast after a write, and the retention job removing only old rows.
- **Migration test.** A fixture creates two legacy `ESP_*` tables with string dates in the old formats and asserts the readings land with correct timestamps, that running it twice does not duplicate, and that the legacy tables still exist afterwards.
- **Conditions unit tests.** Pure function tests at each boundary: one degree either side of every threshold, null Reading, exactly three missed intervals, multiple Conditions at once, worst-level selection.
- **Frontend.** Typecheck and lint in CI. No component tests.
- **Firmware.** A bench checklist in the README: serial shows hostname, first POST returns 201, unplugging the sensor produces skipped samples not zeros, rebooting the router results in resumed posting.

## Out of Scope

- Email, SMS, or any notification when a Condition is active. The Alarms feature is removed, not rebuilt.
- Per-Closet or per-Campus threshold overrides.
- User accounts, roles, or district SSO. Two shared tokens only.
- Long-term rollups or any retention beyond 90 days.
- WebSockets on either link.
- Multi-process or multi-server backend deployment.
- A ground-up visual redesign. The `/impeccable` pass polishes the existing three pages and component set; it does not introduce new pages, a new design system, or new information.
- Automated firmware tests or over-the-air updates.

## Further Notes

- The DHT11 firmware previously flashed to the boards is lost. The new sketch is written from the backend contract and the agreed behaviour, not recovered.
- Existing boards will need reflashing with the new sketch because the endpoint, the body shape, and the token requirement all change. Plan a site visit per closet.
- The hostname-based identity means a replaced board is a new Device. That is acceptable; the old Device can be deleted once the new one reports.
- The migration parses locale-formatted strings written by `toLocaleDateString` and `toLocaleTimeString` on the old server. The formats seen in production should be sampled before the migration is finalised, and the migration should log and skip any row it cannot parse rather than abort.
