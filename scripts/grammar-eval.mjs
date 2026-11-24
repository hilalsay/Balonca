// Compares grammar engines on the gold set (grammar-llm.md, "Evaluation"): spaCy md / lg / en trf with the rules, and
// the model (Inkling) with the prompt of src/lib/read/grammar-model.ts, falling back to spaCy md + rules whenever an
// answer fails validation, exactly as the server does. One table, per language and level.
//
//   node scripts/grammar-eval.mjs [--only=md,lg,trf,model] [--fresh] [--diff=<approach>] [--limit=N]
//
// Python: NLP_PYTHON (else ./pyenv/bin/python, else python3) for md/lg; TRF_PYTHON for en_core_web_trf (needs
// spacy-curated-transformers, so usually its own venv). Models installed elsewhere: PYTHONPATH.
// The model: TINKER_API_KEY (read from BALONCA_ENV_FILE, default /etc/balonca.env; never printed). Answers are kept in
// .cache/grammar-eval/model-answers.json by prompt version, model and sentence, so a rerun costs nothing (--fresh asks
// again). Spending goes to scripts/credit/out/usage/grammar-eval, apart from the live site's budget.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createLlm, TINKER_DEFAULT_URL } from '../server/llm/index.mjs';
import { newTally, pct, scoreOne } from './grammar-gold/score.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const at = (p) => `${root}${p}`;
const opt = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const only = (opt('only') ?? 'md,lg,trf,model').split(',');
const limit = Number(opt('limit') ?? 0);
const out = at('.cache/grammar-eval');
mkdirSync(out, { recursive: true });

// The rules and the model module, bundled for Node.
const bundle = `${out}/engines.mjs`;
await build({ stdin: { contents: "export * from './grammar'; export * from './grammar-model';", resolveDir: at('src/lib/read'), loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: bundle, logLevel: 'warning' });
const E = await import(`${pathToFileURL(bundle).href}?${Date.now()}`);

let gold = ['nl', 'en'].flatMap((l) => readFileSync(at(`tests/grammar-gold/${l}.jsonl`), 'utf8').trim().split('\n').map((x) => JSON.parse(x)));
if (limit) gold = [...gold.filter((r) => r.lang === 'nl').slice(0, limit), ...gold.filter((r) => r.lang === 'en').slice(0, limit)];

const python = process.env.NLP_PYTHON ?? (existsSync(at('pyenv/bin/python')) ? at('pyenv/bin/python') : 'python3');
function parse(name, py, specs) {
  const file = `${out}/timed-${name}.json`;
  execFileSync(py, [at('scripts/grammar-gold/parse_timed.py'), at('tests/grammar-gold'), file, ...specs], { stdio: ['ignore', 'inherit', 'inherit'] });
  return JSON.parse(readFileSync(file, 'utf8'));
}
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN; };
const strip = (toks) => toks.map(({ idx, ...t }) => t);

/** results[approach][lang|level] = { tally, ms: [], usd: [], rejects, asked } */
const results = {};
const group = (name, r) => ((results[name] ??= {})[`${r.lang}|${r.level}`] ??= { tally: newTally(), ms: [], usd: [], rejects: 0, asked: 0, diffs: [] });

function runRules(name, parsed, langs) {
  for (const r of gold) {
    if (!langs.includes(r.lang) || !parsed[r.id]) continue;
    const { toks, ms } = parsed[r.id];
    const t0 = performance.now();
    const a = E.analyze(strip(toks), r.lang);
    const g = group(name, r);
    g.ms.push(ms + performance.now() - t0); g.usd.push(0);
    const d = scoreOne(g.tally, r, toks, a);
    if (d) g.diffs.push(d);
  }
}

const md = parse('md', python, ['nl=nl_core_news_md', 'en=en_core_web_md']);
if (only.includes('md')) runRules('spaCy md + rules', md, ['nl', 'en']);
if (only.includes('lg')) runRules('spaCy lg + rules', parse('lg', python, ['nl=nl_core_news_lg', 'en=en_core_web_lg']), ['nl', 'en']);
if (only.includes('trf')) {
  if (process.env.TRF_PYTHON) runRules('spaCy en trf + rules', parse('trf', process.env.TRF_PYTHON, ['en=en_core_web_trf']), ['en']);
  else console.error('trf skipped: set TRF_PYTHON to a Python with spacy-curated-transformers and en_core_web_trf');
}

