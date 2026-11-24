#!/usr/bin/env node
// Account administration on the server itself.
//   node server/cli.mjs create-admin <email>     asks the password (not shown while typing)
//   node server/cli.mjs invite [days]            prints a one-time invite link
//   node server/cli.mjs reset <email>            prints a one-hour password reset link
// Database: BALONCA_DB (default ../data/balonca.db next to server/). Site address for links: PUBLIC_ORIGIN.
import { fileURLToPath } from 'node:url';
import { openDb } from './db.mjs';
import { createAuth, hashPassword, EMAIL_RE, PASSWORD_MIN } from './auth.mjs';

try { process.loadEnvFile(process.env.BALONCA_ENV_FILE ?? '/etc/balonca.env'); } catch {}
const file = process.env.BALONCA_DB ?? fileURLToPath(new URL('../data/balonca.db', import.meta.url));
const origin = process.env.PUBLIC_ORIGIN || 'https://balonca.example.com';

/** Reads a line without showing what is typed (keeps what was typed ahead for the next question). */
let ahead = '';
function secret(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const stdin = process.stdin;
    stdin.setRawMode?.(true); stdin.resume(); stdin.setEncoding('utf8');
    const done = () => {
      const k = ahead.search(/[\r\n]/);
      if (k < 0) return false;
      const line = ahead.slice(0, k); ahead = ahead.slice(k + 1).replace(/^\n/, '');
      stdin.setRawMode?.(false); stdin.pause(); stdin.off('data', on); process.stdout.write('\n');
      resolve(line); return true;
    };
    const on = (ch) => {
      for (const c of ch) {
        if (c === '\u0003') { process.stdout.write('\n'); process.exit(1); }
        if (c === '\u007f' || c === '\b') ahead = ahead.slice(0, -1); else ahead += c;
      }
      done();
    };
    if (!done()) stdin.on('data', on);
  });
}

const [cmd, arg] = process.argv.slice(2);
const db = openDb(file);
const auth = createAuth({ db });
if (cmd === 'create-admin') {
  if (!EMAIL_RE.test(arg ?? '')) { console.error('usage: create-admin <email>'); process.exit(1); }
  if (db.userByEmail(arg)) { console.error('An account with this e-mail exists already.'); process.exit(1); }
  const p1 = await secret(`Password (at least ${PASSWORD_MIN} characters): `);
  const p2 = await secret('Again: ');
  if (p1 !== p2) { console.error('The two passwords differ.'); process.exit(1); }
  if (p1.length < PASSWORD_MIN) { console.error('Too short.'); process.exit(1); }
  db.createUser({ email: arg, passHash: await hashPassword(p1), isAdmin: true, now: Date.now() });
  console.log('Admin account created.');
} else if (cmd === 'invite') {
  const days = Number(arg ?? 14);
  const code = createAuth({ db, inviteDays: Number.isFinite(days) && days > 0 ? days : 14 }).createInvite(null);
  console.log(`${origin}/#/davet/${code}`);
} else if (cmd === 'reset') {
  const u = arg ? db.userByEmail(arg) : null;
  if (!u) { console.error('No such account.'); process.exit(1); }
  console.log(`${origin}/#/sifre/${auth.createReset(u.id)}  (valid for one hour)`);
} else {
  console.log('usage: node server/cli.mjs create-admin <email> | invite [days] | reset <email>');
}
db.close();
