/**
 * Translations of a text, by Balonca's server (local model): one sentence (sentence panel) or all of them
 * (translation under every sentence). Turkish is made from the English translation, which the local model
 * writes much better than e.g. Dutch -> Turkish; the English one is kept too and shown alongside.
 */
import { app } from '../state.svelte';
import type { Cue, TextDoc } from '../types';
import { serverTranslate, serverConfig } from '../translate/server.svelte';
import { TranslateError } from '../translate/runner';
import { translateSentence, SentenceError } from '../words/sentence';

export const PIVOT = 'en';
/** Languages translated via English. */
export const viaEnglish = (from: string, to: string) => serverConfig.pivot === 'en' && to === 'tr' && from !== PIVOT;

/** Every sentence gets its own time slot, far apart, so the server keeps them as separate units. */
const SLOT = 10;
export const toCues = (sents: string[]): Cue[] => sents.map((text, i) => ({ start: i * SLOT, end: i * SLOT + 5, text }));
export const slotOf = (c: Cue) => Math.floor(c.start / SLOT + 1e-6);

/** One sentence of a text in `to` (stored with the text). Returns it, plus the English made on the way. */
export async function translateOne(doc: TextDoc, i: number, text: string, to: string, signal?: AbortSignal): Promise<{ text: string; en?: string }> {
  const have = doc.trans?.[to]?.[i];
  if (have) return { text: have, en: doc.trans?.[PIVOT]?.[i] ?? undefined };
  if (viaEnglish(doc.lang, to)) {
    let en = doc.trans?.[PIVOT]?.[i] ?? null;
    if (!en) {
      en = await translateSentence({ text, from: doc.lang, to: PIVOT, signal });
      app.setTextTrans(doc.id, PIVOT, i, en);
    }
    const out = await translateSentence({ text: en, from: PIVOT, to, signal });
    app.setTextTrans(doc.id, to, i, out);
    return { text: out, en };
  }
  const out = await translateSentence({ text, from: doc.lang, to, signal });
  app.setTextTrans(doc.id, to, i, out);
  return { text: out };
}

export interface TextJob { id: string; lang: string; done: number; total: number; queued: number; step: 'pivot' | 'final'; error?: string }

/** Translates all sentences of a text that have no translation yet; one job at a time. */
class TextTranslator {
  job = $state<TextJob | null>(null);
  private ctl: AbortController | null = null;

  cancel() { this.ctl?.abort(); this.ctl = null; if (this.job && !this.job.error) this.job = null; }

  missing(doc: TextDoc, lang: string, n: number) {
    const list = doc.trans?.[lang] ?? [];
    let k = 0;
    for (let i = 0; i < n; i++) if (!list[i]) k++;
    return k;
  }

  async run(doc: TextDoc, sents: string[], to: string) {
    if (this.job?.id === doc.id && this.job.lang === to && !this.job.error) return; // already on it
    this.cancel();
    if (!this.missing(doc, to, sents.length)) return;
    const ctl = (this.ctl = new AbortController());
    const job: TextJob = { id: doc.id, lang: to, done: 0, total: sents.length, queued: 0, step: 'final' };
    this.job = job;
    try {
      let from = doc.lang, src = sents;
      if (viaEnglish(doc.lang, to)) {
        if (this.missing(doc, PIVOT, sents.length)) { this.job.step = 'pivot'; await this.all(doc, sents, doc.lang, PIVOT, ctl.signal); }
        const en = doc.trans?.[PIVOT] ?? [];
        if (sents.every((_, i) => en[i])) { from = PIVOT; src = sents.map((_, i) => en[i]!); }
        if (this.job) { this.job.step = 'final'; this.job.done = 0; }
      }
      await this.all(doc, src, from, to, ctl.signal);
      if (this.ctl === ctl) this.job = null;
    } catch (e) {
      if (ctl.signal.aborted || (e instanceof TranslateError && e.code === 'cancelled')) return;
      if (this.job) this.job.error = e instanceof TranslateError ? e.code : 'network';
    } finally {
      if (this.ctl === ctl) this.ctl = null;
    }
  }

  /** Sends only what is missing; the server streams sentences back in order. */
  private async all(doc: TextDoc, src: string[], from: string, to: string, signal: AbortSignal) {
    const have = doc.trans?.[to] ?? [];
    const todo = src.map((text, i) => ({ text, i })).filter((x) => !have[x.i] && x.text.trim());
    if (!todo.length) return;
    const acc = new Map<number, string>();
    await serverTranslate({
      cues: todo.map((x) => ({ start: x.i * SLOT, end: x.i * SLOT + 5, text: x.text })), from, to, signal,
      onQueued: (ahead) => { if (this.job) this.job.queued = ahead; },
      onCues: (cues, done) => {
        for (const c of cues) {
          const i = slotOf(c);
          acc.set(i, acc.has(i) ? `${acc.get(i)} ${c.text}` : c.text);
          app.setTextTrans(doc.id, to, i, acc.get(i)!);
        }
        if (this.job) { this.job.queued = 0; this.job.done = done; this.job.total = todo.length; }
      },
    });
  }
}

export const textTranslator = new TextTranslator();
export { SentenceError };
