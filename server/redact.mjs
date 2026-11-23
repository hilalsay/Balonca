// Every log line and error detail goes through redact(): no keys, tokens, cookies or e-mail names in logs.

const SECRET_FIELD = /(pass(word)?|token|secret|api[-_]?key|key|cookie|authorization)/i;
const SECRET_HEADER = new Set(['x-api-key', 'authorization', 'cookie', 'set-cookie', 'proxy-authorization']);
const PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{8,}/g, // Anthropic / OpenAI style keys
  /\bghp_[A-Za-z0-9]{20,}/g, /\bgh[ousr]_[A-Za-z0-9]{20,}/g, /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\btml-[A-Za-z0-9_-]{16,}/g, // Tinker-style keys
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /(https?:\/\/)[^/\s:@]+:[^/\s@]+@/g, // credentials in URLs
];
const EMAIL = /([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const MASK = '[redacted]';

/** A string, object or Error with secrets masked. Strings are also cut to `max` characters. */
export function redact(value, max = 500) {
  if (value == null) return value;
  if (value instanceof Error) return redact(`${value.name}: ${value.message}`, max);
  if (typeof value === 'string') {
    let s = value;
    for (const re of PATTERNS) s = s.replace(re, (m, a) => (typeof a === 'string' && a.startsWith('http') ? `${a}${MASK}@` : MASK));
    s = s.replace(EMAIL, (_, _name, domain) => `***@${domain}`);
    s = s.replace(/("?(?:pass(?:word)?|token|secret|api[-_]?key)"?\s*[:=]\s*)("[^"]*"|[^\s,;&}]+)/gi, `$1${MASK}`);
    return s.length > max ? `${s.slice(0, max)}…` : s;
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, max));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_HEADER.has(k.toLowerCase()) || SECRET_FIELD.test(k) ? MASK : redact(v, max);
    }
    return out;
  }
  return value;
}

/** The one way the server writes problems: timestamped and redacted. */
export function logError(...parts) {
  console.error(`[${new Date().toISOString()}]`, ...parts.map((p) => (typeof p === 'string' ? redact(p) : JSON.stringify(redact(p)))));
}
