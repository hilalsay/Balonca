<script lang="ts">
  import { sync } from '../lib/sync.svelte';
  import { t } from '../lib/i18n/index.svelte';
  let busy = $state(false);
  const pick = async (yes: boolean) => { busy = true; try { await sync.choose(yes); } finally { busy = false; } };
</script>

{#if sync.ask}
  <div class="scrim" aria-hidden="true"></div>
  <div class="ask card" role="dialog" aria-modal="true" aria-labelledby="import-title">
    <h2 id="import-title">{t('import.title')}</h2>
    <p>{t('import.lead', { words: sync.ask.words, texts: sync.ask.texts })}</p>
    <button class="primary" disabled={busy} onclick={() => pick(true)}>{t('import.yes')}</button>
    <button disabled={busy} onclick={() => pick(false)}>{t('import.no')}</button>
    <p class="muted small">{t('import.noNote')}</p>
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; z-index: 400; background: rgb(10 5 30 / 0.45); }
  .ask { position: fixed; z-index: 410; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(440px, calc(100vw - 32px));
    display: grid; gap: var(--space-3); padding: var(--space-5) var(--space-4); }
  h2, p { margin: 0; }
  button { min-height: 52px; border-radius: 99px; font-weight: 800; font-size: 1rem; }
  .small { font-size: 0.88rem; }
</style>
