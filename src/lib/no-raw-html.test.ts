import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/** Every .svelte / .ts file under src (tests aside). */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(svelte|ts)$/.test(f) && !/\.test\.ts$/.test(f) ? [p] : [];
  });
}

// Model answers, subtitles and texts are shown as text only: a translation that sneaks in markup stays visible
// markup, never a link or a script (phase 2). Raw HTML insertion is not allowed anywhere in the app.
describe('no raw HTML', () => {
  it('uses neither {@html} nor innerHTML-style insertion', () => {
    const bad = files(path.resolve(__dirname, '..'))
      .filter((f) => /\{@html|\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write\(/.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });
});
