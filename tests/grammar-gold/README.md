# Grammar gold set

Reference answers for the reading mode's grammar panel, used to measure and compare grammar engines
(see `grammar-llm.md`). One JSON object per line:

| File | Sentences | Basic | Hard |
|---|---|---|---|
| `nl.jsonl` | 111 | 91 | 20 |
| `en.jsonl` | 58 | 50 | 8 |

**Status: draft.** Every record has `"checked_by": "draft"`. A person who knows the language must review
each record and change it to their name (or `"teacher"`, `"native"`) before results on this set are
trusted. Until then, treat scores as indicative.

## Record format

```json
{
  "id": "nl-006",
  "lang": "nl",
  "text": "Hij staat elke ochtend om zes uur op.",
  "clauses": ["main"],
  "parts": [["Hij","subject",0],["staat","verb",0],["elke ochtend","adverbial",0],["om zes uur","adverbial",0],["op","verbPart",0]],
  "notes": ["tense:present", "separable:opstaan", "articles:de=ochtend|het=uur"],
  "mustNot": ["inversion", "bracket"],
  "optional": [],
  "translation_tr": "Her sabah saat altıda kalkıyor.",
  "level": "basic",
  "checked_by": "draft"
}
```

- `clauses`: clause kinds by id. Id 0 is always the main clause; the others are numbered in order of
  appearance. Kinds: `main`, `sub`, `relative`, `coord`.
- `parts`: `[text, role, clause id]`, in sentence order, punctuation left out. Joined together they rebuild
  the sentence.
- `notes`: what the panel should say. `mustNot`: notes that would be wrong here (a prefix such as `tense`
  or `tense:perfect` forbids every note starting with it). `optional`: notes that are acceptable either way,
  so they count neither as missing nor as wrong.
- `level`: `basic` (short, everyday sentences) or `hard` (longer sentences, nested clauses, known parser
  traps). Report the two separately: the basic set alone is too easy to separate good engines from great
  ones.

## Conventions

These follow the categories in `src/lib/read/grammar.ts`, decided by what a learner should be told, not by
what a parser happens to output.

**Roles**
- `verb`: the finite (conjugated) verb, including finite auxiliaries, modals and copulas.
- `verbPart`: non-finite verb forms (infinitive, participle), separable particles (`op` in *belt … op*),
  and `te`/`to` before an infinitive.
- `link`: conjunctions (`dat`, `of`, `omdat`, `als`, `toen`, `en`, `maar`, `want`, `when`, `if`, `because`)
  and `om` in *om … te*.
- Relative pronouns and question words take their role in their own clause (`die` → subject or object,
  `waar`/`waarom`/`where` → adverbial, `wat`/`what` → object or subject).
- Negation words (`niet`, `geen`, `nooit`, `not`, `n't`, `never`) are `negation`, except where they are the
  subject (`niemand`, `nobody` → subject).
- Reflexive pronouns of reflexive verbs (`zich`, `me`, `je`, `myself`) are `object`.
- Determiners, possessives, adjectives and prepositional modifiers belong to their noun's part. Degree words
  belong to the word they modify (`erg interessant`, `zo laat` → one complement).
- Prepositional phrases are `adverbial`, including prepositional objects (`naar de leraar`, `voor mijn
  broertje`). Exception: a predicate after a copula is a `complement` (`is van mijn broer`).
- `indirect` only for a bare indirect object next to a direct object (`geeft de hond een koekje`) or with
  verbs of telling and giving (`vertellen`, `uitleggen`, `tell`).

**Notes**
- `tense:<tense>[:<aux>]`: one per distinct tense in the sentence. Perfect tenses name the auxiliary
  (`tense:perfect:zijn`, `tense:pluperfect:have`). No tense note for the main clause of a command.
- `inversion`: main or coordinated clause where something other than the subject comes first and the
  subject follows the verb. Not for questions or commands.
- `bracket`: finite verb early (in second place, or first in a question), a non-finite verb form at the end,
  something in between (*Kun je het raam dichtdoen?* has one too).
  Separable particles and `te`-infinitives do not count (they have their own notes).
- `verbFinal`: subordinate or relative clause whose finite verb stands in the verb group at the end (*… dat ze
  morgen niet kan komen*, *… die ik heb gekocht* count too), with at least two words (not counting the
  conjunction) before that verb group.
- `separable:<infinitive>`: only when the particle is actually split off (`belt … op`), not for
  `opstaan`/`opgebeld` written as one word.
- `modal`: a modal verb with an infinitive (Dutch `kunnen`, `moeten`, `willen`, `mogen`, `hoeven`; English
  `can`, `could`, `must`, `should`, `may`, `might`). `zullen`/`will` and `zou`/`would` are tenses, not modals.
- `negation:<word>`: one note per sentence, named after the first negation word.
- `degree:cmp|sup`: comparative or superlative used as such (`vroeger` "formerly" is not).
- `articles:de=…|het=…` (Dutch only): every singular common noun with its article, lower case.
- `teInf`: `te`/`to` + infinitive, including `om … te` and English purpose infinitives.

## Baseline: today's spaCy pipeline

Measured on the draft set with today's rules (`src/lib/read/grammar.ts`):

| Engine | Level | Role accuracy | Note precision | Note recall | `mustNot` violations |
|---|---|---|---|---|---|
| spaCy `md` + rules | basic | 95.7% | 98.3% | 94.8% | 2 |
| spaCy `md` + rules | hard | 93.7% | 93.3% | 89.9% | 5 |
| spaCy `lg` + rules | basic | 95.5% | 97.4% | 93.7% | 2 |
| spaCy `lg` + rules | hard | 90.7% | 91.2% | 85.3% | 5 |

`lg` is not better than `md` on this set. The weakest notes today are `teInf` (English `to` is never
found), `separable` (particles such as `terug`, `dicht`, `mee` are missed), `reflexive` (Dutch `me`/`je`
are not marked as reflexive) and `imperative` (wrongly given to main clauses whose subject is a whole
clause).

## Reviewing

For each record, a reviewer checks four things and corrects the record where needed:
1. Is the sentence natural, correct Dutch or English?
2. Are the parts and their roles right under the conventions above?
3. Are the notes right, and is anything wrong in `mustNot` or missing from it?
4. Is the Turkish translation natural and correct?

When a record is reviewed, set `checked_by`. The sheet `review.csv` has a row per record for this (columns `OK?` and
`comment`); `scripts/grammar-gold/apply-review.mjs` reads it back (see scripts/grammar-gold/README.md). When the reviewer disagrees with a convention itself, change
the convention here first, then every affected record.
