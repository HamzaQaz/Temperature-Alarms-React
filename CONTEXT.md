# Temperature Alarms

Live temperature and humidity monitoring for network closets across school campuses, fed by NodeMCU boards with DHT11 sensors.

## Language

**Device**:
One NodeMCU board with a DHT11 sensor, installed in a single Closet. Identified by its hostname (`ESP_` plus the last six hex digits of its MAC).
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
A named state a Device's latest Reading is in, computed from fixed global thresholds: Hot, Cold, Dry, Mold risk, Offline. Each has a level (warning, critical, or moderate/high for Mold risk). A Device can be in several Conditions at once.
_Avoid_: Alert, alarm, risk, status
