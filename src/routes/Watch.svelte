<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import VideoStage from '../components/VideoStage.svelte';
  import Transcript from '../components/Transcript.svelte';
  import SettingsPanel from '../components/SettingsPanel.svelte';
  import WordsMini from '../components/WordsMini.svelte';
  import Tabs from '../components/Tabs.svelte';
  import AutoStatus from '../components/AutoStatus.svelte';
  import { wordPop } from '../lib/wordpop.svelte';
  import { autoSubs } from '../lib/auto.svelte';
  import { tour } from '../lib/tour.svelte';
  import { subAdjust } from '../lib/subadjust.svelte';
  import { app } from '../lib/state.svelte';
  import { player } from '../lib/player/controller.svelte';
  import { router, watchUrl } from '../lib/router.svelte';
  import { parseVideoId } from '../lib/player/youtube';
  import { loadExample } from '../lib/example';
  import { t } from '../lib/i18n/index.svelte';

  type TabId = 'transcript' | 'words' | 'settings';
  let tab = $state<TabId>('transcript');
  let stage: VideoStage;
  let url = $state('');
  let urlError = $state(false);
  let showUrl = $state(false); // phones: the link field folds away once a video is open
  let urlInput: HTMLInputElement;
  // Phones: the panel under the video can open full screen (and its height follows what the video leaves).
  let expanded = $state(false);
  let videoH = $state(0);
  $effect(() => { if (tour.active || subAdjust.on || router.route !== 'watch') expanded = false; }); // these need the video in view
  $effect(() => { if (tour.active || router.route !== 'watch') subAdjust.on = false; });
  // Phones (portrait): Settings don't need the video, so that tab opens full screen; leaving it closes it again.
  const phone = typeof matchMedia !== 'undefined' ? matchMedia('(max-width: 760px) and (orientation: portrait)') : null;
  let autoOpened = false;
  $effect(() => {
    const onSettings = tab === 'settings' && !tour.active && !subAdjust.on && router.route === 'watch';
    untrack(() => {
      if (onSettings && phone?.matches && !expanded) { expanded = true; autoOpened = true; }
      else if (!onSettings && autoOpened) { autoOpened = false; if (tab !== 'settings') expanded = false; }
    });
  });
  async function toggleUrl() {
    showUrl = !showUrl;
    if (showUrl) { await tick(); urlInput?.focus(); urlInput?.select(); }
  }

  const tabs = $derived<{ id: TabId; label: string }[]>([
    { id: 'transcript', label: t('tab.transcript') },
    { id: 'words', label: t('tab.words') },
    { id: 'settings', label: t('tab.settings') },
  ]);

  function submit(e: SubmitEvent) {
    e.preventDefault();
    const id = parseVideoId(url);
    urlError = !id;
    if (id) { location.hash = watchUrl(id); showUrl = false; }
  }

  // The URL is the source of truth: #/watch?v=ID&t=SECONDS (also used by "jump to word").
  // With neither a URL nor a saved video, a machine that has an example installed opens that one.
  $effect(() => {
    if (router.route !== 'watch') { untrack(() => { wordPop.close({ keepPaused: true }); player.pause(); }); return; }
    const fromUrl = router.params.get('v');
    const at = Number(router.params.get('t')) || 0;
    untrack(async () => {
      const v = fromUrl ?? app.vid ?? (await loadExample())?.videoId;
      if (!v || !parseVideoId(v)) return;
      await app.openVideo(v);
      url = `https://youtu.be/${v}`;
      await app.seedExample();
      void autoSubs.onOpen(v);
      if (player.loaded !== v) player.load(v, at);
      else if (at) player.seek(at);
    });
  });

  function isTyping(el: EventTarget | null) {
    return el instanceof HTMLElement && !!el.closest('input, textarea, select, [contenteditable]');
  }

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (router.route !== 'watch' || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      const onButton = e.target instanceof HTMLElement && !!e.target.closest('button, a, summary');
      const k = e.key;
      if (k === ' ' && !onButton) { e.preventDefault(); player.toggle(); }
      else if (k === 'ArrowLeft') { e.preventDefault(); player.jump(-1); }
      else if (k === 'ArrowRight') { e.preventDefault(); player.jump(1); }
      else if (k === 'r' || k === 'R') player.loop = !player.loop;
      else if (k === 'f' || k === 'F') stage.toggleFullscreen();
      else if (k === 'w' || k === 'W') {
        const first = document.querySelector<HTMLElement>('.overlay button.w');
        if (first) { player.pause(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
</script>

<div class="watch">
  <div class="video-col" bind:clientHeight={videoH}>
    <form class="url" class:folded={!!app.vid && !showUrl && !urlError} onsubmit={submit}>
      <label class="sr-only" for="yt-url">{t('watch.url.label')}</label>
      <input id="yt-url" type="url" inputmode="url" bind:this={urlInput} bind:value={url} placeholder={t('watch.url.placeholder')} aria-invalid={urlError} autocomplete="off" />
      <button class="primary" type="submit">{t('watch.load')}</button>
    </form>
    {#if urlError}<p class="error" role="alert">{t('watch.badlink')}</p>{/if}
    {#if !app.storageOk}<p class="notice" role="status">{t('watch.nostorage')}</p>{/if}
    <VideoStage bind:this={stage} onlink={toggleUrl} />
    <AutoStatus />
  </div>


  <aside class="card side" class:expanded style:--video-h="{videoH}px">
    <button class="handle" onclick={() => { expanded = !expanded; autoOpened = false; }} aria-expanded={expanded} aria-label={t(expanded ? 'panel.collapse' : 'panel.expand')} title={t(expanded ? 'panel.collapse' : 'panel.expand')}>
      <svg class="chev" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <Tabs {tabs} bind:active={tab} label={t('nav.watch')}>
      {#snippet panel(id)}
        {#if id === 'transcript'}<div class="transcript"><Transcript /></div>
        {:else if id === 'words'}<WordsMini />
        {:else}<SettingsPanel />{/if}
      {/snippet}
    </Tabs>
  </aside>
</div>

<style>
  .watch { display: grid; grid-template-columns: minmax(0, 1.7fr) minmax(320px, 1fr); gap: var(--space-4); align-items: start; }
  .video-col { display: grid; gap: var(--space-2); min-width: 0; }
  .url { display: flex; gap: var(--space-2); }
  .url input { flex: 1; min-width: 0; }
  .error { color: var(--danger); margin: 0; font-weight: 700; }
  .notice { margin: 0; padding: var(--space-3); border-radius: var(--radius-sm); background: var(--accent-soft); }
  .side { padding: var(--space-3); min-width: 0; }
  .transcript { height: min(68dvh, 720px); min-height: 320px; }

  @media (min-width: 901px) {
    .video-col { position: sticky; top: calc(var(--header-h, 64px) + var(--space-3)); }
  }
  .handle { display: none; }
  /* Phones: video and controls on top; the tabs get the rest of the screen (never less than 300px:
     on a tiny phone the page scrolls a little instead) and scroll inside. The handle opens them full screen. */
  @media (max-width: 760px) {
    .watch { display: flex; flex-direction: column; align-items: stretch; gap: var(--space-2); }
    .video-col { position: static; flex: none; margin: 0; padding: 0; background: none; gap: 6px; }
    .url.folded { display: none; }
    .side { display: flex; flex-direction: column; padding: 0 var(--space-2) var(--space-2); border-radius: 18px;
      height: max(300px, calc(100dvh - var(--header-h, 0px) - var(--nav-h) - env(safe-area-inset-bottom) - var(--video-h) - var(--space-2) - 2 * var(--space-3))); }
    .side :global(.tabs) { margin-bottom: var(--space-2); flex: none; }
    .side :global(.tabs button) { min-height: 40px; font-size: 0.95rem; }
    .side :global([role="tabpanel"]) { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
    .transcript { height: 100%; min-height: 0; }
    .handle { all: unset; display: grid; place-items: center; height: 22px; cursor: pointer; flex: none; color: var(--muted); -webkit-tap-highlight-color: transparent; }
    .handle .chev { width: 26px; height: 26px; }
    .handle:focus-visible { outline: 2px solid var(--focus); border-radius: 8px; }
    .side.expanded { position: fixed; z-index: 45; left: 0; right: 0; top: 0; height: auto;
      bottom: calc(var(--nav-h) + env(safe-area-inset-bottom)); padding-top: env(safe-area-inset-top);
      border-radius: 0; box-shadow: none; animation: rise 0.2s ease-out; }
    .side.expanded .handle { height: 34px; }
    .side.expanded .handle .chev { transform: rotate(180deg); }
  }
  @media (max-width: 760px) and (orientation: portrait) {
    .watch { padding-top: env(safe-area-inset-top); }
  }
  @keyframes rise { from { transform: translateY(24px); opacity: 0.6; } }
  @media (prefers-reduced-motion: reduce) { .side.expanded { animation: none; } }
  @media (max-width: 760px) and (orientation: landscape) {
    .watch { flex-direction: row; }
    .video-col { flex: 0 0 56%; min-width: 0; }
    .side { flex: 1; min-width: 0; height: calc(100dvh - var(--header-h, 52px) - 2 * var(--space-3)); }
  }
  @media (min-width: 761px) and (max-width: 900px) {
    .watch { grid-template-columns: 1fr; gap: var(--space-3); }
    /* video stays in view while the transcript / words scroll underneath */
    .video-col { position: sticky; top: var(--header-h, 100px); z-index: 20; background: var(--bg); padding-bottom: var(--space-2); margin: 0 calc(var(--space-4) * -1); padding-inline: var(--space-4); }
    .transcript { height: 52dvh; min-height: 260px; }
  }
</style>
