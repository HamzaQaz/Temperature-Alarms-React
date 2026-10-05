// Posts N Readings with a wrong Device token and tallies the statuses: the api's per-address
// cap on Device-token failures (100 per 15 min) shows which address the api believes.
//   node devicefail.mjs URL N [rotate]
const [base, nArg, mode = ''] = process.argv.slice(2);
const tally = {};
for (let i = 0; i < Number(nArg); i++) {
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer wrong' };
  if (mode === 'rotate') headers['X-Forwarded-For'] = `203.0.113.${(i % 250) + 1}`;
  const res = await fetch(`${base}/api/readings`, { method: 'POST', headers, body: '{"device":"ESP_NOPE","temp":70,"humidity":40}' });
  tally[res.status] = (tally[res.status] ?? 0) + 1;
}
console.log(JSON.stringify({ client: process.env.CLIENT, mode, tally }));
