import { describe, expect, it } from 'vitest';
import { allSentences, cutLong, guessLang, splitText, titleFrom } from './text';

describe('splitText', () => {
  it('numbers sentences through paragraphs', () => {
    const p = splitText('Ik heet Sam. Ik woon in Gent!\n\nWaar woon jij? Ik weet het niet.', 'nl');
    expect(p.map((x) => x.sentences.map((s) => `${s.i}:${s.text}`))).toEqual([
      ['0:Ik heet Sam.', '1:Ik woon in Gent!'], ['2:Waar woon jij?', '3:Ik weet het niet.'],
    ]);
  });
  it('keeps short lines apart (dialogue) and joins lines broken by a PDF', () => {
    expect(splitText('– Hallo!\n– Dag Sam.', 'nl')).toHaveLength(2);
    const pdf = 'Dit is een hele lange regel uit een pdf die zomaar halverwege\nde zin afbreekt omdat de pagina smal was en zo verder gaat.';
    expect(allSentences(splitText(pdf, 'nl'))).toHaveLength(1);
  });
  it('cuts very long sentences at a comma', () => {
    const long = `${'woord '.repeat(60)}, ${'ander '.repeat(40)}einde.`;
    const parts = cutLong(long.replace(/\s+/g, ' '), 300);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((x) => x.length <= 300)).toBe(true);
  });
  it('ignores empty input', () => {
    expect(splitText('  \n\n ', 'nl')).toEqual([]);
  });
});

describe('guessLang', () => {
  it('recognises common languages', () => {
    expect(guessLang('Het is een mooie dag en ik ga met de fiets naar het werk, maar het regent wel.')).toBe('nl');
    expect(guessLang('It is a nice day and I am going to work by bike, but it is raining.')).toBe('en');
    expect(guessLang('Es ist ein schöner Tag und ich fahre mit dem Fahrrad zur Arbeit, aber es regnet.')).toBe('de');
    expect(guessLang("C'est une belle journée et je vais au travail à vélo, mais il pleut.")).toBe('fr');
    expect(guessLang('Es un día bonito y voy al trabajo en bicicleta, pero está lloviendo.')).toBe('es');
    expect(guessLang('Bugün hava çok güzel ve ben bisikletle işe gidiyorum ama yağmur yağıyor.')).toBe('tr');
  });
  it('says nothing when unsure', () => {
    expect(guessLang('ok')).toBe('');
    expect(guessLang('123 456')).toBe('');
  });
});

it('titleFrom shortens the first line', () => {
  expect(titleFrom('Een dag aan zee\nHet was warm.')).toBe('Een dag aan zee');
  expect(titleFrom('a'.repeat(30) + ' ' + 'b'.repeat(50)).endsWith('…')).toBe(true);
});
