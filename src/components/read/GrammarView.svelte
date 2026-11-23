<script lang="ts">
  import { t } from '../../lib/i18n/index.svelte';
  import type { MessageKey } from '../../lib/i18n/tr';
  import type { Analysis, Chunk, Note, Role } from '../../lib/read/grammar';

  let { a }: { a: Analysis } = $props();

  // The sentence as boxes; the words of a subordinate clause sit together in one frame.
  type Group = { clause: number; chunks: Chunk[] };
  const groups = $derived.by(() => {
    const out: Group[] = [];
    for (const ch of a.chunks) {
      if (ch.role === 'punct') continue;
      const last = out[out.length - 1];
      if (last && last.clause === ch.clause && ch.clause !== mainId) last.chunks.push(ch);
      else out.push({ clause: ch.clause, chunks: [ch] });
    }
    return out;
  });
  const mainId = $derived(a.clauses.find((c) => c.kind === 'main')?.id ?? 0);
  const kindOf = (id: number) => a.clauses[id]?.kind ?? 'main';

  let picked = $state<Chunk | null>(null);
  let focus = $state<Note | null>(null);
  const lit = (ch: Chunk) => !!focus && focus.tokens.some((i) => i >= ch.from && i <= ch.to);

  const ROLE_LABEL: Partial<Record<Role, MessageKey>> = {
    subject: 'gr.role.subject', verb: 'gr.role.verb', verbPart: 'gr.role.verbPart', object: 'gr.role.object', indirect: 'gr.role.indirect',
    complement: 'gr.role.complement', adverbial: 'gr.role.adverbial', link: 'gr.role.link', negation: 'gr.role.negation',
  };
  const label = (r: Role) => (ROLE_LABEL[r] ? t(ROLE_LABEL[r]!) : '');

  const ICON: Record<Note['kind'], string> = {
    tense: '⏱', imperative: '❗', question: '❓', whQuestion: '❓', inversion: '🔀', bracket: '🧩', verbFinal: '⏭', separable: '✂️',
    modal: '🔧', passive: '🔄', negation: '🚫', relative: '🔗', teInf: '➡️', reflexive: '🪞', degree: '📈', articles: '📚',
  };

  /** A message with its {placeholders} filled by words of the sentence, shown in bold. */
  type Seg = { text: string; b?: boolean };
  function rich(key: MessageKey, p: Record<string, string>): Seg[] {
    const msg = t(key), out: Seg[] = [];
    let last = 0;
    for (const m of msg.matchAll(/\{(\w+)\}/g)) {
      out.push({ text: msg.slice(last, m.index) });
      out.push({ text: p[m[1]] ?? '', b: true });
      last = m.index! + m[0].length;
    }
    out.push({ text: msg.slice(last) });
    return out.filter((s) => s.text);
  }

  /** Title and body keys of a note (some depend on the language or a detail). */
  function keys(n: Note): { title: MessageKey; body: MessageKey; extra?: MessageKey } {
    switch (n.kind) {
      case 'tense': {
        const aux = n.p.aux ? (`gr.aux.${a.lang}.${n.p.aux.normalize('NFD').replace(/\p{M}/gu, '')}` as MessageKey) : undefined;
        return { title: `gr.tense.${n.p.tense}` as MessageKey, body: `gr.tense.${n.p.tense}.d` as MessageKey, extra: aux && hasKey(aux) ? aux : undefined };
      }
      case 'negation': return { title: 'gr.negation', body: `gr.neg.${n.p.kind}` as MessageKey };
      case 'degree': return { title: n.p.kind === 'sup' ? 'gr.degree.sup' : 'gr.degree.cmp', body: n.p.kind === 'sup' ? 'gr.degree.sup.d' : 'gr.degree.cmp.d' };
      case 'articles': return { title: `gr.articles.${a.lang}` as MessageKey, body: `gr.articles.${a.lang}.d` as MessageKey };
      default: return { title: `gr.${n.kind}` as MessageKey, body: `gr.${n.kind}.d` as MessageKey };
    }
  }
  const hasKey = (k: MessageKey) => !!t(k);
  const ARTS: Record<string, string[]> = { nl: ['de', 'het'], de: ['der', 'die', 'das'] };
</script>

