// Accounts: invite-only sign-up, e-mail + password, 30-day sessions in an HttpOnly cookie.
//   POST /api/auth/register {email, password, invite}   POST /api/auth/login {email, password}
//   POST /api/auth/logout                                POST /api/auth/password {current, password}
//   POST /api/auth/reset {token, password}               GET  /api/me
//   GET  /api/auth/google/start[?invite=]  GET /api/auth/google/callback   (sign in with Google, see below)
// Passwords: scrypt (N=2^15, r=8, p=1, 16-byte salt). Sessions: 32 random bytes, only their SHA-256 is stored.
// Login answers the same for "no such user" and "wrong password".
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { ApiError } from './lib.mjs';
import { windowCounter } from './limits.mjs';
import { readBody } from './translate.mjs';

const scrypt = promisify(scryptCb);
const N = 2 ** 15, R = 8, P = 1, KEYLEN = 32;
export const SESSION_DAYS = 30;
export const COOKIE = 'balonca_sid';
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
export const newToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}
export async function verifyPassword(password, stored) {
  const [alg, n, r, p, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64');
  const got = await scrypt(String(password).normalize('NFKC'), Buffer.from(salt, 'base64'), want.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
  return got.length === want.length && timingSafeEqual(got, want);
}
// Spent on unknown e-mails too, so the answer time does not tell whether an account exists.
const DUMMY = 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

export const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;
export const PASSWORD_MIN = 10;

export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/**
 * db: the repository from db.mjs. secure: Secure cookie flag (off only for plain-HTTP tests).
 * Returns { route(req, res, url, client) -> handled?, requireUser(req) -> user | null, … }.
 */
export function createAuth({ db, now = Date.now, secure = true, inviteDays = 14, google = null, fetchImpl = fetch }) {
  const loginTries = windowCounter(15 * 60_000, 10, now);
  const googleStarts = windowCounter(15 * 60_000, 30, now);
  /** state -> {nonce, invite, at}: sign-ins with Google on their way (10 minutes, in memory). */
  const pending = new Map();
  const cookie = (token, maxAge) =>
    `${COOKIE}=${token}; HttpOnly;${secure ? ' Secure;' : ''} SameSite=Lax; Path=/; Max-Age=${maxAge}`;

  function startSession(res, userId, req) {
    const token = newToken();
    const t = now();
    db.createSession(sha256(token), userId, t, t + SESSION_DAYS * 86_400_000, String(req.headers['user-agent'] ?? '').slice(0, 200));
    res.setHeader('set-cookie', cookie(token, SESSION_DAYS * 86400));
  }
  const json = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(JSON.stringify(body));
  };
  const me = (u) => ({ email: u.email, displayName: u.display_name ?? null, isAdmin: !!u.is_admin });

  /** The signed-in user of a request, or null. Updates "last seen" at most once a minute. */
  function requireUser(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token || token.length > 100) return null;
    const s = db.session(sha256(token));
    if (!s || s.expires_at < now() || s.disabled) return null;
    if (!s.last_seen_at || now() - s.last_seen_at > 60_000) db.touchUser(s.user_id, now());
    return { id: s.user_id, email: s.email, display_name: s.display_name, is_admin: s.is_admin };
  }

  async function body(req) {
    let b;
    try { b = JSON.parse(await readBody(req, 4_000)); } catch { throw new ApiError(400, 'bad-request'); }
    return b && typeof b === 'object' ? b : {};
  }
  const str = (v, max) => (typeof v === 'string' && v.length <= max ? v : '');

  // Sign in with Google (OpenID Connect, authorization code flow). The browser goes to Google and comes back to the
  // callback with a code; the server swaps the code for Google's ID token over its own TLS connection, so the token
  // needs no signature check (OpenID Connect Core, "ID Token Validation"). A random `state` in an HttpOnly cookie ties the return to the browser
  // that left, a `nonce` ties the token to it. A known Google account signs in; an account with the same (verified)
  // e-mail gets Google added; anyone else needs an invite code, as with a password.
  const G_COOKIE = 'balonca_g';
  const redirect = (res, to, extra = []) => {
    const had = res.getHeader('set-cookie'); // the session cookie, when one was started
    res.writeHead(302, { location: to, 'cache-control': 'no-store', 'set-cookie': [...(had ? [had].flat() : []), ...extra] });
    res.end();
  };
  const back = (res, error) => redirect(res, error ? `/#/giris?hata=${error}` : '/#/', [`${G_COOKIE}=; HttpOnly;${secure ? ' Secure;' : ''} SameSite=Lax; Path=/api/auth/google; Max-Age=0`]);

  async function googleRoute(req, res, url, client) {
    if (req.method !== 'GET') throw new ApiError(405, 'method');
    if (!google) throw new ApiError(404, 'not-found-route');
    for (const [k, v] of pending) if (now() - v.at > 10 * 60_000) pending.delete(k);
    if (url.pathname === '/api/auth/google/start') {
      if (!googleStarts.has(client) || pending.size > 5000) return back(res, 'rate-limit'), true;
      googleStarts.add(client);
      const state = newToken(24), nonce = newToken(24);
      pending.set(state, { nonce, invite: (url.searchParams.get('invite') ?? '').slice(0, 100), at: now() });
      const to = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      for (const [k, v] of Object.entries({ client_id: google.clientId, redirect_uri: google.redirectUri, response_type: 'code',
        scope: 'openid email', state, nonce, prompt: 'select_account' })) to.searchParams.set(k, v);
      redirect(res, to.href, [`${G_COOKIE}=${state}; HttpOnly;${secure ? ' Secure;' : ''} SameSite=Lax; Path=/api/auth/google; Max-Age=600`]);
      return true;
    }
    if (url.pathname !== '/api/auth/google/callback') throw new ApiError(404, 'not-found-route');
    const state = url.searchParams.get('state') ?? '', code = url.searchParams.get('code') ?? '';
    const p = pending.get(state);
    pending.delete(state);
    if (!p || !state || parseCookies(req.headers.cookie)[G_COOKIE] !== state) return back(res, 'google-failed'), true;
    if (!code) return back(res, url.searchParams.has('error') ? 'google-cancelled' : 'google-failed'), true;
    let claims;
    try {
      const r = await fetchImpl('https://oauth2.googleapis.com/token', {
        method: 'POST', signal: AbortSignal.timeout(10_000), headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, client_id: google.clientId, client_secret: google.clientSecret, redirect_uri: google.redirectUri, grant_type: 'authorization_code' }),
      });
      if (!r.ok) { console.warn(`google sign-in: token endpoint answered ${r.status}`); return back(res, 'google-failed'), true; }
      const idToken = String((await r.json()).id_token ?? '');
      claims = JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8'));
    } catch (e) { console.warn(`google sign-in: ${e?.name ?? 'error'}`); return back(res, 'google-failed'), true; }
    const ok = claims && ['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss) && claims.aud === google.clientId
      && Number(claims.exp) * 1000 > now() && claims.nonce === p.nonce && typeof claims.sub === 'string' && claims.sub.length <= 255;
    if (!ok) return back(res, 'google-failed'), true;
    const email = typeof claims.email === 'string' && claims.email_verified === true && EMAIL_RE.test(claims.email) ? claims.email : '';
    let u = db.userByGoogle(claims.sub);
    if (!u && email) {
      u = db.userByEmail(email);
      if (u?.google_sub) return back(res, 'google-failed'), true; // that account belongs to another Google account
      if (u && !u.disabled) db.setGoogle(u.id, claims.sub);
    }
    if (u) {
      if (u.disabled) return back(res, 'bad-login'), true;
      startSession(res, u.id, req);
      db.event(u.id, 'login', now(), { via: 'google' });
      return back(res, null), true;
    }
    if (!email) return back(res, 'google-failed'), true;
    const inv = p.invite ? db.invite(p.invite) : null;
    if (!inv || inv.used_by || (inv.expires_at && inv.expires_at < now())) return back(res, 'need-invite'), true;
    let id;
    try {
      id = db.tx(() => {
        const uid = db.createUser({ email, passHash: '', now: now() }); // no password: Google only (an admin reset link can add one)
        db.setGoogle(uid, claims.sub);
        if (!db.useInvite(p.invite, uid, now())) throw new ApiError(400, 'bad-invite');
        return uid;
      })();
    } catch { return back(res, 'bad-invite'), true; }
    startSession(res, id, req);
    db.event(id, 'register', now(), { via: 'google' });
    return back(res, null), true;
  }

  async function route(req, res, url, client) {
    const p = url.pathname;
    if (p === '/api/me') {
      if (req.method !== 'GET') throw new ApiError(405, 'method');
      const u = requireUser(req);
      // Signed out: also say which ways of signing in there are.
      if (!u) return json(res, 401, { error: 'login-required', google: !!google }), true;
      return json(res, 200, me(u)), true;
    }
    if (p.startsWith('/api/auth/google/')) return googleRoute(req, res, url, client);
    if (!p.startsWith('/api/auth/')) return false;
    if (req.method !== 'POST') throw new ApiError(405, 'method');
    const b = await body(req);

    if (p === '/api/auth/login') {
      const email = str(b.email, 254).trim(), password = str(b.password, 200);
      const key = `${client}|${email.toLowerCase()}`;
      if (!loginTries.has(key)) throw new ApiError(429, 'rate-limit');
      loginTries.add(key);
      const u = email ? db.userByEmail(email) : null;
      const ok = await verifyPassword(password, u?.pass_hash ?? DUMMY);
      if (!u || !ok || u.disabled) throw new ApiError(401, 'bad-login');
      startSession(res, u.id, req);
      db.event(u.id, 'login', now());
      return json(res, 200, me(u)), true;
    }
    if (p === '/api/auth/register') {
      const email = str(b.email, 254).trim(), password = str(b.password, 200), code = str(b.invite, 100).trim();
      if (!EMAIL_RE.test(email)) throw new ApiError(400, 'bad-email');
      if (password.length < PASSWORD_MIN) throw new ApiError(400, 'short-password');
      const inv = code ? db.invite(code) : null;
      if (!inv || inv.used_by || (inv.expires_at && inv.expires_at < now())) throw new ApiError(400, 'bad-invite');
      if (db.userByEmail(email)) throw new ApiError(409, 'email-taken');
      const hash = await hashPassword(password);
      const id = db.tx(() => {
        const uid = db.createUser({ email, passHash: hash, now: now() });
        if (!db.useInvite(code, uid, now())) throw new ApiError(400, 'bad-invite'); // used meanwhile: undo
        return uid;
      })();
      startSession(res, id, req);
      db.event(id, 'register', now());
      return json(res, 200, me(db.userById(id))), true;
    }
    if (p === '/api/auth/logout') {
      const token = parseCookies(req.headers.cookie)[COOKIE];
      if (token) db.deleteSession(sha256(token));
      res.setHeader('set-cookie', cookie('', 0));
      return json(res, 200, { ok: true }), true;
    }
    if (p === '/api/auth/password') {
      const u = requireUser(req);
      if (!u) throw new ApiError(401, 'login-required');
      const full = db.userById(u.id);
      if (!(await verifyPassword(str(b.current, 200), full.pass_hash))) throw new ApiError(401, 'bad-login');
      const password = str(b.password, 200);
      if (password.length < PASSWORD_MIN) throw new ApiError(400, 'short-password');
      db.setPassword(u.id, await hashPassword(password));
      db.deleteSessionsOf(u.id); // every other device signs in again
      startSession(res, u.id, req);
      return json(res, 200, { ok: true }), true;
    }
    if (p === '/api/auth/reset') {
      const token = str(b.token, 100), password = str(b.password, 200);
      const r = token ? db.reset(sha256(token)) : null;
      if (!r || r.used_at || r.expires_at < now()) throw new ApiError(400, 'bad-reset');
      if (password.length < PASSWORD_MIN) throw new ApiError(400, 'short-password');
      const hash = await hashPassword(password);
      if (!db.useReset(sha256(token), now())) throw new ApiError(400, 'bad-reset');
      db.setPassword(r.user_id, hash);
      db.deleteSessionsOf(r.user_id);
      startSession(res, r.user_id, req);
      return json(res, 200, me(db.userById(r.user_id))), true;
    }
    throw new ApiError(404, 'not-found-route');
  }

  return {
    route, requireUser,
    /** A new invite code (128 random bits), valid for `inviteDays`. */
    createInvite(byUserId = null) {
      const code = newToken(16);
      db.createInvite(code, byUserId, now(), now() + inviteDays * 86_400_000);
      return code;
    },
    /** A one-time password reset token, valid for an hour (the admin hands the link over). */
    createReset(userId) {
      const token = newToken();
      db.createReset(sha256(token), userId, now(), now() + 3_600_000);
      return token;
    },
  };
}
