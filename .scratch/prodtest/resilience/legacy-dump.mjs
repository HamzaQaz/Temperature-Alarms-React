// Upgrade path step 6: a synthetic dump of an old (PHP-era) database, shaped like the fixtures in
// backend/test/legacyMigration.test.ts: devices, locations, alarms, and one ESP_xxxxxx table per
// Device whose DATE and TIME are strings in America/Chicago local time.
//   node legacy-dump.mjs > old.sql         (prints expected counts to stderr)
// Contents: 3 locations (one shortcode lower-case), 6 device rows (one on an unknown campus),
// 5 ESP tables with a row every 5 minutes for the last 2 days, plus an orphan ESP table with no
// device row, and 3 unreadable rows (bad date, bad time, empty date) in ESP_0A0001.
const hosts = ['ESP_0A0001', 'ESP_0A0002', 'ESP_0A0003', 'ESP_0A0004', 'ESP_0A0005'];
const campusOf = ['OHS', 'OHS', 'oms', 'OES', 'OES'];
const out = [];
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
out.push('SET NAMES utf8mb4;', 'SET FOREIGN_KEY_CHECKS=0;');
out.push(`CREATE TABLE \`locations\` (\`ID\` int NOT NULL AUTO_INCREMENT, \`NAME\` varchar(255) NOT NULL, \`SHORTCODE\` varchar(255) NOT NULL, PRIMARY KEY (\`ID\`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;`);
out.push("INSERT INTO `locations` (NAME, SHORTCODE) VALUES ('Old High', 'OHS'), ('Old Middle', 'oms'), ('Old Elementary', 'OES');");
out.push(`CREATE TABLE \`devices\` (\`ID\` int NOT NULL AUTO_INCREMENT, \`Name\` varchar(255) DEFAULT NULL, \`Campus\` varchar(20) NOT NULL, \`Location\` varchar(20) NOT NULL, PRIMARY KEY (\`ID\`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;`);
out.push(`INSERT INTO \`devices\` (Name, Campus, Location) VALUES ${hosts.map((h, i) => `(${q(h)}, ${q(campusOf[i])}, ${q(i === 0 ? 'MDF' : `IDF ${i}`)})`).join(', ')}, ('ESP_0A00FF', 'NOPE', 'IDF 9');`);
out.push(`CREATE TABLE \`alarms\` (\`ID\` int NOT NULL AUTO_INCREMENT, \`EMAIL\` varchar(255) DEFAULT NULL, \`TEMP\` int DEFAULT NULL, PRIMARY KEY (\`ID\`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;`);
out.push("INSERT INTO `alarms` (EMAIL, TEMP) VALUES ('ops@example.test', 85);");

const chicago = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
const parts = (d) => Object.fromEntries(chicago.formatToParts(d).map((p) => [p.type, p.value]));
const end = Math.floor(Date.now() / 300_000) * 300_000 - 600_000;
const per = 2 * 24 * 12; // two days every 5 minutes
const expected = {};
for (const [i, h] of [...hosts, 'ESP_0A0099'].entries()) {
  const withHumidity = i % 2 === 0;
  out.push(`CREATE TABLE \`${h}\` (\`ID\` int NOT NULL AUTO_INCREMENT, \`CAMPUS\` varchar(20) NOT NULL, \`LOCATION\` varchar(20) NOT NULL, \`DATE\` varchar(20) NOT NULL, \`TIME\` varchar(20) NOT NULL, \`TEMP\` int NOT NULL, ${withHumidity ? '`HUMIDITY` int DEFAULT NULL, ' : ''}PRIMARY KEY (\`ID\`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;`);
  const rows = [];
  for (let n = 0; n < per; n++) {
    const p = parts(new Date(end - (per - 1 - n) * 300_000));
    const temp = 68 + ((n + i) % 6);
    rows.push(`(${q(campusOf[i] ?? 'OHS')}, 'IDF', ${q(`${p.month}/${p.day}/${p.year}`)}, ${q(`${p.hour}:${p.minute}:${p.second} ${p.dayPeriod}`)}, ${temp}${withHumidity ? `, ${30 + (n % 20)}` : ''})`);
  }
  if (i === 0) rows.push("('OHS', 'IDF', '13/45/2026', '1:00:00 PM', 70, 40)", "('OHS', 'IDF', '10/4/2026', '25:61:00 XM', 70, 40)", "('OHS', 'IDF', '', '1:00:00 PM', 70, 40)");
  for (let k = 0; k < rows.length; k += 500) {
    out.push(`INSERT INTO \`${h}\` (CAMPUS, LOCATION, DATE, TIME, TEMP${withHumidity ? ', HUMIDITY' : ''}) VALUES ${rows.slice(k, k + 500).join(', ')};`);
  }
  expected[h] = rows.length;
}
console.log(out.join('\n'));
console.error(JSON.stringify({ rowsPerTable: expected, readableRowsPerTable: per, firstLocal: parts(new Date(end - (per - 1) * 300_000)), lastLocal: parts(new Date(end)) }));
