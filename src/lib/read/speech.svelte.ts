/**
 * Reading aloud, one sentence at a time, with two voices:
 *  - Balonca's own (Piper on the server): the same good voice on every device; words are followed by estimate.
 *  - the device's (Web Speech): works offline; some devices report each word as it is spoken.
 * The reader page loads a text's sentences; the word card and the review use `say` for a single word or sentence.
 */
import { app } from '../state.svelte';
import { nlpInfo, ttsUrl, type SpeechSource } from './api';

export interface Line { i: number; text: string }
export type Engine = 'server' | 'device';
export type SpeechProblem = 'no-voice' | 'failed' | 'blocked';

/** Character range of the word heard at `progress` (0-1) of a sentence, estimated from word lengths and pauses. */
export function wordAt(text: string, progress: number): { from: number; to: number } | null {
  const parts = [...text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)];
  if (!parts.length) return null;
  const weights = parts.map((m, k) => {
    const next = parts[k + 1]?.index ?? text.length;
    const gap = text.slice(m.index! + m[0].length, next);
    return m[0].length + 1.5 + (/[.!?…]/.test(gap) ? 6 : /[,;:—–]/.test(gap) ? 3 : 0);
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  const target = Math.min(Math.max(progress, 0), 0.9999) * total;
  for (let k = 0; k < parts.length; k++) {
    acc += weights[k];
    if (target < acc) return { from: parts[k].index!, to: parts[k].index! + parts[k][0].length };
  }
  const last = parts[parts.length - 1];
  return { from: last.index!, to: last.index! + last[0].length };
}

const synth = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;

/** How good a device voice sounds, roughly: network and "natural" voices are far better than the old ones. */
function voiceScore(v: SpeechSynthesisVoice, lang: string): number {
  const tag = v.lang.replace('_', '-').toLowerCase();
  if (!tag.startsWith(lang)) return -1;
  let s = 1;
  if (/google|natural|neural|premium|enhanced|siri/i.test(v.name)) s += 3;
  if (tag === `${lang}-${lang}` || (lang === 'en' && tag === 'en-us')) s += 1; // nl-NL, de-DE, fr-FR…
  if (v.default) s += 0.5;
  return s;
}

class Speech {
  playing = $state(false);
  loading = $state(false);
  /** Sentence being read (or last read) in the loaded text. */
  index = $state(-1);
  /** The word being heard, as a character range in that sentence. */
  word = $state<{ from: number; to: number } | null>(null);
  problem = $state<SpeechProblem | null>(null);
  engine = $state<Engine | null>(null);
  /** The device's voices (they load late on some browsers). */
  voices = $state<SpeechSynthesisVoice[]>([]);
  serverLangs = $state<string[]>([]);

  /** Languages whose server voice failed in this visit (refused, limit reached, switched off): the device reads them. */
  private serverDown = new Set<string>();
  private lines: Line[] = [];
  private lang = '';
  /** The library text being read (the server reads its sentences only from there). */
  private libId = '';
  private run = 0;
  private audio: HTMLAudioElement | null = null;
  private raf = 0;
  private onLine: ((i: number) => void) | null = null;
  private onEnd: (() => void) | null = null;

  constructor() {
    if (synth) {
      const load = () => { this.voices = synth.getVoices(); };
      load();
      synth.addEventListener?.('voiceschanged', load);
    }
    void nlpInfo().then((i) => (this.serverLangs = i.tts));
  }

  deviceVoices(lang: string): SpeechSynthesisVoice[] {
    return this.voices.filter((v) => voiceScore(v, lang) >= 0).sort((a, b) => voiceScore(b, lang) - voiceScore(a, lang));
  }
  deviceVoice(lang: string): SpeechSynthesisVoice | null {
    const mine = app.settings.readVoices[lang];
    const list = this.deviceVoices(lang);
    return list.find((v) => v.voiceURI === mine) ?? list[0] ?? null;
  }
  /** Which voice will read `lang`, given the setting and what is available; null when none can. */
  engineFor(lang: string): Engine | null {
    const server = this.serverLangs.includes(lang) && !this.serverDown.has(lang), device = !!this.deviceVoice(lang);
    const want = app.settings.readEngine;
    if (want === 'device') return device ? 'device' : server ? 'server' : null;
    return server ? 'server' : device ? 'device' : null;
  }
  canRead(lang: string) { return this.engineFor(lang) !== null; }

  /** Gives the reader a text. `onLine` hears about every sentence that starts. */
  load(lang: string, lines: Line[], hooks: { onLine?: (i: number) => void; onEnd?: () => void } = {}, libId = '') {
    this.libId = libId;
    this.stop();
    this.lang = lang;
    this.lines = lines;
    this.onLine = hooks.onLine ?? null;
    this.onEnd = hooks.onEnd ?? null;
    this.index = -1;
    this.problem = null;
  }
  /** The reader page closed. */
  unload() { this.stop(); this.lines = []; this.onLine = this.onEnd = null; }

  /** Reads on from sentence `from` (default: where it is). */
  play(from = this.index < 0 ? 0 : this.index) {
    if (!this.lines.length) return;
    this.index = Math.max(0, Math.min(from, this.lines.length - 1));
    this.playing = true;
    void this.speakCurrent();
  }
  pause() {
    this.run++;
    this.playing = false;
    this.loading = false;
    this.word = null;
    this.audio?.pause();
    synth?.cancel();
    cancelAnimationFrame(this.raf);
  }
  stop() { this.pause(); }
  toggle() { if (this.playing) this.pause(); else this.play(); }
  /** Moves one sentence on or back; keeps reading if it was. */
  step(d: number) {
    const to = Math.max(0, Math.min((this.index < 0 ? 0 : this.index) + d, this.lines.length - 1));
    if (this.playing) this.play(to);
    else { this.index = to; this.onLine?.(to); }
  }
  /** Jumps to a sentence and reads just there on (used when a sentence is tapped while reading). */
  jump(i: number) { if (this.playing) this.play(i); else this.index = i; }

  /**
   * Reads one word or sentence once, outside the text (word card, review). `slow` reads it at 70 %. `src` says
   * where it comes from for Balonca's voice (default: `text` is one word).
   */
  async say(lang: string, text: string, opts: { slow?: boolean; src?: SpeechSource } = {}) {
    this.pause();
    const engine = this.engineFor(lang);
    if (!engine) { this.problem = 'no-voice'; return; }
    const run = ++this.run;
    await this.speak(engine, lang, text, run, { rate: app.settings.readRate * (opts.slow ? 0.7 : 1), track: false, src: opts.src ?? { word: text } });
  }

  private async speakCurrent() {
    const run = ++this.run;
    const line = this.lines[this.index];
    if (!line) { this.playing = false; return; }
    const engine = this.engineFor(this.lang);
    this.engine = engine;
    if (!engine) { this.problem = 'no-voice'; this.playing = false; return; }
    this.problem = null;
    this.onLine?.(line.i);
    const ok = await this.speak(engine, this.lang, line.text, run, { rate: app.settings.readRate, track: true });
    if (run !== this.run) return; // paused, moved or replaced meanwhile
    if (!ok) { this.playing = false; return; }
    if (app.settings.readLoop) { void this.speakCurrent(); return; }
    if (this.index + 1 < this.lines.length) { this.index++; void this.speakCurrent(); }
    else { this.playing = false; this.word = null; this.onEnd?.(); }
  }

  /** Speaks `text`; resolves true when it was heard to the end, false on a problem or when interrupted. */
  private speak(engine: Engine, lang: string, text: string, run: number, o: { rate: number; track: boolean; src?: SpeechSource }): Promise<boolean> {
    this.word = null;
    return engine === 'server' ? this.speakServer(lang, text, run, o) : this.speakDevice(lang, text, run, o);
  }

  private speakServer(lang: string, text: string, run: number, o: { rate: number; track: boolean; src?: SpeechSource }): Promise<boolean> {
    const a = (this.audio ??= new Audio());
    a.preload = 'auto';
    a.src = ttsUrl(lang, o.src ?? { lib: this.libId, text });
    a.playbackRate = o.rate;
    this.loading = true;
    // Warm the next sentence while this one plays.
    const next = o.track ? this.lines[this.index + 1] : null;
    if (next) void fetch(ttsUrl(lang, { lib: this.libId, text: next.text })).catch(() => {});
    return new Promise((resolve) => {
      const done = (ok: boolean) => {
        a.onended = a.onerror = a.onplaying = null;
        cancelAnimationFrame(this.raf);
        if (run === this.run) { this.word = null; this.loading = false; }
        resolve(ok);
      };
      a.onplaying = () => {
        if (run !== this.run) return;
        this.loading = false;
        if (!o.track) return;
        const tick = () => {
          if (run !== this.run || a.paused) return;
          if (a.duration > 0) {
            const w = wordAt(text, a.currentTime / a.duration);
            if (w?.from !== this.word?.from) this.word = w;
          }
          this.raf = requestAnimationFrame(tick);
        };
        tick();
      };
      a.onended = () => done(run === this.run);
      a.onerror = () => {
        // Refused or switched off (403/429/404): quietly carry on with the device's voice if it has one.
        if (run === this.run && this.deviceVoice(lang)) {
          this.serverDown.add(lang);
          a.onended = a.onerror = a.onplaying = null;
          this.loading = false;
          void this.speakDevice(lang, text, run, o).then(resolve);
          return;
        }
        if (run === this.run) this.problem = 'failed';
        done(false);
      };
      a.play().catch((e: DOMException) => {
        if (run !== this.run) return done(false);
        this.problem = e?.name === 'NotAllowedError' ? 'blocked' : 'failed';
        done(false);
      });
    });
  }

  private speakDevice(lang: string, text: string, run: number, o: { rate: number; track: boolean }): Promise<boolean> {
    if (!synth) { this.problem = 'no-voice'; return Promise.resolve(false); }
    const voice = this.deviceVoice(lang);
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = lang;
    u.rate = o.rate;
    return new Promise((resolve) => {
      let settled = false;
      const done = (ok: boolean) => { if (settled) return; settled = true; if (run === this.run) this.word = null; resolve(ok); };
      u.onboundary = (e) => {
        if (run !== this.run || !o.track || e.name !== 'word') return;
        const len = e.charLength || (/^[\p{L}\p{N}'’-]+/u.exec(text.slice(e.charIndex))?.[0].length ?? 1);
        this.word = { from: e.charIndex, to: e.charIndex + len };
      };
      u.onend = () => done(run === this.run);
      u.onerror = (e) => {
        if (run === this.run && e.error !== 'interrupted' && e.error !== 'canceled') this.problem = e.error === 'not-allowed' ? 'blocked' : 'failed';
        done(false);
      };
      synth.speak(u);
    });
  }
}

export const speech = new Speech();
