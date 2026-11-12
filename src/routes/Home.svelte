<script lang="ts">
  import Mascot from '../components/Mascot.svelte';
  import { t } from '../lib/i18n/index.svelte';
  import { app } from '../lib/state.svelte';
  import { watchUrl } from '../lib/router.svelte';
  import { parseVideoId } from '../lib/player/youtube';

  let url = $state('');
  let bad = $state(false);
  function go(e: SubmitEvent) {
    e.preventDefault();
    const id = parseVideoId(url);
    bad = !id;
    if (id) location.hash = watchUrl(id);
  }
  const steps = [
    ['home.s1.t', 'home.s1.d'],
    ['home.s2.t', 'home.s2.d'],
    ['home.s3.t', 'home.s3.d'],
  ] as const;
</script>

<section class="hero">
  <Mascot size={110} float />
  <h1>{t('home.title')}</h1>
  <p class="muted">{t('home.lead')}</p>
  <form class="go" onsubmit={go}>
    <label class="sr-only" for="home-url">{t('watch.url.label')}</label>
    <input id="home-url" type="url" inputmode="url" bind:value={url} placeholder={t('watch.url.placeholder')} aria-invalid={bad} autocomplete="off" />
    <button class="primary" type="submit">{t('home.cta')}</button>
  </form>
  {#if bad}<p class="error" role="alert">{t('watch.badlink')}</p>{/if}
  {#if app.vid}
    <a class="resume" href={watchUrl(app.vid)}>
      <img src={`https://i.ytimg.com/vi/${app.vid}/mqdefault.jpg`} alt="" width="96" height="54" loading="lazy" />
      <span>{t('home.continue')} →</span>
    </a>
  {/if}
</section>

<section aria-labelledby="how">
  <h2 id="how" class="sr-only">{t('home.how')}</h2>
  <ol class="steps">
    {#each steps as [title, desc], i}
      <li class="card">
        <span class="n" aria-hidden="true">{i + 1}</span>
        <h3>{t(title)}</h3>
        <p class="muted">{t(desc)}</p>
      </li>
    {/each}
  </ol>
</section>

<p class="muted private">{t('home.private')}</p>

<style>
  .hero { display: grid; justify-items: center; text-align: center; gap: var(--space-3); padding: var(--space-6) 0 var(--space-5); }
  h1 { font-size: clamp(2rem, 7vw, 3.2rem); }
  .hero p { max-width: 36rem; margin: 0; font-size: 1.1rem; }
  .go { display: flex; gap: var(--space-2); width: min(100%, 560px); margin-top: var(--space-2); }
  .go input { flex: 1; min-width: 0; min-height: 52px; font-size: 1rem; border-radius: 99px; padding: 0 20px; }
  .go button { min-height: 52px; padding: 0 24px; border-radius: 99px; font-weight: 800; box-shadow: var(--shadow-lg); }
  .error { color: var(--danger); font-weight: 700; }
  @media (max-width: 440px) { .go { flex-direction: column; } }
  @media (max-width: 760px) {
    .hero { padding: var(--space-4) 0 var(--space-4); gap: var(--space-2); }
    .hero :global(svg) { width: 76px; height: auto; }
    h1 { font-size: 2rem; }
    .hero p { font-size: 1rem; }
    .steps { gap: var(--space-2); }
  }
  .resume { display: inline-flex; align-items: center; gap: var(--space-3); margin-top: var(--space-3); padding: 6px 16px 6px 6px; border: 1.5px solid var(--line); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); text-decoration: none; font-weight: 700; }
  .resume:hover { border-color: var(--accent); }
  .resume img { border-radius: 8px; object-fit: cover; }
  .private { text-align: center; margin-top: var(--space-5); }
  .steps { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
  .steps h3 { margin: var(--space-2) 0 var(--space-1); }
  .steps p { margin: 0; }
  .n { display: inline-grid; place-items: center; width: 30px; height: 30px; border-radius: 50%;
    background: var(--accent-soft); color: var(--accent); font-weight: 800; }
</style>