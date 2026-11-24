import { describe, expect, it } from 'vitest';
import { safeOutput } from './guard.mjs';

describe('safeOutput', () => {
  it('lets ordinary translations through', () => {
    expect(safeOutput('Ik graaf naar een verborgen schat.', 'Gizli bir hazine için kazıyorum.')).toBe(true);
    expect(safeOutput('Ga naar www.balonca.nl voor meer.', 'Daha fazlası için www.balonca.nl adresine git.')).toBe(true);
  });
  it('drops answers that are far too long', () => {
    expect(safeOutput('Hallo.', 'x'.repeat(59))).toBe(false);
    expect(safeOutput('Hallo.', 'x'.repeat(58))).toBe(true);
  });
  it('drops links, e-mail addresses and markup the source did not have', () => {
    expect(safeOutput('Klik hier om verder te gaan en meer te lezen.', 'Devam etmek için https://evil.example/x tıkla.')).toBe(false);
    expect(safeOutput('Klik hier om verder te gaan en meer te lezen.', 'Devam için evil.com adresine git.')).toBe(false);
    expect(safeOutput('Stuur een bericht naar ons team vandaag nog.', 'Bugün ekibimize a@b.co yaz.')).toBe(false);
    expect(safeOutput('Dit is een gewone zin over het weer vandaag.', 'Hava <img src=x onerror=alert(1)> güzel.')).toBe(false);
    expect(safeOutput('Dit is een gewone zin over het weer vandaag.', 'Bak [buraya](http://x.y) bugün.')).toBe(false);
  });
});
