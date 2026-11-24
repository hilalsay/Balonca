<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import WordRow from '../WordRow.svelte';
  import KnownBar from '../KnownBar.svelte';
  import ShowLang from '../ShowLang.svelte';
  import Icon from '../Icon.svelte';
  import SentencePanel from './SentencePanel.svelte';
  import ReadSettings from './ReadSettings.svelte';
  import { app } from '../../lib/state.svelte';
  import { t, i18n } from '../../lib/i18n/index.svelte';
  import type { MessageKey } from '../../lib/i18n/tr';
  import { langName } from '../../lib/languages';
  import { readUrl } from '../../lib/router.svelte';
  import { speech } from '../../lib/read/speech.svelte';
  import { splitText, allSentences } from '../../lib/read/text';
  import { textTranslator, viaEnglish } from '../../lib/read/translate.svelte';
  import { wordPop } from '../../lib/wordpop.svelte';
  import type { TextDoc } from '../../lib/types';

  /** `start`: a sentence to open at (from "go to text" on a saved word). */
  let { doc, start = null }: { doc: TextDoc; start?: number | null } = $props();

  const pars = $derived(splitText(doc.body, doc.lang));
  const sents = $derived(allSentences(pars));
  const known = $derived({ lang: doc.lang, cues: sents });
  const total = $derived(sents.length);

  let sel = $state<number | null>(null);
  let settingsOpen = $state(false);
  let revealed = $state<Record<number, true>>({});
  let narrow = $state(false); // phones and small tablets: the sentence panel is a sheet over the text
  let finished = $state(false);

  const progress = $derived(total ? Math.min(1, Math.max(doc.done, doc.pos + 1) / total) : 0);
  const transLang = $derived(app.settings.meaningLang && app.settings.meaningLang !== doc.lang ? app.settings.meaningLang : null);
  const showTrans = $derived(app.settings.readTrans);
  const trans = $derived(transLang ? doc.trans?.[transLang] ?? [] : []);
  const job = $derived(textTranslator.job?.id === doc.id ? textTranslator.job : null);
  const seen = (i: number) => i < doc.done || !!revealed[i];
  const readable = $derived(speech.canRead(doc.lang));
  const here = $derived(speech.index < 0 ? 0 : speech.index);

  onMount(() => {
    speech.load(doc.lang, untrack(() => sents.map((s) => ({ i: s.i, text: s.text }))), {
      onLine: (i) => {
        finished = false;
        app.updateText(doc.id, { pos: i, done: Math.max(doc.done, i) });
        if (sel !== null && !narrow) sel = i; // the side panel follows the reading on wide screens
        follow(i);
      },
      onEnd: () => { app.updateText(doc.id, { done: total }); finished = true; },
    });
    app.touchText(doc.id);
    const at = start ?? (doc.pos > 0 ? doc.pos : null);
    if (at !== null && at < total) {
      speech.index = at;
      if (start !== null) sel = start;
      void tick().then(() => scrollToS(at, false));
    }
    const mq = matchMedia('(max-width: 900px)');
    const on = () => (narrow = mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => {
      mq.removeEventListener('change', on);
      speech.unload();
      textTranslator.cancel();
      wordPop.close({ keepPaused: true });
    };
  });

  // Translation under every sentence: made for the whole text in the background, sentence by sentence.
  $effect(() => {
    if (!showTrans || !transLang) return;
    const lang = transLang;
    untrack(() => textTranslator.run(doc, sents.map((s) => s.text), lang));
  });

  function scrollToS(i: number, smooth = true, block: ScrollLogicalPosition = 'center') {
    document.getElementById(`s-${i}`)?.scrollIntoView({ block, behavior: smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto' });
  }
  /** Keeps the sentence being read in view (only when it has gone off screen, so reading along is not jumpy). */
  function follow(i: number) {
    const el = document.getElementById(`s-${i}`);
    if (!el) return;
    const r = el.getBoundingClientRect(), bottom = innerHeight - (narrow ? 170 : 110);
    if (r.top < 70 || r.bottom > bottom) scrollToS(i);
  }

  function select(i: number) {
    if (i < 0 || i >= total) return;
    sel = i;
    if (!speech.playing) speech.index = i;
    app.updateText(doc.id, { pos: i });
    void tick().then(() => { if (narrow) scrollToS(i, true, 'start'); else follow(i); });
  }

  const RATES = [0.6, 0.8, 1, 1.2];
  function cycleRate() {
    const r = app.settings.readRate, k = RATES.findIndex((x) => Math.abs(x - r) < 0.01);
    app.setSetting('readRate', RATES[(k + 1) % RATES.length]);
    if (speech.playing) speech.play(); // the new speed from this sentence on
  }

  function onkey(e: KeyboardEvent) {
    if (settingsOpen || e.ctrlKey || e.metaKey || e.altKey) return;
    const el = e.target as HTMLElement | null;
    if (el?.closest('input, textarea, select, [contenteditable]')) return;
    const onButton = !!el?.closest('button, a, summary');
    if (e.key === ' ' && !onButton && readable) { e.preventDefault(); speech.toggle(); }
    else if (e.key === 'ArrowRight' && !el?.closest('.wordrow')) { e.preventDefault(); if (sel !== null) select(sel + 1); else speech.step(1); }
    else if (e.key === 'ArrowLeft' && !el?.closest('.wordrow')) { e.preventDefault(); if (sel !== null) select(sel - 1); else speech.step(-1); }
    else if (e.key === 'Escape' && sel !== null && !wordPop.cur) { sel = null; }
  }

  // Lock screen / headphone buttons
  $effect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    try {
      if (typeof MediaMetadata !== 'undefined') ms.metadata = new MediaMetadata({ title: doc.title || t('read.untitled'), artist: 'Balonca' });
      ms.setActionHandler('play', () => speech.play());
      ms.setActionHandler('pause', () => speech.pause());
      ms.setActionHandler('previoustrack', () => speech.step(-1));
      ms.setActionHandler('nexttrack', () => speech.step(1));
    } catch {}
    return () => { for (const a of ['play', 'pause', 'previoustrack', 'nexttrack'] as const) { try { ms.setActionHandler(a, null); } catch {} } };
  });
  $effect(() => { if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) navigator.mediaSession.playbackState = speech.playing ? 'playing' : 'paused'; });
