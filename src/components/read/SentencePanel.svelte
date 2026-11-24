<script lang="ts">
  import { untrack } from 'svelte';
  import WordRow from '../WordRow.svelte';
  import ShowLang from '../ShowLang.svelte';
  import GrammarView from './GrammarView.svelte';
  import Icon from '../Icon.svelte';
  import { app } from '../../lib/state.svelte';
  import { t, i18n } from '../../lib/i18n/index.svelte';
  import { langName } from '../../lib/languages';
  import { speech } from '../../lib/read/speech.svelte';
  import { nlpInfo, grammarFor, GrammarError } from '../../lib/read/api';
  import { analyze, type Analysis } from '../../lib/read/grammar';
  import { toAnalysis } from '../../lib/read/grammar-model';
  import { translateOne, viaEnglish, PIVOT, SentenceError } from '../../lib/read/translate.svelte';
  import type { Sentence } from '../../lib/read/text';
  import type { TextDoc } from '../../lib/types';

  let { doc, sents, i, onclose, onmove, onplay }: {
    doc: TextDoc; sents: Sentence[]; i: number;
    onclose: () => void; onmove: (to: number) => void; onplay: (from: number) => void;
  } = $props();

  const s = $derived(sents[i]);
  const to = $derived(app.settings.meaningLang && app.settings.meaningLang !== doc.lang ? app.settings.meaningLang : null);

  // Translation (stored with the text once made)
  let trBusy = $state(false), trErr = $state<string | null>(null), trRetry = $state(0);
  const tr = $derived(to ? doc.trans?.[to]?.[i] ?? null : null);
  const en = $derived(to && viaEnglish(doc.lang, to) ? doc.trans?.[PIVOT]?.[i] ?? null : null);
  $effect(() => {
    const idx = i, lang = to, text = s?.text;
    void trRetry;
    trErr = null;
    if (!lang || !text || untrack(() => doc.trans?.[lang]?.[idx])) { trBusy = false; return; }
    const ctl = new AbortController();
    trBusy = true;
    untrack(() => translateOne(doc, idx, text, lang, ctl.signal))
      .catch((e) => { if (!ctl.signal.aborted) trErr = e instanceof SentenceError && e.code === 'rate-limit' ? 'trans.err.rate' : 'trans.err'; })
      .finally(() => { if (!ctl.signal.aborted) trBusy = false; });
    return () => ctl.abort();
  });

  // Grammar (parsed on the server, explained here)
  let gram = $state<Analysis | null>(null), grBusy = $state(false), grErr = $state<string | null>(null), grRetry = $state(0);
  let nuance = $state(''); // the model's short note (only when the model labelled the sentence)
  let canParse = $state<boolean | null>(null);
  $effect(() => { const l = doc.lang; void nlpInfo().then((x) => { if (doc.lang === l) canParse = x.parse.includes(l); }); });
  $effect(() => {
    const idx = i, text = s?.text, ok = canParse;
    void grRetry;
    gram = null; grErr = null; nuance = '';
    if (!text || !ok) { grBusy = false; return; }
    const ctl = new AbortController();
    grBusy = true;
    // The next sentence too, so stepping on is instant.
    const next = sents[idx + 1]?.text;
    // Only the opened sentence may go to the model (server/grammar.mjs); the next one is parsed only.
    grammarFor(doc.lang, next ? [text, next] : [text], { signal: ctl.signal, ref: { libraryId: doc.id }, explain: true, ui: i18n.locale })
      .then(({ docs: [toks], grammar }) => {
        if (ctl.signal.aborted) return;
        if (grammar?.source === 'model') { gram = toAnalysis(grammar.answer, toks, doc.lang); nuance = grammar.answer.nuance ?? ''; }
        else gram = analyze(toks, doc.lang);
      })
      .catch((e) => { if (!ctl.signal.aborted) grErr = e instanceof GrammarError && e.code === 'rate-limit' ? 'gr.err.rate' : 'gr.err'; })
      .finally(() => { if (!ctl.signal.aborted) grBusy = false; });
    return () => ctl.abort();
  });

  const readable = $derived(speech.canRead(doc.lang));
</script>

