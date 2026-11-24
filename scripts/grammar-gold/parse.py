"""Parses the gold sentences the way server/nlp.py does and writes the tokens as JSON.
usage: parse.py <gold dir> <model suffix: md|lg> <out.json>"""
import json, sys, spacy

gold, size, out = sys.argv[1], sys.argv[2], sys.argv[3]
models = {'nl': f'nl_core_news_{size}', 'en': f'en_core_web_{"md" if size == "md" else "md"}'}
res = {}
for lang in ('nl', 'en'):
    nlp = spacy.load(models[lang], exclude=['ner'])
    recs = [json.loads(l) for l in open(f'{gold}/{lang}.jsonl', encoding='utf-8')]
    for r, doc in zip(recs, nlp.pipe([r['text'] for r in recs])):
        res[r['id']] = [{'t': w.text, 'ws': bool(w.whitespace_), 'pos': w.pos_, 'dep': w.dep_, 'head': w.head.i,
                         'lemma': w.lemma_, 'morph': str(w.morph), 'idx': w.idx} for w in doc]
json.dump(res, open(out, 'w'), ensure_ascii=False)
print('parsed', len(res))
