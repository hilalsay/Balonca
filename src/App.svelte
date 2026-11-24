<script lang="ts">
  import Header from './components/Header.svelte';
  import Toasts from './components/Toasts.svelte';
  import BottomNav from './components/BottomNav.svelte';
  import Tour from './components/Tour.svelte';
  import WordPopover from './components/WordPopover.svelte';
  import { tour } from './lib/tour.svelte';
  import Home from './routes/Home.svelte';
  import NotFound from './routes/NotFound.svelte';
  import Login from './routes/Login.svelte';
  import { router, PUBLIC_ROUTES } from './lib/router.svelte';
  import { account } from './lib/account.svelte';
  import { sync } from './lib/sync.svelte';
  import ImportAsk from './components/ImportAsk.svelte';
  import FontAsk from './components/FontAsk.svelte';
  import { app } from './lib/state.svelte';
  import { t } from './lib/i18n/index.svelte';
  import type { Component } from 'svelte';

  // Heavy pages are separate chunks, fetched only when first visited.
  const lazy = {
    watch: () => import('./routes/Watch.svelte'),
    read: () => import('./routes/Read.svelte'),
    settings: () => import('./routes/Settings.svelte'),
    words: () => import('./routes/Words.svelte'),
    help: () => import('./routes/Help.svelte'),
  } as const;

  const loaded = $state<Record<string, Component | undefined>>({});
  $effect(() => {
    const r = router.route;
    if (r in lazy && !loaded[r]) void lazy[r as keyof typeof lazy]().then((m) => (loaded[r] = m.default as Component));
  });

  // The player stays mounted once opened so leaving and returning never reloads the video.
  let watchOpened = $state(router.route === 'watch');
  $effect(() => { if (router.route === 'watch') watchOpened = true; });
  const Watch = $derived(loaded.watch);

  // First visit only: offer a short tour (never started on its own; always available from Home, Help, Settings).
  // The way of learning in use (home page puts it first and offers to continue there).
  $effect(() => {
    const r = router.route;
    if (!app.ready) return;
    const mode = r === 'watch' ? 'video' : r === 'read' ? 'text' : null;
    if (mode && app.settings.mode !== mode) app.setSetting('mode', mode);
  });

  // The tour shows the video mode, so it is offered when someone first opens the player.
  $effect(() => { if (app.ready && router.route === 'watch') { const h = setTimeout(() => tour.maybeOffer(), 900); return () => clearTimeout(h); } });
  // Accounts: the server decides (off = the app works on this device only, as before).
  void account.check();
  const signIn = $derived(PUBLIC_ROUTES.includes(router.route));
  const gated = $derived(account.status === 'out' && !signIn);
  $effect(() => { if (gated) { try { sessionStorage.setItem('balonca.afterLogin', location.hash); } catch {} } });
  $effect(() => { if (account.status === 'in' && signIn) location.hash = '#/'; });
  $effect(() => { if (app.ready && account.status === 'in') void sync.start(); });
  const Page = $derived(signIn || gated ? Login : router.route === 'home' ? Home : router.route === 'notfound' ? NotFound : router.route === 'watch' ? null : loaded[router.route]);
</script>

<a class="skip" href="#main" onclick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>{t('skip')}</a>
<Header />
<main id="main" tabindex="-1">
  {#if app.ready && account.status !== 'unknown'}
    {#if watchOpened && Watch && !gated}
      <div class="page" hidden={router.route !== 'watch'}><Watch /></div>
    {/if}
    {#if Page}
      {#key router.route}
        <div class="page"><Page /></div>
      {/key}
    {/if}
    <WordPopover where="page" />
  {/if}
</main>
<footer class:on-watch={router.route === 'watch'}><small class="muted">{t('footer.note')}</small></footer>
<BottomNav />
<Tour />
<Toasts />
<ImportAsk />
{#if !gated && !signIn}<FontAsk />{/if}

<style>
  main { max-width: 1200px; margin: 0 auto; padding: var(--space-4); outline: none; min-height: 70dvh; }
  .page { animation: enter 0.25s ease-out; }
  .page[hidden] { display: none; }
  @keyframes enter { from { opacity: 0; transform: translateY(6px); } }
  footer { text-align: center; padding: var(--space-5) var(--space-4); }
  .skip { position: absolute; left: -999px; top: 8px; z-index: 300; background: var(--accent); color: var(--accent-ink); padding: 10px 16px; border-radius: 10px; }
  .skip:focus { left: 8px; }
  @media (max-width: 760px) {
    main { padding: var(--space-3); min-height: 0; }
    footer { padding: var(--space-3) var(--space-4) calc(var(--nav-h) + env(safe-area-inset-bottom) + var(--space-4)); }
    footer.on-watch { display: none; } /* the player fills the screen */
  }
</style>
