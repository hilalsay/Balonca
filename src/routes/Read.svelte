<script lang="ts">
  import ReadLibrary from '../components/read/ReadLibrary.svelte';
  import Reader from '../components/read/Reader.svelte';
  import { router, readUrl } from '../lib/router.svelte';
  import { app } from '../lib/state.svelte';
  import { t } from '../lib/i18n/index.svelte';

  // #/read: the learner's texts; #/read?id=…[&s=sentence]: one text.
  const id = $derived(router.params.get('id'));
  const doc = $derived(id ? app.textById.get(id) : undefined);
  const s = $derived(Number.isFinite(Number(router.params.get('s'))) && router.params.get('s') !== null ? Number(router.params.get('s')) : null);
</script>

{#if doc}
  {#key doc.id}<Reader {doc} start={s} />{/key}
{:else if id}
  <div class="card missing">
    <p>{t('read.missing')}</p>
    <a href={readUrl()}>← {t('read.back')}</a>
  </div>
{:else}
  <ReadLibrary />
{/if}

<style>
  .missing { display: grid; gap: var(--space-2); justify-items: start; }
  .missing p { margin: 0; }
</style>
