import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { markCreditGone, restarter, tinkerOff } from './switch.mjs';
import { createLlm } from './index.mjs';

describe('switching from Tinker to Ollama', () => {
  it('stops Tinker from TINKER_END (local midnight) or once the credit marker exists', async () => {
    const day = (s) => new Date(s).getTime();
    expect(tinkerOff({ end: '2026-12-10', now: day('2026-12-09T23:59:00') })).toBe('');
    expect(tinkerOff({ end: '2026-12-10', now: day('2026-12-10T00:00:00') })).toBe('date');
    expect(tinkerOff({ end: 'soon', now: day('2030-01-01T00:00:00') })).toBe(''); // a bad date changes nothing
    const dir = await mkdtemp(path.join(tmpdir(), 'switch-'));
    const marker = path.join(dir, 'usage', 'tinker-credit-gone');
    expect(tinkerOff({ markerFile: marker })).toBe('');
    markCreditGone(marker, day('2026-12-01T10:00:00'));
    expect(tinkerOff({ markerFile: marker })).toBe('credit');
    expect(await readFile(marker, 'utf8')).toContain('402/403');
    await rm(dir, { recursive: true, force: true });
  });

  it('restarts once under pm2, and only logs without it', () => {
    const exits = [], logs = [];
    const timers = [];
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (fn) => { timers.push(fn); return { unref() {} }; };
    try {
      const r = restarter({ env: { pm_id: '0' }, exit: (c) => exits.push(c), log: (m) => logs.push(m) });
      expect(r('credit')).toBe(true);
      expect(r('date')).toBe(false); // planned once
      timers.forEach((f) => f());
      expect(exits).toEqual([0]);
      const bare = restarter({ env: {}, exit: (c) => exits.push(c), log: (m) => logs.push(m) });
      expect(bare('date')).toBe(false);
      expect(exits).toEqual([0]);
      expect(logs.join('\n')).toMatch(/restart the service/);
    } finally { globalThis.setTimeout = realSetTimeout; }
  });

  it('the model layer reports a gone credit (402/403), not a bad key (401)', async () => {
    const gone = [];
    const mk = (status) => createLlm({
      provider: 'tinker', fallback: 'ollama', priceIn: 1, priceOut: 1, onCreditGone: (s) => gone.push(s),
      tinker: { url: 'https://tinker.example/api', key: 'k', model: 'org/Big' },
      ollama: { model: 'gemma3', chat: async () => ({ status: 200, content: '{}' }) },
    }, { fetchImpl: async () => ({ status, json: async () => ({ error: {} }) }), sleep: async () => {} });
    const body = { messages: [{ role: 'user', content: 'x' }] };
    await mk(402).chat('', body);
    await mk(401).chat('', body);
    expect(gone).toEqual([402]);
  });
});
