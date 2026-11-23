import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createYouTube } from './youtube.mjs';
import { ApiError } from './lib.mjs';

const info = {
  id: 'abcdefghijk', title: 'Video', duration: 60,
  subtitles: { en: [{ ext: 'json3', name: 'English' }] },
  automatic_captions: { 'nl-orig': [{ ext: 'json3', name: 'Dutch (Original)' }], tr: [{ ext: 'json3', name: 'Turkish' }] },
};

/** A fake yt-dlp and a fake clock (sleeping moves the clock, so minutes pass instantly). */
function setup({ fail, limits = {}, cacheDir = '' } = {}) {
  const clock = { t: 1_000_000 };
  const calls = [];
  const run = async (args) => {
    calls.push(args);
    if (fail) { const e = fail(calls.length); if (e) throw e; }
    if (args.includes('--dump-single-json')) return { stdout: JSON.stringify(info), stderr: '' };
    const out = args[args.indexOf('-o') + 1].replace('%(id)s', 'abcdefghijk');
    const lang = args[args.indexOf('--sub-langs') + 1];
    await writeFile(`${out}.${lang}.json3`, '{"events":[]}');
    return { stdout: '', stderr: '' };
  };
  const yt = createYouTube({ run, cacheDir, limits: { gapMs: [0, 0], ...limits }, now: () => clock.t, sleep: async (ms) => { clock.t += ms; } });
  return { yt, calls, clock, run };
}
const V = 'abcdefghijk';

describe('YouTube calls', () => {
  it('ten requests for one video at once make one call', async () => {
    const { yt, calls } = setup();
    const all = await Promise.all(Array.from({ length: 10 }, () => yt.list(V, 'a')));
    expect(all.every((x) => x.tracks.length === 3)).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('a video opened before costs no call, also after a restart', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'yt-'));
    const a = setup({ cacheDir: dir });
    await a.yt.list(V, 'a');
    await a.yt.sub(V, 'nl-orig', 'auto', 'a');
    expect(a.calls).toHaveLength(2);
    // the subtitle was read from the saved video info, not from a new page visit
    expect(a.calls[1]).toContain('--load-info-json');
    const b = setup({ cacheDir: dir }); // a new process, same disk
    await b.yt.list(V, 'a');
    expect((await b.yt.sub(V, 'nl-orig', 'auto', 'a')).text).toBe('{"events":[]}');
    expect(b.calls).toHaveLength(0);
  });

  it('never fetches YouTube’s own machine translations', async () => {
    const { yt, calls } = setup();
    await expect(yt.sub(V, 'tr', 'auto', 'a')).rejects.toMatchObject({ status: 400, code: 'auto-translated' });
    expect(calls.filter((c) => c.includes('--write-auto-subs'))).toHaveLength(0);
    await expect(yt.sub(V, 'de', 'manual', 'a')).rejects.toMatchObject({ code: 'no-subs' });
  });

  it('over the shared budget, requests wait their turn and then finish', async () => {
    const { yt, calls, clock } = setup({ limits: { perMin: 2 } });
    const start = clock.t;
    const ids = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'];
    await Promise.all(ids.map((id) => yt.list(id, 'a')));
    expect(calls).toHaveLength(3);
    expect(clock.t - start).toBeGreaterThanOrEqual(60_000); // the third waited a minute
  });

  it('says "busy" when the wait would be too long', async () => {
    const { yt } = setup({ limits: { perMin: 1, perHour: 1, maxWaitMs: 60_000 } });
    await yt.list('aaaaaaaaaaa', 'a');
    await expect(yt.list('bbbbbbbbbbb', 'a')).rejects.toMatchObject({ code: 'yt-busy' });
  });

  it('after a refusal makes no calls during the pause, then exactly one try', async () => {
    let refuse = true;
    const { yt, calls, clock } = setup({ fail: () => (refuse ? new ApiError(503, 'yt-rate-limit') : null) });
    await expect(yt.list('aaaaaaaaaaa', 'a')).rejects.toMatchObject({ code: 'yt-rate-limit' });
    expect(calls).toHaveLength(1);
    await expect(yt.list('bbbbbbbbbbb', 'a')).rejects.toMatchObject({ code: 'yt-blocked' });
    expect(calls).toHaveLength(1);
    expect(yt.status().paused).toMatchObject({ minutes: 15, reason: 'yt-rate-limit' });
    clock.t += 15 * 60_000 + 1;
    // still refused: the next pause is twice as long
    await expect(yt.list('ccccccccccc', 'a')).rejects.toMatchObject({ code: 'yt-rate-limit' });
    expect(calls).toHaveLength(2);
    expect(yt.status().paused?.minutes).toBe(30);
    clock.t += 30 * 60_000 + 1;
    refuse = false;
    await expect(yt.list('ddddddddddd', 'a')).resolves.toBeTruthy();
    expect(yt.status().paused).toBeNull();
  });

  it('limits new videos per client per day; cached ones do not count', async () => {
    const { yt } = setup({ limits: { newVideosPerDay: 1 } });
    await yt.list('aaaaaaaaaaa', 'a');
    await expect(yt.list('bbbbbbbbbbb', 'a')).rejects.toMatchObject({ status: 429, code: 'daily-videos' });
    await expect(yt.list('aaaaaaaaaaa', 'a')).resolves.toBeTruthy(); // cached
    await expect(yt.list('bbbbbbbbbbb', 'b')).resolves.toBeTruthy(); // someone else
  });

  it('background jobs wait while someone is waiting live', async () => {
    const { yt } = setup({ limits: { backgroundPerHour: 1 } });
    await yt.list('aaaaaaaaaaa', 'bg', { priority: 'background' });
    await expect(yt.list('bbbbbbbbbbb', 'bg', { priority: 'background' })).rejects.toMatchObject({ code: 'yt-busy' });
  });

  it('rejects bad ids and codes before any call', async () => {
    const { yt, calls } = setup();
    await expect(yt.list('../../etc', 'a')).rejects.toMatchObject({ code: 'bad-request' });
    await expect(yt.sub(V, '--exec', 'auto', 'a')).rejects.toMatchObject({ code: 'bad-request' });
    expect(calls).toHaveLength(0);
  });
});
