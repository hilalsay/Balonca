// End-to-end gold-set evaluation of today's rules (`npm run grammar:eval`):
// parses the gold sentences with spaCy, bundles src/lib/read/grammar.ts and scores basic and hard separately.
// usage: node scripts/grammar-gold/run.mjs [--size=md|lg] [--diff] [--dict]
// --dict: also score with what the phase 3b dictionary adds on the server (markFromDictionary), read from BALONCA_DB
// (default ../balonca-api/data/balonca.db). Its numbers change while the dictionary grows; the entry count is printed.
// Python: NLP_PYTHON (as for the server), else ./pyenv/bin/python, else python3. spaCy needs nl_core_news_<size>
// and en_core_web_md; a model installed elsewhere can be added with PYTHONPATH.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../..', import.meta.url));
const at = (p) => `${root}${p}`;
const size = process.argv.find((a) => a.startsWith('--size='))?.slice(7) ?? 'md';
const diff = process.argv.includes('--diff') ? ['--diff'] : [];
const python = process.env.NLP_PYTHON ?? (existsSync(at('pyenv/bin/python')) ? at('pyenv/bin/python') : 'python3');
const out = at('.cache/grammar-eval');
mkdirSync(out, { recursive: true });
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });

// Versions first: a different spaCy or model version is the usual reason for numbers that differ from the README.
console.log(run(python, ['-c', `import spacy, importlib.metadata as m
print('spaCy', spacy.__version__, '|', ', '.join(f"{n} {m.version(n)}" for n in ('nl_core_news_${size}', 'en_core_web_md')))`]).trim());
const parsed = `${out}/parsed-${size}.json`;
run(python, [at('scripts/grammar-gold/parse.py'), at('tests/grammar-gold'), size, parsed]);
const bundle = `${out}/grammar.mjs`;
await build({ entryPoints: [at('src/lib/read/grammar.ts')], bundle: true, format: 'esm', platform: 'node', outfile: bundle, logLevel: 'warning' });
const runs = [['', parsed]];
if (process.argv.includes('--dict')) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(process.env.BALONCA_DB ?? at('../balonca-api/data/balonca.db'), { readOnly: true });
  const get = db.prepare('SELECT lemma, data FROM dictionary WHERE lang = ? AND form = ?');
  const counts = db.prepare('SELECT lang, COUNT(*) n FROM dictionary GROUP BY lang').all().map((r) => `${r.lang} ${r.n}`).join(', ');
  const { markFromDictionary } = await import(pathToFileURL(bundle).href);
  const docs = JSON.parse(readFileSync(parsed, 'utf8'));
  const lookup = (lang) => (form) => { const r = get.get(lang, form); return r ? { lemma: r.lemma, ...JSON.parse(r.data) } : null; };
  for (const id of Object.keys(docs)) docs[id] = markFromDictionary(docs[id], id.split('-')[0], lookup(id.split('-')[0]));
  writeFileSync(`${out}/parsed-${size}-dict.json`, JSON.stringify(docs));
  runs.push([` + dictionary (${counts || 'empty'})`, `${out}/parsed-${size}-dict.json`]);
}
for (const [label, file] of runs) {
  for (const level of ['basic', 'hard']) {
    console.log(`\n== ${level} (spaCy ${size}${label})`);
    process.stdout.write(run(process.execPath, [at('scripts/grammar-gold/eval.mjs'), bundle, at('tests/grammar-gold'), file, `--level=${level}`, ...diff]));
  }
}
