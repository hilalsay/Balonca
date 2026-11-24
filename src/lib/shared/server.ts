/**
 * The browser code the server needs too, so both read subtitles and cut texts into sentences the same way.
 * scripts/build-shared.mjs bundles this file into server/gen/shared.mjs (not committed; `npm test` and
 * `npm run build` make it).
 */
export { parseSubtitles } from '../subtitles/parsers';
export { splitText, allSentences, sentencesOf } from '../read/text';
