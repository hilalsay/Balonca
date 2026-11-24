export type Route = 'home' | 'watch' | 'read' | 'words' | 'help' | 'settings' | 'login' | 'invite' | 'reset' | 'admin' | 'notfound';
// Address segment -> route. Sign-in pages have Turkish addresses because they are shared as links.
const SEGMENTS: Record<string, Route> = {
  home: 'home', watch: 'watch', read: 'read', words: 'words', help: 'help', ayarlar: 'settings', giris: 'login', davet: 'invite', sifre: 'reset', admin: 'admin',
};
/** Pages someone who is not signed in may see. */
export const PUBLIC_ROUTES: Route[] = ['login', 'invite', 'reset'];

function parse() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const [seg = '', rest = ''] = path.split('/');
  return {
    route: (SEGMENTS[seg || 'home'] ?? 'notfound') as Route,
    params: new URLSearchParams(query),
    /** The part after the first segment: the code of an invite link, the token of a reset link. */
    rest: decodeURIComponent(rest),
  };
}

export const router = $state(parse());

addEventListener('hashchange', () => {
  const next = parse();
  if (next.route !== router.route) scrollTo(0, 0);
  router.route = next.route;
  router.params = next.params;
  router.rest = next.rest;
});

export const watchUrl = (id: string, t = 0) => `#/watch?v=${id}${t ? `&t=${Math.max(0, Math.floor(t))}` : ''}`;

/** A text in the reading mode, optionally at sentence `s`; without an id, the list of texts. */
export const readUrl = (id?: string, s?: number) => (id ? `#/read?id=${encodeURIComponent(id)}${s ? `&s=${s}` : ''}` : '#/read');
