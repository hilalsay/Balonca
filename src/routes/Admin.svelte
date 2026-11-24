<script lang="ts">
  // The admin panel (phase 5): numbers, active minutes of the last 30 days, invites, accounts. Admins only; the
  // server checks that too (/api/admin/*). Texts are local here: this page is for the site's owner.
  import { account } from '../lib/account.svelte';
  import { i18n } from '../lib/i18n/index.svelte';

  const BASE = (import.meta.env.VITE_SUBS_API as string | undefined) ?? '/api';
  const TR = {
    title: 'Yönetim', users: 'Kullanıcı', active1: 'Bugün aktif', active7: '7 günde aktif', new7: '7 günde yeni', spend: 'Bugünkü model harcaması', grammar: 'Dilbilgisi: model', grammarParser: 'ayrıştırıcı', rejects: 'reddedildi',
    chart: 'Aktif dakika, son 30 gün', minutes: 'dk', people: 'kişi', table: 'Tablo olarak göster', day: 'Gün',
    invites: 'Davetler', make: 'Davet linki oluştur', valid: 'Geçerlilik', days: 'gün', copy: 'Kopyala', copied: 'Kopyalandı',
    usedBy: 'Kullanan', open: 'Geçerli', expired: 'Süresi doldu', until: 'son gün',
    accounts: 'Hesaplar', email: 'E-posta', joined: 'Katıldı', seen: 'Son görülme', words: 'Kelime', texts: 'Metin', videos: 'Video', min30: '30 gün dk',
    actions: 'İşlem', reset: 'Şifre linki', off: 'Kapat', on: 'Aç', disabled: 'kapalı', admin: 'admin', never: '—',
    resetNote: 'Bu link bir saat geçerli; kişiye kendin gönder:', noAccess: 'Bu sayfa yalnızca yöneticiler için.', failed: 'Yüklenemedi. Sayfayı yenile.',
    confirmOff: 'Bu hesap kapatılsın mı? Hemen çıkış yapılır.',
  };
  const EN: typeof TR = {
    title: 'Admin', users: 'Users', active1: 'Active today', active7: 'Active in 7 days', new7: 'New in 7 days', spend: 'Model spend today', grammar: 'Grammar by the model', grammarParser: 'by the parser', rejects: 'rejected',
    chart: 'Active minutes, last 30 days', minutes: 'min', people: 'people', table: 'Show as a table', day: 'Day',
    invites: 'Invites', make: 'Create invite link', valid: 'Valid for', days: 'days', copy: 'Copy', copied: 'Copied',
    usedBy: 'Used by', open: 'Open', expired: 'Expired', until: 'until',
    accounts: 'Accounts', email: 'E-mail', joined: 'Joined', seen: 'Last seen', words: 'Words', texts: 'Texts', videos: 'Videos', min30: '30-day min',
    actions: 'Actions', reset: 'Password link', off: 'Switch off', on: 'Switch on', disabled: 'off', admin: 'admin', never: '—',
    resetNote: 'This link works for one hour; send it to the person yourself:', noAccess: 'This page is for admins only.', failed: 'Could not load. Reload the page.',
    confirmOff: 'Switch this account off? It is signed out at once.',
  };
  const L = $derived(i18n.locale === 'tr' ? TR : EN);

  interface Day { day: string; users: number; minutes: number }
  interface GrammarStatus { engine: string; budgetUsd: number; spentToday: number; model: number; parser: Record<string, number>; rejects: Record<string, number> }
  interface Overview { users: number; active1: number; active7: number; new7: number; days: Day[]; llm: { today?: { usd: number; budgetUsd: number }; grammar?: GrammarStatus } | null }
  const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
  interface User { id: number; email: string; admin: boolean; disabled: boolean; google: boolean; created: number; lastSeen: number | null; words: number; texts: number; videos: number; minutes30: number }
  interface Invite { code: string; link: string; created: number; expires: number | null; used: number | null; usedBy: string | null }

  let overview = $state<Overview | null>(null), users = $state<User[]>([]), invites = $state<Invite[]>([]);
  let error = $state(false), fresh = $state<string | null>(null), resetLink = $state<string | null>(null), copied = $state<string | null>(null);
  let inviteDays = $state(14);

  async function api<T>(path: string, body?: unknown): Promise<T> {
    const r = await fetch(`${BASE}/admin/${path}`, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(String(r.status));
    return r.json() as Promise<T>;
  }
  async function load() {
    try {
      [overview, users, invites] = await Promise.all([
        api<Overview>('overview'), api<{ users: User[] }>('users').then((x) => x.users), api<{ invites: Invite[] }>('invites').then((x) => x.invites),
      ]);
      error = false;
    } catch { error = true; }
  }
  $effect(() => { if (account.me?.isAdmin) void load(); });

  async function makeInvite() { fresh = (await api<{ link: string }>('invites', { days: inviteDays })).link; void load(); }
  async function reset(u: User) { resetLink = (await api<{ link: string }>(`users/${u.id}/reset`, {})).link; }
  async function toggle(u: User) {
    if (!u.disabled && !confirm(L.confirmOff)) return;
    await api(`users/${u.id}/disable`, { disabled: !u.disabled }); void load();
  }
  async function copy(text: string) { try { await navigator.clipboard.writeText(text); copied = text; setTimeout(() => (copied = null), 2000); } catch {} }

  // Sortable accounts table
  type Key = 'email' | 'created' | 'lastSeen' | 'words' | 'texts' | 'videos' | 'minutes30';
  let sortKey = $state<Key>('lastSeen'), desc = $state(true);
  const sorted = $derived([...users].sort((a, b) => {
    const x = a[sortKey] ?? 0, y = b[sortKey] ?? 0;
    const c = typeof x === 'string' ? x.localeCompare(String(y)) : Number(x) - Number(y);
    return desc ? -c : c;
  }));
  const sortBy = (k: Key) => { if (sortKey === k) desc = !desc; else { sortKey = k; desc = k !== 'email'; } };
  const date = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString(i18n.locale === 'tr' ? 'tr-TR' : 'en-GB', { day: 'numeric', month: 'short' }) : L.never);
  const ago = (ms: number | null) => {
    if (!ms) return L.never;
    const m = Math.round((Date.now() - ms) / 60_000);
    const rtf = new Intl.RelativeTimeFormat(i18n.locale, { numeric: 'auto' });
    return m < 60 ? rtf.format(-m, 'minute') : m < 2880 ? rtf.format(-Math.round(m / 60), 'hour') : rtf.format(-Math.round(m / 1440), 'day');
  };

  // Chart: one series (active minutes per day), bars from the baseline, a tooltip per bar.
  const W = 600, H = 160, PAD = { l: 32, b: 22, t: 8, r: 4 };
  const max = $derived(Math.max(5, ...(overview?.days.map((d) => d.minutes) ?? [0])));
  const ticks = $derived([0, Math.round(max / 2), max]);
  const bw = (W - PAD.l - PAD.r) / 30;
  let hover = $state<number | null>(null);
  const y = (v: number) => H - PAD.b - ((H - PAD.b - PAD.t) * v) / max;
  /** A bar with 4 px rounded top corners, square at the baseline. */
  function bar(x: number, w: number, top: number, base: number) {
    const r = Math.min(4, w / 2, (base - top));
    if (base - top <= 0) return '';
    return `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${base}Z`;
  }
