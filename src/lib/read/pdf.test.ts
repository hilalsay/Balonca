import { expect, it } from 'vitest';
import { tidyPdfText } from './pdf';

it('joins words split over a line end and keeps pages apart', () => {
  expect(tidyPdfText(['Het is een  mooie woor-\nden lijst.\n', '  ', 'Tweede pagina. \n Regel.'])).toBe('Het is een mooie woorden lijst.\n\nTweede pagina.\nRegel.');
  expect(tidyPdfText(['Noord-\nZee'])).toBe('Noord-\nZee'); // a capital after the hyphen is a real compound
});
