<script lang="ts">
  import Mascot from '../components/Mascot.svelte';
  import { t } from '../lib/i18n/index.svelte';
  import type { MessageKey } from '../lib/i18n/tr';
  import { app } from '../lib/state.svelte';
  import { watchUrl, readUrl } from '../lib/router.svelte';
  import { parseVideoId } from '../lib/player/youtube';
  import { tour } from '../lib/tour.svelte';
  import { account } from '../lib/account.svelte';

  let url = $state('');
  let bad = $state(false);
  function go(e: SubmitEvent) {
    e.preventDefault();
    const id = parseVideoId(url);
    bad = !id;
    if (id) { app.setSetting('mode', 'video'); location.hash = watchUrl(id); }
  }

  // The way chosen last comes first; before any choice, the video way (the one with the tour).
  const order = $derived(app.settings.mode === 'text' ? (['text', 'video'] as const) : (['video', 'text'] as const));
  const lastText = $derived(app.texts[0]);
  const steps: Record<'video' | 'text', [MessageKey, MessageKey][]> = {
    video: [['home.s1.t', 'home.s1.d'], ['home.s2.t', 'home.s2.d'], ['home.s3.t', 'home.s3.d']],
    text: [['home.t1.t', 'home.t1.d'], ['home.t2.t', 'home.t2.d'], ['home.t3.t', 'home.t3.d']],
  };
  const shown = $derived(app.settings.mode === 'text' ? 'text' : 'video');
</script>

<section class="hero" class:back={!!app.settings.mode}>
  <Mascot size={96} float />
  <h1>{t('home.title2')}</h1>
  <p class="muted">{t('home.lead2')}</p>
</section>