<div class="sp">
  <header>
    <button class="nav" onclick={() => onmove(i - 1)} disabled={i <= 0} aria-label={t('read.prevSentence')}>‹</button>
    <h3>{t('read.sentence.n', { n: i + 1, total: sents.length })}</h3>
    <button class="nav" onclick={() => onmove(i + 1)} disabled={i >= sents.length - 1} aria-label={t('read.nextSentence')}>›</button>
    <button class="x" onclick={onclose} aria-label={t('common.close')}>✕</button>
  </header>

  <div class="body">
    {#if s}
      <p class="sentence" lang={doc.lang}><WordRow text={s.text} lang={doc.lang} doc={doc.id} at={() => i} hl={speech.index === i ? speech.word : null} /></p>
    {/if}

    {#if readable}
      <div class="listen">
        <button onclick={() => s && speech.say(doc.lang, s.text, { src: { lib: doc.id, text: s.text } })}><Icon name="speaker" size={18} /> {t('read.listen')}</button>
        <button onclick={() => s && speech.say(doc.lang, s.text, { slow: true, src: { lib: doc.id, text: s.text } })}>🐢 {t('read.slow')}</button>
        <button onclick={() => onplay(i)}>▶ {t('read.fromHere')}</button>
      </div>
    {/if}

    <section aria-labelledby="sp-tr">
      <h4 id="sp-tr">{t('read.translation')}{#if to} <span class="muted">· {langName(to, i18n.locale)}</span>{/if}</h4>
      {#if !to}
        <ShowLang compact exclude={doc.lang} />
      {:else if tr}
        <p class="tr" lang={to}>{tr}</p>
        {#if en}<p class="en muted"><span>{t('read.viaEnglish')}</span> <span lang="en">{en}</span></p>{/if}
      {:else if trBusy}
        <p class="muted loading" role="status"><span class="spin" aria-hidden="true"></span>{viaEnglish(doc.lang, to) ? t('read.translating.via') : t('trans.loading')}</p>
        {#if en}<p class="en muted"><span>{t('read.viaEnglish')}</span> <span lang="en">{en}</span></p>{/if}
      {:else if trErr}
        <p class="err" role="alert">{t(trErr as 'trans.err')} <button class="link" onclick={() => trRetry++}>{t('trans.retry')}</button></p>
      {/if}
    </section>

    <section aria-labelledby="sp-gr">
      <h4 id="sp-gr">{t('read.grammar')}</h4>
      {#if canParse === false}
        <p class="muted">{t('gr.unsupported', { lang: langName(doc.lang, i18n.locale) })}</p>
      {:else if gram}
        <GrammarView a={gram} />
        {#if nuance}<p class="nuance"><span class="ai">{t('gr.aiNote')}</span> {nuance}</p>{/if}
        <p class="auto muted">{t('gr.auto')}</p>
      {:else if grErr}
        <p class="err" role="alert">{t(grErr as 'gr.err')} <button class="link" onclick={() => grRetry++}>{t('trans.retry')}</button></p>
      {:else}
        <p class="muted loading" role="status"><span class="spin" aria-hidden="true"></span>{t('gr.loading')}</p>
      {/if}
    </section>
  </div>
</div>

<style>
  .sp { display: flex; flex-direction: column; min-height: 0; max-height: 100%; }
  header { display: flex; align-items: center; gap: 6px; padding-bottom: var(--space-2); border-bottom: 1px solid var(--line); flex: none; }
  h3 { margin: 0; font-size: 1rem; flex: 1; text-align: center; }
  .nav, .x { min-width: 40px; min-height: 40px; padding: 0; border-radius: 50%; font-size: 1.2rem; line-height: 1; }
  .x { font-size: 1rem; border: 0; background: none; color: var(--muted); }
  .body { overflow-y: auto; overscroll-behavior: contain; display: grid; gap: var(--space-3); padding-top: var(--space-3); min-height: 0; }
  .sentence { margin: 0; font-size: 1.2rem; line-height: 1.6; }
  .listen { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .listen button { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; border-radius: 99px; padding: 0 14px; font-weight: 700; }
  section { display: grid; gap: 6px; }
  h4 { margin: 0; font-size: 0.95rem; }
  .tr { margin: 0; font-size: 1.08rem; font-weight: 700; color: var(--accent); }
  .en { margin: 0; font-size: 0.88rem; }
  .en span:first-child { font-weight: 700; }
  .err { margin: 0; color: var(--danger); font-weight: 700; font-size: 0.9rem; }
  .auto { margin: 0; font-size: 0.78rem; }
  .loading { display: flex; align-items: center; gap: 8px; margin: 0; }
  .spin { width: 1rem; height: 1rem; border-radius: 50%; border: 2px solid var(--accent); border-right-color: transparent; animation: spin 0.9s linear infinite; flex: none; }
  .link { all: unset; cursor: pointer; color: var(--accent); text-decoration: underline; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .nuance { margin: var(--space-2) 0 0; font-size: 0.92rem; }
  .nuance .ai { font: 800 0.7rem var(--font-display); text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); border: 1.5px solid var(--line); border-radius: 8px; padding: 1px 6px; margin-right: 4px; }
</style>
