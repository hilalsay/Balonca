// Checks on what a model wrote, before anyone sees it (phase 2, prompt injection): a translation or meaning is
// thrown away when it is far longer than its source, or brings links, e-mail addresses or markup the source did
// not have. Whatever text slipped instructions to the model, the answer cannot carry a link to the reader.
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s"'<>]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|ru|cn|tk|xyz|top|info|biz|me|co|ly|gg|app|link|click|site|online|shop)\b(?:\/[^\s"'<>]*)?/giu;
const EMAIL_RE = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
const MARKUP_RE = /<\/?[a-z][^>]*>|\]\(\s*\S|javascript:|data:[a-z]+\//i;

/** Whether `out`, written by a model from `src`, may be shown. */
export function safeOutput(src, out, { factor = 3, extra = 40 } = {}) {
  if (typeof out !== 'string') return false;
  const s = String(src ?? '');
  if (out.length > factor * s.length + extra) return false;
  const low = s.toLowerCase();
  for (const m of out.match(URL_RE) ?? []) if (!low.includes(m.toLowerCase())) return false;
  for (const m of out.match(EMAIL_RE) ?? []) if (!low.includes(m.toLowerCase())) return false;
  if (MARKUP_RE.test(out) && !MARKUP_RE.test(s)) return false;
  return true;
}