</script>

<svelte:window onkeydown={onkey} />

<div class="reader" class:with-panel={sel !== null} class:narrow>
  <div class="main" style:--read-size="{app.settings.readSize}px">
    <div class="top">
      <a class="back" href={readUrl()}>← {t('read.back')}</a>
      <button class="gear" onclick={() => (settingsOpen = true)} aria-label={t('read.settings')} title={t('read.settings')}>⚙<span class="long"> {t('read.settings.short')}</span></button>
    </div>
    <h1 lang={doc.lang}>{doc.title || t('read.untitled')}</h1>
    <p class="meta muted">{langName(doc.lang, i18n.locale)} · {t('read.sentences', { n: total })} · {t('read.progress', { n: Math.round(progress * 100) })}</p>
    <KnownBar track={known} />

    {#if app.settings.readHint}
      <div class="hint" role="note">
        <strong>{t('read.hint.title')}</strong>
        <ul>
          <li><span aria-hidden="true">👆</span> {t('read.hint.word')}</li>
          <li><span class="hi" aria-hidden="true"><Icon name="bubble" size={18} /></span> {t('read.hint.sentence')}</li>
          <li><span aria-hidden="true">▶</span> {readable ? t('read.hint.play') : t('read.noVoice')}</li>
          <li><span aria-hidden="true">⚙</span> {t('read.hint.settings')}</li>
        </ul>
        <button class="primary" onclick={() => app.setSetting('readHint', false)}>{t('read.hint.ok')}</button>
      </div>
    {/if}

    {#if showTrans}
      {#if !transLang}
        <div class="notice"><span>{t('read.trans.choose')}</span><ShowLang compact exclude={doc.lang} /></div>
      {:else if job && !job.error}
        <p class="notice muted" role="status"><span class="spin" aria-hidden="true"></span>
          {job.queued ? t('read.trans.queued', { n: job.queued }) : job.step === 'pivot' ? t('read.trans.pivot', { done: job.done, total: job.total })
            : t('read.trans.progress', { lang: langName(job.lang, i18n.locale), done: job.done, total: job.total })}</p>
      {:else if job?.error}
        <p class="notice err" role="alert">{t(`auto.err.${job.error}` as MessageKey)} <button class="link" onclick={() => { textTranslator.cancel(); if (transLang) textTranslator.run(doc, sents.map((s) => s.text), transLang); }}>{t('trans.retry')}</button></p>
      {/if}
    {/if}

    <article class="text" class:lines={showTrans && !!transLang} class:hide={app.settings.readHide} lang={doc.lang}>
      {#each pars as p}
        <p>
          {#each p.sentences as s (s.i)}<span class="s" id="s-{s.i}" class:cur={speech.index === s.i && (speech.playing || speech.loading)} class:at={speech.index === s.i} class:sel={sel === s.i}>{#if app.settings.readHide && !seen(s.i)}<button class="veil" onclick={() => (revealed[s.i] = true)} aria-label={t('read.reveal')}><span aria-hidden="true">{s.text}</span></button>{:else}<WordRow text={s.text} lang={doc.lang} doc={doc.id} at={() => s.i} hl={speech.index === s.i ? speech.word : null} explain={() => select(s.i)} />{/if}<button class="sb" class:on={sel === s.i} onclick={() => select(s.i)} aria-label={t('read.sentence.open', { n: s.i + 1 })} title={t('read.sentence.open', { n: s.i + 1 })}><Icon name="bubble" size={18} /></button>{#if showTrans && transLang}<span class="st" lang={transLang}>{trans[s.i] ?? (job ? '…' : '')}</span>{/if}</span>{' '}{/each}
        </p>
      {/each}
    </article>

    {#if finished || progress >= 1}
      <div class="end">
        <strong>🎉 {t('read.end.title')}</strong>
        <span class="muted">{t('read.end.desc')}</span>
        <div class="end-actions">
          <a class="go" href="#/words">{t('read.end.words')}</a>
          {#if readable}<button onclick={() => { finished = false; speech.play(0); }}>↺ {t('read.end.again')}</button>{/if}
        </div>
      </div>
    {/if}

    <div class="bar" role="group" aria-label={t('read.player')}>
      <span class="prog" style:width="{total ? ((here + (speech.playing ? 0.5 : 0)) / total) * 100 : 0}%" aria-hidden="true"></span>
      {#if readable}
        <button class="ctl" onclick={() => speech.step(-1)} disabled={here <= 0} aria-label={t('read.prevSentence')}><Icon name="prev" size={20} /></button>
        <button class="ctl play" onclick={() => speech.toggle()} aria-label={speech.playing ? t('read.pause') : t('read.play')}>
          {#if speech.loading}<span class="spin light" aria-hidden="true"></span>{:else}<Icon name={speech.playing ? 'pause' : 'play'} size={24} fill />{/if}
        </button>
        <button class="ctl" onclick={() => speech.step(1)} disabled={here >= total - 1} aria-label={t('read.nextSentence')}><Icon name="next" size={20} /></button>
        <span class="where" aria-live="off">{here + 1}<span class="muted">/{total}</span></span>
        <span class="grow"></span>
        <button class="chip rate" onclick={cycleRate} aria-label={t('read.set.rate')} title={t('read.set.rate')}>{app.settings.readRate === 1 ? '1×' : `${app.settings.readRate}×`}</button>
        <button class="chip" class:on={app.settings.readLoop} aria-pressed={app.settings.readLoop} onclick={() => app.setSetting('readLoop', !app.settings.readLoop)} aria-label={t('read.set.loop')} title={t('read.set.loop')}><Icon name="repeat" size={18} /></button>
      {:else}
        <span class="novoice">{t('read.noVoice.short')}</span><span class="grow"></span>
      {/if}
      <button class="chip" onclick={() => (settingsOpen = true)} aria-label={t('read.settings')} title={t('read.settings')}>⚙</button>
    </div>
    {#if speech.problem}<p class="problem" role="alert">{t(`read.problem.${speech.problem}` as MessageKey)}</p>{/if}
  </div>

  {#if sel !== null}
    <aside class="panel" class:sheet={narrow} aria-label={t('read.sentence.panel')}>
      <SentencePanel {doc} {sents} i={sel} onclose={() => (sel = null)} onmove={select}
        onplay={(from) => { speech.play(from); if (narrow) sel = null; }} />
    </aside>
  {:else if !narrow}
    <aside class="panel idle">
      <p class="big" aria-hidden="true"><Icon name="bubble" size={40} /></p>
      <p><strong>{t('read.panel.empty.t')}</strong></p>
      <p class="muted">{t('read.panel.empty.d')}</p>
      {#if viaEnglish(doc.lang, 'tr') && transLang === 'tr'}<p class="muted small">{t('read.panel.viaEnglish')}</p>{/if}
    </aside>
  {/if}
</div>

{#if settingsOpen}<ReadSettings lang={doc.lang} sample={sents[here]?.text ?? ''} onclose={() => (settingsOpen = false)} />{/if}

<style>
  .reader { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: var(--space-5); align-items: start; }
  .main { min-width: 0; display: grid; gap: var(--space-3); }
  .top { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
  .back { font-weight: 700; text-decoration: none; min-height: 44px; display: inline-flex; align-items: center; }
  .gear { min-height: 44px; border-radius: 99px; padding: 0 14px; font-weight: 700; }
  h1 { margin: 0; font-size: clamp(1.5rem, 4vw, 2.1rem); overflow-wrap: anywhere; }
  .meta { margin: 0; }
  .hint { display: grid; gap: 6px; padding: var(--space-3) var(--space-4); border-radius: var(--radius); background: var(--accent-soft); }
  .hint ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 4px; }
  .hint li { display: flex; gap: 8px; }
  .hint button { justify-self: start; min-height: 44px; border-radius: 99px; padding: 0 18px; margin-top: 4px; }
  .notice { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0; padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); background: var(--surface-2); }
  .notice.err { color: var(--danger); font-weight: 700; }

  .text { font-size: var(--read-size); line-height: 1.8; max-width: 44rem; padding: var(--space-4) var(--space-5); background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow, 0 2px 12px rgb(0 0 0 / 0.05)); }
  .text p { margin: 0 0 0.9em; }
  .text p:last-child { margin-bottom: 0; }
  .s { border-radius: 0.3em; transition: background 0.2s; scroll-margin-top: 80px; scroll-margin-bottom: 120px; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
  .s.at { background: color-mix(in srgb, var(--accent) 7%, transparent); }
  .s.cur { background: color-mix(in srgb, var(--accent) 14%, transparent); }
  .s.sel { background: color-mix(in srgb, var(--pink) 24%, transparent); }
  .sb { all: unset; cursor: pointer; display: inline-block; line-height: 0; vertical-align: -0.1em; padding: 6px 4px; margin: -6px -2px -6px 1px; border-radius: 99px; color: var(--accent); opacity: 0.5; transition: opacity 0.15s, transform 0.15s; touch-action: manipulation; }
  .sb:hover, .sb:focus-visible, .sb.on, .s.cur .sb, .s.sel .sb { opacity: 1; }
  .sb:hover { transform: scale(1.15); }
  .sb:focus-visible { outline: 3px solid var(--focus); }
  .lines .s { display: block; margin-bottom: 0.7em; padding: 2px 4px; }
  .st { display: block; font-size: 0.8em; line-height: 1.5; color: var(--muted); font-style: italic; }
  .veil { all: unset; cursor: pointer; filter: blur(0.32em); user-select: none; -webkit-user-select: none; }
  .veil:focus-visible { outline: 3px solid var(--focus); filter: blur(0.2em); }

  .end { display: grid; gap: 6px; justify-items: start; padding: var(--space-3) var(--space-4); border-radius: var(--radius); background: color-mix(in srgb, var(--good) 12%, var(--surface)); }
  .end-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: 4px; }
  .end-actions > * { min-height: 44px; border-radius: 99px; padding: 0 18px; display: inline-flex; align-items: center; }
  .end-actions .go { background: var(--accent); color: var(--accent-ink); text-decoration: none; font-weight: 800; }

  .bar { position: sticky; bottom: var(--space-3); z-index: 20; display: flex; align-items: center; gap: 6px; padding: 8px 10px; overflow: hidden;
    background: color-mix(in srgb, var(--surface) 94%, transparent); backdrop-filter: blur(10px); border: 1px solid var(--line); border-radius: 20px; box-shadow: 0 8px 30px rgb(20 10 50 / 0.15); }
  .prog { position: absolute; left: 0; top: 0; height: 3px; background: var(--accent); transition: width 0.3s; }
  .ctl { min-width: 44px; min-height: 44px; padding: 0; border-radius: 50%; display: grid; place-items: center; }
  .ctl.play { min-width: 54px; min-height: 54px; background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
  .where { font: 800 0.95rem var(--font-display); margin-left: 4px; white-space: nowrap; }
  .grow { flex: 1; }
  .chip { min-height: 44px; min-width: 44px; border-radius: 99px; padding: 0 10px; font-weight: 800; display: grid; place-items: center; }
  .chip.on { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
  .novoice { font-size: 0.88rem; color: var(--muted); padding-left: 6px; }
  .problem { margin: 0; color: var(--danger); font-weight: 700; font-size: 0.9rem; }

  .panel { position: sticky; top: calc(var(--header-h, 64px) + var(--space-3)); max-height: calc(100dvh - var(--header-h, 64px) - 2 * var(--space-3));
    display: flex; flex-direction: column; padding: var(--space-3) var(--space-4); background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow-lg, 0 10px 30px rgb(0 0 0 / 0.1)); }
  .panel.idle { text-align: center; display: grid; gap: 4px; padding: var(--space-5) var(--space-4); }
  .panel.idle p { margin: 0; }
  .big { font-size: 2rem; display: grid; place-items: center; color: var(--accent); }
  .hi { color: var(--accent); display: inline-grid; place-items: center; }
  .small { font-size: 0.82rem; }
  .spin { width: 1rem; height: 1rem; border-radius: 50%; border: 2px solid var(--accent); border-right-color: transparent; animation: spin 0.9s linear infinite; display: inline-block; flex: none; }
  .spin.light { width: 1.4rem; height: 1.4rem; border-color: var(--accent-ink); border-right-color: transparent; }
  .link { all: unset; cursor: pointer; color: var(--accent); text-decoration: underline; }
  @keyframes spin { to { transform: rotate(360deg); } }

  @media (max-width: 900px) {
    .reader { display: block; }
    .main { padding-bottom: 96px; }
    .with-panel .main { padding-bottom: 64dvh; }
    .bar { position: fixed; left: var(--space-2); right: var(--space-2); bottom: calc(var(--nav-h, 0px) + env(safe-area-inset-bottom) + var(--space-2)); z-index: 35; }
    .panel.sheet { position: fixed; left: 0; right: 0; bottom: 0; top: auto; z-index: 46; max-height: 62dvh; border-radius: 22px 22px 0 0;
      padding: 10px var(--space-4) max(var(--space-3), env(safe-area-inset-bottom)); box-shadow: 0 -10px 40px rgb(20 10 50 / 0.25); animation: sheet 0.2s ease-out; }
    .panel.sheet::before { content: ''; display: block; width: 40px; height: 5px; margin: 0 auto 8px; border-radius: 99px; background: var(--line); flex: none; }
    .text { padding: var(--space-3) var(--space-3); }
  }
  @media (min-width: 901px) and (max-width: 1100px) { .reader { grid-template-columns: minmax(0, 1fr) 330px; gap: var(--space-4); } }
  @media (max-width: 760px) and (orientation: landscape) { .bar { bottom: var(--space-2); } }
  /* Phones: speed is in ⚙ (reading settings); repeat stays in view. A 44 px tap area around the small bubble. */
  @media (pointer: coarse) { .sb { position: relative; } .sb::after { content: ''; position: absolute; left: 50%; top: 50%; width: 44px; height: 44px; transform: translate(-50%, -50%); } }
  @media (max-width: 480px) { .rate { display: none; } .long { display: none; } .where { font-size: 0.85rem; } .ctl.play { min-width: 50px; min-height: 50px; } }
  @keyframes sheet { from { transform: translateY(100%); } }
  @media (prefers-reduced-motion: reduce) { .panel.sheet, .spin { animation: none; } }
</style>