</script>

{#if !account.me?.isAdmin}
  <p class="muted">{L.noAccess}</p>
{:else}
  <div class="admin">
    <h1>{L.title}</h1>
    {#if error}<p class="err" role="alert">{L.failed}</p>{/if}

    {#if overview}
      <div class="tiles">
        <div class="tile card"><span class="v">{overview.users}</span><span class="k">{L.users}</span></div>
        <div class="tile card"><span class="v">{overview.active1}</span><span class="k">{L.active1}</span></div>
        <div class="tile card"><span class="v">{overview.active7}</span><span class="k">{L.active7}</span></div>
        <div class="tile card"><span class="v">{overview.new7}</span><span class="k">{L.new7}</span></div>
        {#if overview.llm?.today}<div class="tile card"><span class="v">${overview.llm.today.usd.toFixed(2)}</span><span class="k">{L.spend} / ${overview.llm.today.budgetUsd}</span></div>{/if}
        {#if overview.llm?.grammar?.engine === 'model'}{@const g = overview.llm.grammar}<div class="tile card" title={Object.entries(g.rejects).map(([k, n]) => `${k}: ${n}`).join(', ')}><span class="v">{g.model}</span><span class="k">{L.grammar} · {sum(g.parser)} {L.grammarParser} · {sum(g.rejects)} {L.rejects} · ${g.spentToday.toFixed(2)} / ${g.budgetUsd}</span></div>{/if}
      </div>

      <section class="card chart">
        <h2>{L.chart}</h2>
        <div class="plot">
          <svg viewBox="0 0 {W} {H}" role="img" aria-label={L.chart} onpointerleave={() => (hover = null)}>
            {#each ticks as tk}
              <line x1={PAD.l} x2={W - PAD.r} y1={y(tk)} y2={y(tk)} class="grid" />
              <text x={PAD.l - 6} y={y(tk) + 4} class="axis" text-anchor="end">{tk}</text>
            {/each}
            {#each overview.days as d, i}
              {@const x = PAD.l + i * bw}
              <path d={bar(x + 1, bw - 2, y(d.minutes), H - PAD.b)} class="bar" class:dim={hover !== null && hover !== i} />
              <!-- the hit area is the whole column, wider than the bar -->
              <rect x={x} y={PAD.t} width={bw} height={H - PAD.b - PAD.t} fill="transparent" onpointerenter={() => (hover = i)} role="presentation" />
              {#if (i % 7 === 0 && i <= 21) || i === 29}<text x={x + bw / 2} y={H - 6} class="axis" text-anchor="middle">{d.day.slice(5)}</text>{/if}
            {/each}
          </svg>
          {#if hover !== null}
            {@const d = overview.days[hover]}
            <div class="tip" style:left="{((PAD.l + hover * bw + bw / 2) / W) * 100}%">
              <strong>{date(Date.parse(d.day))}</strong><span>{d.minutes} {L.minutes} · {d.users} {L.people}</span>
            </div>
          {/if}
        </div>
        <details>
          <summary>{L.table}</summary>
          <table class="small">
            <thead><tr><th>{L.day}</th><th>{L.minutes}</th><th>{L.people}</th></tr></thead>
            <tbody>{#each [...overview.days].reverse() as d}<tr><td>{d.day}</td><td>{d.minutes}</td><td>{d.users}</td></tr>{/each}</tbody>
          </table>
        </details>
      </section>
    {/if}

    <section class="card">
      <h2>{L.invites}</h2>
      <div class="row">
        <label>{L.valid} <select bind:value={inviteDays}>{#each [1, 3, 7, 14, 30] as n}<option value={n}>{n} {L.days}</option>{/each}</select></label>
        <button class="primary" onclick={makeInvite}>{L.make}</button>
      </div>
      {#if fresh}<p class="link"><code>{fresh}</code> <button onclick={() => copy(fresh!)}>{copied === fresh ? L.copied : L.copy}</button></p>{/if}
      <ul class="invites">
        {#each invites.slice(0, 12) as inv}
          {@const expired = !inv.used && inv.expires !== null && inv.expires < Date.now()}
          <li>
            <span class="state" class:used={!!inv.used} class:expired>{inv.used ? `${L.usedBy}: ${inv.usedBy ?? '—'}` : expired ? L.expired : `${L.open} · ${L.until} ${date(inv.expires)}`}</span>
            {#if !inv.used && !expired}<button onclick={() => copy(inv.link)}>{copied === inv.link ? L.copied : L.copy}</button>{/if}
          </li>
        {/each}
      </ul>
    </section>

    <section class="card">
      <h2>{L.accounts}</h2>
      {#if resetLink}<p class="link">{L.resetNote} <code>{resetLink}</code> <button onclick={() => copy(resetLink!)}>{copied === resetLink ? L.copied : L.copy}</button></p>{/if}
      <div class="scroll">
        <table>
          <thead><tr>
            {#each [['email', L.email], ['created', L.joined], ['lastSeen', L.seen], ['words', L.words], ['texts', L.texts], ['videos', L.videos], ['minutes30', L.min30]] as [k, label]}
              <th aria-sort={sortKey === k ? (desc ? 'descending' : 'ascending') : 'none'}><button class="th" onclick={() => sortBy(k as Key)}>{label}{sortKey === k ? (desc ? ' ↓' : ' ↑') : ''}</button></th>
            {/each}
            <th>{L.actions}</th>
          </tr></thead>
          <tbody>
            {#each sorted as u (u.id)}
              <tr class:off={u.disabled}>
                <td>{u.email}{#if u.admin} <span class="tag">{L.admin}</span>{/if}{#if u.google} <span class="tag">G</span>{/if}{#if u.disabled} <span class="tag warn">{L.disabled}</span>{/if}</td>
                <td>{date(u.created)}</td><td>{ago(u.lastSeen)}</td><td class="n">{u.words}</td><td class="n">{u.texts}</td><td class="n">{u.videos}</td><td class="n">{u.minutes30}</td>
                <td class="acts">
                  <button onclick={() => reset(u)}>{L.reset}</button>
                  {#if u.email !== account.me?.email}<button onclick={() => toggle(u)}>{u.disabled ? L.on : L.off}</button>{/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  </div>
{/if}

<style>
  .admin { display: grid; gap: var(--space-4); min-width: 0; }
  .admin > * { min-width: 0; }
  h1, h2 { margin: 0; }
  h2 { font-size: 1.15rem; margin-bottom: var(--space-2); }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: var(--space-2); }
  .tile { display: grid; gap: 2px; padding: var(--space-3); }
  .tile .v { font-size: 1.8rem; font-weight: 800; }
  .tile .k { color: var(--muted); font-size: 0.92rem; }
  .card { padding: var(--space-3); }
  .plot { position: relative; max-width: 760px; }
  svg { width: 100%; height: auto; display: block; }
  .grid { stroke: var(--line); stroke-width: 1; }
  .axis { fill: var(--muted); font-size: 11px; }
  /* the chart shrinks with the screen: larger label units keep them readable on a phone */
  @media (max-width: 640px) { .axis { font-size: 20px; } }
  .bar { fill: var(--accent); }
  .bar.dim { opacity: 0.45; }
  .tip { position: absolute; top: 0; transform: translateX(-50%); background: var(--surface); border: 1px solid var(--line); border-radius: 8px;
    padding: 4px 8px; display: grid; font-size: 0.85rem; pointer-events: none; white-space: nowrap; box-shadow: 0 2px 8px rgb(0 0 0 / 0.12); }
  details { margin-top: var(--space-2); }
  summary { cursor: pointer; min-height: 44px; display: flex; align-items: center; font-weight: 700; }
  .row { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; }
  select { min-height: 44px; margin-left: 6px; }
  button { min-height: 44px; border-radius: 99px; padding: 0 14px; font-weight: 700; }
  .link { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: var(--space-2) 0 0; }
  code { word-break: break-all; font-size: 0.85rem; }
  .invites { list-style: none; padding: 0; margin: var(--space-2) 0 0; display: grid; gap: 6px; }
  .invites li { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .state.used, .state.expired { color: var(--muted); }
  .scroll { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-size: 0.95rem; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); white-space: nowrap; }
  td.n { text-align: right; font-variant-numeric: tabular-nums; }
  .th { background: none; border: 0; padding: 0; min-height: 44px; font-weight: 800; color: inherit; }
  tr.off td { color: var(--muted); }
  .tag { font-size: 0.75rem; border: 1px solid var(--line); border-radius: 99px; padding: 1px 6px; }
  .tag.warn { color: var(--danger); border-color: currentColor; }
  .acts { display: flex; gap: 6px; }
  .acts button { min-height: 40px; padding: 0 10px; font-size: 0.88rem; }
  .err { color: var(--danger); font-weight: 700; }
  .small { max-width: 22rem; }
</style>
