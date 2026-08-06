import http from 'http';
import { createAnonServer } from '../dist/server.js';

const results = [];
function check(name, cond, extra = '') {
  results.push(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' ' + extra : ''}`);
  if (!cond) process.exitCode = 1;
}

function fakeUpstream(handler) {
  return new Promise((resolve) => {
    const s = http.createServer(handler);
    s.listen(0, () => resolve({ server: s, port: s.address().port }));
  });
}
const base = (port) => `http://127.0.0.1:${port}`;

// fake upstream that 403s chat-requirements
const { port: p403 } = await fakeUpstream((req, res) => {
  res.writeHead(403, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ detail: 'rate limited' }));
});
// fake upstream that 500s everything
const { port: p500 } = await fakeUpstream((req, res) => {
  res.writeHead(500, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'boom' }));
});
// fake upstream that returns valid JSON but no dx (covers getTurnstile crash path)
const { port: pNoDx } = await fakeUpstream((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ token: 'tok', turnstile: {}, proofofwork: { required: true, seed: '', difficulty: '' } }));
});
// fake upstream that streams forever (disconnect test)
const { port: pSlow } = await fakeUpstream((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const iv = setInterval(() => res.write('data: {"v":"a"}\n\n'), 50);
  req.on('close', () => clearInterval(iv));
});

function startProxy(port) {
  const server = createAnonServer(base(port));
  return new Promise((resolve) => server.listen(0, () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` })));
}

const proxy403 = await startProxy(p403);
const proxy500 = await startProxy(p500);
const proxyNoDx = await startProxy(pNoDx);
const proxySlow = await startProxy(pSlow);

const post = (url, body, opts = {}) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...opts.headers }, body: opts.rawBody ?? JSON.stringify(body) });

// --- error mapping ---
let r = await post(`${proxy403.url}/v1/chat/completions`, { messages: [{ role: 'user', content: 'hi' }] });
check('upstream 403 -> 429', r.status === 429, `(got ${r.status})`);
r = await post(`${proxy500.url}/v1/chat/completions`, { messages: [{ role: 'user', content: 'hi' }] });
check('upstream 500 -> 502', r.status === 502, `(got ${r.status})`);
r = await post(`${proxyNoDx.url}/v1/chat/completions`, { messages: [{ role: 'user', content: 'hi' }] });
check('garbage dx -> 500, no crash', r.status === 500, `(got ${r.status})`);

// --- validation ---
r = await post(proxy403.url + '/v1/chat/completions', '', { rawBody: '{not json' });
check('malformed JSON -> 400', r.status === 400, `(got ${r.status})`);
const j = await r.json().catch(() => null);
check('400 error shape', j?.error?.type === 'bad_request');
r = await fetch(proxy403.url + '/v1/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'x'.repeat(11 * 1024 * 1024) }] }),
});
check('oversized body -> 413', r.status === 413, `(got ${r.status})`);
r = await post(`${proxy403.url}/v1/chat/completions`, { messages: [] });
check('empty messages -> no crash', [400, 429, 500].includes(r.status), `(got ${r.status})`);
r = await fetch(`${proxy403.url}/nope`);
check('unknown path -> 404', r.status === 404);
r = await fetch(`${proxy403.url}/v1/chat/completions`, { method: 'PUT' });
check('PUT -> 404', r.status === 404);
r = await fetch(`${proxy403.url}/v1/chat/completions`, { method: 'OPTIONS' });
check('OPTIONS -> 204', r.status === 204);
r = await fetch(`${proxy403.url}/health`);
check('health -> 200', r.status === 200);
r = await fetch(`${proxy403.url}/v1/models`);
check('models -> 200', r.status === 200);

// --- concurrency: 8 parallel mixed requests, all answered ---
const concurrent = await Promise.all(
  Array.from({ length: 8 }, (_, i) =>
    i % 2 === 0 ? fetch(`${proxy403.url}/health`) : post(`${proxy403.url}/v1/chat/completions`, { messages: [{ role: 'user', content: 'hi' }] }),
  ),
);
check('8 concurrent requests all answered', concurrent.every((x) => x.status > 0), `(statuses ${concurrent.map((x) => x.status).join(',')})`);

// --- client disconnect mid-stream: server must survive and stay healthy ---
const ac = new AbortController();
const slow = fetch(`${proxySlow.url}/v1/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
  signal: ac.signal,
}).catch(() => 'aborted');
await new Promise((ok) => setTimeout(ok, 120));
ac.abort();
await slow;
await new Promise((ok) => setTimeout(ok, 300));
r = await fetch(`${proxySlow.url}/health`);
check('server survives client abort mid-stream', r.status === 200);

// --- CLI offline behavior ---
const { execFileSync, spawnSync } = await import('node:child_process');
const v = execFileSync(process.execPath, ['dist/bin/cli.js', '--version'], { encoding: 'utf8' }).trim();
check('CLI --version', v === '1.0.0', `(${v})`);
const empty = spawnSync(process.execPath, ['dist/bin/cli.js', 'chat'], { encoding: 'utf8' });
check('CLI chat no-args exits 1', empty.status === 1, `(status ${empty.status})`);
const badHealth = spawnSync(process.execPath, ['dist/bin/cli.js', 'health', '--base', 'http://127.0.0.1:1'], { encoding: 'utf8' });
check('CLI health dead port exits 1', badHealth.status === 1, `(status ${badHealth.status})`);

for (const s of [proxy403.server, proxy500.server, proxyNoDx.server, proxySlow.server]) s.close();
for (const p of [proxy403, proxy500, proxyNoDx, proxySlow]) p.server.close();

console.log('\n' + results.join('\n'));
console.log(`\n${results.filter((x) => x.startsWith('PASS')).length}/${results.length} passed`);
process.exit(process.exitCode ?? 0);
