import { app } from './state.svelte';
import { ingestText } from './ingest';
import { listRemoteSubs, fetchRemoteSub, SubsApiError, SUBS_API_ENABLED, type RemoteList } from './ytsubs/api';
import { baseLang, pickManual, pickSource } from './ytsubs/pick';
import { serverTranslate } from './translate/server';
import { TranslateError } from './translate/runner';
import { AUTO_LANGS } from './settings';

export type JobPhase = 'fetch' | 'queued' | 'translate' | 'done' | 'error';
export interface Job { kind: 'source' | 'target'; lang: string; phase: JobPhase; done: number; total: number; ahead: number; error?: string; manual?: boolean }

const PARTIAL = ' (AI…)';
const FINISHED = ' (AI)';

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
    if (!app.tracks.length || interrupted.length) await this.run(vid, interrupted.length ? interrupted : undefined);
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
      for (const lang of this.offerable().filter((l) => wanted.includes(l))) {
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

        const track = app.addCues([], `${source.name} → ${lang}${PARTIAL}`, lang);
        try {
          await serverTranslate({
            cues: $state.snapshot(source.cues), from: source.lang, to: lang, signal,
            onQueued: (ahead) => { job.phase = 'queued'; job.ahead = ahead; },
            onCues: (cues, done, total) => {
              if (app.vid !== vid) return;
              app.appendCues(track.id, cues);
              job.phase = 'translate'; job.done = done; job.total = total;
            },
          });
          if (app.vid !== vid) return;
          app.renameTrack(track.id, `${source.name} → ${lang}${FINISHED}`);
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
