import { describe, expect, it } from 'vitest';
import http from 'node:http';
import { createHandler, checkSource } from './lib.mjs';
import { redact } from './redact.mjs';
import { createTtsHandler, speakable, windowCounter } from './nlp.mjs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

async function call(handler, p, { method = 'GET', headers = {}, body } = {}) {
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers, body });
    return { status: res.status, headers: res.headers, text: await res.text() };
  } finally { server.close(); }
}

describe('only the site itself may use the API', () => {
  const echo = async (req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); };
  const h = createHandler({ sentence: echo, tts: echo, publicOrigin: 'https://balonca.example.com', run: async () => ({ stdout: '{}' }) });

  it('refuses requests that do not come from the site', async () => {
    for (const site of [undefined, 'cross-site', 'same-site', 'none']) {
      const r = await call(h, '/api/tts?lang=nl&text=hoi', { headers: site ? { 'sec-fetch-site': site } : {} });
      expect(r.status, String(site)).toBe(403);
      expect(JSON.parse(r.text)).toEqual({ error: 'forbidden' });
    }
    expect((await call(h, '/api/tts?lang=nl&text=hoi', { headers: { 'sec-fetch-site': 'same-origin' } })).status).toBe(200);
  });
  it('wants the site origin on POST', async () => {
    const post = (origin) => call(h, '/api/sentence', { method: 'POST', body: '{}', headers: { 'sec-fetch-site': 'same-origin', ...(origin ? { origin } : {}) } });
    expect((await post('https://evil.example')).status).toBe(403);
    expect((await post(undefined)).status).toBe(403);
    expect((await post('https://balonca.example.com')).status).toBe(200);
  });
  it('old Safari without Sec-Fetch-Site: a page of the site may, a shared link may not', async () => {
    const ref = (referer) => call(h, '/api/tts?lang=nl&text=hoi', { headers: referer ? { referer } : {} });
    expect((await ref('https://balonca.example.com/#/read')).status).toBe(200);
    expect((await ref('https://evil.example/page')).status).toBe(403);
    expect((await ref(undefined)).status).toBe(403);
    // a modern browser saying cross-site is refused even with a fitting Referer
    expect((await call(h, '/api/tts?lang=nl&text=hoi', { headers: { 'sec-fetch-site': 'cross-site', referer: 'https://balonca.example.com/' } })).status).toBe(403);
  });
  it('lets health through for monitoring', async () => {
    expect((await call(h, '/api/health')).status).toBe(200);
  });
  it('without PUBLIC_ORIGIN, a POST from the same host (dev proxy) passes', () => {
    const req = (origin, host) => ({ method: 'POST', headers: { 'sec-fetch-site': 'same-origin', origin, host } });
    expect(() => checkSource(req('http://127.0.0.1:4199', '127.0.0.1:4199'))).not.toThrow();
    expect(() => checkSource(req('http://other:1', '127.0.0.1:4199'))).toThrow();
  });
  it('speech switched off answers 404', async () => {
    const off = createHandler({ tts: null });
    expect((await call(off, '/api/tts?lang=nl&text=hoi', { headers: { 'sec-fetch-site': 'same-origin' } })).status).toBe(404);
  });
});

describe('speech limits and headers', () => {
  const info = async () => ({ parse: [], tts: ['nl'] });
  const anyText = { contains: async () => true }; // every sentence counts as part of the text here
  const worker = { call: async (m) => { await writeFile(m.out, 'RIFFdata'); return { ok: true }; } };
  const ask = async (h, text, ip = '203.0.113.4') => {
    const out = { status: 0, headers: {}, body: '' };
    const res = { writeHead: (s, hd) => { out.status = s; out.headers = hd; }, end: () => {}, on() {}, once() {}, emit() {}, write() { return true; } };
    const { PassThrough } = await import('node:stream');
    const sink = new PassThrough(); Object.assign(sink, res); sink.resume();
    try { await h({ headers: {}, method: 'GET' }, sink, new URL(`http://x/api/tts?lang=nl&lib=doc1&text=${encodeURIComponent(text)}`), ip); }
    catch (e) { out.status = e.status; out.code = e.code; }
    return out;
  };

  it('keeps audio private and out of search engines', async () => {
    const h = createTtsHandler({ worker, info, sources: anyText, cacheDir: await mkdtemp(path.join(tmpdir(), 'tts-')) });
    const r = await ask(h, 'Hallo daar');
    expect(r.headers['cache-control']).toBe('private, max-age=86400');
    expect(r.headers['cache-control']).not.toMatch(/public|immutable/);
    expect(r.headers['x-robots-tag']).toBe('noindex');
  });
  it('limits new speech but not audio already made', async () => {
    const h = createTtsHandler({ worker, info, sources: anyText, cacheDir: await mkdtemp(path.join(tmpdir(), 'tts-')), limits: { newPer10Min: 2 } });
    expect((await ask(h, 'Een')).status).toBe(200);
    expect((await ask(h, 'Twee')).status).toBe(200);
    expect((await ask(h, 'Drie')).status).toBe(429);
    expect((await ask(h, 'Een')).status).toBe(200); // cached
    expect((await ask(h, 'Drie', '203.0.113.8')).status).toBe(200); // another client
  });
  it('limits characters per day', async () => {
    const h = createTtsHandler({ worker, info, sources: anyText, cacheDir: await mkdtemp(path.join(tmpdir(), 'tts-')), limits: { charsPerDay: 12 } });
    expect((await ask(h, 'Hallo daar')).status).toBe(200);
    expect((await ask(h, 'Nog een zin')).status).toBe(429);
  });
  it('reads only text with letters, without addresses', () => {
    expect(speakable('Kijk op https://evil.example/x of mail me@evil.example nu')).toBe('Kijk op of mail nu');
    expect(speakable('12345 !!!')).toBe('');
    expect(speakable('Hallo\u0000‮daar')).toBe('Hallo daar');
  });
  it('windowCounter forgets old hits', () => {
    let t = 0;
    const c = windowCounter(1000, 2, () => t);
    c.add('a'); c.add('a');
    expect(c.has('a')).toBe(false);
    t = 1500;
    expect(c.has('a')).toBe(true);
  });
});

describe('redact', () => {
  it('masks keys, tokens, cookies and e-mail names', () => {
    const s = redact('key sk-ant-abcdefghijklmnop token ghp_abcdefghijklmnopqrstuvwx pat github_pat_11ABCDEFG0123456789abcdef mail jan.de.vries@example.com Bearer abc.def.ghi1234');
    expect(s).not.toMatch(/sk-ant|ghp_a|github_pat_1|jan\.de\.vries|abc\.def/);
    expect(s).toContain('***@example.com');
    expect(redact({ 'x-api-key': 'secret', Authorization: 'Bearer x', cookie: 'sid=1', password: 'hunter2', nested: { token: 't' }, ok: 'fine' }))
      .toEqual({ 'x-api-key': '[redacted]', Authorization: '[redacted]', cookie: '[redacted]', password: '[redacted]', nested: { token: '[redacted]' }, ok: 'fine' });
    expect(redact('{"password":"hunter2","user":"a"}')).not.toContain('hunter2');
    expect(redact('https://user:pw@host/x')).toBe('https://[redacted]@host/x');
    expect(redact('x'.repeat(600)).length).toBeLessThan(510);
  });
});