if (only.includes('model')) {
  try { process.loadEnvFile(process.env.BALONCA_ENV_FILE ?? '/etc/balonca.env'); } catch {}
  const model = process.env.TINKER_MODEL || 'thinkingmachines/Inkling';
  const priceIn = Number(process.env.LLM_PRICE_IN ?? 1.87), priceOut = Number(process.env.LLM_PRICE_OUT ?? 4.68);
  const cacheFile = `${out}/model-answers.json`;
  const cache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : {};
  const key = (r) => `${E.promptId(r.lang, 'tr')}|${model}|${r.lang}|${r.text}`;
  // The dictionary the server uses for rule 4 (read only; empty when there is none).
  let dictFor = () => undefined;
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(process.env.BALONCA_DB ?? at('../balonca-api/data/balonca.db'), { readOnly: true });
    const q = db.prepare('SELECT data FROM dictionary WHERE lang = ? AND form = ?');
    dictFor = (lang) => (form) => { const x = q.get(lang, form); return x ? JSON.parse(x.data) : undefined; };
  } catch {}
  const todo = gold.filter((r) => process.argv.includes('--fresh') || !cache[key(r)]?.raw);
  if (todo.length && !process.env.TINKER_API_KEY) throw new Error('TINKER_API_KEY not set');
  // One model client per worker, so each call's usage can be read back.
  const worker = async () => {
    let usage = null;
    const fetchImpl = async (url, init) => { const res = await fetch(url, init); usage = (await res.clone().json().catch(() => null))?.usage ?? null; return res; };
    const llm = createLlm({ provider: 'tinker', fallback: 'off', concurrency: 1, priceIn, priceOut, usageDir: at('scripts/credit/out/usage/grammar-eval'),
      tinker: { url: process.env.TINKER_BASE_URL || TINKER_DEFAULT_URL, key: process.env.TINKER_API_KEY ?? '', model }, ollama: { model: 'unused', chat: null } }, { fetchImpl });
    while (todo.length) {
      const r = todo.shift();
      const t0 = performance.now();
      let raw = null, err = '';
      try {
        const res = await llm.chat('', { model, format: E.GRAMMAR_SCHEMA, options: { temperature: 0, num_predict: 1400 },
          messages: [{ role: 'system', content: E.systemPrompt(r.lang, 'tr') }, { role: 'user', content: E.userMessage(r.text) }] }, {}, 'grammar');
        raw = JSON.parse(res.content);
      } catch (e) { err = e?.code ?? e?.message ?? 'error'; }
      const ms = performance.now() - t0;
      const u = usage ?? {};
      const inTok = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
      cache[key(r)] = { raw, err, ms: Math.round(ms), usd: (inTok * priceIn + (u.output_tokens ?? 0) * priceOut) / 1e6,
        tokens: { input: inTok, cached: u.cache_read_input_tokens ?? 0, output: u.output_tokens ?? 0 } };
      process.stderr.write('.');
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, todo.length) }, worker));
  if (todo.length === 0) writeFileSync(cacheFile, JSON.stringify(cache));
  process.stderr.write('\n');

  const name = `${model.split('/').pop()} + prompt (fallback: spaCy md)`;
  const reasons = {};
  for (const r of gold) {
    const c = cache[key(r)];
    if (!c || !md[r.id]) continue;
    const g = group(name, r);
    g.asked++; g.ms.push(c.ms); g.usd.push(c.usd);
    const v = c.raw ? E.validateAnswer(c.raw, r.text, dictFor(r.lang)) : { ok: false, reason: c.err ? 'error' : 'shape' };
    const toks = md[r.id].toks;
    let a;
    if (v.ok) a = E.toAnalysis(v.answer, strip(toks), r.lang);
    else { g.rejects++; reasons[v.reason] = (reasons[v.reason] ?? 0) + 1; a = E.analyze(strip(toks), r.lang); }
    const d = scoreOne(g.tally, r, toks, a);
    if (d) g.diffs.push({ ...d, ...(v.ok ? {} : { rejected: v.reason }), ...(v.ok && v.answer.nuance ? { nuance: v.answer.nuance } : {}) });
  }
  if (Object.keys(reasons).length) console.log(`model rejects by reason: ${JSON.stringify(reasons)}`);
}

// The table.
const rows = [];
console.log('\n| Approach | Lang | Level | Sentences | Part accuracy | Note precision | Note recall | `mustNot` violations | Validation rejects | Cost / sentence | Median latency |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
for (const [name, groups] of Object.entries(results)) {
  for (const lang of ['nl', 'en']) for (const level of ['basic', 'hard']) {
    const g = groups[`${lang}|${level}`];
    if (!g) continue;
    const t = g.tally, usd = g.usd.reduce((a, b) => a + b, 0) / (g.usd.length || 1);
    const row = { name, lang, level, n: t.sentences, role: t.words ? (100 * t.roleOk) / t.words : 0, prec: t.tp + t.fp ? (100 * t.tp) / (t.tp + t.fp) : 100,
      rec: t.tp + t.fn ? (100 * t.tp) / (t.tp + t.fn) : 100, mustNot: t.mustNot, rejects: g.asked ? g.rejects : null, usd, ms: median(g.ms) };
    rows.push(row);
    console.log(`| ${name} | ${lang} | ${level} | ${t.sentences} | ${pct(t.roleOk, t.words)} | ${pct(t.tp, t.tp + t.fp)} | ${pct(t.tp, t.tp + t.fn)} | ${t.mustNot} | ${g.asked ? `${g.rejects} / ${g.asked}` : '—'} | ${usd ? `$${usd.toFixed(4)}` : '$0'} | ${g.ms.length ? `${Math.round(row.ms)} ms` : '—'} |`);
  }
}
writeFileSync(`${out}/results.json`, JSON.stringify(rows, null, 1));

const showDiff = opt('diff');
if (showDiff) for (const [name, groups] of Object.entries(results)) {
  if (!name.toLowerCase().includes(showDiff.toLowerCase())) continue;
  for (const g of Object.values(groups)) for (const d of g.diffs) {
    console.log(`\n${d.id} ${d.text}${d.rejected ? `  [REJECTED: ${d.rejected}]` : ''}\n  roles: ${d.wrong.join('; ') || 'ok'}\n  missing: ${d.missing.join(' ') || '-'}\n  extra: ${d.extra.join(' ') || '-'}${d.forbidden.length ? `\n  FORBIDDEN: ${d.forbidden.join(' ')}` : ''}${d.nuance ? `\n  nuance: ${d.nuance}` : ''}`);
  }
}
