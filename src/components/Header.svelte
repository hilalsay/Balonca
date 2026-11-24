<script lang="ts">
  import Mascot from './Mascot.svelte';
  import { onMount } from 'svelte';
  import { t, i18n } from '../lib/i18n/index.svelte';
  import { router } from '../lib/router.svelte';
  import { app } from '../lib/state.svelte';

  let el: HTMLElement;
  onMount(() => {
    // The watch page sticks its video under the header, so publish the header's real height.
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--header-h', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  });

  const links = [
    ['home', 'nav.home'],
    ['watch', 'nav.watch'],
    ['read', 'nav.read'],
    ['words', 'nav.words'],
    ['ayarlar', 'nav.settings'],
    ['help', 'nav.help'],
  ] as const;
</script>

<header bind:this={el} class:on-watch={router.route === 'watch'}>
  <a class="logo" href="#/" aria-label="Balonca"><Mascot size={30} /><span>Balonca</span></a>
  <nav aria-label="Main">
    {#each links as [route, key]}
      <a href={`#/${route === 'home' ? '' : route}`} aria-current={router.route === (route === 'ayarlar' ? 'settings' : route) ? 'page' : undefined}>{t(key)}</a>
    {/each}
  </nav>
  <div class="tools">
    <!-- The app's language, written out (an icon alone is unclear); appearance lives in Settings. -->
    <button class="lang" onclick={() => app.setSetting('locale', i18n.locale === 'tr' ? 'en' : 'tr')} aria-label={t('lang.switch')} title={t('lang.switch')}>
      🌐 <span>{i18n.locale === 'tr' ? 'English' : 'Türkçe'}</span>
    </button>
  </div>
</header>

<style>
  header {
    position: sticky; top: 0; z-index: 30;
    display: flex; align-items: center; gap: var(--space-3);
    padding: var(--space-2) var(--space-4);
    background: color-mix(in srgb, var(--bg) 88%, transparent);
    backdrop-filter: blur(10px);
    border-bottom: 1px solid var(--line);
  }
  .logo { display: flex; align-items: center; min-height: 44px; gap: 6px; text-decoration: none; color: var(--text);
    font: 800 20px var(--font-display); }
  nav { display: flex; gap: 2px; margin-left: auto; overflow-x: auto; }
  nav a { padding: 10px 14px; border-radius: 99px; color: var(--muted); text-decoration: none; font-weight: 700; white-space: nowrap; }
  nav a:hover { color: var(--text); }
  nav a[aria-current='page'] { background: var(--accent-soft); color: var(--accent); }
  .tools { display: flex; gap: var(--space-2); }
  .lang { min-height: 44px; padding: 0 12px; border-radius: 99px; font-weight: 700; display: inline-flex; align-items: center; gap: 6px; }
  @media (max-width: 760px) {
    header { padding: 6px var(--space-3); padding-top: max(6px, env(safe-area-inset-top)); }
    nav { display: none; } /* the bottom tab bar takes over */
    .tools { margin-left: auto; }
    .logo { font-size: 18px; }
    .lang { min-height: 44px; }
  }
  /* Phones: the player gets the whole screen; the bottom tab bar has the navigation. */
  @media (max-width: 760px) and (orientation: portrait) { header.on-watch { display: none; } }
  @media (max-width: 760px) and (orientation: landscape) {
    nav { display: flex; margin-left: auto; }
    nav a { padding: 8px 10px; font-size: 0.9rem; }
    .tools { margin-left: 0; }
  }
</style>
