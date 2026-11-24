// Side-by-side translation quality of several models, as an HTML report (plan, phase 3).
//
//   node scripts/compare-models.mjs [--out file.html] [--sentences 40] [--budget 5]
//
// Uses the app's own translator (prompt, schema, checks) and word-meaning code, so the report shows what users
// would see. Secrets come from /etc/balonca.env (or the environment); the report holds no keys. The output goes to
// scripts/credit/out/ (not committed): it quotes video subtitles.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLlm, TINKER_DEFAULT_URL } from '../server/llm/index.mjs';
import { chatStream, ollamaTranslator, toUnits, batches } from '../server/translate.mjs';
import { define } from '../server/define.mjs';
import { createYouTube } from '../server/youtube.mjs';
import { runYtDlp } from '../server/lib.mjs';

try { process.loadEnvFile(process.env.BALONCA_ENV_FILE ?? '/etc/balonca.env'); } catch {}
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = arg('out', path.join(here, 'credit/out', `compare-${new Date().toISOString().slice(0, 10)}.html`));
const N = Number(arg('sentences', 40));
const BUDGET = Number(arg('budget', 5));

// Prices from Tinker's price page, USD per 1M tokens (input / output). gemma3 runs locally: free.
const MODELS = [
  { id: 'gemma3:latest', label: 'gemma3 (yerel, bugünkü)', local: true },
  { id: 'thinkingmachines/Inkling', label: 'Inkling', price: [1.87, 4.68] },
  { id: 'Qwen/Qwen3.5-397B-A17B', label: 'Qwen3.5-397B', price: [1.65, 7.5] },
  { id: 'moonshotai/Kimi-K2.6', label: 'Kimi-K2.6', price: [2.205, 5.49] },
  { id: 'Qwen/Qwen3.5-9B', label: 'Qwen3.5-9B (damıtma adayı)', price: [0.3, 1.0] },
  { id: 'Qwen/Qwen3.5-4B', label: 'Qwen3.5-4B (damıtma adayı)', price: [0.15, 0.5] },
];
const VIDEOS = [
  { v: 'Xxpk4h19iV4', lang: 'nl', what: 'Jeugdjournaal (çocuk haberleri)' },
  { v: 'Dn1xbpAzKFM', lang: 'nl', what: 'Het Klokhuis: donut nasıl yapılır' },
  { v: 'Ej3Cl2IFQp0', lang: 'nl', what: 'NOS: ABD borcu (zor)' },
  { v: '_5siHrpPnmw', lang: 'en', what: 'BBC 6 Minute English' },
  { v: 'uqomYhAafqs', lang: 'de', what: 'logo! Nachrichten' },
];
// Word meanings, some of them hard on purpose ("zus" is a sister, not a girlfriend).
const WORDS = [
  ['zus', 'Dan bel ik mijn zus op.'], ['perron', 'Mijn zus staat al op het perron.'], ['schat', 'Hoe weet je dat hier een schat ligt?'],
  ['aankom', 'Als ik aankom, staat mijn zus al op het perron.'], ['aardbeien', 'De aardbeien zijn vandaag heel zoet.'],
  ['gezellig', 'Het was een gezellige avond.'], ['eigenlijk', 'Eigenlijk wil ik niet gaan.'], ['meteen', 'Kom meteen naar huis!'],
  ['leuk', 'Dat vind ik heel leuk.'], ['jammer', 'Wat jammer dat je niet komt.'], ['verhuizen', 'Wij gaan volgend jaar verhuizen.'],
  ['afspraak', 'Ik heb morgen een afspraak bij de dokter.'], ['zeker', 'Weet je het zeker?'], ['gewoon', 'Doe maar gewoon.'],
  ['beurt', 'Nu is het jouw beurt.'], ['staking', 'Door de staking rijden er geen treinen.'], ['schuld', 'De staatsschuld is heel hoog.'],
  ['opgeruimd', 'Mijn kamer is opgeruimd.'], ['lekker', 'Lekker geslapen?'], ['even', 'Kun je even helpen?'],
  ['toch', 'Je komt toch ook?'], ['wel', 'Ik kom wel.'], ['graag', 'Ik drink graag thee.'], ['net', 'Ik ben net thuis.'],
  ['Stau', 'Wir stehen seit einer Stunde im Stau.'], ['Feierabend', 'Endlich Feierabend!'], ['doch', 'Doch, ich komme mit.'],
  ['spare', 'Do you have a spare pen?'], ['fancy', 'Do you fancy a cup of tea?'], ['grumpy', 'He is always grumpy in the morning.'],
];

