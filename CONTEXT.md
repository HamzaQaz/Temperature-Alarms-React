# Temperature Alarms

Live temperature and humidity monitoring for network closets across school campuses, fed by NodeMCU boards with DHT11 sensors.

## Language

**Device**:
One NodeMCU board with a DHT11 sensor, installed in a single Closet. Identified by its hostname (`ESP_` plus the last six hex digits of its MAC), which never changes: a replaced board is a new Device. Its Closet and Campus can be corrected without losing its Readings.
_Avoid_: Sensor, node, board, table

**Reading**:
One temperature and humidity sample sent by a Device at a single moment.
_Avoid_: Record, data point, temp data, row

**Report interval**:
How often a healthy Device sends a Reading. Currently 30 seconds.
_Avoid_: Poll rate, update rate, countdown

**Online / Offline**:
A Device is Online if its last Reading arrived within the last Report interval. It is Offline after three consecutive missed reports.
_Avoid_: Pinging, connected, alive

**Campus**:
A school site. Has a display name and a short code (e.g. `CHS`). Every Device belongs to exactly one Campus.
_Avoid_: Location (the old `locations` table held campuses), site, school

**Closet**:
The room a Device is installed in, within a Campus. Named by its network role and number, e.g. `IDF 2` or `MDF`.
_Avoid_: Location, room, position

**IDF / MDF**:
Intermediate and Main Distribution Frame. The two kinds of Closet; parsed from the Closet name to tag cards.

**Admin token**:
The single shared secret that authorises changes to Devices, Campuses, and history.

**Device token**:
The single shared secret every Device sends with each Reading.

**Condition**:
A named state a Device's latest Reading is in, computed on the server from global thresholds set once in the backend configuration: Hot, Cold, Dry, Mold risk, Offline. Each has a level (warning, critical, or moderate/high for Mold risk). A Device can be in several Conditions at once.
_Avoid_: Alert, alarm, risk, status

**Bench**:
The holding Campus (shortcode `BENCH`) a Device is registered under between flashing and installation, whatever its bench verdict: a board that failed its check stays registered there too, and the inventory sheet's `TESTED` column says which passed. A Device on the Bench is expected to be Offline until it is moved to its real Campus and Closet.
_Avoid_: Staging, spare, inventory (that is the spreadsheet of boards, not a place)

**Operator**:
The person who runs the backend and its database: installs, upgrades, backs up. A role in the documentation, not in the product; there is no login for it.
_Avoid_: Admin (that is a token), sysadmin, host

**Retention window**:
How long a Reading is kept before the backend deletes it, in a pass that runs once a day and whenever the backend starts. 90 days unless the configuration says otherwise (docs/adr/0004). Nothing is rolled up first; a Reading past the window is gone.
_Avoid_: Purge, cleanup, archive, expiry
