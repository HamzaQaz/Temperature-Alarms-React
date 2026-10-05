// Drill 6: the Overnight window, Today, the 7-day overview's local days, and History's day across
// the next two DST changes (2026-11-01 back, 2027-03-14 forward in the US), with a fixed clock.
// The browser computes Overnight/Today in its own zone (frontend/src/lib/incidentWindow.ts); the
// server cuts days in the ?tz= the browser sends (backend/src/localDay.ts). Run once per zone:
//   TZ=America/Chicago node dst.mjs     (the zone is both the "browser" zone and the ?tz= value)
import assert from 'node:assert/strict';
import { latestDate, windowBounds } from '../../../frontend/src/lib/incidentWindow.ts';
import { localDay, todayIn, instantIn } from '../../../backend/src/localDay.ts';

const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const H = 3_600_000;
const hours = ({ from, to }) => (to.getTime() - from.getTime()) / H;
const results = [];
const check = (name, fn) => {
  try {
    const detail = fn();
    results.push({ name, ok: true, detail });
  } catch (e) {
    results.push({ name, ok: false, detail: e.message });
  }
};
// The same lastDates the overview uses (campusOverview.ts), copied: it is not exported.
const lastDates = (today, count) => {
  const [y, m, d] = today.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => new Date(Date.UTC(y, m - 1, d - (count - 1 - i))).toISOString().slice(0, 10));
};
const observesDst = new Date(2026, 6, 1).getTimezoneOffset() !== new Date(2026, 11, 1).getTimezoneOffset();
const fallNight = zone.startsWith('America/') ? '2026-10-31' : '2026-10-24'; // EU changes a week earlier
const springNight = zone.startsWith('America/') ? '2027-03-13' : '2027-03-27';
const next = (date) => new Date(Date.UTC(...date.split('-').map((n, i) => Number(n) - (i === 1 ? 1 : 0))) + 86_400_000).toISOString().slice(0, 10);

check('Overnight across fall-back is 18:00 to 08:00 local, 15 h', () => {
  const b = windowBounds('overnight', fallNight);
  assert.equal(b.from.getHours(), 18);
  assert.equal(b.to.getHours(), 8);
  assert.equal(hours(b), observesDst ? 15 : 14);
  return `${b.from.toISOString()} → ${b.to.toISOString()} (${hours(b)} h)`;
});
check('Overnight across spring-forward is 18:00 to 08:00 local, 13 h', () => {
  const b = windowBounds('overnight', springNight);
  assert.equal(b.from.getHours(), 18);
  assert.equal(b.to.getHours(), 8);
  assert.equal(hours(b), observesDst ? 13 : 14);
  return `${b.from.toISOString()} → ${b.to.toISOString()} (${hours(b)} h)`;
});
check('At 07:30 the morning after fall-back, Overnight names the night before', () => {
  const now = new Date(...next(fallNight).split('-').map((n, i) => Number(n) - (i === 1 ? 1 : 0)), 7, 30);
  assert.equal(latestDate('overnight', now), fallNight);
  return `${now.toString()} → ${latestDate('overnight', now)}`;
});
check('At 01:30 during the repeated hour, Overnight is still the night before and Today is the change day', () => {
  const day = next(fallNight);
  const now = new Date(...day.split('-').map((n, i) => Number(n) - (i === 1 ? 1 : 0)), 1, 30);
  assert.equal(latestDate('overnight', now), fallNight);
  assert.equal(latestDate('today', now), day);
  return now.toString();
});
check('Today (browser) and History day (server) agree: 25 h on fall-back, 23 h on spring-forward', () => {
  const fall = next(fallNight);
  const spring = next(springNight);
  const bFall = windowBounds('today', fall);
  const sFall = localDay(fall, zone);
  const bSpring = windowBounds('today', spring);
  const sSpring = localDay(spring, zone);
  assert.equal(bFall.from.getTime(), sFall.from.getTime());
  assert.equal(bFall.to.getTime(), sFall.to.getTime());
  assert.equal(bSpring.from.getTime(), sSpring.from.getTime());
  assert.equal(bSpring.to.getTime(), sSpring.to.getTime());
  assert.equal(hours(sFall), observesDst ? 25 : 24);
  assert.equal(hours(sSpring), observesDst ? 23 : 24);
  return `fall ${hours(sFall)} h, spring ${hours(sSpring)} h`;
});
check('Overview: the 7 local days ending the day after fall-back tile time with no gap or overlap', () => {
  const today = next(next(fallNight));
  const days = lastDates(today, 7).map((d) => localDay(d, zone));
  for (let i = 1; i < days.length; i++) assert.equal(days[i].from.getTime(), days[i - 1].to.getTime());
  const lengths = days.map(hours);
  assert.deepEqual(lengths.filter((h) => h !== 24), observesDst ? [25] : []);
  return `${days.map((d) => d.date).join(',')} lengths ${lengths.join(',')}`;
});
check('Overview: todayIn() flips at local midnight, not UTC midnight, on both sides of the change', () => {
  const before = instantIn({ year: 2026, month: 10, day: 31, hour: 23, minute: 59, second: 59 }, zone);
  const after = new Date(before.getTime() + 2000);
  assert.equal(todayIn(before, zone), '2026-10-31');
  assert.equal(todayIn(after, zone), '2026-11-01');
  const before2 = instantIn({ year: 2026, month: 11, day: 1, hour: 23, minute: 59, second: 59 }, zone);
  assert.equal(todayIn(before2, zone), '2026-11-01');
  assert.equal(todayIn(new Date(before2.getTime() + 2000), zone), '2026-11-02');
  return `${before.toISOString()} / ${before2.toISOString()}`;
});
check('Server running in UTC (the containers) still cuts Chicago days right when ?tz= is sent', () => {
  // backend/src/localDay.ts never reads the process zone when a zone is passed; prove it by comparing with Intl.
  const d = localDay('2026-11-01', 'America/Chicago');
  assert.equal(d.from.toISOString(), '2026-11-01T05:00:00.000Z');
  assert.equal(d.to.toISOString(), '2026-11-02T06:00:00.000Z');
  return `${d.from.toISOString()} → ${d.to.toISOString()}`;
});

const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ zone, observesDst, results }, null, 2));
process.exit(failed.length === 0 ? 0 : 1);
