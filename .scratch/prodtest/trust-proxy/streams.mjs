// Opens N live streams at once and reports how many the server accepted (200) and refused (429),
// with who refused (nginx's HTML page or the api's JSON). Run inside a client container so each
// client has its own address:  node streams.mjs URL N [XFF|rotate]
//   XFF     sent as the client's own X-Forwarded-For on every stream (a spoof attempt)
//   rotate  a different made-up X-Forwarded-For on every stream
const [url, nArg, xff = ''] = process.argv.slice(2);
const n = Number(nArg ?? 25);
const holdMs = Number(process.env.HOLD_MS ?? 8000);
const controllers = [];
const results = await Promise.all(Array.from({ length: n }, async (_, i) => {
  const headers = {};
  if (xff === 'rotate') headers['X-Forwarded-For'] = `203.0.113.${i + 1}`;
  else if (xff) headers['X-Forwarded-For'] = xff;
  const ac = new AbortController();
  controllers.push(ac);
  try {
    const res = await fetch(url, { headers, signal: ac.signal });
    if (res.status === 200) return 'ok';
    const body = await res.text();
    return `${res.status}:${body.trimStart().startsWith('{') ? 'api' : 'nginx'}`;
  } catch (e) {
    return `error:${e.cause?.code ?? e.message}`;
  }
}));
// Hold the accepted streams open so a concurrent client sees them counted.
await new Promise((r) => setTimeout(r, holdMs));
controllers.forEach((c) => c.abort());
const tally = results.reduce((t, r) => ({ ...t, [r]: (t[r] ?? 0) + 1 }), {});
console.log(JSON.stringify({ client: process.env.CLIENT ?? '?', url, xff, n, tally }));
process.exit(0);
