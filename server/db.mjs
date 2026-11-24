// The database (SQLite through node:sqlite, no dependency). All SQL of the server lives in this file, every
// statement with parameters (never pieces of text glued into SQL). Schema changes are numbered migrations
// (PRAGMA user_version), applied in one transaction at start.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const MIGRATIONS = [
  // 1: accounts, the user's data, shared caches, measurements
  `CREATE TABLE users (
     id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL COLLATE NOCASE, pass_hash TEXT NOT NULL,
     display_name TEXT, is_admin INTEGER NOT NULL DEFAULT 0, disabled INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL, last_seen_at INTEGER);
   CREATE TABLE invites (code TEXT PRIMARY KEY, created_by INTEGER REFERENCES users(id), created_at INTEGER NOT NULL,
     used_by INTEGER REFERENCES users(id), used_at INTEGER, expires_at INTEGER);
   CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, user_agent TEXT);
   CREATE INDEX sessions_user ON sessions(user_id);
   CREATE TABLE resets (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER);
   CREATE TABLE words (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, id TEXT NOT NULL,
     lang TEXT NOT NULL, data TEXT NOT NULL, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (user_id, id));
   CREATE INDEX words_user_updated ON words(user_id, updated_at);
   CREATE TABLE known_words (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, lang TEXT NOT NULL,
     w TEXT NOT NULL, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, lang, w));
   CREATE INDEX known_user_updated ON known_words(user_id, updated_at);
   CREATE TABLE settings (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, data TEXT NOT NULL,
     updated_at INTEGER NOT NULL);
   CREATE TABLE library (id TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     kind TEXT NOT NULL CHECK (kind IN ('youtube','link','text','pdf','subfile')),
     title TEXT, url TEXT, vid TEXT, body TEXT, meta TEXT,
     created_at INTEGER NOT NULL, opened_at INTEGER, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (user_id, id));
   CREATE INDEX library_user_updated ON library(user_id, updated_at);
   CREATE TABLE transcripts (vid TEXT NOT NULL, code TEXT NOT NULL, kind TEXT NOT NULL, cues TEXT NOT NULL,
     fetched_at INTEGER NOT NULL, PRIMARY KEY (vid, code, kind));
   CREATE TABLE translations (vid TEXT NOT NULL, src_code TEXT NOT NULL, src_kind TEXT NOT NULL, via TEXT NOT NULL DEFAULT '',
     to_lang TEXT NOT NULL, model TEXT NOT NULL, units TEXT NOT NULL, out TEXT NOT NULL, status TEXT NOT NULL,
     updated_at INTEGER NOT NULL, PRIMARY KEY (vid, src_code, src_kind, via, to_lang, model));
   CREATE TABLE events (id INTEGER PRIMARY KEY, user_id INTEGER, type TEXT NOT NULL, at INTEGER NOT NULL, meta TEXT);
   CREATE INDEX events_at ON events(at);
   CREATE INDEX events_user_at ON events(user_id, at);
   CREATE TABLE llm_usage (id INTEGER PRIMARY KEY, user_id INTEGER, at INTEGER NOT NULL, provider TEXT NOT NULL,
     model TEXT NOT NULL, purpose TEXT NOT NULL, input_tokens INTEGER, output_tokens INTEGER, cost_usd REAL);`,
  // 2: a dictionary made once (phase 3b): meanings of frequent word forms, so lookups need no model later
  `CREATE TABLE dictionary (lang TEXT NOT NULL, form TEXT NOT NULL, lemma TEXT, data TEXT NOT NULL, source TEXT NOT NULL,
     created_at INTEGER NOT NULL, PRIMARY KEY (lang, form));`,
  // 3: sign in with Google (the account's stable Google id; an account may have both a password and Google)
  `ALTER TABLE users ADD COLUMN google_sub TEXT;
   CREATE UNIQUE INDEX users_google_sub ON users(google_sub);`,
];

