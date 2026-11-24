import { app } from './state.svelte';
import { ingestText } from './ingest';
import { listRemoteSubs, fetchRemoteSub, SubsApiError, SUBS_API_ENABLED, type RemoteList } from './ytsubs/api';
import { baseLang, pickManual, pickSource } from './ytsubs/pick';
import { isBrokenLine, serverTranslate, serverConfig } from './translate/server.svelte';
import { TranslateError } from './translate/runner';
import { AUTO_LANGS } from './settings';

export type JobPhase = 'fetch' | 'queued' | 'translate' | 'done' | 'error';
export interface Job { kind: 'source' | 'target'; lang: string; phase: JobPhase; done: number; total: number; ahead: number; error?: string; manual?: boolean }

const PARTIAL = ' (AI…)';
const PIVOT = 'en';
const PIVOT_TO = 'tr';

/**
 * The order to make translations in. Turkish is translated from English (the local model is much better at
 * English → Turkish than at e.g. Dutch → Turkish), so English is made first when it is not there yet.
 */
export function pivotOrder(src: string, wanted: string[], open: readonly string[]): string[] {
  const out = [...wanted];
  if (src !== PIVOT && out.includes(PIVOT_TO) && open.includes(PIVOT) && !out.includes(PIVOT)) out.splice(out.indexOf(PIVOT_TO), 0, PIVOT);
  if (out.includes(PIVOT) && out.includes(PIVOT_TO) && out.indexOf(PIVOT) > out.indexOf(PIVOT_TO)) {
    out.splice(out.indexOf(PIVOT), 1); out.splice(out.indexOf(PIVOT_TO), 0, PIVOT);
  }
  return out;
}
const FINISHED = ' (AI)';

/**
 * Finished machine translations that contain a broken line, plus the Turkish ones made from a broken English one
 * (they copy its mistakes).
 */
export function brokenTracks<T extends { name: string; lang: string; cues: { text: string }[] }>(tracks: T[]): T[] {
  const ai = tracks.filter((t) => t.name.endsWith(FINISHED));
  const bad = ai.filter((t) => t.cues.some((c) => isBrokenLine(c.text)));
  if (bad.some((t) => t.lang === PIVOT)) {
    for (const t of ai) if (t.lang === PIVOT_TO && t.name.includes(`→ ${PIVOT} →`) && !bad.includes(t)) bad.push(t);
  }
  return bad;
}

class AutoSubs {
  jobs = $state<Job[]>([]);
  running = $state(false);
  private ctl: AbortController | null = null;
  private openedFor: string | null = null;

  /** Languages this video could still be translated into (empty when its own language is unknown). */
  offerable(): string[] {
    const src = app.tracks[0]?.lang;
    if (!src || src === '??') return [];
    return AUTO_LANGS.filter((l) => l !== src && !app.tracks.some((t) => t.lang === l));
  }

  /** The user picked a language in the status bar. `remember` makes it the automatic choice from now on. */
  translateTo(lang: string, remember = false) {
    if (remember) app.setSetting('autoTranslate', lang as (typeof AUTO_LANGS)[number]);
    if (app.vid) void this.run(app.vid, [lang]);
  }

  cancel() { this.ctl?.abort(); }

  /**
   * Called when a video opens. Fully automatic only for a video without subtitles (or one whose translation
   * was interrupted); otherwise the user's own choices are left alone and the status bar offers the missing ones.
   */
  async onOpen(vid: string) {
    if (this.openedFor === vid) return; // same video again (e.g. a "jump to word" link): leave running work alone
    this.openedFor = vid;
    this.cancel();
    this.jobs = [];
    if (!SUBS_API_ENABLED || !app.settings.autoSubs) return;
    const interrupted = app.tracks.filter((t) => t.name.endsWith(PARTIAL)).map((t) => t.lang);
    // Machine translations saved by an older version may hold broken lines: remove and make them again.
    const broken = brokenTracks(app.tracks);
    for (const t of broken) app.removeTrack(t.id);
    const redo = [...new Set([...interrupted, ...broken.map((t) => t.lang)])];
    if (!app.tracks.length || redo.length) await this.run(vid, redo.length ? redo : undefined);
  }

