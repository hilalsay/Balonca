"""Balonca language worker: sentence parsing (spaCy) and speech (Piper), driven by server/nlp.mjs.

One JSON request per line on stdin, one JSON answer per line on stdout:
  {"id": 1, "op": "info"}                                   -> {"id": 1, "ok": true, "parse": ["nl", ...], "tts": ["nl", ...]}
  {"id": 2, "op": "parse", "lang": "nl", "sents": ["..."]}  -> {"id": 2, "ok": true, "docs": [[token, ...], ...]}
  {"id": 3, "op": "tts", "lang": "nl", "text": "...", "out": "/path/x.wav"} -> {"id": 3, "ok": true}
A token is {"t": text, "ws": trailing space?, "pos", "dep", "head" (index in its sentence), "lemma", "morph"}.

Usage: python nlp.py [parse|tts]  (the role only decides what is loaded up front; every op works in both).
Models are loaded on first use and kept. Environment: VOICES_DIR (Piper .onnx voices, named like nl_NL-x-medium.onnx),
NLP_PRELOAD (comma-separated languages to load at start, default "nl").
"""
import glob
import json
import os
import sys
import wave

# Grammar models per language (spaCy pipelines with a dependency parser), best first.
SPACY = {
    'nl': ['nl_core_news_md', 'nl_core_news_sm'],
    'en': ['en_core_web_md', 'en_core_web_sm'],
    'de': ['de_core_news_md', 'de_core_news_sm'],
    'fr': ['fr_core_news_md', 'fr_core_news_sm'],
    'es': ['es_core_news_md', 'es_core_news_sm'],
    'it': ['it_core_news_md', 'it_core_news_sm'],
    'pt': ['pt_core_news_md', 'pt_core_news_sm'],
}
VOICES_DIR = os.environ.get('VOICES_DIR') or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'voices')

_parsers = {}
_voices = {}


def _installed(pkg):
    try:
        import importlib.util
        return importlib.util.find_spec(pkg) is not None
    except Exception:
        return False


def parse_langs():
    return sorted(l for l, pkgs in SPACY.items() if any(_installed(p) for p in pkgs))


def voice_files():
    out = {}
    for f in sorted(glob.glob(os.path.join(VOICES_DIR, '*.onnx'))):
        lang = os.path.basename(f).split('_')[0].lower()
        if os.path.exists(f + '.json'):
            out.setdefault(lang, f)
    return out


def parser(lang):
    if lang not in _parsers:
        import spacy
        pkg = next((p for p in SPACY.get(lang, []) if _installed(p)), None)
        if not pkg:
            raise LookupError('unsupported-lang')
        # Only what grammar needs: no named entities.
        _parsers[lang] = spacy.load(pkg, exclude=['ner'])
    return _parsers[lang]


def voice(lang):
    if lang not in _voices:
        f = voice_files().get(lang)
        if not f:
            raise LookupError('unsupported-lang')
        from piper import PiperVoice
        _voices[lang] = PiperVoice.load(f)
    return _voices[lang]


def do_parse(req):
    nlp = parser(req['lang'])
    docs = []
    for doc in nlp.pipe([str(s)[:600] for s in req['sents']]):
        docs.append([{
            't': w.text, 'ws': bool(w.whitespace_), 'pos': w.pos_, 'dep': w.dep_, 'head': w.head.i,
            'lemma': w.lemma_, 'morph': str(w.morph),
        } for w in doc])
    return {'docs': docs}


def do_tts(req):
    v = voice(req['lang'])
    out = req['out']
    tmp = out + '.part'
    with wave.open(tmp, 'wb') as w:
        v.synthesize_wav(str(req['text'])[:600], w)
    os.replace(tmp, out)
    return {}


def handle(req):
    op = req.get('op')
    if op == 'info':
        return {'parse': parse_langs(), 'tts': sorted(voice_files())}
    if op == 'parse':
        return do_parse(req)
    if op == 'tts':
        return do_tts(req)
    raise ValueError('bad-op')


def main():
    role = sys.argv[1] if len(sys.argv) > 1 else 'parse'
    for lang in filter(None, os.environ.get('NLP_PRELOAD', 'nl').split(',')):
        try:
            (parser if role == 'parse' else voice)(lang.strip())
        except Exception:
            pass
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        rid = None
        try:
            req = json.loads(line)
            rid = req.get('id')
            ans = {'id': rid, 'ok': True, **handle(req)}
        except LookupError as e:
            ans = {'id': rid, 'ok': False, 'error': str(e).strip("'")}
        except Exception as e:  # one bad request never stops the worker
            ans = {'id': rid, 'ok': False, 'error': 'failed', 'detail': repr(e)[:300]}
        sys.stdout.write(json.dumps(ans, ensure_ascii=False) + '\n')
        sys.stdout.flush()


if __name__ == '__main__':
    main()
