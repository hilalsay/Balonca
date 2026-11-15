import { app } from './state.svelte';
import { router, watchUrl } from './router.svelte';
import { player } from './player/controller.svelte';
import type { MessageKey } from './i18n/tr';

/** A video with subtitles (and cached translations) the tour can show when the user has none open. */
export const DEMO_VIDEO = 'QhAzVr2RuJo';
const OFFERED_KEY = 'balonca.tourOffered';

export interface TourStep {
  /** Page the step lives on; the tour goes there first. */
  route?: 'home' | 'watch' | 'words' | 'help';
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

export const STEPS: TourStep[] = [
  { title: 'tour.welcome.t', text: 'tour.welcome.d' },
  { route: 'home', target: ['#home-url'], title: 'tour.link.t', text: 'tour.link.d' },
  { route: 'watch', target: ['.stage'], title: 'tour.video.t', text: 'tour.video.d' },
  { route: 'watch', target: ['.auto .ask'], title: 'tour.lang.t', text: 'tour.lang.d', optional: true },
  { route: 'watch', target: ['.transcript button.w', '.overlay button.w', '.side [role="tabpanel"]'], title: 'tour.word.t', text: 'tour.word.d', optional: true, prepare: clickTab('transcript') },
  { route: 'watch', target: ['.kb'], title: 'tour.known.t', text: 'tour.known.d', optional: true, prepare: clickTab('transcript') },
  { route: 'watch', target: ['.controls .buttons'], title: 'tour.controls.t', text: 'tour.controls.d' },
  { route: 'watch', target: ['.side .tabs'], title: 'tour.tabs.t', text: 'tour.tabs.d' },
  { target: ['nav.bottom a[href="#/words"]', 'header nav a[href="#/words"]'], title: 'tour.words.t', text: 'tour.words.d' },
  { target: ['nav.bottom a[href="#/help"]', 'header nav a[href="#/help"]'], title: 'tour.end.t', text: 'tour.end.d' },
];

const storage = {
  get: () => { try { return localStorage.getItem(OFFERED_KEY) === '1'; } catch { return true; } }, // no storage: never nag
  set: () => { try { localStorage.setItem(OFFERED_KEY, '1'); } catch {} },
};

class Tour {
  active = $state(false);
  index = $state(0);
  /** The one-time "want a quick tour?" card on the first visit. */
  offer = $state(false);

  get step(): TourStep { return STEPS[this.index]; }
  get count() { return STEPS.length; }

  /** Called once the app has loaded: offer the tour to someone who has never been asked. */
  maybeOffer() {
    if (!storage.get()) this.offer = true;
  }
  dismissOffer() { this.offer = false; storage.set(); }

  start() {
    this.dismissOffer();
    this.index = 0;
    this.active = true;
    this.go();
  }
  next() { if (this.index < STEPS.length - 1) { this.index++; this.go(); } else this.end(); }
  back() { if (this.index > 0) { this.index--; this.go(1); } }
  end() { this.active = false; }

  /** Skips an optional step whose element never appeared, in the direction the user was going. */
  skip(dir: 1 | -1) {
    const i = this.index + dir;
    if (i < 0 || i >= STEPS.length) { this.end(); return; }
    this.index = i;
    this.go(dir === 1 ? 0 : 1);
  }

  /** Opens the page the step needs. On the player: the user's own video if it has subtitles, otherwise the demo. */
  private go(_dir = 0) {
    const r = this.step.route;
    if (r === 'home' && router.route !== 'home') location.hash = '#/';
    else if (r === 'words' && router.route !== 'words') location.hash = '#/words';
    else if (r === 'help' && router.route !== 'help') location.hash = '#/help';
    else if (r === 'watch' && router.route !== 'watch') {
      location.hash = app.vid && app.tracks.length ? '#/watch' : watchUrl(DEMO_VIDEO);
    }
    if (r === 'watch') player.pause();
  }
}

export const tour = new Tour();
