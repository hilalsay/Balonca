"""Parses the gold sentences one at a time and times each parse (for scripts/grammar-eval.mjs).
usage: parse_timed.py <gold dir> <out.json> <lang>=<model> [<lang>=<model> ...]
Writes {id: {"toks": [...], "ms": parse time}}; tokens as in parse.py."""
import json, sys, time, spacy

gold, out = sys.argv[1], sys.argv[2]
res = {}
for spec in sys.argv[3:]:
    lang, model = spec.split('=')
    nlp = spacy.load(model, exclude=['ner'])
    recs = [json.loads(l) for l in open(f'{gold}/{lang}.jsonl', encoding='utf-8')]
    nlp(recs[0]['text'])  # warm up
    for r in recs:
        t0 = time.perf_counter()
        doc = nlp(r['text'])
        ms = (time.perf_counter() - t0) * 1000
        res[r['id']] = {'ms': round(ms, 2), 'toks': [{'t': w.text, 'ws': bool(w.whitespace_), 'pos': w.pos_, 'dep': w.dep_, 'head': w.head.i,
                         'lemma': w.lemma_, 'morph': str(w.morph), 'idx': w.idx} for w in doc]}
    print(model, spacy.util.get_package_version(model), len(recs), file=sys.stderr)
json.dump(res, open(out, 'w'), ensure_ascii=False)
