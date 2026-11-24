import { app } from './state.svelte';
import { router, watchUrl, readUrl } from './router.svelte';
import { player } from './player/controller.svelte';
import { speech } from './read/speech.svelte';
import { SAMPLES } from './read/samples';
import type { MessageKey } from './i18n/tr';

/** A video with subtitles (and cached translations) the tour can show when the user has none open. */
export const DEMO_VIDEO = 'QhAzVr2RuJo';
const OFFERED_KEY = 'balonca.tourOffered';

/** One tour per way of learning, at most 4 steps each (plan: "tur her mod için en fazla 4 adım"). */
export type TourMode = 'video' | 'text';

export interface TourStep {
  /** Page the step lives on; the tour goes there first. `reader`: a text open in the reader. */
  route?: 'home' | 'watch' | 'words' | 'help' | 'read' | 'reader';
  /** Elements to point at, first visible one wins (phone and desktop layouts differ). None: a centred card. */
  target?: string[];
  title: MessageKey;
  text: MessageKey;
  /** Skip the step if its element does not show up (e.g. no language question because a translation exists). */
  optional?: boolean;
  /** Something to do before looking for the target, e.g. switch the player tab. */
  prepare?: () => void;
}

const clickTab = (id: string) => () => document.querySelector<HTMLButtonElement>(`#tab-${id}`)?.click();

const WORDS_NAV = ['nav.bottom a[href="#/words"]', 'header nav a[href="#/words"]'];

export const TOURS: Record<TourMode, TourStep[]> = {
  video: [
    { route: 'home', target: ['#home-url'], title: 'tour.link.t', text: 'tour.link.d' },
    { route: 'watch', target: ['.stage'], title: 'tour.video.t', text: 'tour.video.d' },
    { route: 'watch', target: ['.transcript button.w', '.overlay button.w', '.side [role="tabpanel"]'], title: 'tour.word.t', text: 'tour.word.d', optional: true, prepare: clickTab('transcript') },
    { target: WORDS_NAV, title: 'tour.words.t', text: 'tour.words.d' },
  ],
  text: [
    { route: 'read', target: ['#read-body'], title: 'tour.text.add.t', text: 'tour.text.add.d' },
    { route: 'reader', target: ['.reader .bar[role="group"]'], title: 'tour.text.listen.t', text: 'tour.text.listen.d' },
    { route: 'reader', target: ['.reader .text button.w'], title: 'tour.text.word.t', text: 'tour.text.word.d', optional: true },
    { route: 'reader', target: ['.reader .text button.sb'], title: 'tour.text.sentence.t', text: 'tour.text.sentence.d', optional: true },
  ],
};
/** The video tour (kept for anything that imports the old name). */
export const STEPS = TOURS.video;

// The video tour keeps its old key, so people who were already asked are not asked again.
const key = (m: TourMode) => (m === 'video' ? OFFERED_KEY : `${OFFERED_KEY}.${m}`);
const storage = {
  get: (m: TourMode) => { try { return localStorage.getItem(key(m)) === '1'; } catch { return true; } }, // no storage: never nag
  set: (m: TourMode) => { try { localStorage.setItem(key(m), '1'); } catch {} },
};

class Tour {
  active = $state(false);
  index = $state(0);
  mode = $state<TourMode>('video');
  /** The one-time "want a quick tour?" card the first time a mode is opened (null: none showing). */
  offer = $state<TourMode | null>(null);

  get steps(): TourStep[] { return TOURS[this.mode]; }
  get step(): TourStep { return this.steps[this.index]; }
  get count() { return this.steps.length; }

  /** Offers the tour of a mode to someone who has never been asked about it. */
  maybeOffer(mode: TourMode = 'video') {
    if (!this.active && !this.offer && !storage.get(mode)) this.offer = mode;
  }
  dismissOffer() { if (this.offer) storage.set(this.offer); this.offer = null; }

  start(mode: TourMode = 'video') {
    this.dismissOffer();
    storage.set(mode);
    this.mode = mode;
    this.index = 0;
    this.active = true;
    this.go();
  }
  next() { if (this.index < this.count - 1) { this.index++; this.go(); } else this.end(); }
  back() { if (this.index > 0) { this.index--; this.go(1); } }
  end() { this.active = false; }

  /** Skips an optional step whose element never appeared, in the direction the user was going. */
  skip(dir: 1 | -1) {
    const i = this.index + dir;
    if (i < 0 || i >= this.count) { this.end(); return; }
    this.index = i;
    this.go(dir === 1 ? 0 : 1);
  }

  /**
   * Opens the page the step needs. On the player: the user's own video if it has subtitles, otherwise the demo.
   * In the reader: the text that is open, else the last one read, else the sample text (as its ✨ button would add it).
   */
  private go(_dir = 0) {
    const r = this.step.route;
    if (r === 'home' && router.route !== 'home') location.hash = '#/';
    else if (r === 'read' && (router.route !== 'read' || router.params.get('id'))) location.hash = readUrl();
    else if (r === 'reader') {
      const open = router.route === 'read' && router.params.get('id');
      if (!open || !app.textById.get(open)) {
        const s = SAMPLES.nl;
        const doc = app.texts[0] ?? app.addText({ title: s.title, lang: 'nl', body: s.body });
        location.hash = readUrl(doc.id);
      }
      speech.pause();
    }
    else if (r === 'words' && router.route !== 'words') location.hash = '#/words';
    else if (r === 'help' && router.route !== 'help') location.hash = '#/help';
    else if (r === 'watch' && router.route !== 'watch') {
      location.hash = app.vid && app.tracks.length ? '#/watch' : watchUrl(DEMO_VIDEO);
    }
    if (r === 'watch') player.pause();
  }
}

export const tour = new Tour();
