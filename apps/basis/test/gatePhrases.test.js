/**
 * The gate's words as phrase templates (Fable, ledger L174): a translator writes "zet {item} op (de|het)? {list}",
 * never a regular expression; ONE compiler turns a template into a test that hands back its slots. Slots are typed —
 * a list is one of the household's list words, a person one word, a day and a time what the date reader reads —
 * and everything else is literal words, small alternations and optional groups.
 */
import { describe, it, expect } from 'vitest';
import { compilePhrase } from '../src/v2/gatePhrases.js';

const slots = { list: ['boodschappen', 'klusjes', 'agenda'] };

describe('compilePhrase', () => {
  it('literal words, alternation, optional words, and typed slots', () => {
    const p = compilePhrase('(zet|noteer) {items} op (de|het)? {list}', slots);
    expect(p.match('zet melk op de boodschappen')).toEqual({ items: 'melk', list: 'boodschappen' });
    expect(p.match('Noteer melk en kaas op boodschappen!')).toEqual({ items: 'melk en kaas', list: 'boodschappen' });
    expect(p.match('zet melk op de schuur')).toBeNull();          // not a list word
    expect(p.match('zet de verwarming op 20')).toBeNull();
  });

  it('a list word may carry -lijst / -lijstje / list', () => {
    expect(compilePhrase('wat staat er op (de|het)? {list}', slots).match('wat staat er op de boodschappenlijst')).toEqual({ list: 'boodschappen' });
  });

  it('{person} is one word; {any} is anything (a gap); keeps the typed case', () => {
    expect(compilePhrase('nieuwe taak voor {person}: {text}', slots).match('nieuwe taak voor Bert: Vuilnis buiten')).toEqual({ person: 'Bert', text: 'Vuilnis buiten' });
    expect(compilePhrase('(wat|laat) {any} {list} {any}', slots).match('wat moet er nog op de klusjes')).toEqual({ list: 'klusjes' });
  });

  it('trailing punctuation is allowed, the whole line must match', () => {
    const p = compilePhrase('wat moet ik (nog)? doen', slots);
    expect(p.match('Wat moet ik nog doen?')).toEqual({});
    expect(p.match('wat moet ik doen')).toEqual({});
    expect(p.match('wat moet ik doen vandaag dan')).toBeNull();
  });

  it('a template it cannot read is an error at compile time, not a silent never-match', () => {
    expect(() => compilePhrase('zet {item op de lijst', slots)).toThrow(/template/);
    expect(() => compilePhrase('zet {onbekend} op', slots)).toThrow(/slot/);
  });
});
