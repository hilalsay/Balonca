<script lang="ts">
  import { onMount } from 'svelte';
  import Overlay from './Overlay.svelte';
  import Icon from './Icon.svelte';
  import WordPopover from './WordPopover.svelte';
  import { wordPop } from '../lib/wordpop.svelte';
  import Mascot from './Mascot.svelte';
  import { app } from '../lib/state.svelte';
  import { player } from '../lib/player/controller.svelte';
  import { t } from '../lib/i18n/index.svelte';
  import type { MessageKey } from '../lib/i18n/tr';
  import { subAdjust } from '../lib/subadjust.svelte';

  /** `onlink`: phones fold the link field away; this button brings it back. */
  let { onlink }: { onlink?: () => void } = $props();
  let wrap: HTMLDivElement;
  let host: HTMLDivElement;
  let stage: HTMLDivElement;
  let full = $state(false);
  let pseudo = $state(false); // iPhone Safari cannot fullscreen arbitrary elements
  let seeking = $state<number | null>(null);

  const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
  const fmt = (s: number) => {
    s = Math.max(0, Math.floor(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return `${h ? h + ':' + String(m).padStart(2, '0') : m}:${String(s % 60).padStart(2, '0')}`;
  };

  onMount(() => {
    void player.mount(host);

    // Keep the subtitle size proportional to the video size (phones vs. fullscreen).
    const ro = new ResizeObserver(([e]) => {
      stage.style.setProperty('--sub-scale', String(Math.min(2.4, Math.max(0.55, e.contentRect.width / 720))));
    });
    ro.observe(stage);

    // Clicking inside the iframe steals keyboard focus; hand it back so shortcuts keep working.
    const reclaim = () => setTimeout(() => {
      if (document.activeElement === player.iframe()) (document.activeElement as HTMLElement).blur();
    }, 0);
    window.addEventListener('blur', reclaim);

    const onFs = () => { full = document.fullscreenElement === wrap; wordPop.fullscreen = full; wordPop.close({ keepPaused: true }); };
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('webkitfullscreenchange', onFs);

    return () => {
      ro.disconnect();
      window.removeEventListener('blur', reclaim);
      document.removeEventListener('fullscreenchange', onFs);
      document.removeEventListener('webkitfullscreenchange', onFs);
      player.destroy();
    };
  });

  export function toggleFullscreen() {
    if (pseudo) { pseudo = false; document.body.classList.remove('pseudo-fs'); return; }
    if (document.fullscreenElement) { void document.exitFullscreen(); return; }
    const el = wrap as HTMLElement & { webkitRequestFullscreen?: () => void };
    if (el.requestFullscreen) void el.requestFullscreen().catch(() => (pseudo = true));
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    else { pseudo = true; document.body.classList.add('pseudo-fs'); }
  }

  // Subtitle adjust mode: drag (or tap) anywhere on the video to place the subtitles, buttons for size.
  let dragging = false;
  function place(e: PointerEvent) {
    const r = stage.getBoundingClientRect();
    const h = stage.querySelector<HTMLElement>('.overlay')?.offsetHeight ?? 0;
    const free = Math.max(1, r.height - h);
    app.settings.subPos = Math.round(Math.min(100, Math.max(0, ((e.clientY - r.top - h / 2) / free) * 100)));
  }
  const nudge = (d: number) => app.setSetting('subPos', Math.min(100, Math.max(0, app.settings.subPos + d)));
  const size = (d: number) => app.setSetting('subSize', Math.min(48, Math.max(14, app.settings.subSize + d)));
  function resetSubs() { app.setSetting('subPos', 92); app.setSetting('subSize', 26); }
  function adjustKey(e: KeyboardEvent) {
    if (!subAdjust.on) return;
    if (e.key === 'Escape') { e.preventDefault(); subAdjust.on = false; }
  }

  const isFull = $derived(full || pseudo);
  const shown = $derived(seeking ?? player.time);
</script>

<svelte:window onkeydown={adjustKey} />

<div class="wrap" class:full={isFull} bind:this={wrap}>
  <div class="stage" bind:this={stage} style:--sub-size="{app.settings.subSize}px" style:--sub-bg={app.settings.subBg / 100} style:--sub-pos={app.settings.subPos}>
    <div class="yt"><div bind:this={host}></div></div>
    {#if !app.vid}
      <div class="placeholder">
        <Mascot size={72} float />
        <strong>{t('watch.empty.title')}</strong>
        <span>{t('watch.empty.desc')}</span>
      </div>
    {/if}
    {#if player.error}
      <div class="placeholder error" role="alert">{t(`err.${player.error}` as MessageKey)}</div>
    {/if}
    <Overlay />
    <WordPopover where="stage" />
    {#if app.vid && !subAdjust.on}
      <button class="aa" onclick={() => { player.pause(); subAdjust.on = true; }} aria-label={t('subadj.open')} title={t('subadj.open')}>Aa</button>
    {/if}
    {#if subAdjust.on}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="adjust" class:flip={app.settings.subPos < 50}
        onpointerdown={(e) => { dragging = true; e.currentTarget.setPointerCapture(e.pointerId); place(e); }}
        onpointermove={(e) => { if (dragging) place(e); }}
        onpointerup={() => { if (dragging) { dragging = false; app.setSetting('subPos', app.settings.subPos); } }}
        onpointercancel={() => (dragging = false)}>
        <div class="adj-bar" role="toolbar" aria-label={t('subadj.open')} tabindex="-1" onpointerdown={(e) => e.stopPropagation()}>
          <button onclick={() => nudge(-8)} aria-label={t('subadj.up')} title={t('subadj.up')}>↑</button>
          <button onclick={() => nudge(8)} aria-label={t('subadj.down')} title={t('subadj.down')}>↓</button>
          <button onclick={() => size(-2)} disabled={app.settings.subSize <= 14} aria-label={t('subadj.smaller')} title={t('subadj.smaller')}><small>A</small>−</button>
          <button onclick={() => size(2)} disabled={app.settings.subSize >= 48} aria-label={t('subadj.bigger')} title={t('subadj.bigger')}>A+</button>
          <button onclick={resetSubs} aria-label={t('subadj.reset')} title={t('subadj.reset')}>↺</button>
          <button class="primary done" onclick={() => (subAdjust.on = false)}>✓ {t('subadj.done')}</button>
        </div>
        <p class="adj-hint">{t('subadj.hint')}</p>
      </div>
    {/if}
  </div>

  <div class="controls">
    <div class="seek">
      <span class="time" aria-hidden="true">{fmt(shown)}</span>
      <input
        type="range" min="0" max={Math.max(1, Math.floor(player.duration))} step="1" value={Math.floor(shown)}
        aria-label={t('ctl.seek')} aria-valuetext={`${fmt(shown)} / ${fmt(player.duration)}`}
        oninput={(e) => (seeking = +e.currentTarget.value)}
        onchange={(e) => { player.seek(+e.currentTarget.value); seeking = null; }}
      />
      <span class="time" aria-hidden="true">{fmt(player.duration)}</span>
    </div>
    <div class="buttons">
      <button onclick={() => player.jump(-1)} aria-label={t('ctl.prev')} title={t('ctl.prev')}><Icon name="prev" /></button>
      <button class="primary play" onclick={() => player.toggle()} aria-label={player.playing ? t('ctl.pause') : t('ctl.play')}>
        <Icon name={player.playing ? 'pause' : 'play'} fill />
      </button>
      <button onclick={() => player.jump(1)} aria-label={t('ctl.next')} title={t('ctl.next')}><Icon name="next" /></button>
      <select aria-label={t('ctl.speed')} value={player.rate} onchange={(e) => player.setRate(+e.currentTarget.value)}>
        {#each RATES as r}<option value={r}>{r}×</option>{/each}
      </select>
      <button class="toggle" aria-pressed={player.loop} onclick={() => (player.loop = !player.loop)} aria-label={t('ctl.loop')} title="{t('ctl.loop')} (R)"><Icon name="repeat" /></button>
      <button class="spacer" onclick={toggleFullscreen} aria-label={isFull ? t('ctl.exitFullscreen') : t('ctl.fullscreen')} title="{t('ctl.fullscreen')} (F)">
        <Icon name={isFull ? 'shrink' : 'expand'} />
      </button>
      {#if onlink && !isFull}
        <button class="link-btn" onclick={onlink} aria-label={t('watch.change')} title={t('watch.change')}><Icon name="link" /></button>
      {/if}
    </div>
  </div>
</div>

<style>
  .wrap { display: grid; gap: var(--space-2); }
  .stage { position: relative; background: #000; aspect-ratio: 16 / 9; border-radius: var(--radius); overflow: hidden; box-shadow: var(--shadow-lg); }
  .yt, .yt :global(iframe) { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
  .placeholder {
    position: absolute; inset: 0; z-index: 4; display: grid; place-content: center; justify-items: center; gap: 8px;
    padding: var(--space-4); text-align: center; color: #e9e4f7;
    background: radial-gradient(circle at 50% 30%, #3b2f6b, #1b1630);
  }
  .placeholder span { opacity: 0.8; max-width: 26rem; }
  .placeholder.error { background: #2a1420; color: #ffd5de; }
  .aa { position: absolute; z-index: 7; top: 8px; right: 8px; min-height: 0; min-width: 0; width: 38px; height: 38px; padding: 0;
    border: 0; border-radius: 50%; background: rgb(0 0 0 / 0.55); color: #fff; font: 800 0.95rem var(--font-display); }
  .aa:hover { background: rgb(0 0 0 / 0.75); transform: none; }
  .adjust { position: absolute; inset: 0; z-index: 8; cursor: ns-resize; touch-action: none; background: rgb(0 0 0 / 0.25);
    display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px; }
  .adjust.flip { flex-direction: column-reverse; } /* subtitles up top: the toolbar moves out of their way */
  .adj-bar { display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; cursor: default; padding: 6px; border-radius: 14px;
    background: rgb(20 14 40 / 0.85); box-shadow: 0 6px 20px rgb(0 0 0 / 0.35); }
  .adj-bar button { min-height: 38px; min-width: 40px; padding: 0 10px; border-radius: 10px; font-weight: 800; font-size: 1rem;
    background: rgb(255 255 255 / 0.12); color: #fff; border: 1px solid rgb(255 255 255 / 0.2); }
  .adj-bar button:disabled { opacity: 0.4; }
  .adj-bar button small { font-size: 0.75em; }
  .adj-bar .done { background: var(--accent); border-color: var(--accent); padding: 0 14px; }
  .adj-hint { margin: 0; padding: 3px 10px; border-radius: 99px; background: rgb(0 0 0 / 0.6); color: #fff; font-size: 0.82rem; pointer-events: none; }
  .controls { display: grid; gap: var(--space-2); }
  .seek { display: flex; align-items: center; gap: var(--space-2); }
  .seek input { flex: 1; min-width: 0; accent-color: var(--accent); min-height: 32px; }
  .time { font-family: var(--font-display); font-variant-numeric: tabular-nums; font-size: 0.85rem; color: var(--muted); min-width: 3.2rem; text-align: center; }
  .buttons { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
  .buttons button { min-width: 44px; padding: 0 12px; display: inline-grid; place-items: center; }
  .link-btn { display: none !important; }
  .play { min-width: 56px !important; }
  .toggle[aria-pressed='true'] { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); }
  .spacer { margin-left: auto; }
  select { min-width: 72px; }

  @media (max-width: 760px) {
    .wrap { gap: 4px; }
    .stage { border-radius: 14px; }
    .seek input { min-height: 28px; }
    .time { min-width: 2.6rem; font-size: 0.78rem; }
    /* every control shares the row, so it fits any phone width (no fixed minimums that push the page wider) */
    .buttons { gap: 6px; flex-wrap: nowrap; }
    .buttons > * { flex: 1 1 0; min-width: 0 !important; }
    .buttons button { min-height: 42px; padding: 0; }
    .buttons .play { flex-grow: 1.4; }
    .buttons select { flex-grow: 1.5; min-height: 42px; padding: 0 2px; text-align: center; }
    .spacer { margin-left: 0; }
    .link-btn { display: inline-grid !important; }
    .aa { width: 34px; height: 34px; top: 6px; right: 6px; font-size: 0.85rem; }
    .adjust { padding: 6px; gap: 4px; }
    .adj-bar { gap: 4px; padding: 4px; }
    .adj-bar button { min-height: 34px; min-width: 34px; padding: 0 8px; font-size: 0.92rem; }
    .adj-hint { font-size: 0.75rem; }
  }
  /* Phones held sideways: the video is sized by the height that is left, next to the tabs. */
  @media (max-width: 760px) and (orientation: landscape) {
    .stage { height: calc(100dvh - var(--header-h, 52px) - 120px); width: auto; max-width: 100%; aspect-ratio: 16 / 9; margin: 0 auto; }
  }
  .wrap.full { position: fixed; inset: 0; z-index: 100; background: #000; padding: 0; gap: 0; grid-template-rows: 1fr auto; }
  .wrap.full .stage { aspect-ratio: auto; border-radius: 0; box-shadow: none; }
  .wrap.full .controls { background: #14111f; padding: var(--space-2) var(--space-3); padding-bottom: max(var(--space-2), env(safe-area-inset-bottom)); color: #fff; }
  .wrap.full .time { color: #cfc8e8; }
  .wrap:fullscreen { background: #000; grid-template-rows: 1fr auto; gap: 0; }
  .wrap:fullscreen .stage { aspect-ratio: auto; border-radius: 0; box-shadow: none; }
  .wrap:fullscreen .controls { background: #14111f; padding: var(--space-2) var(--space-3); color: #fff; }
</style>