/** Opens (and creates or upgrades) the database. ':memory:' for tests. */
export function openDb(file) {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const have = db.prepare('PRAGMA user_version').get().user_version;
  for (let v = have; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try { db.exec(MIGRATIONS[v]); db.exec(`PRAGMA user_version = ${v + 1}`); db.exec('COMMIT'); }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  return repo(db);
}

/** Every query the server makes, as named functions. */
function repo(db) {
  const q = (sql) => db.prepare(sql);
  const tx = (fn) => (...a) => { db.exec('BEGIN'); try { const r = fn(...a); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  const s = {
    userByEmail: q('SELECT * FROM users WHERE email = ?'),
    userById: q('SELECT * FROM users WHERE id = ?'),
    userByGoogle: q('SELECT * FROM users WHERE google_sub = ?'),
    setGoogle: q('UPDATE users SET google_sub = ? WHERE id = ?'),
    insertUser: q('INSERT INTO users (email, pass_hash, display_name, is_admin, created_at) VALUES (?, ?, ?, ?, ?)'),
    setPass: q('UPDATE users SET pass_hash = ? WHERE id = ?'),
    setDisabled: q('UPDATE users SET disabled = ? WHERE id = ?'),
    seen: q('UPDATE users SET last_seen_at = ? WHERE id = ?'),
    countUsers: q('SELECT COUNT(*) n FROM users'),
    insertInvite: q('INSERT INTO invites (code, created_by, created_at, expires_at) VALUES (?, ?, ?, ?)'),
    invite: q('SELECT * FROM invites WHERE code = ?'),
    useInvite: q('UPDATE invites SET used_by = ?, used_at = ? WHERE code = ? AND used_by IS NULL AND used_at IS NULL'),
    // deleting an account: what refers to it is let go (an invite it used stays used: used_at)
    forgetInvitesOf: q('UPDATE invites SET used_by = NULL WHERE used_by = ?'),
    forgetInvitesBy: q('UPDATE invites SET created_by = NULL WHERE created_by = ?'),
    deleteEventsOf: q('DELETE FROM events WHERE user_id = ?'),
    anonUsage: q('UPDATE llm_usage SET user_id = NULL WHERE user_id = ?'),
    deleteUser: q('DELETE FROM users WHERE id = ?'),
    invites: q('SELECT i.code, i.created_at, i.expires_at, i.used_at, u.email used_email FROM invites i LEFT JOIN users u ON u.id = i.used_by ORDER BY i.created_at DESC LIMIT 200'),
    insertSession: q('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)'),
    session: q('SELECT s.user_id, s.expires_at, u.email, u.display_name, u.is_admin, u.disabled, u.last_seen_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?'),
    deleteSession: q('DELETE FROM sessions WHERE token_hash = ?'),
    deleteSessionsOf: q('DELETE FROM sessions WHERE user_id = ?'),
    deleteExpired: q('DELETE FROM sessions WHERE expires_at < ?'),
    insertReset: q('INSERT INTO resets (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
    reset: q('SELECT * FROM resets WHERE token_hash = ?'),
    useReset: q('UPDATE resets SET used_at = ? WHERE token_hash = ? AND used_at IS NULL'),
    // sync
    wordsSince: q('SELECT id, lang, data, updated_at, deleted FROM words WHERE user_id = ? AND updated_at > ? ORDER BY updated_at LIMIT 20000'),
    word: q('SELECT updated_at FROM words WHERE user_id = ? AND id = ?'),
    wordData: q('SELECT data FROM words WHERE user_id = ? AND id = ? AND deleted = 0'),
    putWord: q(`INSERT INTO words (user_id, id, lang, data, updated_at, deleted) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id, id) DO UPDATE SET lang = excluded.lang, data = excluded.data, updated_at = excluded.updated_at, deleted = excluded.deleted
      WHERE excluded.updated_at > words.updated_at`),
    countWords: q('SELECT COUNT(*) n FROM words WHERE user_id = ? AND deleted = 0'),
    knownSince: q('SELECT lang, w, updated_at, deleted FROM known_words WHERE user_id = ? AND updated_at > ? ORDER BY updated_at LIMIT 100000'),
    putKnown: q(`INSERT INTO known_words (user_id, lang, w, updated_at, deleted) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (user_id, lang, w) DO UPDATE SET updated_at = excluded.updated_at, deleted = excluded.deleted
      WHERE excluded.updated_at > known_words.updated_at`),
    settings: q('SELECT data, updated_at FROM settings WHERE user_id = ?'),
    putSettings: q(`INSERT INTO settings (user_id, data, updated_at) VALUES (?, ?, ?)
      ON CONFLICT (user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at WHERE excluded.updated_at > settings.updated_at`),
    librarySince: q('SELECT id, kind, title, url, vid, body, meta, created_at, opened_at, updated_at, deleted FROM library WHERE user_id = ? AND updated_at > ? ORDER BY updated_at LIMIT 5000'),
    putLibrary: q(`INSERT INTO library (id, user_id, kind, title, url, vid, body, meta, created_at, opened_at, updated_at, deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id, id) DO UPDATE SET kind = excluded.kind, title = excluded.title, url = excluded.url, vid = excluded.vid,
        body = excluded.body, meta = excluded.meta, opened_at = excluded.opened_at, updated_at = excluded.updated_at, deleted = excluded.deleted
      WHERE excluded.updated_at > library.updated_at`),
    libraryItem: q('SELECT * FROM library WHERE user_id = ? AND id = ? AND deleted = 0'),
    insertEvent: q('INSERT INTO events (user_id, type, at, meta) VALUES (?, ?, ?, ?)'),
    dictGet: q('SELECT lemma, data, source FROM dictionary WHERE lang = ? AND form = ?'),
    dictPut: q(`INSERT INTO dictionary (lang, form, lemma, data, source, created_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (lang, form) DO UPDATE SET lemma = excluded.lemma, data = excluded.data, source = excluded.source, created_at = excluded.created_at`),
    dictHas: q('SELECT 1 FROM dictionary WHERE lang = ? AND form = ?'),
    dictCount: q('SELECT lang, COUNT(*) n FROM dictionary GROUP BY lang'),
  };
  return {
    raw: db,
    close: () => db.close(),
    tx,
    userByEmail: (email) => s.userByEmail.get(email) ?? null,
    userById: (id) => s.userById.get(id) ?? null,
    userByGoogle: (sub) => s.userByGoogle.get(sub) ?? null,
    setGoogle: (id, sub) => s.setGoogle.run(sub, id),
    countUsers: () => s.countUsers.get().n,
    createUser: ({ email, passHash, displayName = null, isAdmin = false, now }) =>
      Number(s.insertUser.run(email, passHash, displayName, isAdmin ? 1 : 0, now).lastInsertRowid),
    setPassword: (id, passHash) => s.setPass.run(passHash, id),
    setDisabled: (id, on) => s.setDisabled.run(on ? 1 : 0, id),
    touchUser: (id, at) => s.seen.run(at, id),
    createInvite: (code, by, now, expiresAt) => s.insertInvite.run(code, by, now, expiresAt),
    invite: (code) => s.invite.get(code) ?? null,
    /** Removes an account and everything that is its own (words, texts, settings, sessions: ON DELETE CASCADE). */
    deleteUser: (id) => tx(() => { s.forgetInvitesOf.run(id); s.forgetInvitesBy.run(id); s.deleteEventsOf.run(id); s.anonUsage.run(id); return s.deleteUser.run(id).changes === 1; })(),
    useInvite: (code, userId, now) => s.useInvite.run(userId, now, code).changes === 1,
    invites: () => s.invites.all(),
    createSession: (hash, userId, now, expiresAt, ua) => s.insertSession.run(hash, userId, now, expiresAt, ua),
    session: (hash) => s.session.get(hash) ?? null,
    deleteSession: (hash) => s.deleteSession.run(hash),
    deleteSessionsOf: (userId) => s.deleteSessionsOf.run(userId),
    deleteExpiredSessions: (now) => s.deleteExpired.run(now),
    createReset: (hash, userId, now, expiresAt) => s.insertReset.run(hash, userId, now, expiresAt),
    reset: (hash) => s.reset.get(hash) ?? null,
    useReset: (hash, now) => s.useReset.run(now, hash).changes === 1,
    wordsSince: (u, t) => s.wordsSince.all(u, t),
    putWord: (u, w) => s.putWord.run(u, w.id, w.lang, w.data, w.updatedAt, w.deleted ? 1 : 0),
    /** One saved word of a user (the SavedWord the browser synced), or null. */
    savedWord: (u, id) => { const r = s.wordData.get(u, id); try { return r ? JSON.parse(r.data) : null; } catch { return null; } },
    countWords: (u) => s.countWords.get(u).n,
    knownSince: (u, t) => s.knownSince.all(u, t),
    putKnown: (u, k) => s.putKnown.run(u, k.lang, k.w, k.updatedAt, k.deleted ? 1 : 0),
    settings: (u) => s.settings.get(u) ?? null,
    putSettings: (u, data, at) => s.putSettings.run(u, data, at),
    librarySince: (u, t) => s.librarySince.all(u, t),
    putLibrary: (u, x) => s.putLibrary.run(x.id, u, x.kind, x.title ?? null, x.url ?? null, x.vid ?? null, x.body ?? null, x.meta ?? null,
      x.createdAt, x.openedAt ?? null, x.updatedAt, x.deleted ? 1 : 0),
    libraryItem: (u, id) => s.libraryItem.get(u, id) ?? null,
    dict: (lang, form) => { const r = s.dictGet.get(lang, form); return r ? { lemma: r.lemma, source: r.source, ...JSON.parse(r.data) } : null; },
    putDict: (lang, form, lemma, data, source, at) => s.dictPut.run(lang, form, lemma, JSON.stringify(data), source, at),
    hasDict: (lang, form) => !!s.dictHas.get(lang, form),
    dictCounts: () => Object.fromEntries(s.dictCount.all().map((r) => [r.lang, r.n])),
    event: (userId, type, at, meta) => s.insertEvent.run(userId ?? null, type, at, meta ? JSON.stringify(meta) : null),
  };
}
