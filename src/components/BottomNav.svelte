<script lang="ts">
  import Icon, { type IconName } from './Icon.svelte';
  import { t } from '../lib/i18n/index.svelte';
  import { router } from '../lib/router.svelte';
  import { app } from '../lib/state.svelte';
  import { reviewQueue } from '../lib/srs/scheduler';
  import type { MessageKey } from '../lib/i18n/tr';

  // Phones only: the main sections within thumb reach (the header keeps them on wide screens).
  const items: [string, MessageKey, IconName][] = [
    ['home', 'nav.home', 'home'],
    ['watch', 'nav.watch', 'tv'],
    ['read', 'nav.read', 'book'],
    ['words', 'nav.words.short', 'cards'],
    ['help', 'nav.help', 'help'],
  ];
  const due = $derived(reviewQueue(app.words).length);
</script>

<nav class="bottom" aria-label={t('nav.main')}>
  {#each items as [route, key, icon]}
    <a href={`#/${route === 'home' ? '' : route}`} aria-current={router.route === route ? 'page' : undefined}>
      <span class="ic">
        <Icon name={icon} size={24} />
        {#if route === 'words' && due}<span class="badge" aria-label={t('nav.due', { n: due })}>{due > 99 ? '99+' : due}</span>{/if}
      </span>
      <span class="lbl">{t(key)}</span>
    </a>
  {/each}
</nav>

<style>
  .bottom { display: none; }
  @media (max-width: 760px) and (orientation: portrait) {
    .bottom {
      position: fixed; left: 0; right: 0; bottom: 0; z-index: 40;
      display: grid; grid-template-columns: repeat(5, 1fr);
      height: calc(var(--nav-h) + env(safe-area-inset-bottom)); padding-bottom: env(safe-area-inset-bottom);
      background: color-mix(in srgb, var(--surface) 92%, transparent); backdrop-filter: blur(12px);
      border-top: 1px solid var(--line); box-shadow: 0 -4px 20px rgb(30 20 60 / 0.06);
    }
    a { display: grid; justify-items: center; align-content: center; gap: 2px; text-decoration: none; color: var(--muted);
      font: 700 0.72rem var(--font-display); -webkit-tap-highlight-color: transparent; }
    a[aria-current='page'] { color: var(--accent); }
    a[aria-current='page'] .ic { background: var(--accent-soft); }
    .lbl { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 2px; }
    .ic { position: relative; display: grid; place-items: center; width: 52px; height: 30px; border-radius: 99px; transition: background 0.15s; }
    .badge { position: absolute; top: -4px; right: 6px; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 99px;
      background: var(--pink); color: #1a1226; font: 800 0.68rem/18px var(--font-body); text-align: center; }
  }
</style>