  /**
   * Gets the video's own subtitle if it has none, then translates into `targets`. Without `targets` that is the
   * remembered language (Settings), or nothing: the status bar then asks which language to translate into, so no
   * time is spent on a translation the user does not want.
   */
  async run(vid: string, targets?: string[]) {
    this.cancel();
    const ctl = (this.ctl = new AbortController());
    const signal = ctl.signal;
    const alive = () => !signal.aborted && app.vid === vid;
    this.running = true;
    this.jobs = [];
    let list: RemoteList | null = null;
    try {
      // Interrupted translations start over (the server has kept what it already translated, so this is fast).
      for (const t of app.tracks.filter((x) => x.name.endsWith(PARTIAL))) app.removeTrack(t.id);

      if (!app.tracks.length) {
        const job = this.add({ kind: 'source', lang: '', phase: 'fetch' });
        try {
          list = await listRemoteSubs(vid, signal);
          const src = pickSource(list.tracks);
          if (!src) throw new SubsApiError('no-subs');
          job.lang = baseLang(src.code);
          const text = await fetchRemoteSub(vid, src, signal);
          if (!alive()) return;
          if (!ingestText(text, `${vid}.${src.code}.json3`, job.lang, { quiet: true })) throw new SubsApiError('failed');
          job.manual = src.kind === 'manual';
          job.phase = 'done';
        } catch (e) {
          if (!alive()) return;
          job.phase = 'error';
          job.error = e instanceof SubsApiError ? `ytsubs.err.${e.code}` : 'ytsubs.err.failed';
          return;
        }
      }

      const source = app.tracks[0];
      if (!source || !alive()) return;
      const auto = app.settings.autoTranslate;
      const wanted = targets ?? (auto === 'ask' ? [] : [auto]);
      const open = this.offerable();
      const chosen = wanted.filter((l) => open.includes(l));
      for (const lang of serverConfig.pivot === 'en' ? pivotOrder(source.lang, chosen, open) : chosen) {
        if (!alive()) return;
        const job = this.add({ kind: 'target', lang, phase: 'translate' });
        // A hand-made YouTube subtitle in the target language beats any machine translation.
        if (!list) list = await listRemoteSubs(vid, signal).catch(() => null);
        const manual = list && pickManual(list.tracks, lang);
        if (manual) {
          try {
            const text = await fetchRemoteSub(vid, manual, signal);
            if (alive() && ingestText(text, `${vid}.${manual.code}.json3`, lang, { quiet: true })) { job.manual = true; job.phase = 'done'; continue; }
          } catch { /* fall back to translating */ }
          if (!alive()) return;
        }

        // The server translates the video's own YouTube subtitle, which it reads itself (never text from here).
        // Turkish comes out better from the English translation than straight from e.g. Dutch: the server does that.
        const via = serverConfig.pivot === 'en' && lang === PIVOT_TO && source.lang !== PIVOT;
        const track = app.addCues([], `${source.name} → ${via ? `${PIVOT} → ` : ''}${lang}${PARTIAL}`, lang);
        try {
          if (!list) list = await listRemoteSubs(vid, signal);
          const yt = pickSource(list.tracks);
          if (!yt) throw new TranslateError('unavailable', 'no-subs');
          await serverTranslate({
            source: { v: vid, code: yt.code, kind: yt.kind === 'manual' ? 'manual' : 'auto' }, to: lang, signal,
            onQueued: (ahead) => { job.phase = 'queued'; job.ahead = ahead; },
            onCues: (cues, done, total) => {
              if (app.vid !== vid) return;
              app.appendCues(track.id, cues);
              job.phase = 'translate'; job.done = done; job.total = total;
            },
          });
          if (app.vid !== vid) return;
          app.renameTrack(track.id, `${source.name} → ${via ? `${PIVOT} → ` : ''}${lang}${FINISHED}`);
          job.phase = 'done';
        } catch (e) {
          if (app.vid === vid) app.removeTrack(track.id);
          const code = e instanceof TranslateError ? e.code : 'network';
          if (code === 'cancelled') { this.jobs = this.jobs.filter((j) => j.phase === 'done'); return; }
          job.phase = 'error';
          job.error = `auto.err.${code}`;
          if (code === 'unavailable' || code === 'rate-limit' || code === 'busy') return; // the next language would fail the same way
        }
      }
    } finally {
      if (this.ctl === ctl) { this.running = false; this.ctl = null; }
    }
  }

  private add(j: Pick<Job, 'kind' | 'lang' | 'phase'>): Job {
    this.jobs.push({ done: 0, total: 0, ahead: 0, ...j });
    return this.jobs[this.jobs.length - 1]; // the reactive proxy, so updates show up
  }
}

export const autoSubs = new AutoSubs();
