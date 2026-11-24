<script lang="ts">
  import { tick } from 'svelte';
  import Mascot from './Mascot.svelte';
  import { tour } from '../lib/tour.svelte';
  import { autoSubs } from '../lib/auto.svelte';
  import { t } from '../lib/i18n/index.svelte';

  type Box = { left: number; top: number; width: number; height: number };
  let box = $state<Box | null>(null); // spotlight around the current target; null = centred card
  let waiting = $state(false);
  let cardH = $state(180);
  let vw = $state(typeof innerWidth === 'number' ? innerWidth : 400);
  let vh = $state(typeof innerHeight === 'number' ? innerHeight : 800);
  let card: HTMLDivElement | undefined = $state();
  let dir: 1 | -1 = 1;

  const visible = (el: Element | null): el is HTMLElement => {
    if (!(el instanceof HTMLElement)) return false;
    const r = el.getBoundingClientRect();
    // offsetParent is null for hidden elements, but also for fixed ones (the reader's player bar on a phone)
    return r.width > 0 && r.height > 0 && (el.offsetParent !== null || getComputedStyle(el).position === 'fixed');
  };
  /** First visible match; inside a scrolling panel, one that is fully in view. */
  const find = (sels: string[]) => {
    for (const strict of [true, false]) {
      for (const s of sels) for (const el of document.querySelectorAll(s)) {
        if (!visible(el)) continue;
        const clip = el.closest('[role="tabpanel"]')?.getBoundingClientRect(), r = el.getBoundingClientRect();
        if (!clip || !strict || (r.top >= clip.top && r.bottom <= clip.bottom)) return el as HTMLElement;
      }
    }
    return null;
  };

  // For every step: go to its page (done by the store), then wait for its element and point at it.
  $effect(() => {
    if (!tour.active) { box = null; return; }
    const i = tour.index, step = tour.step;
    let alive = true, raf = 0;
    waiting = !!step.target;
    box = null;
    const started = Date.now();
    const limit = step.optional ? 9000 : 12000;
    const poll = () => {
      if (!alive) return;
      step.prepare?.();
      const el = step.target ? find(step.target) : null;
      if (el) {
        waiting = false;
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        const follow = () => {
          if (!alive) return;
          const r = el.getBoundingClientRect();
          // Inside a scrolling panel only the visible part counts (a half-hidden transcript line, say).
          const clip = el.closest('[role="tabpanel"]')?.getBoundingClientRect();
          const top = clip ? Math.max(r.top, clip.top) : r.top, bottom = clip ? Math.min(r.bottom, clip.bottom) : r.bottom;
          const pad = 6;
          box = { left: r.left - pad, top: top - pad, width: r.width + pad * 2, height: Math.max(0, bottom - top) + pad * 2 };
          vw = innerWidth; vh = innerHeight;
          raf = requestAnimationFrame(follow); // keeps up with scrolling, resizing and layout changes
        };
        follow();
      } else if (!step.target) {
        waiting = false;
      } else if (Date.now() - started > limit && !(step.route === 'watch' && autoSubs.running && Date.now() - started < 45000)) {
        // (while the video's subtitles are still on their way, keep waiting: the next steps need them)
        waiting = false;
        if (step.optional) tour.skip(dir); // e.g. no language question because a translation already exists
      } else setTimeout(poll, 150);
    };
    void tick().then(() => setTimeout(poll, 60));
    void tick().then(() => card?.querySelector<HTMLElement>('.next')?.focus({ preventScroll: true }));
    return () => { alive = false; cancelAnimationFrame(raf); void i; };
  });

  // The card sits under the target when it fits, else above it, else at the bottom of the screen.
  const W = $derived(Math.min(360, vw - 24));
  const pos = $derived.by(() => {
    if (!box) return `left:${(vw - W) / 2}px;top:${Math.max(12, (vh - cardH) / 2)}px;`;
    const left = Math.min(Math.max(12, box.left + box.width / 2 - W / 2), vw - W - 12);
    if (vh - (box.top + box.height) >= cardH + 24) return `left:${left}px;top:${box.top + box.height + 12}px;`;
    if (box.top >= cardH + 24) return `left:${left}px;top:${box.top - cardH - 12}px;`;
    return `left:${left}px;bottom:12px;`;
  });

  function next() { dir = 1; tour.next(); }
  function back() { dir = -1; tour.back(); }
  function onkey(e: KeyboardEvent) {
    if (!tour.active) return;
    if (e.key === 'Escape') { e.preventDefault(); tour.end(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); back(); }
    e.stopPropagation(); // the player's own shortcuts stay quiet during the tour
  }
</script>

<svelte:window onkeydowncapture={onkey} onresize={() => { vw = innerWidth; vh = innerHeight; }} />