<section aria-labelledby="choose">
  <h2 id="choose" class="choose">{t('home.choose')}</h2>
  <div class="modes">
    {#each order as m}
      {#if m === 'video'}
        <article class="card mode video" class:last={app.settings.mode === 'video'}>
          {#if app.settings.mode === 'video'}<span class="badge">{t('home.lastUsed')}</span>{/if}
          <div class="mhead"><span class="ic" aria-hidden="true">🎬</span><h3>{t('home.video.t')}</h3></div>
          <p class="muted">{t('home.video.d')}</p>
          <ul class="feats"><li>{t('home.video.f1')}</li><li>{t('home.video.f2')}</li><li>{t('home.video.f3')}</li></ul>
          <form class="go" onsubmit={go}>
            <label class="sr-only" for="home-url">{t('watch.url.label')}</label>
            <input id="home-url" type="url" inputmode="url" bind:value={url} placeholder={t('watch.url.placeholder')} aria-invalid={bad} autocomplete="off" />
            <button class="primary" type="submit">{t('home.video.cta')}</button>
          </form>
          {#if bad}<p class="error" role="alert">{t('watch.badlink')}</p>{/if}
          {#if app.vid}
            <a class="resume" href={watchUrl(app.vid)}>
              <img src={`https://i.ytimg.com/vi/${app.vid}/mqdefault.jpg`} alt="" width="80" height="45" loading="lazy" />
              <span>{t('home.continue')} →</span>
            </a>
          {/if}
        </article>
      {:else}
        <article class="card mode text" class:last={app.settings.mode === 'text'}>
          {#if app.settings.mode === 'text'}<span class="badge">{t('home.lastUsed')}</span>{/if}
          <div class="mhead"><span class="ic" aria-hidden="true">🎧</span><h3>{t('home.text.t')}</h3></div>
          <p class="muted">{t('home.text.d')}</p>
          <ul class="feats"><li>{t('home.text.f1')}</li><li>{t('home.text.f2')}</li><li>{t('home.text.f3')}</li></ul>
          <a class="cta" href={readUrl()} onclick={() => app.setSetting('mode', 'text')}>{app.texts.length ? t('home.text.cta2') : t('home.text.cta')} →</a>
          {#if lastText}
            <a class="resume" href={readUrl(lastText.id)}>
              <span class="doc" aria-hidden="true">📖</span>
              <span>{t('home.continueText', { title: lastText.title || t('read.untitled') })} →</span>
            </a>
          {/if}
        </article>
      {/if}
    {/each}
  </div>
</section>

<section aria-labelledby="how">
  <h2 id="how" class="how">{t('home.how')} <span class="muted">· {t(shown === 'text' ? 'home.text.t' : 'home.video.t')}</span></h2>
  <ol class="steps">
    {#each steps[shown] as [title, desc], i}
      <li class="card">
        <span class="n" aria-hidden="true">{i + 1}</span>
        <h3>{t(title)}</h3>
        <p class="muted">{t(desc)}</p>
      </li>
    {/each}
  </ol>
</section>

{#if shown === 'video'}
  <div class="tour-row">
    <button class="tour" onclick={() => tour.start()}>✨ {t('tour.button')}</button>
  </div>
{/if}

<p class="muted private">{t(account.status === 'in' ? 'home.private.account' : 'home.private')}</p>

<style>
  /* Phones, someone who has been here: the two ways (and their buttons) come first. */
  @media (max-width: 640px) { .hero.back p { display: none; } .hero.back :global(svg) { width: 48px; } .hero.back { padding: var(--space-2) 0; } }
  .hero { display: grid; justify-items: center; text-align: center; gap: var(--space-2); padding: var(--space-5) 0 var(--space-4); }
  h1 { font-size: clamp(2rem, 7vw, 3rem); margin: 0; }
  .hero p { max-width: 38rem; margin: 0; font-size: 1.1rem; }
  .choose { text-align: center; font-size: 1.3rem; margin: 0 0 var(--space-3); }
  .modes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4); }
  .mode { min-width: 0; grid-template-columns: minmax(0, 1fr); position: relative; display: grid; gap: var(--space-2); align-content: start; padding: var(--space-4) var(--space-4) var(--space-4); border: 2px solid transparent; }
  .mode.last { border-color: var(--accent); box-shadow: var(--shadow-lg); }
  .badge { position: absolute; top: -12px; right: 16px; background: var(--accent); color: var(--accent-ink); font: 800 0.75rem var(--font-display); padding: 4px 12px; border-radius: 99px; }
  .mhead { display: flex; align-items: center; gap: var(--space-2); }
  .ic { font-size: 2rem; line-height: 1; }
  h3 { margin: 0; font-size: 1.3rem; }
  .mode p { margin: 0; }
  .feats { margin: 0; padding: 0; list-style: none; display: grid; gap: 4px; font-size: 0.92rem; }
  .feats li::before { content: '✓ '; color: var(--good); font-weight: 800; }
  .go { display: flex; gap: var(--space-2); margin-top: var(--space-2); }
  .go input { flex: 1; min-width: 0; min-height: 50px; font-size: 1rem; border-radius: 99px; padding: 0 18px; }
  .go button, .cta { min-height: 50px; padding: 0 22px; border-radius: 99px; font-weight: 800; box-shadow: var(--shadow-lg); white-space: nowrap; }
  .cta { display: inline-flex; align-items: center; justify-content: center; justify-self: start; margin-top: var(--space-2); background: var(--accent); color: var(--accent-ink); text-decoration: none; }
  .cta:hover { transform: translateY(-1px); }
  .error { color: var(--danger); font-weight: 700; margin: 0; }
  .resume { display: inline-flex; align-items: center; gap: var(--space-3); justify-self: start; max-width: 100%; padding: 6px 14px 6px 6px; border: 1.5px solid var(--line); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); text-decoration: none; font-weight: 700; }
  .resume span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .resume:hover { border-color: var(--accent); }
  .resume img { border-radius: 8px; object-fit: cover; flex: none; }
  .doc { display: grid; place-items: center; width: 45px; height: 45px; border-radius: 8px; background: var(--accent-soft); font-size: 1.3rem; flex: none; }
  .how { font-size: 1.15rem; margin: var(--space-5) 0 var(--space-3); }
  .steps { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
  .steps h3 { margin: var(--space-2) 0 var(--space-1); font-size: 1.1rem; }
  .steps p { margin: 0; }
  .n { display: inline-grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: var(--accent-soft); color: var(--accent); font-weight: 800; }
  .tour-row { display: flex; justify-content: center; margin-top: var(--space-4); }
  .tour { min-height: 48px; padding: 0 22px; border-radius: 99px; font-weight: 800; }
  .private { text-align: center; margin-top: var(--space-5); }
  @media (max-width: 760px) {
    .hero { padding: var(--space-3) 0 var(--space-3); }
    .hero :global(svg) { width: 70px; height: auto; }
    h1 { font-size: 2rem; }
    .hero p { font-size: 1rem; }
    .modes { grid-template-columns: 1fr; gap: var(--space-4); }
    .steps { gap: var(--space-2); }
  }
  @media (max-width: 440px) { .go { flex-direction: column; } .cta { justify-self: stretch; } }
</style>
