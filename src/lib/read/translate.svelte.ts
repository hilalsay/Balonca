/**
 * Translations of a text, by Balonca's server: one sentence (sentence panel) or all of them (translation under
 * every sentence). The server reads the text from the account (phase 2: no text is sent from here), so the text
 * is synced first when the server does not have it yet. With the pivot on, Turkish is made from English on the
 * server, and the English is kept too and shown alongside.
 */
import { app } from '../state.svelte';
import { sync } from '../sync.svelte';
import type { TextDoc } from '../types';
import { serverTranslate, serverConfig } from '../translate/server.svelte';
import { TranslateError } from '../translate/runner';
import { translateSentence, SentenceError } from '../words/sentence';

export const PIVOT = 'en';
/** Languages translated via English. */
export const viaEnglish = (from: string, to: string) => serverConfig.pivot === 'en' && to === 'tr' && from !== PIVOT;

const flush = () => sync.flush();
/** Sentences compare equal however they are spaced (the server compares the same way). */
export const same = (a: string, b: string) => a.normalize('NFC').replace(/[\u200b-\u200d\u2060\ufeff]/g, '').replace(/\s+/g, ' ').trim()
  === b.normalize('NFC').replace(/[\u200b-\u200d\u2060\ufeff]/g, '').replace(/\s+/g, ' ').trim();

/** One sentence of a text in `to` (stored with the text). Returns it, plus the English made on the way. */
export async function translateOne(doc: TextDoc, i: number, text: string, to: string, signal?: AbortSignal): Promise<{ text: string; en?: string }> {
  const have = doc.trans?.[to]?.[i];
  if (have) return { text: have, en: doc.trans?.[PIVOT]?.[i] ?? undefined };
  const out = await translateSentence({ source: { libraryId: doc.id, text }, to, signal, flush });
  if (out.en && to !== PIVOT) app.setTextTrans(doc.id, PIVOT, i, out.en);
  app.setTextTrans(doc.id, to, i, out.text);
  return out;
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
    const job: TextJob = { id: doc.id, lang: to, done: 0, total: sents.length, queued: 0, step: viaEnglish(doc.lang, to) ? 'pivot' : 'final' };
    this.job = job;
    try {
      try { await this.all(doc, sents, to, ctl.signal); }
      catch (e) {
        // A text added a moment ago may not be on the account yet: sync, then once more.
        if (!(e instanceof TranslateError && e.code === 'unavailable')) throw e;
        await flush();
        await this.all(doc, sents, to, ctl.signal);
      }
      if (this.ctl === ctl) this.job = null;
    } catch (e) {
      if (ctl.signal.aborted || (e instanceof TranslateError && e.code === 'cancelled')) return;
      if (this.job) this.job.error = e instanceof TranslateError ? e.code : 'network';
    } finally {
      if (this.ctl === ctl) this.ctl = null;
    }
  }

  /** The server translates the whole text it has; each answer names its sentence (number and text). */
  private async all(doc: TextDoc, sents: string[], to: string, signal: AbortSignal) {
    // The server numbers sentences as this device does; should the two ever differ, the text decides.
    const byText = new Map<string, number>();
    sents.forEach((s, i) => { const k = s.replace(/\s+/g, ' ').trim(); if (!byText.has(k)) byText.set(k, i); });
    await serverTranslate({
      source: { libraryId: doc.id }, to, signal,
      onQueued: (ahead) => { if (this.job) this.job.queued = ahead; },
      onPivot: (done, total) => { if (this.job) { this.job.queued = 0; this.job.step = 'pivot'; this.job.done = done; this.job.total = total; } },
      onCues: (cues, done, total) => {
        for (const c of cues) {
          const i = typeof c.i === 'number' && sents[c.i] !== undefined && same(sents[c.i], c.src ?? '') ? c.i : byText.get((c.src ?? '').replace(/\s+/g, ' ').trim());
          if (i !== undefined && c.text) app.setTextTrans(doc.id, to, i, c.text);
        }
        if (this.job) { this.job.queued = 0; this.job.step = 'final'; this.job.done = done; this.job.total = total; }
      },
    });
  }
}

export const textTranslator = new TextTranslator();
export { SentenceError };
