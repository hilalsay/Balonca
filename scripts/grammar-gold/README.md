# Gold set tools

- `build.py`: the gold set in compact notation; `python3 build.py tests/grammar-gold` rewrites the JSONL files
  and checks structure and coverage. Edit either this file or the JSONL directly, but not both.
- `parse.py`: parses the gold sentences with spaCy, like `server/nlp.py` (`parse.py tests/grammar-gold md out.json`).
- `eval.mjs`: scores today's rules against the gold set. Bundle the rules first:
  `npx esbuild src/lib/read/grammar.ts --bundle --format=esm --platform=node --outfile=/tmp/grammar.mjs`,
  then `node eval.mjs /tmp/grammar.mjs tests/grammar-gold out.json [--level=basic|hard] [--diff]`.

These are a starting point for `scripts/grammar-eval.mjs` in grammar-llm.md, which should add the model
engine and the cost/latency columns.

End to end: `npm run grammar:eval [-- --diff] [-- --size=lg] [-- --dict]` (`run.mjs`) prints the spaCy/model versions, parses,
bundles and scores basic and hard separately. Python comes from `NLP_PYTHON`, else `./pyenv/bin/python`, else `python3`;
it needs `nl_core_news_md` and `en_core_web_md` (add a model installed elsewhere with `PYTHONPATH`).

Review by a person (see "Reviewing" in tests/grammar-gold/README.md):
- `review.mjs` writes `tests/grammar-gold/review.csv` (id, level, sentence, parts as `text [role]` joined with ` | `,
  notes, mustNot, Turkish translation, OK?, comment). Opens in a spreadsheet program; save it again as CSV.
- `apply-review.mjs <filled.csv> --reviewer=<name> [--dry-run]` sets `checked_by` on rows marked OK (ok/yes/evet)
  that have no comment and no edited cell. Rows with a comment, an edit or a "no" are only listed (and written to
  `<filled.csv>.to-resolve.md`); nothing in them is applied automatically.
- Once a record is reviewed, the JSONL is the source: `build.py` refuses to rebuild (it would reset `checked_by`)
  unless given `--force`.
`--dict` scores a second time with what the server adds from the phase 3b dictionary (verb lemmas, separable
particles), read from `BALONCA_DB`; those numbers move while the dictionary grows, so the entry count is printed.
