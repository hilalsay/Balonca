import { describe, expect, it } from 'vitest';
import http from 'node:http';
import { openDb } from './db.mjs';
import { createAuth, hashPassword, verifyPassword } from './auth.mjs';
import { createSync } from './sync.mjs';
import { createHandler } from './lib.mjs';

function server() {
  const db = openDb(':memory:');
  const auth = createAuth({ db, secure: false });
  const handler = createHandler({ auth, sync: createSync({ db }), ratePerMinute: 1000, run: async () => ({ stdout: '{}' }) });
  const srv = http.createServer(handler);
  const ready = new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = () => `http://127.0.0.1:${srv.address().port}`;
  /** A browser: keeps its cookie, sends the site's own headers. */
  const browser = () => {
    let cookie = '';
    const call = async (path, body, method = body ? 'POST' : 'GET') => {
      await ready;
      const r = await fetch(base() + path, { method, body: body ? JSON.stringify(body) : undefined,
        headers: { 'sec-fetch-site': 'same-origin', origin: base(), ...(cookie ? { cookie } : {}) } });
      const set = r.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
      return { status: r.status, body: await r.json().catch(() => null), setCookie: set };
    };
    return { call, get cookie() { return cookie; } };
  };
  return { db, auth, browser, close: () => srv.close() };
}

describe('passwords', () => {
  it('hash and verify', async () => {
    const h = await hashPassword('correct horse');
    expect(h).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(await verifyPassword('correct horse', h)).toBe(true);
    expect(await verifyPassword('wrong horse!', h)).toBe(false);
  });
});

describe('accounts', () => {
  it('signs up with a one-time invite, then signs in and out', async () => {
    const s = server();
    const code = s.auth.createInvite();
    const a = s.browser();
    expect((await a.call('/api/me')).status).toBe(401);
    expect((await a.call('/api/subs?v=abcdefghijk')).body).toEqual({ error: 'login-required' });
    const reg = await a.call('/api/auth/register', { email: 'ayse@example.com', password: 'long enough pw', invite: code });
    expect(reg.status).toBe(200);
    expect(reg.setCookie).toMatch(/balonca_sid=.+; HttpOnly; SameSite=Lax; Path=\/; Max-Age=2592000/);
    expect((await a.call('/api/me')).body).toEqual({ email: 'ayse@example.com', displayName: null, isAdmin: false });
    // the invite is used up
    expect((await s.browser().call('/api/auth/register', { email: 'b@example.com', password: 'long enough pw', invite: code })).body).toEqual({ error: 'bad-invite' });
    await a.call('/api/auth/logout', {});
    expect((await a.call('/api/me')).status).toBe(401);
    expect((await a.call('/api/auth/login', { email: 'AYSE@example.com', password: 'long enough pw' })).status).toBe(200);
    s.close();
  });

  it('says the same for an unknown e-mail and a wrong password, and limits tries', async () => {
    const s = server();
    s.db.createUser({ email: 'x@example.com', passHash: await hashPassword('right password'), now: 1 });
    const b = s.browser();
    const wrong = await b.call('/api/auth/login', { email: 'x@example.com', password: 'nope nope nope' });
    const none = await b.call('/api/auth/login', { email: 'nobody@example.com', password: 'nope nope nope' });
    expect(wrong).toMatchObject({ status: 401, body: { error: 'bad-login' } });
    expect(none).toMatchObject({ status: 401, body: { error: 'bad-login' } });
    for (let i = 0; i < 9; i++) await b.call('/api/auth/login', { email: 'x@example.com', password: 'nope nope nope' });
    expect((await b.call('/api/auth/login', { email: 'x@example.com', password: 'right password' })).status).toBe(429);
    s.close();
  });

  it('a new password signs out every other device; reset links work once', async () => {
    const s = server();
    const id = s.db.createUser({ email: 'y@example.com', passHash: await hashPassword('first password'), now: 1 });
    const phone = s.browser(), laptop = s.browser();
    await phone.call('/api/auth/login', { email: 'y@example.com', password: 'first password' });
    await laptop.call('/api/auth/login', { email: 'y@example.com', password: 'first password' });
    expect((await phone.call('/api/auth/password', { current: 'first password', password: 'second password' })).status).toBe(200);
    expect((await phone.call('/api/me')).status).toBe(200);
    expect((await laptop.call('/api/me')).status).toBe(401);
    const token = s.auth.createReset(id);
    expect((await s.browser().call('/api/auth/reset', { token, password: 'third password' })).status).toBe(200);
    expect((await s.browser().call('/api/auth/reset', { token, password: 'fourth password' })).body).toEqual({ error: 'bad-reset' });
    s.close();
  });

  it('rejects weak input', async () => {
    const s = server();
    const code = s.auth.createInvite();
    const b = s.browser();
    expect((await b.call('/api/auth/register', { email: 'not-an-email', password: 'long enough pw', invite: code })).body.error).toBe('bad-email');
    expect((await b.call('/api/auth/register', { email: 'z@example.com', password: 'short', invite: code })).body.error).toBe('short-password');
    expect((await b.call('/api/auth/register', { email: 'z@example.com', password: 'long enough pw', invite: 'guess' })).body.error).toBe('bad-invite');
    s.close();
  });
});

