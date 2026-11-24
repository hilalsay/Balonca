import { describe, expect, it } from 'vitest';
import { mkdtemp, readdir, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { backup } from './backup-db.mjs';

describe('backup-db', () => {
  it('makes a private, checked copy and drops copies older than the limit', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'bk-'));
    const dbFile = path.join(dir, 'src.db');
    const db = new DatabaseSync(dbFile); db.exec('CREATE TABLE t (x); INSERT INTO t VALUES (42);'); db.close();
    const out = path.join(dir, 'out');
    const old = path.join(out, 'balonca-2026-01-01-00-00.db');
    backup(dbFile, out, { now: Date.parse('2026-11-01T03:30:00Z') });
    await writeFile(old, 'old');
    await utimes(old, new Date('2026-01-01'), new Date('2026-01-01'));
    const r = backup(dbFile, out, { now: Date.parse('2026-11-02T03:30:00Z') });
    expect(r.removed).toEqual(['balonca-2026-01-01-00-00.db']);
    expect((await readdir(out)).sort()).toEqual(['balonca-2026-11-01-03-30.db', 'balonca-2026-11-02-03-30.db']);
    expect((await stat(r.out)).mode & 0o777).toBe(0o600);
    expect(new DatabaseSync(r.out, { readOnly: true }).prepare('SELECT x FROM t').get().x).toBe(42);
  });
});
