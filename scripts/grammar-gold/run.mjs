// End-to-end gold-set evaluation of today's rules (`npm run grammar:eval`):
// parses the gold sentences with spaCy, bundles src/lib/read/grammar.ts and scores basic and hard separately.
// usage: node scripts/grammar-gold/run.mjs [--size=md|lg] [--diff]
// Python: NLP_PYTHON (as for the server), else ./pyenv/bin/python, else python3. spaCy needs nl_core_news_<size>
// and en_core_web_md; a model installed elsewhere can be added with PYTHONPATH.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
for (const level of ['basic', 'hard']) {
  console.log(`\n== ${level} (spaCy ${size})`);
  process.stdout.write(run(process.execPath, [at('scripts/grammar-gold/eval.mjs'), bundle, at('tests/grammar-gold'), parsed, `--level=${level}`, ...diff]));
}