{#if tour.active}
  <!-- Blocks the page during the tour: only the card is interactive. -->
  <div class="shade" class:dim={!box} aria-hidden="true"></div>
  {#if box}<div class="spot" style:left="{box.left}px" style:top="{box.top}px" style:width="{box.width}px" style:height="{box.height}px"></div>{/if}

  <div class="card" bind:this={card} bind:clientHeight={cardH} style="{pos}width:{W}px;" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-text">
    <div class="top">
      <span class="count">{tour.index + 1} / {tour.count}</span>
      <button class="skip" onclick={() => tour.end()}>{t('tour.skip')}</button>
    </div>
    {#if tour.index === 0}<div class="mascot"><Mascot size={56} float /></div>{/if}
    <h2 id="tour-title">{t(tour.step.title)}</h2>
    <p id="tour-text">{waiting ? (autoSubs.running ? t('auto.source.fetch') : t('tour.loading')) : t(tour.step.text)}</p>
    <div class="dots" aria-hidden="true">{#each { length: tour.count } as _, k}<i class:on={k === tour.index}></i>{/each}</div>
    <div class="actions">
      {#if tour.index > 0}<button onclick={back}>{t('tour.back')}</button>{/if}
      <button class="primary next" onclick={next}>{tour.index === tour.count - 1 ? t('tour.done') : tour.index === 0 ? t('tour.go') : t('tour.next')}</button>
    </div>
  </div>
{:else if tour.offer}
  <div class="offer" role="dialog" aria-labelledby="offer-title">
    <Mascot size={44} />
    <div class="offer-text">
      <strong id="offer-title">{t('tour.offer.t')}</strong>
      <span class="muted">{t('tour.offer.d')}</span>
    </div>
    <div class="offer-actions">
      <button class="primary" onclick={() => tour.start(tour.offer ?? 'video')}>{t('tour.offer.yes')}</button>
      <button onclick={() => tour.dismissOffer()}>{t('tour.offer.no')}</button>
    </div>
  </div>
{/if}

<style>
  .shade { position: fixed; inset: 0; z-index: 400; }
  .shade.dim { background: rgb(15 10 35 / 0.6); }
  .spot { position: fixed; z-index: 401; border-radius: 14px; pointer-events: none;
    box-shadow: 0 0 0 9999px rgb(15 10 35 / 0.6), 0 0 0 3px var(--accent);
    transition: left 0.25s ease, top 0.25s ease, width 0.25s ease, height 0.25s ease; }
  .card { position: fixed; z-index: 402; display: grid; gap: var(--space-2); padding: var(--space-4);
    background: var(--surface); color: var(--text); border-radius: 18px; box-shadow: 0 18px 50px rgb(10 5 30 / 0.35);
    animation: pop 0.2s ease-out; }
  .top { display: flex; justify-content: space-between; align-items: center; }
  .count { font: 800 0.8rem var(--font-display); color: var(--accent); background: var(--accent-soft); padding: 2px 10px; border-radius: 99px; }
  .skip { all: unset; cursor: pointer; color: var(--muted); font-size: 0.88rem; font-weight: 700; padding: 6px 4px; }
  .skip:focus-visible { outline: 2px solid var(--focus); border-radius: 6px; }
  .mascot { display: grid; justify-items: center; }
  h2 { font-size: 1.2rem; }
  p { margin: 0; color: var(--muted); line-height: 1.5; }
  .dots { display: flex; gap: 5px; justify-content: center; margin: 2px 0; }
  .dots i { width: 6px; height: 6px; border-radius: 99px; background: var(--line); transition: width 0.2s, background 0.2s; }
  .dots i.on { width: 18px; background: var(--accent); }
  .actions { display: flex; gap: var(--space-2); justify-content: flex-end; }
  .actions button { min-height: 44px; padding: 0 18px; border-radius: 99px; font-weight: 800; }
  .actions .next { flex: 0 1 auto; min-width: 7rem; }

  .offer { position: fixed; z-index: 350; right: 16px; bottom: calc(16px + var(--nav-h) + env(safe-area-inset-bottom));
    width: min(380px, calc(100vw - 24px)); display: grid; grid-template-columns: auto 1fr; gap: var(--space-2) var(--space-3);
    padding: var(--space-4); background: var(--surface); border: 1.5px solid var(--accent-soft); border-radius: 18px;
    box-shadow: 0 14px 44px rgb(20 10 50 / 0.25); animation: pop 0.25s ease-out; }
  .offer-text { display: grid; gap: 2px; }
  .offer-text span { font-size: 0.9rem; }
  .offer-actions { grid-column: 1 / -1; display: flex; gap: var(--space-2); }
  .offer-actions button { flex: 1; min-height: 44px; border-radius: 99px; font-weight: 800; }
  @media (max-width: 760px) { .offer { right: 12px; left: 12px; width: auto; } }
  @keyframes pop { from { opacity: 0; transform: translateY(6px) scale(0.98); } }
  @media (prefers-reduced-motion: reduce) { .card, .offer { animation: none; } .spot { transition: none; } }
</style>
