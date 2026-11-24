// Measurements (phase 5): what the app tells about its use, and the admin panel's API. No IP addresses, no texts.
//   POST /api/events {type, meta?}           a signed-in user's app reports one event (allowed types only)
//   GET  /api/admin/overview                 counts, last 30 days per day, model spend today
//   GET  /api/admin/users                    every account with its numbers
//   GET  /api/admin/users/:id                one account: event counts of the last 30 days
//   POST /api/admin/users/:id/disable {disabled}   switch an account off (its sessions end) or on again
//   POST /api/admin/users/:id/reset          a one-hour password link for that account
//   GET  /api/admin/invites   POST /api/admin/invites {days?}   invite links
import { ApiError } from './lib.mjs';
import { readBody } from './translate.mjs';
import { windowCounter } from './limits.mjs';

/** Event types the browser may report, with the meta fields kept for each (short values only). */
export const CLIENT_EVENTS = { heartbeat: [], video_open: [], text_open: [], word_save: ['lang'], review: ['grade'] };
export const EVENT_DAYS = 180;
const DAY = 86_400_000;

export function cleanEvent(b) {
  if (!b || typeof b !== 'object' || !Object.hasOwn(CLIENT_EVENTS, b.type)) return null;
  const meta = {};
  for (const k of CLIENT_EVENTS[b.type]) {
    const v = b.meta?.[k];
    if ((typeof v === 'string' && /^[a-z0-9-]{1,12}$/i.test(v)) || (typeof v === 'number' && Number.isInteger(v) && Math.abs(v) < 100)) meta[k] = v;
  }
  return { type: b.type, meta: Object.keys(meta).length ? meta : null };
}

/** auth: auth.mjs (invites, reset links). llmStatus(): today's model spend. publicOrigin: for the links. */
export function createAdmin({ db, auth, llmStatus = () => null, publicOrigin = '', now = Date.now }) {
  const perUser = windowCounter(60_000, 30, now);
  const beats = new Map(); // user -> last heartbeat: at most one counted per 50 s, however many tabs are open
  const prune = () => db.pruneEvents(now() - EVENT_DAYS * DAY);
  prune();
  setInterval(prune, DAY).unref?.();

  const json = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(JSON.stringify(body));
  };
  const body = async (req) => { try { const b = JSON.parse((await readBody(req, 2_000)) || '{}'); return b && typeof b === 'object' ? b : {}; } catch { throw new ApiError(400, 'bad-request'); } };
  const link = (p) => `${publicOrigin}/#/${p}`;

  async function events(req, res, user) {
    if (req.method !== 'POST') throw new ApiError(405, 'method');
    if (!perUser.has(user.id)) throw new ApiError(429, 'rate-limit');
    perUser.add(user.id);
    const e = cleanEvent(await body(req));
    if (!e) throw new ApiError(400, 'bad-request');
    if (e.type === 'heartbeat') {
      if (now() - (beats.get(user.id) ?? 0) < 50_000) return json(res, 200, { ok: true });
      beats.set(user.id, now());
    }
    db.event(user.id, e.type, now(), e.meta);
    json(res, 200, { ok: true });
  }

  async function admin(req, res, url, user) {
    if (!user?.is_admin) throw new ApiError(403, 'forbidden');
    const p = url.pathname.slice('/api/admin/'.length).split('/');
    const t = now(), from = Math.floor((t - 29 * DAY) / DAY) * DAY; // 30 calendar days (UTC) including today
    if (p[0] === 'overview' && req.method === 'GET') {
      const days = Array.from({ length: 30 }, (_, d) => ({ day: new Date(from + d * DAY).toISOString().slice(0, 10), users: 0, minutes: 0 }));
      for (const r of db.perDay(from)) if (days[r.d]) Object.assign(days[r.d], { users: r.users, minutes: r.minutes ?? 0 });
      return json(res, 200, {
        users: db.countUsers(), active1: db.activeSince(t - DAY), active7: db.activeSince(t - 7 * DAY), new7: db.newUsersSince(t - 7 * DAY),
        days, events30: db.eventTypes(from), llm: await llmStatus(),
      });
    }
    if (p[0] === 'users' && p.length === 1 && req.method === 'GET') {
      return json(res, 200, { users: db.adminUsers(from).map((u) => ({ id: u.id, email: u.email, admin: !!u.is_admin, disabled: !!u.disabled,
        google: !!u.google, created: u.created_at, lastSeen: u.last_seen_at, words: u.words, texts: u.texts, videos: u.videos, minutes30: u.minutes })) });
    }
    if (p[0] === 'users' && /^\d{1,9}$/.test(p[1] ?? '')) {
      const id = Number(p[1]), u = db.userById(id);
      if (!u) throw new ApiError(404, 'not-found');
      if (p.length === 2 && req.method === 'GET') return json(res, 200, { id, email: u.email, events30: db.userEventTypes(id, from) });
      if (p[2] === 'disable' && req.method === 'POST') {
        if (id === user.id) throw new ApiError(400, 'not-yourself');
        const off = !!(await body(req)).disabled;
        db.setDisabled(id, off);
        if (off) db.deleteSessionsOf(id);
        db.event(user.id, off ? 'admin_disable' : 'admin_enable', t, { user: id });
        return json(res, 200, { ok: true, disabled: off });
      }
      if (p[2] === 'reset' && req.method === 'POST') return json(res, 200, { link: link(`sifre/${auth.createReset(id)}`) });
    }
    if (p[0] === 'invites' && p.length === 1) {
      if (req.method === 'GET') return json(res, 200, { invites: db.invites().map((i) => ({ code: i.code, link: link(`davet/${i.code}`), created: i.created_at, expires: i.expires_at, used: i.used_at, usedBy: i.used_email ?? null })) });
      if (req.method === 'POST') {
        const days = Number((await body(req)).days);
        const code = auth.createInvite(user.id, Number.isInteger(days) && days >= 1 && days <= 60 ? days : undefined);
        return json(res, 200, { code, link: link(`davet/${code}`) });
      }
    }
    throw new ApiError(404, 'not-found-route');
  }

  return { events, admin };
}
