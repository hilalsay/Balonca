<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { t } from '../lib/i18n/index.svelte';
  import { tour } from '../lib/tour.svelte';
  import type { MessageKey } from '../lib/i18n/tr';
  const sizes = ['normal', 'large', 'xlarge'] as const;
  const pick = (s: (typeof sizes)[number]) => { app.setSetting('fontScale', s); app.setSetting('fontAsked', true); };
</script>

<!-- Asked once, on the first visit: bigger text for everything. Later in Settings. -->
{#if app.ready && !app.settings.fontAsked && !tour.offer && !tour.active}
  <div class="fa" role="dialog" aria-labelledby="fa-t">
    <strong id="fa-t">{t('fontAsk.title')}</strong>
    <div class="row">
      {#each sizes as s}
        <button class:on={app.settings.fontScale === s} onclick={() => pick(s)}><span class="a {s}" aria-hidden="true">A</span> {t(`settings.font.${s}` as MessageKey)}</button>
      {/each}
    </div>
    <small class="muted">{t('fontAsk.later')}</small>
  </div>
{/if}

<style>
  .fa { position: fixed; z-index: 340; left: 50%; transform: translateX(-50%); bottom: calc(16px + var(--nav-h) + env(safe-area-inset-bottom));
    width: min(440px, calc(100vw - 24px)); display: grid; gap: 10px; padding: 14px 16px; background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow-lg); border: 1.5px solid var(--accent-soft); }
  .row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  button { min-height: 52px; border-radius: 14px; font-weight: 700; display: grid; place-items: center; padding: 4px; line-height: 1.1; }
  .a { font: 800 1rem var(--font-display); } .a.large { font-size: 1.25rem; } .a.xlarge { font-size: 1.55rem; }
  small { font-size: 0.85rem; }
</style>
