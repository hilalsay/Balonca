// Load test (phase 3 acceptance: 50 users at once, < 1 % errors). Run it against a LOCAL test instance only.
//   node scripts/loadtest.mjs <base url> <file with one invite code per line> [seconds=60] [video id]
// Every virtual user signs up with its own invite, then repeats what a learner does every ~2 s: who am I, sync,
// which translations are ready, the video's translation (cached: no model cost), a heartbeat. Reports latency and
// errors; 429 (a limit answered) is counted apart from failures.
import { readFileSync } from 'node:fs';

const [base, codesFile, secs = '60', vid = 'Ej3Cl2IFQp0'] = process.argv.slice(2);
if (!base || !codesFile) { console.error('usage: node scripts/loadtest.mjs <base url> <codes file> [seconds] [video id]'); process.exit(2); }
const codes = readFileSync(codesFile, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
const until = Date.now() + Number(secs) * 1000;
const times = [], stats = { ok: 0, limited: 0, failed: 0 }, failures = new Map();

async function user(i, code) {
  let cookie = '';
  const h = () => ({ 'sec-fetch-site': 'same-origin', origin: base, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) });
  const call = async (name, method, path, body) => {
    const t = performance.now();
    try {
      const r = await fetch(base + path, { method, headers: h(), body: body ? JSON.stringify(body) : undefined });
      const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
      const text = await r.text();
      times.push(performance.now() - t);
      // A streamed translation answers 200 and may report its error inside the stream.
      if (r.ok && text.includes('"type":"error"')) { stats.failed++; failures.set(`${name} stream-error`, (failures.get(`${name} stream-error`) ?? 0) + 1); }
      else if (r.ok) stats.ok++; else if (r.status === 429) stats.limited++; else { stats.failed++; failures.set(`${name} ${r.status}`, (failures.get(`${name} ${r.status}`) ?? 0) + 1); }
    } catch (e) { stats.failed++; failures.set(`${name} ${e.cause?.code ?? e.name}`, (failures.get(`${name} ${e.cause?.code ?? e.name}`) ?? 0) + 1); }
  };
  await call('register', 'POST', '/api/auth/register', { email: `load${i}@example.com`, password: 'long enough pw', invite: code });
  const steps = [
    () => call('me', 'GET', '/api/me'), () => call('sync', 'GET', '/api/sync?since=0'),
    () => call('ready', 'GET', `/api/translations?v=${vid}`),
    () => call('translate', 'POST', '/api/translate', { v: vid, code: 'nl', kind: 'manual', to: 'tr' }),
    () => call('heartbeat', 'POST', '/api/events', { type: 'heartbeat' }),
  ];
  for (let k = 0; Date.now() < until; k++) {
    await steps[k % steps.length]();
    await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1000));
  }
}

await Promise.all(codes.map((c, i) => user(i, c)));
times.sort((a, b) => a - b);
const q = (p) => Math.round(times[Math.min(times.length - 1, Math.floor(times.length * p))] ?? 0);
const total = stats.ok + stats.limited + stats.failed;
console.log(`${codes.length} users, ${secs} s: ${total} requests, ${stats.ok} ok, ${stats.limited} limited (429), ${stats.failed} failed (${((stats.failed / Math.max(1, total)) * 100).toFixed(2)} %)`);
console.log(`latency ms: p50 ${q(0.5)}, p95 ${q(0.95)}, p99 ${q(0.99)}, max ${Math.round(times.at(-1) ?? 0)}`);
if (failures.size) console.log('failures:', Object.fromEntries(failures));
process.exit(stats.failed / Math.max(1, total) < 0.01 ? 0 : 1);