<div class="gv">
  <div class="parts" role="group" aria-label={t('gr.parts')}>
    {#each groups as g}
      {#if g.clause !== mainId}
        <div class="clause {kindOf(g.clause)}">
          <span class="cl-label">{t(`gr.clause.${kindOf(g.clause)}` as MessageKey)}</span>
          <div class="cl-row">
            {#each g.chunks as ch}
              <button class="ch {ch.role}" class:lit={lit(ch)} class:picked={picked === ch} onclick={() => (picked = picked === ch ? null : ch)}>
                <span class="tx" lang={a.lang}>{ch.text}</span><span class="rl">{label(ch.role)}</span>
              </button>
            {/each}
          </div>
        </div>
      {:else}
        {#each g.chunks as ch}
          <button class="ch {ch.role}" class:lit={lit(ch)} class:picked={picked === ch} onclick={() => (picked = picked === ch ? null : ch)}>
            <span class="tx" lang={a.lang}>{ch.text}</span><span class="rl">{label(ch.role)}</span>
          </button>
        {/each}
      {/if}
    {/each}
  </div>
  <p class="what" aria-live="polite">
    {#if picked && ROLE_LABEL[picked.role]}
      <b lang={a.lang}>{picked.text}</b> · <strong class="r {picked.role}">{label(picked.role)}</strong>: {t(`gr.roleD.${picked.role}` as MessageKey)}
    {:else}<span class="muted">{t('gr.tapPart')}</span>{/if}
  </p>

  {#if a.notes.length}
    <h4>{t('gr.notice')}</h4>
    <ul class="notes">
      {#each a.notes as n}
        {@const k = keys(n)}
        <li>
          <button class="note" class:on={focus === n} onclick={() => (focus = focus === n ? null : n)} aria-pressed={focus === n}>
            <span class="ic" aria-hidden="true">{ICON[n.kind]}</span>
            <span class="nt">
              <strong>{#each rich(k.title, n.p) as s}{#if s.b}<b lang={a.lang}>{s.text}</b>{:else}{s.text}{/if}{/each}</strong>
              {#if n.kind === 'tense' && n.p.name}<span class="name">{t('gr.bookName')} <i lang={a.lang}>{n.p.name}</i></span>{/if}
              {#if n.kind === 'articles'}
                <span class="arts">{#each ARTS[a.lang] ?? [] as art}{#if n.p[art]}<span><b lang={a.lang}>{art}</b>: <span lang={a.lang}>{n.p[art]}</span></span>{/if}{/each}</span>
              {/if}
              <span class="body">{#each rich(k.body, n.p) as s}{#if s.b}<b lang={a.lang}>{s.text}</b>{:else}{s.text}{/if}{/each}{#if k.extra} {t(k.extra)}{/if}</span>
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .gv { display: grid; gap: var(--space-2); }
  .parts { display: flex; flex-wrap: wrap; gap: 6px; align-items: flex-start; }
  .ch { all: unset; box-sizing: border-box; cursor: pointer; display: grid; justify-items: center; gap: 2px; padding: 6px 10px 5px; border-radius: 12px;
    background: color-mix(in srgb, var(--role) 14%, var(--surface)); border: 1.5px solid color-mix(in srgb, var(--role) 45%, transparent);
    --role: var(--muted); min-height: 44px; transition: transform 0.1s, box-shadow 0.1s; }
  .ch:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
  .ch.picked, .ch.lit { box-shadow: 0 0 0 3px color-mix(in srgb, var(--role) 55%, transparent); transform: translateY(-1px); }
  .tx { font: 700 1.05rem var(--font-body); color: var(--text); text-align: center; overflow-wrap: anywhere; }
  .rl { font: 800 0.66rem var(--font-display); letter-spacing: 0.03em; text-transform: uppercase; color: color-mix(in srgb, var(--role) 80%, var(--text)); }
  .ch.other, .ch.link { background: var(--surface-2); border-color: var(--line); }
  .subject { --role: #3b82f6; } .verb { --role: #e5484d; } .verbPart { --role: #f472b6; } .object { --role: #16a34a; }
  .indirect { --role: #0d9488; } .complement { --role: #8b5cf6; } .adverbial { --role: #f59e0b; } .negation { --role: #dc2626; }
  .link { --role: #64748b; } .other { --role: #94a3b8; }
  .clause { display: grid; gap: 4px; padding: 4px 6px 6px; border: 1.5px dashed var(--line); border-radius: 14px; background: color-mix(in srgb, var(--surface-2) 60%, transparent); }
  .cl-label { font: 800 0.66rem var(--font-display); text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); padding-left: 4px; }
  .cl-row { display: flex; flex-wrap: wrap; gap: 6px; }
  .what { margin: 0; font-size: 0.92rem; min-height: 1.4em; }
  .r { color: color-mix(in srgb, var(--role) 80%, var(--text)); }
  h4 { margin: var(--space-2) 0 0; font-size: 0.95rem; }
  .notes { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  .note { all: unset; box-sizing: border-box; cursor: pointer; width: 100%; display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border-radius: 14px;
    background: var(--surface-2); border: 1.5px solid transparent; }
  .note:focus-visible { outline: 3px solid var(--focus); }
  .note.on { border-color: var(--accent); background: var(--accent-soft); }
  .ic { font-size: 1.15rem; line-height: 1.3; flex: none; }
  .nt { display: grid; gap: 3px; min-width: 0; font-size: 0.92rem; line-height: 1.45; }
  .nt strong { font-size: 0.98rem; }
  .name { font-size: 0.8rem; color: var(--muted); }
  .arts { display: flex; flex-wrap: wrap; gap: 4px 14px; }
  .body { color: var(--text); }
  b { font-weight: 800; color: var(--accent); }
</style>