describe('sync', () => {
  it('keeps devices in step, newer wins, deletions travel, and nobody sees another user’s data', async () => {
    const s = server();
    const make = async (email) => {
      const b = s.browser();
      await b.call('/api/auth/register', { email, password: 'long enough pw', invite: s.auth.createInvite() });
      return b;
    };
    const a1 = await make('a@example.com'), b = await make('b@example.com');
    const word = (t, extra = {}) => ({ id: 'nl:huis', lang: 'nl', updatedAt: t, data: { w: 'huis', reps: t }, ...extra });
    expect((await a1.call('/api/sync', { words: [word(100)], known: [{ lang: 'nl', w: 'de', updatedAt: 100 }], settings: { data: { theme: 'dark' }, updatedAt: 100 },
      library: [{ id: 't1', kind: 'text', title: 'Een dag', body: 'Ik heet Sam.', updatedAt: 100 }] })).status).toBe(200);
    // an older change does not overwrite a newer one
    await a1.call('/api/sync', { words: [word(50)] });
    const pulled = (await a1.call('/api/sync?since=0')).body;
    expect(pulled.words).toEqual([{ id: 'nl:huis', lang: 'nl', updatedAt: 100, deleted: false, data: { w: 'huis', reps: 100 } }]);
    expect(pulled.settings).toEqual({ data: { theme: 'dark' }, updatedAt: 100 });
    expect(pulled.library[0]).toMatchObject({ id: 't1', body: 'Ik heet Sam.' });
    // deleting travels
    await a1.call('/api/sync', { words: [word(200, { deleted: true })] });
    expect((await a1.call('/api/sync?since=150')).body.words).toEqual([{ id: 'nl:huis', lang: 'nl', updatedAt: 200, deleted: true }]);
    // the other user sees nothing of it
    const other = (await b.call('/api/sync?since=0')).body;
    expect([other.words, other.known, other.library, other.settings]).toEqual([[], [], [], null]);
    s.close();
  });
  it('drops malformed records', async () => {
    const { cleanWord, cleanLibrary } = await import('./sync.mjs');
    expect(cleanWord({ id: 'tr:ev', lang: 'nl', updatedAt: 1 }, 10)).toBeNull(); // id of another language
    expect(cleanLibrary({ id: '../x', kind: 'text', updatedAt: 1 }, 10)).toBeNull();
    expect(cleanLibrary({ id: 'a', kind: 'youtube', vid: 'not-an-id!!', updatedAt: 1 }, 10)).toBeNull();
    expect(cleanLibrary({ id: 'a', kind: 'link', url: 'javascript:alert(1)', updatedAt: 1 }, 10)).toBeNull();
    expect(cleanWord({ id: 'nl:x', lang: 'nl', updatedAt: 1e15 }, 10).updatedAt).toBe(60_010); // no far-future stamps
  });
});

