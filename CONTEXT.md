# Temperature Alarms

Live temperature and humidity monitoring for network closets across school campuses, fed by NodeMCU boards with DHT11 sensors (or the more accurate DHT22 or SHT31).

## Language

**Device**:
One NodeMCU board with a sensor (a DHT11, DHT22, or SHT31, chosen when its firmware is built), installed in a single Closet. Identified by its hostname (`ESP_` plus the last six hex digits of its MAC), which never changes: a replaced board is a new Device. Its Closet and Campus can be corrected without losing its Readings. From firmware 6 the board says which sensor it carries with every report, and the Device's History shows it, so its Readings are read with that sensor's accuracy in mind.
_Avoid_: Sensor, node, board, table

**Reading**:
One temperature and humidity sample sent by a Device at a single moment.
_Avoid_: Record, data point, temp data, row

**Report interval**:
How often a healthy Device sends a Reading. Currently 30 seconds.
_Avoid_: Poll rate, update rate, countdown

**Online / Offline**:
A Device is Online if its last report, a Reading or a Fault report, arrived within the last Report interval. It is Offline after three consecutive missed reports.
_Avoid_: Pinging, connected, alive

**Fault report**:
What a Device posts in place of a Reading when its sensor does not answer (firmware 5 and later): its hostname and `fault: "sensor"`, no values. It is a report, so the Device stays Online, but not a Reading: nothing is stored in Readings (docs/adr/0009).
_Avoid_: Error reading, null reading, failed reading

**Sensor fault**:
The Condition a Device is in after three Fault reports in a row: the board is online but its sensor is not answering. Critical, since the closet is unwatched. While it lasts, the last good Reading is not judged for Hot, Cold, Dry, or Mold risk. The next Reading clears it (docs/adr/0009).
_Avoid_: Sensor offline, broken sensor, bad data

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

**Device token rotation**:
Replacing the Device token without a dark fleet: for a while the server accepts the **previous Device token** as well as the new one, lists which Devices still report with the previous token (and which it has not heard since it started), and stops accepting the previous one when the rotation is finished. One at a time (docs/adr/0003).
_Avoid_: Key rollover, token refresh, re-keying

**New device**:
A board that reports with the Device token but is not yet added as a Device, waiting in Settings to be adopted: given a Campus and Closet, it becomes a Device. Its Readings are refused until then.
_Avoid_: Pending device, unknown device, orphan

**Firmware release**:
The one signed firmware build the server offers to Devices over the air, with its version and, while it is staged, the named Devices it is offered to first. It is released to all (widened) once every named Device has sent 10 clean Readings in a row on it. A Device installs it when its version is higher than the Device's own (docs/adr/0007).
_Avoid_: OTA image, update, push

**Hold**:
A staged Firmware release stopping itself because one of its named Devices went Offline or into Sensor fault after taking it, or reported that the update failed. A held release is offered to no Device until it is withdrawn or replaced by a higher version; it is emailed when Notifications are on (docs/adr/0007).
_Avoid_: Pause, freeze, rollback (nothing is rolled back: boards that installed it keep it)

**Condition**:
A named state a Device is in, computed on the server from its latest Reading and its reports against global thresholds set once in the backend configuration: Hot, Cold, Dry, Mold risk, Sensor fault, Offline. Each has a level (warning, critical, or moderate/high for Mold risk). A Device can be in several Conditions at once.
_Avoid_: Alert, alarm, risk, status

**Incident**:
A stretch of time a Device spent in one Condition at warning or worse, recorded by the server: when it started, each level change, when it ended (or that it is ongoing), and its peak Reading. It opens on the first Reading in the Condition and closes after two Readings in a row without it, ending at the first of them; Offline opens when the server would first report the Device Offline and closes on its next report; Sensor fault opens on the third Fault report in a row. Moderate Mold risk is a heads-up, never an Incident. Kept for the Retention window, like Readings (docs/adr/0006).
_Avoid_: Alert, alarm, event, outage

**Acknowledgement**:
A technician saying they are on an open Incident, with their name or a short note (free text, 1 to 60 characters, since there are no user accounts) and when they said it. Given in the app with the Admin token, from the Device card or the Incidents log; the first one stands, an ended Incident cannot be acknowledged, and it is never cleared, not by the level rising nor by the close. It shows on the card, in the log, and in every later Notification about that Incident, which still sends (docs/adr/0008). It stops Reminders.
_Avoid_: Claim, assign, ownership, ack

**Notification**:
An email the server sends to a fixed list of recipients, through the district's SMTP relay, when an Incident opens, gets worse (its level rises), or closes, and when a Firmware release goes on Hold (its own email). A level falling back is not sent, Devices on the Bench never send one, and Incident changes close together go out as one email, worst first. Each is queued in the same transaction as the Incident change it reports, so a restart or an SMTP outage delays it rather than losing it. Off unless the backend configuration names a relay (docs/adr/0008).
_Avoid_: Alert, alarm (the old feature that was removed), page, message

**Reminder**:
A Notification that an Incident is still open and no one has acknowledged it, sent once it has been open a set number of hours (`NOTIFY_REMIND_HOURS`, the same for every Condition and level) and again every as many hours after, counted from the Incident's start, until it closes or is acknowledged. Off unless configured, and only while Notifications are on; Devices on the Bench never get one; no cap on how many (docs/adr/0008).
_Avoid_: Escalation, repeat alert, nag, follow-up

**Bench**:
The holding Campus (shortcode `BENCH`) a Device is registered under between flashing and installation, whatever its bench verdict: a board that failed its check stays registered there too, and the inventory sheet's `TESTED` column says which passed. A Device on the Bench is expected to be Offline until it is moved to its real Campus and Closet.
_Avoid_: Staging, spare, inventory (that is the spreadsheet of boards, not a place)

**Operator**:
The person who runs the backend and its database: installs, upgrades, backs up. A role in the documentation, not in the product; there is no login for it.
_Avoid_: Admin (that is a token), sysadmin, host

**Retention window**:
How long a Reading is kept before the backend deletes it, in a pass that runs once a day and whenever the backend starts. 90 days unless the configuration says otherwise (docs/adr/0004). Nothing is rolled up first; a Reading past the window is gone.
_Avoid_: Purge, cleanup, archive, expiry
