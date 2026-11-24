import { describe, expect, it } from 'vitest';
import http from 'node:http';
import { openDb } from './db.mjs';
import { createAuth, hashPassword } from './auth.mjs';
import { createAdmin, cleanEvent } from './admin.mjs';
import { createHandler } from './lib.mjs';

async function setup() {
  let t = Date.parse('2026-11-24T12:00:00Z');
  const now = () => t;
  const db = openDb(':memory:');
  const auth = createAuth({ db, secure: false, now });
  const admin = createAdmin({ db, auth, now, publicOrigin: 'https://balonca.example.com', llmStatus: () => ({ today: { usd: 0.4 } }) });
  const pw = await hashPassword('long enough pw');
  db.createUser({ email: 'boss@example.com', passHash: pw, isAdmin: true, now: t });
  db.createUser({ email: 'ayse@example.com', passHash: pw, now: t });
  const srv = http.createServer(createHandler({ auth, admin, ratePerMinute: 1000, now, run: async () => ({ stdout: '{}' }) }));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = async (email) => {
    let cookie = '';
    const call = async (path, body, method = body ? 'POST' : 'GET') => {
      const r = await fetch(base + path, { method, body: body ? JSON.stringify(body) : undefined, headers: { 'sec-fetch-site': 'same-origin', origin: base, ...(cookie ? { cookie } : {}) } });
      const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
      return { status: r.status, body: await r.json().catch(() => null) };
    };
    await call('/api/auth/login', { email, password: 'long enough pw' });
    return call;
  };
  return { db, browser, tick: (ms) => (t += ms), close: () => srv.close() };
}

describe('events', () => {
  it('keeps only allowed types and short meta values', () => {
    expect(cleanEvent({ type: 'word_save', meta: { lang: 'nl', text: 'secret sentence' } })).toEqual({ type: 'word_save', meta: { lang: 'nl' } });
    expect(cleanEvent({ type: 'review', meta: { grade: 'x'.repeat(40) } })).toEqual({ type: 'review', meta: null });
    expect(cleanEvent({ type: 'login' })).toBeNull(); // server-side types cannot be faked
    expect(cleanEvent({ type: 'constructor' })).toBeNull();
  });

  it('counts one heartbeat per minute per user, however many tabs', async () => {
    const s = await setup();
    const ayse = await s.browser('ayse@example.com');
    for (let i = 0; i < 3; i++) expect((await ayse('/api/events', { type: 'heartbeat' })).status).toBe(200);
    s.tick(60_000);
    await ayse('/api/events', { type: 'heartbeat' });
    expect((await ayse('/api/events', { type: 'nope' })).status).toBe(400);
    const boss = await s.browser('boss@example.com');
    const o = (await boss('/api/admin/overview')).body;
    expect(o.days.at(-1)).toMatchObject({ day: '2026-11-24', minutes: 2 });
    expect(o).toMatchObject({ users: 2, active1: 2, llm: { today: { usd: 0.4 } } });
    s.close();
  });
});

describe('admin API', () => {
  it('is for admins only', async () => {
    const s = await setup();
    const ayse = await s.browser('ayse@example.com');
    for (const p of ['/api/admin/overview', '/api/admin/users', '/api/admin/invites']) expect((await ayse(p)).status).toBe(403);
    expect((await ayse('/api/admin/invites', {})).status).toBe(403);
    s.close();
  });

  it('lists users, makes invites and reset links, switches accounts off and on', async () => {
    const s = await setup();
    const boss = await s.browser('boss@example.com');
    const ayse = await s.browser('ayse@example.com');
    const users = (await boss('/api/admin/users')).body.users;
    expect(users.map((u) => [u.email, u.admin])).toEqual([['boss@example.com', true], ['ayse@example.com', false]]);
    const inv = (await boss('/api/admin/invites', { days: 3 })).body;
    expect(inv.link).toMatch(/^https:\/\/balonca\.example\.com\/#\/davet\/[\w-]{22}$/);
    expect(s.db.invite(inv.code).expires_at - s.db.invite(inv.code).created_at).toBe(3 * 86_400_000);
    expect((await boss('/api/admin/invites')).body.invites[0]).toMatchObject({ code: inv.code, used: null });
    const id = users[1].id;
    expect((await boss(`/api/admin/users/${id}/reset`, {})).body.link).toMatch(/#\/sifre\//);
    expect((await boss(`/api/admin/users/${id}/disable`, { disabled: true })).body).toEqual({ ok: true, disabled: true });
    expect((await ayse('/api/me')).status).toBe(401); // signed out at once
    await boss(`/api/admin/users/${id}/disable`, { disabled: false });
    expect((await (await s.browser('ayse@example.com'))('/api/me')).status).toBe(200);
    expect((await boss(`/api/admin/users/${users[0].id}/disable`, { disabled: true })).status).toBe(400); // not yourself
    expect((await boss('/api/admin/users/999')).status).toBe(404);
    s.close();
  });
});
