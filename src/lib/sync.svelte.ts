/**
 * Keeps this device and the account in step (server/sync.mjs). IndexedDB stays the working copy, so the app is fast
 * and works offline; changes travel in the background: at start, 2 s after a change, when the tab comes back and
 * when the connection returns. First this device's changes go up, then the others' come down.
 */
import { app, type SyncPayload } from './state.svelte';
import { account } from './account.svelte';

const BASE = (import.meta.env.VITE_SUBS_API as string | undefined) ?? '/api';

interface SyncMeta { user: string; pulledAt: number }

class Sync {
  state = $state<'idle' | 'busy' | 'error'>('idle');
  lastAt = $state(0);
  /** First sign-in on a device that already has data: what to do with it is asked once. */
  ask = $state<{ words: number; texts: number } | null>(null);
  private meta: SyncMeta | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  private started = false;

  /** Called once the account is known; does nothing without one. */
  async start() {
    if (this.started || account.status !== 'in' || !account.me || !app.storageOk) return;
    this.started = true;
    const me = account.me.email.toLowerCase();
    const saved = await app.meta<SyncMeta>('sync');
    if (saved?.user === me) this.meta = saved;
    else {
      const n = app.localCounts();
      // Data from before this account (or from someone else on this device): ask; an empty device just takes the account's.
      if (n.words || n.texts) { this.ask = n; return; }
      this.meta = { user: me, pulledAt: 0 };
      await app.setMeta('sync', this.meta);
    }
    this.listen();
    void this.run();
  }

  /** The answer to `ask`. "No" saves a backup file first, then empties this device and takes the account's data. */
  async choose(addToAccount: boolean) {
    if (!account.me) return;
    if (addToAccount) app.markAll();
    else {
      try {
        const blob = await app.exportAll();
        const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `balonca-bu-cihaz-${new Date().toISOString().slice(0, 10)}.json` });
        a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      } catch {}
      await app.wipeLocal();
    }
    this.meta = { user: account.me.email.toLowerCase(), pulledAt: 0 };
    await app.setMeta('sync', this.meta);
    this.ask = null;
    this.listen();
    void this.run();
  }

  private listen() {
    app.onChange = () => this.soon();
    addEventListener('online', () => void this.run());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void this.run(); });
  }

  /** A change happened: sync in two seconds (many changes in a row make one request). */
  soon() {
    if (!this.meta) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), 2000);
  }

  /** One round: push, then pull. Overlapping calls fold into one more round. */
  async run(): Promise<void> {
    if (!this.meta || account.status !== 'in') return;
    if (this.running) { this.again = true; return this.running; }
    this.running = (async () => {
      this.state = 'busy';
      try {
        const out = app.collect();
        const startedAt = Date.now();
        if (out.words.length || out.known.length || out.library.length || out.settings) {
          await request('POST', '/sync', out);
          app.acknowledge(startedAt);
        }
        const r = await request('GET', `/sync?since=${this.meta!.pulledAt}`) as SyncPayload & { now: number };
        await app.applyRemote(r);
        // A small overlap: a change saved by another device in the same second is not missed.
        this.meta = { ...this.meta!, pulledAt: Math.max(0, r.now - 5000) };
        await app.setMeta('sync', this.meta);
        this.lastAt = Date.now();
        this.state = 'idle';
      } catch (e) {
        this.state = 'error';
        if (e instanceof SyncAuthError) void account.check(); // signed out elsewhere (password changed)
      } finally {
        this.running = null;
        if (this.again) { this.again = false; void this.run(); }
      }
    })();
    return this.running;
  }
}

class SyncAuthError extends Error {}

async function request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
  const r = await fetch(`${BASE}${path}`, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) throw new SyncAuthError();
  if (!r.ok) throw new Error(`sync ${r.status}`);
  return r.json();
}

export const sync = new Sync();
