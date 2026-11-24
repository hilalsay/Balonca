<script lang="ts">
  import { t } from '../lib/i18n/index.svelte';
  import type { MessageKey } from '../lib/i18n/tr';
  import { tour } from '../lib/tour.svelte';
  import { account } from '../lib/account.svelte';

  const faq = [1, 13, 2, 3, 14, 4, 5, 15, 6, 9, 10, 11, 12] as const;
  const keys: [string, MessageKey][] = [
    ['Space', 'kbd.play'], ['← →', 'kbd.line'], ['R', 'kbd.loop'], ['F', 'kbd.full'], ['W', 'kbd.word'],
  ];

</script>

<div class="help">
  <h1>{t('help.title')}</h1>
  <p class="muted lead">{t('help.lead')}</p>
  <div class="card tourcard">
    <div><strong>{t('tour.button')}</strong><p class="muted">{t('tour.help')}</p></div>
    <div class="tourbtns">
      <button class="primary" onclick={() => tour.start('video')}>🎬 {t('tour.start.video')}</button>
      <button class="primary" onclick={() => tour.start('text')}>🎧 {t('tour.start.text')}</button>
    </div>
  </div>

  <div class="card faq">
    {#each faq as n, i}
      <details open={i === 0}>
        <summary>{t(`help.q${n}` as MessageKey)}</summary>
        <div class="answer">
          <!-- Where data lives depends on whether there are accounts. -->
          <p>{t(n === 1 && account.status === 'in' ? 'help.a1.account' : `help.a${n}` as MessageKey)}</p>
        </div>
      </details>
    {/each}
    <details>
      <summary>{t('help.q7')}</summary>
      <dl class="keys">
        {#each keys as [k, label]}<div><dt><kbd>{k}</kbd></dt><dd>{t(label)}</dd></div>{/each}
      </dl>
    </details>
    <details>
      <summary>{t('help.q8')}</summary>
      <div class="answer"><p>{t('help.a8')}</p></div>
    </details>
  </div>
</div>

<style>
  .help { display: grid; gap: var(--space-3); max-width: 46rem; margin: 0 auto; }
  h1 { font-size: clamp(1.6rem, 5vw, 2.2rem); }
  .lead { margin: 0; }
  .faq { padding: var(--space-2) var(--space-4); }
  details { border-top: 1px solid var(--line); }
  details:first-child { border-top: 0; }
  summary { cursor: pointer; font-weight: 700; padding: var(--space-3) 0; min-height: 48px; display: flex; align-items: center; list-style: none; gap: 10px; }
  summary::-webkit-details-marker { display: none; }
  summary::before { content: '▸'; color: var(--accent); transition: transform 0.15s; flex: none; }
  details[open] > summary::before { transform: rotate(90deg); }
  .answer p { margin: 0 0 var(--space-3); }
  .keys { margin: 0 0 var(--space-3); display: grid; gap: 8px; }
  .keys div { display: flex; gap: var(--space-3); align-items: baseline; }
  dt { min-width: 5.5rem; } dd { margin: 0; color: var(--muted); }
  kbd { font: 700 0.85rem var(--font-body); background: var(--surface-2); border: 1px solid var(--line); border-bottom-width: 2px; border-radius: 6px; padding: 2px 8px; }
  .tourcard { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; justify-content: space-between; background: linear-gradient(135deg, var(--accent-soft), var(--surface)); }
  .tourcard p { margin: 4px 0 0; }
  .tourbtns { display: flex; gap: var(--space-2); flex-wrap: wrap; }
  .tourcard button { min-height: 48px; padding: 0 22px; border-radius: 99px; font-weight: 800; }
</style>
