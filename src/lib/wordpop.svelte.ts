import { player } from './player/controller.svelte';
import { app } from './state.svelte';

export interface PopWord {
  lang: string;
  key: string; // normalized word (what is saved)
  surface: string; // as written in the subtitle
  ctx: string; // the subtitle line
  trans: { lang: string; text: string }[]; // the same moment in the other visible tracks
  t: number; // seconds into the video
  rect: { left: number; top: number; right: number; bottom: number; width: number };
  anchor: HTMLElement | null; // focus returns here on close
}

/** The word card that opens when a word in the subtitles or transcript is tapped. One at a time. */
class WordPop {
  cur = $state<PopWord | null>(null);
  /** True while the player is in real (browser) fullscreen: the card must then render inside the player. */
  fullscreen = $state(false);
  private resume = false;

  open(w: PopWord) {
    // Pause so the learner can read; play on again on close, but only if we were the ones who paused.
    if (!this.cur && player.playing && app.settings.pauseOnSave) { player.pause(); this.resume = true; }
    this.cur = w;
  }

  close(opts: { keepPaused?: boolean } = {}) {
    if (!this.cur) return;
    const anchor = this.cur.anchor;
    this.cur = null;
    if (this.resume && !opts.keepPaused) player.play();
    this.resume = false;
    anchor?.focus?.({ preventScroll: true });
  }
}

export const wordPop = new WordPop();
