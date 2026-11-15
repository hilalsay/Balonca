import type { RemoteTrack } from './filter';

/** "nl-orig" / "pt-BR" -> "nl" / "pt": the code word bags and our language list use. */
export const baseLang = (code: string) => code.replace(/-orig$/i, '').split('-')[0].toLowerCase();

/**
 * The best subtitle to learn from: the spoken language (YouTube's "-orig" auto-caption tells us which one it is),
 * preferring a hand-made track in that language over the automatic one. Without auto-captions, the first
 * hand-made track. YouTube's machine translations are never picked (scripts get HTTP 429 for them anyway).
 */
export function pickSource(tracks: RemoteTrack[]): RemoteTrack | null {
  const orig = tracks.find((t) => t.kind === 'auto');
  if (orig) {
    const spoken = baseLang(orig.code);
    return tracks.find((t) => t.kind === 'manual' && baseLang(t.code) === spoken) ?? orig;
  }
  return tracks.find((t) => t.kind === 'manual') ?? null;
}

/** A hand-made YouTube subtitle in `lang`, which beats a machine translation. */
export const pickManual = (tracks: RemoteTrack[], lang: string) =>
  tracks.find((t) => t.kind === 'manual' && baseLang(t.code) === lang) ?? null;
