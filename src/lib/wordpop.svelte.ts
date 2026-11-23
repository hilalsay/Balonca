import { player } from './player/controller.svelte';
import { app } from './state.svelte';
import { speech } from './read/speech.svelte';

export interface PopWord {
  lang: string;
  key: string; // normalized word (what is saved)
  surface: string; // as written in the subtitle
  ctx: string; // the subtitle line
  trans: { lang: string; text: string }[]; // the same moment in the other visible tracks
  t: number; // seconds into the video, or the sentence number in a text
  doc?: string; // the text (reading mode) the word is in
  explain?: () => void; // reading mode: opens the sentence's translation and grammar
  rect: { left: number; top: number; right: number; bottom: number; width: number };
  anchor: HTMLElement | null; // focus returns here on close
}

/** The word card that opens when a word in the subtitles or transcript is tapped. One at a time. */
class WordPop {
  cur = $state<PopWord | null>(null);
  /** True while the player is in real (browser) fullscreen: the card must then render inside the player. */
  fullscreen = $state(false);
  private resume = false;
  private resumeSpeech = false;

  open(w: PopWord) {
    // Pause so the learner can read; play on again on close, but only if we were the ones who paused.
    if (!this.cur && !w.doc && player.playing && app.settings.pauseOnSave) { player.pause(); this.resume = true; }
    if (!this.cur && w.doc && speech.playing && app.settings.pauseOnSave) { speech.pause(); this.resumeSpeech = true; }
    this.cur = w;
  }

  close(opts: { keepPaused?: boolean } = {}) {
    if (!this.cur) return;
    const anchor = this.cur.anchor;
    this.cur = null;
    if (this.resume && !opts.keepPaused) player.play();
    if (this.resumeSpeech && !opts.keepPaused) speech.play();
    this.resume = this.resumeSpeech = false;
    anchor?.focus?.({ preventScroll: true });
  }
}

export const wordPop = new WordPop();
