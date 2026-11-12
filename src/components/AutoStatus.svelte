<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { autoSubs, type Job } from '../lib/auto.svelte';
  import { SUBS_API_ENABLED } from '../lib/ytsubs/api';
  import { t, i18n } from '../lib/i18n/index.svelte';
  import { langName } from '../lib/languages';
  import type { MessageKey } from '../lib/i18n/tr';

  // Finished rows linger a few seconds, then fold away; errors stay until the next video.
  let settled = $state(false);
  let remember = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const idle = !autoSubs.running && autoSubs.jobs.length > 0 && autoSubs.jobs.every((j) => j.phase === 'done');
    clearTimeout(timer);
    settled = false;
    if (idle) timer = setTimeout(() => (settled = true), 5000);
    return () => clearTimeout(timer);
  });

  const offer = $derived(app.ready && app.vid && !autoSubs.running ? autoSubs.offerable() : []);
  // The first translation of a video is a real question; after that the other languages are a quiet extra.
  const first = $derived(app.tracks.length === 1);
  const showJobs = $derived(autoSubs.jobs.length > 0 && (!settled || autoSubs.running));
  const name = (code: string) => langName(code, i18n.locale);

  function text(j: Job): string {
    if (j.phase === 'error') return t((j.error ?? 'auto.err.api') as MessageKey);
    if (j.kind === 'source') return j.phase === 'done' ? t('auto.source.done', { lang: name(j.lang) }) : t('auto.source.fetch');
    if (j.phase === 'done') return t(j.manual ? 'auto.target.manual' : 'auto.target.done', { lang: name(j.lang) });
    if (j.phase === 'queued') return t('auto.target.queued', { lang: name(j.lang), n: j.ahead });
    return j.total ? t('auto.target.progress', { lang: name(j.lang), done: j.done, total: j.total }) : t('auto.target.start', { lang: name(j.lang) });
  }
</script>

{#if SUBS_API_ENABLED && (showJobs || autoSubs.running || offer.length)}
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

    {#if autoSubs.running}
      <button class="stop" onclick={() => autoSubs.cancel()}>{t('auto.cancel')}</button>
    {:else if offer.length}
      <div class="ask" class:first role="group" aria-label={t(first ? 'auto.ask' : 'auto.askMore')}>
        <span class="q">{t(first ? 'auto.ask' : 'auto.askMore')}</span>
        <div class="langs">
          {#each offer as code}
            <button class:primary={first} onclick={() => autoSubs.translateTo(code, first && remember)}>{name(code)}</button>
          {/each}
        </div>
        {#if first}
          <label class="remember">
            <input type="checkbox" bind:checked={remember} />
            <span>{t('auto.remember')}</span>
          </label>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .auto { display: grid; gap: var(--space-2); padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); background: var(--accent-soft); }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
  li { display: flex; align-items: center; gap: var(--space-2); font-size: 0.92rem; }
  .txt { min-width: 0; }
  .dot { width: 1.2rem; height: 1.2rem; flex: none; border-radius: 50%; display: grid; place-items: center; font-size: 0.75rem; font-weight: 700;
    border: 2px solid var(--accent); border-right-color: transparent; animation: spin 0.9s linear infinite; }
  li.done .dot { animation: none; border-color: var(--good); color: var(--good); }
  li.error .dot { animation: none; border-color: var(--danger); color: var(--danger); }
  li.error .txt { color: var(--danger); font-weight: 700; }
  progress { flex: 1; min-width: 60px; max-width: 160px; height: 8px; accent-color: var(--accent); }
  .stop { justify-self: end; }

  .ask { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); }
  .q { font-size: 0.92rem; color: var(--muted); }
  .ask.first .q { color: var(--text); font-weight: 700; font-size: 1rem; }
  .langs { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .langs button { border-radius: 99px; min-height: 40px; padding: 0 16px; }
  .ask:not(.first) .langs button { min-height: 36px; font-size: 0.88rem; }
  .remember { display: flex; align-items: center; gap: 8px; font-size: 0.85rem; color: var(--muted); min-height: 36px; flex-basis: 100%; }
  .remember input { width: 18px; height: 18px; accent-color: var(--accent); }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
