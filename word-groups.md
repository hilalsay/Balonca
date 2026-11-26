# Word groups: meanings of words that belong together

Spec for Claude Code. The rules in `plan.md` still apply: never print or commit secrets, ask before running
server commands, keep commit messages neutral, and send each phase as its own PR.

## Problem

Some words mean something else in a group than alone:

- Split (separable) verbs: *Ik **bel** je morgen **op*** = "I'll call you", not "ring + up".
- Fixed expressions: *in de gaten houden* (göz kulak olmak), *op tijd* (zamanında), *give up*, *look forward to*.
- Verbs with a fixed preposition or *zich*: *wachten op*, *zich vergissen*.
- Idioms: *het regent pijpenstelen* (bardaktan boşanırcasına yağıyor).

Today a tap gives the meaning of one word (in its sentence). The learner cannot ask for the group.

## What the user sees

1. **Found automatically.** When a tapped word belongs to a known group, the word card shows a line on top:
   "Part of **opbellen** (bel … op): aramak". The group's words get a light underline; tapping the line
   opens the group's meaning.
2. **Picked by hand.** The card gets a "Select words" button: the words of the sentence become toggles, the
   learner taps the words of the group and then "Translate". Words need not be next to each other (*bel … op*).
   Tap only, no dragging. 2–6 words, all from the same sentence.
3. **The answer** has the same layout as a word card: the group's dictionary form (*in de gaten houden*), its
   meaning in this sentence, and whether it is a fixed expression or simply the words' own meanings together.
   The model must say so instead of inventing an idiom.
4. **Saving.** Groups can be saved to the word bag and come up in review like words; a saved group is underlined
   wherever it appears.

## Where groups come from (cheapest first)

1. **The grammar parse** (free, already running): spaCy marks split particles (`compound:prt`) and *zich*
   verbs, and the phase 3b dictionary confirms separable verbs (`markFromDictionary`). The word dictionary
   already has *opbellen*, *terugbellen*, *dichtdoen* with their Turkish meanings.
2. **A phrase dictionary from Wiktionary** (free): the Dutch extract has 12,009 multi-word entries (about 7,000
   verbs, mostly split verb forms such as *roept op* → *oproepen*; 1,900 nouns; 640 phrases and
   prepositional phrases). The English extract has many more. Matched against the sentence by lemma, with
   gaps allowed, so *houd hem in de gaten* matches *in de gaten houden*. Guard against false hits: a two-word
   phrase of very common words is shown only when the parse confirms it (a particle, a fixed preposition).
3. **Turkish meanings for those phrases**, generated once with Inkling before the credit ends (10 December),
   like the word dictionary: a pilot on a database copy first, then the full run. Budget: at most $10.
4. **The model** for groups no dictionary has: Inkling with the sentence; after 10 December gemma3, labelled
   as a guess (as word meanings are).

## Server

- `/api/define` gets a group mode: `{ words: [...], positions, lang, to, ref, ctx }`. Every word must match the
  word pattern, the group must occur in the sentence in that order, and the sentence must be found in the
  named source (phase 2: no free text).
- Cache by group, sentence, language and model; shared for videos and the sample texts, per user for the user's
  own texts.
- The same per-user limits as word lookups, plus a daily cap on model-answered groups.
- The `dictionary` table holds phrases too (form = the phrase in lower case, `kind: "phrase"`). Single-word
  lookups never match a form with a space, so phrase rows change nothing until a phase uses them.
- Saved groups use `SavedWord` with optional `kind: "phrase"` and `parts`, so sync and older clients keep working.

## Evaluation

A small gold set like the grammar one: about 60 Dutch and 30 English sentences with groups, plus traps that
look like groups but are not (*op* in *op de tafel*; *houden van* is a group, *houden … op* is not). It measures
how well groups are found (precision and recall) and whether the meanings are right; a person reviews it with the
same CSV sheet.

## Phases (one PR each)

| # | What | Model cost | Needs the credit |
|---|---|---|---|
| 3 (first) | Turkish meanings for the Wiktionary phrases (pilot on a copy, then the full run) | ≤ $10 | yes, before 10 Dec |
| 1 | Groups from the parse (split and *zich* verbs) in the word card, meaning from the existing dictionary | $0 | no |
| 2 | Import the Wiktionary phrases (nl, en) and match them by lemma, with gaps | $0 | no |
| 4 | "Select words" and the group mode of `/api/define` | per use | Inkling until 10 Dec, then gemma3 |
| 5 | Save groups, review them, underline them | $0 | no |
| 6 | Gold set and evaluation | about $1 | the model part |

Decisions (26 Nov): 2–6 words from one sentence; up to $10 for phase 3; English: the common phrases only (words
all in the 20k frequency list); saved groups count together with words.