const tinkerKey = process.env.TINKER_API_KEY ?? '';
const ollama = { baseUrl: process.env.OLLAMA_URL ?? 'http://127.0.0.1:31039', hostHeader: process.env.OLLAMA_HOST_HEADER ?? '127.0.0.1' };
const layer = (m) => createLlm({
  provider: m.local ? 'ollama' : 'tinker', fallback: 'off', concurrency: 4, dailyBudgetUsd: BUDGET,
  priceIn: m.price?.[0] ?? 0, priceOut: m.price?.[1] ?? 0,
  tinker: { url: process.env.TINKER_BASE_URL || TINKER_DEFAULT_URL, key: tinkerKey, model: m.id },
  ollama: { model: m.id, chat: chatStream },
});

/** json3 subtitles -> cues */
function json3Cues(text) {
  const j = JSON.parse(text);
  return (j.events ?? []).filter((e) => e.segs).map((e) => ({
    start: e.tStartMs / 1000, end: (e.tStartMs + (e.dDurationMs ?? 1000)) / 1000,
    text: e.segs.map((s) => s.utf8 ?? '').join('').replace(/\s+/g, ' ').trim(),
  })).filter((c) => c.text);
}

async function sentencesOf(yt, video) {
  const list = await yt.list(video.v, 'compare', { priority: 'live' });
  const src = list.tracks.find((t) => t.kind === 'manual' && t.code.startsWith(video.lang)) ?? list.tracks.find((t) => t.kind === 'auto' && t.code.startsWith(video.lang));
  if (!src) throw new Error(`no ${video.lang} subtitles for ${video.v}`);
  const sub = await yt.sub(video.v, src.code, src.kind === 'manual' ? 'manual' : 'auto', 'compare');
  return toUnits(json3Cues(sub.text)).map((u) => u.text).filter((t) => !/^[[(♪]/.test(t)).slice(0, N);
}

async function translateAll(m, llm, texts, from, to) {
  const tr = ollamaTranslator({ ...ollama, model: m.id, from, to, chat: (u, b, o) => llm.chat(`${ollama.baseUrl}/api/chat`, b, { ...o, headers: { host: ollama.hostHeader } }) });
  const out = [];
  for (const b of batches(texts.map((text) => ({ text })))) {
    const first = b[0];
    out.push(...(await tr(b.map((i) => texts[i]), texts.slice(Math.max(0, first - 3), first), undefined)));
  }
  return out;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function main() {
  if (!tinkerKey) console.log('TINKER_API_KEY not set: only the local model will run');
  const yt = createYouTube({ run: (a, o) => runYtDlp(a, { ...o, bin: process.env.YTDLP_BIN || 'yt-dlp' }), cacheDir: process.env.YT_CACHE_DIR ?? path.join(here, '../.cache/yt') });
  const videos = [];
  for (const v of VIDEOS) {
    try { videos.push({ ...v, texts: await sentencesOf(yt, v) }); console.log(`${v.v}: ${videos.at(-1).texts.length} sentences`); }
    catch (e) { console.log(`${v.v}: skipped (${e.code ?? e.message})`); }
  }
  const only = arg('models', '');
  const models = MODELS.filter((m) => (m.local || tinkerKey) && (!only || only.split(',').some((x) => m.id.includes(x))));
  // Each model's result is written as soon as it is done (a run cut short loses nothing); earlier ones are reused.
  const partDir = path.join(path.dirname(OUT), 'compare-parts');
  await mkdir(partDir, { recursive: true });
  const partOf = (m) => path.join(partDir, `${m.id.replace(/[^A-Za-z0-9.-]+/g, '_')}-${N}.json`);
  const results = {}; // model -> { time, usd, out: {variant: {v: [..]}}, words: [...] }
  await Promise.all(models.map(async (m) => {
    try { results[m.id] = JSON.parse(await readFile(partOf(m), 'utf8')); console.log(`${m.label}: reused`); return; } catch {}
    const llm = layer(m), r = (results[m.id] = { time: 0, usd: 0, out: {}, words: [], errors: 0 });
    const t0 = Date.now();
    const variants = [['tr', null], ['en', null], ...(m.id === 'gemma3:latest' || m.id.endsWith('Inkling') ? [['tr', 'en']] : [])];
    for (const v of videos) {
      for (const [to, via] of variants) {
        const key = via ? `${to} (${via} üzerinden)` : to;
        if (v.lang === to) continue;
        try {
          let texts = v.texts, from = v.lang;
          if (via && v.lang !== via) { texts = r.out[via]?.[v.v] ?? await translateAll(m, llm, v.texts, v.lang, via); from = via; }
          (r.out[key] ??= {})[v.v] = await translateAll(m, llm, texts, from, to);
        } catch (e) { r.errors++; (r.out[key] ??= {})[v.v] = v.texts.map(() => `⚠ ${e.code ?? e.message}`); }
        console.log(`${m.label}: ${v.v} → ${key} done (${llm.status().today.usd.toFixed(3)} $)`);
      }
    }
    const wiki = new Map();
    const fetchImpl = async (u, o) => { if (!wiki.has(u)) wiki.set(u, await fetch(u, o).then(async (x) => ({ ok: x.ok, status: x.status, body: await x.text() }))); const w = wiki.get(u); return { ok: w.ok, status: w.status, json: async () => JSON.parse(w.body) }; };
    for (const [word, ctx] of WORDS) {
      const lang = /^[A-Z]/.test(word) || ['doch'].includes(word) ? 'de' : ['spare', 'fancy', 'grumpy'].includes(word) ? 'en' : 'nl';
      try {
        const d = await define({ word, lang, to: 'tr', ctx }, { llm: { ...ollama, model: m.id, models: {} }, chat: (u, b, o) => llm.chat(u, b, { ...o, headers: { host: ollama.hostHeader } }), fetchImpl });
        r.words.push(`${d.inContext}${d.source === 'ai' ? ' (AI)' : ''}`);
      } catch (e) { r.errors++; r.words.push(`⚠ ${e.code ?? e.message}`); }
    }
    r.time = (Date.now() - t0) / 1000;
    r.usd = llm.status().today.usd;
    await writeFile(partOf(m), JSON.stringify(r));
    console.log(`${m.label}: finished in ${Math.round(r.time)} s, ${r.usd.toFixed(3)} $`);
  }));

  // ---- report
  const variantsAll = [...new Set(models.flatMap((m) => Object.keys(results[m.id].out)))];
  let html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Model karşılaştırması</title>
<style>body{font:15px/1.45 system-ui,sans-serif;margin:16px;color:#1d1b29}table{border-collapse:collapse;margin:8px 0 24px;width:100%}td,th{border:1px solid #ddd;padding:6px 8px;vertical-align:top;text-align:left}th{background:#f3f0ff;position:sticky;top:0}td.src{background:#fafafa;font-weight:600}h2{margin-top:32px}.num{text-align:right}details{margin:12px 0}summary{cursor:pointer;font-weight:700}</style>
<h1>Çeviri modelleri karşılaştırması</h1><p>${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · videoların ilk ${N} cümlesi · uygulamanın kendi çeviri kodu (prompt, şema, kontroller) kullanıldı.</p>
<h2>Özet</h2><table><tr><th>Model</th><th class="num">Süre (sn)</th><th class="num">Maliyet ($)</th><th class="num">Hata</th></tr>
${models.map((m) => `<tr><td>${esc(m.label)}</td><td class="num">${Math.round(results[m.id].time)}</td><td class="num">${results[m.id].usd.toFixed(3)}</td><td class="num">${results[m.id].errors}</td></tr>`).join('')}</table>
<p>Not: Qwen ve Kimi modelleri düşünme modunu kapatmaya izin vermiyor; her cevaptan önce uzun bir iç düşünme yazıyorlar (daha yavaş ve pahalı). Süreler aynı anda çalışan modellerle ölçüldü; yerel gemma3 tek başına CPU'da çalışır.</p>
<h2>Kelime anlamları (Türkçe)</h2><table><tr><th>Kelime</th><th>Cümle</th>${models.map((m) => `<th>${esc(m.label)}</th>`).join('')}</tr>
${WORDS.map(([w, c], i) => `<tr><td class="src">${esc(w)}</td><td>${esc(c)}</td>${models.map((m) => `<td>${esc(results[m.id].words[i])}</td>`).join('')}</tr>`).join('')}</table>`;
  for (const v of videos) {
    html += `<h2>${esc(v.what)} <small>(${v.lang}, <a href="https://youtu.be/${esc(v.v)}">youtu.be/${esc(v.v)}</a>)</small></h2>`;
    for (const variant of variantsAll) {
      const cols = models.filter((m) => results[m.id].out[variant]?.[v.v]);
      if (!cols.length) continue;
      html += `<details${variant === 'tr' ? ' open' : ''}><summary>→ ${esc(variant)}</summary><table><tr><th>#</th><th>Kaynak</th>${cols.map((m) => `<th>${esc(m.label)}</th>`).join('')}</tr>
${v.texts.map((s, i) => `<tr><td class="num">${i + 1}</td><td class="src">${esc(s)}</td>${cols.map((m) => `<td>${esc(results[m.id].out[variant][v.v][i])}</td>`).join('')}</tr>`).join('')}</table></details>`;
    }
  }
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, html);
  console.log(`report: ${OUT}`);
  console.log(`total: ${models.reduce((s, m) => s + results[m.id].usd, 0).toFixed(3)} $`);
}
main().catch((e) => { console.error(e?.code ?? e?.message ?? e); process.exit(1); });
