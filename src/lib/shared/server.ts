/**
 * The browser code the server needs too, so both read subtitles and cut texts into sentences the same way
 * (and the server can mark separable verbs from its dictionary for the grammar rules).
 * scripts/build-shared.mjs bundles this file into server/gen/shared.mjs (not committed; `npm test` and
 * `npm run build` make it).
 */
export { parseSubtitles } from '../subtitles/parsers';
export { splitText, allSentences, sentencesOf } from '../read/text';
export { markFromDictionary } from '../read/grammar';
// Grammar by the model: prompt, schema and validation (server/grammar.mjs); the sample texts count as shared content.
export { GRAMMAR_SCHEMA, MODEL_LANGS, promptId, systemPrompt, userMessage, validateAnswer } from '../read/grammar-model';
export { SAMPLES } from '../read/samples';