describe('sign in with Google', () => {
  const google = { clientId: 'cid.apps.googleusercontent.com', clientSecret: 'test-secret', redirectUri: 'https://balonca.example.com/api/auth/google/callback' };
  function setup() {
    const db = openDb(':memory:');
    let claims = {};
    const calls = [];
    const fetchImpl = async (u, init) => {
      calls.push({ u, body: String(init.body) });
      const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
      return new Response(JSON.stringify({ id_token: `${part({ alg: 'RS256' })}.${part(claims)}.sig` }), { status: 200 });
    };
    const auth = createAuth({ db, secure: false, google, fetchImpl });
    const srv = http.createServer(createHandler({ auth, ratePerMinute: 1000, run: async () => ({ stdout: '{}' }) }));
    const ready = new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const get = async (path, headers = {}) => {
      await ready;
      const r = await fetch(`http://127.0.0.1:${srv.address().port}${path}`, { redirect: 'manual', headers });
      return { status: r.status, location: r.headers.get('location'), cookies: r.headers.getSetCookie(), body: await r.text() };
    };
    /** start (from the site) -> Google -> callback with the given claims; returns the callback answer. */
    const signIn = async (who, { invite = '', cookie = true, state: forceState } = {}) => {
      const start = await get(`/api/auth/google/start${invite ? `?invite=${invite}` : ''}`, { 'sec-fetch-site': 'same-origin' });
      expect(start.status).toBe(302);
      const to = new URL(start.location);
      expect(to.origin).toBe('https://accounts.google.com');
      expect(to.searchParams.get('redirect_uri')).toBe(google.redirectUri);
      const state = forceState ?? to.searchParams.get('state');
      claims = { iss: 'https://accounts.google.com', aud: google.clientId, exp: Date.now() / 1000 + 300, nonce: to.searchParams.get('nonce'), email_verified: true, ...who };
      const g = start.cookies[0].split(';')[0];
      return get(`/api/auth/google/callback?state=${state}&code=abc`, { 'sec-fetch-site': 'cross-site', ...(cookie ? { cookie: g } : {}) });
    };
    const sid = (r) => r.cookies.find((c) => c.startsWith('balonca_sid=') && !c.startsWith('balonca_sid=;'));
    return { db, auth, signIn, get, calls, sid, close: () => srv.close() };
  }

  it('says Google is there when signed out', async () => {
    const s = setup();
    const r = await s.get('/api/me', { 'sec-fetch-site': 'same-origin' });
    expect(r.status).toBe(401);
    expect(JSON.parse(r.body)).toEqual({ error: 'login-required', google: true });
    s.close();
  });

  it('needs an invite for a new person, then signs them in with one tap', async () => {
    const s = setup();
    const no = await s.signIn({ sub: '111', email: 'yeni@example.com' });
    expect(no.location).toBe('/#/giris?hata=need-invite');
    expect(s.sid(no)).toBeUndefined();
    const code = s.auth.createInvite();
    const yes = await s.signIn({ sub: '111', email: 'yeni@example.com' }, { invite: code });
    expect(yes.location).toBe('/#/');
    expect(s.sid(yes)).toMatch(/HttpOnly; SameSite=Lax/);
    expect(s.db.invite(code).used_by).toBe(s.db.userByEmail('yeni@example.com').id);
    expect(s.calls[1].body).toContain('client_secret=test-secret');
    // later: no invite needed, even if the e-mail changed at Google
    expect(s.sid(await s.signIn({ sub: '111', email: 'baska@example.com' }))).toBeTruthy();
    s.close();
  });

  it('adds Google to an existing account with the same verified e-mail', async () => {
    const s = setup();
    const id = s.db.createUser({ email: 'ayse@example.com', passHash: 'x', now: 1 });
    expect(s.sid(await s.signIn({ sub: '222', email: 'AYSE@example.com' }))).toBeTruthy();
    expect(s.db.userById(id).google_sub).toBe('222');
    // an unverified e-mail is not enough
    s.db.createUser({ email: 'mehmet@example.com', passHash: 'x', now: 1 });
    expect((await s.signIn({ sub: '333', email: 'mehmet@example.com', email_verified: false })).location).toBe('/#/giris?hata=google-failed');
    s.close();
  });

  it('refuses a callback without the state cookie, a wrong nonce or audience, and cross-site starts', async () => {
    const s = setup();
    const code = s.auth.createInvite();
    expect((await s.signIn({ sub: '1', email: 'a@example.com' }, { invite: code, cookie: false })).location).toBe('/#/giris?hata=google-failed');
    expect((await s.signIn({ sub: '1', email: 'a@example.com', nonce: 'other' }, { invite: code })).location).toBe('/#/giris?hata=google-failed');
    expect((await s.signIn({ sub: '1', email: 'a@example.com', aud: 'someone-else' }, { invite: code })).location).toBe('/#/giris?hata=google-failed');
    expect((await s.signIn({ sub: '1', email: 'a@example.com', exp: 1 }, { invite: code })).location).toBe('/#/giris?hata=google-failed');
    expect((await s.get('/api/auth/google/start', { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect(s.db.invite(code).used_by).toBeNull();
    s.close();
  });
});

describe('deleting an account', () => {
  it('needs the e-mail as confirmation, removes everything of the user, keeps the invite used', async () => {
    const s = server();
    const code = s.auth.createInvite();
    const a = s.browser();
    await a.call('/api/auth/register', { email: 'weg@example.com', password: 'long enough pw', invite: code });
    await a.call('/api/sync', { words: [{ id: 'nl:huis', lang: 'nl', updatedAt: Date.now(), data: { w: 'huis' } }],
      library: [{ id: 'doc1', kind: 'text', body: 'Mijn huis.', meta: { lang: 'nl' }, createdAt: 1, updatedAt: Date.now() }] });
    const id = s.db.userByEmail('weg@example.com').id;
    expect((await a.call('/api/me', { confirm: 'other@example.com' }, 'DELETE')).body).toEqual({ error: 'bad-confirm' });
    expect((await a.call('/api/me', { confirm: 'WEG@example.com' }, 'DELETE')).status).toBe(200);
    expect(s.db.userById(id)).toBeNull();
    expect(s.db.savedWord(id, 'nl:huis')).toBeNull();
    expect(s.db.libraryItem(id, 'doc1')).toBeNull();
    expect((await a.call('/api/me')).status).toBe(401);
    // the invite does not come back to life
    expect((await s.browser().call('/api/auth/register', { email: 'x@example.com', password: 'long enough pw', invite: code })).body).toEqual({ error: 'bad-invite' });
    s.close();
  });
});
