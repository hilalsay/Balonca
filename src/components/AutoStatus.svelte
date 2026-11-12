<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { autoSubs, type Job } from '../lib/auto.svelte';
  import { SUBS_API_ENABLED } from '../lib/ytsubs/api';
  import { t, i18n } from '../lib/i18n/index.svelte';
  import { langName } from '../lib/languages';
  import type { MessageKey } from '../lib/i18n/tr';

  // Finished rows linger a few seconds, then the bar folds away; errors stay until the next video.
  let settled = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const idle = !autoSubs.running && autoSubs.jobs.length > 0 && autoSubs.jobs.every((j) => j.phase === 'done');
    clearTimeout(timer);
    settled = false;
    if (idle) timer = setTimeout(() => (settled = true), 5000);
    return () => clearTimeout(timer);
  });

  const missing = $derived(app.ready && app.vid ? autoSubs.missing() : []);
  const showJobs = $derived(autoSubs.jobs.length > 0 && !settled);
  const name = (code: string) => langName(code, i18n.locale);

  function text(j: Job): string {
    if (j.phase === 'error') return t((j.error ?? 'auto.err.api') as MessageKey);
    if (j.kind === 'source') return j.phase === 'done' ? t('auto.source.done', { lang: name(j.lang) }) : t('auto.source.fetch');
    if (j.phase === 'done') return t(j.manual ? 'auto.target.manual' : 'auto.target.done', { lang: name(j.lang) });
    if (j.phase === 'queued') return t('auto.target.queued', { lang: name(j.lang), n: j.ahead });
    return j.total ? t('auto.target.progress', { lang: name(j.lang), done: j.done, total: j.total }) : t('auto.target.start', { lang: name(j.lang) });
  }
</script>

{#if SUBS_API_ENABLED && (showJobs || (missing.length && !autoSubs.running))}
  <div class="auto" role="status" aria-live="polite">
    {#if showJobs}
      <ul>
        {#each autoSubs.jobs as j}
          <li class={j.phase}>
            <span class="dot" aria-hidden="true">{j.phase === 'done' ? '✓' : j.phase === 'error' ? '!' : ''}</span>
            <span class="txt">{text(j)}</span>
            {#if j.kind === 'target' && j.phase === 'translate' && j.total}
              <progress max={j.total} value={j.done}></progress>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
    <div class="actions">
      {#if autoSubs.running}
        <button onclick={() => autoSubs.cancel()}>{t('auto.cancel')}</button>
      {:else if missing.length && app.vid}
        <button class="primary" onclick={() => app.vid && autoSubs.run(app.vid)}>
          {t('auto.translateMissing', { langs: missing.map(name).join(', ') })}
        </button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .auto { display: flex; gap: var(--space-3); align-items: center; justify-content: space-between; flex-wrap: wrap;
    padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); background: var(--accent-soft); }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; flex: 1; min-width: 220px; }
  li { display: flex; align-items: center; gap: var(--space-2); font-size: 0.92rem; }
  .txt { min-width: 0; }
  .dot { width: 1.2rem; height: 1.2rem; flex: none; border-radius: 50%; display: grid; place-items: center; font-size: 0.75rem; font-weight: 700;
    border: 2px solid var(--accent); border-right-color: transparent; animation: spin 0.9s linear infinite; }
  li.done .dot { animation: none; border-color: var(--good); color: var(--good); }
  li.error .dot { animation: none; border-color: var(--danger); color: var(--danger); }
  li.error .txt { color: var(--danger); font-weight: 700; }
  progress { flex: 1; min-width: 60px; max-width: 160px; height: 8px; accent-color: var(--accent); }
  .actions:empty { display: none; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
