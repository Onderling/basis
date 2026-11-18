/**
 * A capability as a person reads it, one shared lookup for every screen that lists one (the settings rows, the circle
 * override, the recipe consent card, the join wizard; both shells): the verb's label from the locale
 * (`circle.settings.verb.<atom>`), the noun by its own name (`noun.<noun>`), never its id where a name exists.
 */
import { describe, it, expect } from 'vitest';
import { verbLabel, capabilityLabel } from '../../src/v2/capabilityLabel.js';
import { sharedLocale } from '../../src/locales/index.js';

// a translator over the shared bundle as i18next reads it (a `count` picks `<key>_one` / `<key>_other`), echoing the
// key on a miss as t() does
const tOf = (lang) => (k, v = {}) => {
  const parts = k.split('.');
  const last = parts.pop();
  const parent = parts.reduce((o, p) => o?.[p], sharedLocale[lang]);
  const node = v.count != null ? (parent?.[`${last}_${v.count === 1 ? 'one' : 'other'}`] ?? parent?.[last]) : parent?.[last];
  const s = typeof node === 'string' ? node : node?.text;
  return typeof s === 'string' ? s : (v.defaultValue ?? k);
};

describe('capabilityLabel', () => {
  it('the verb\'s label and the noun\'s own name, per language', () => {
    expect(verbLabel(tOf('nl'), 'add')).toBe('Toevoegen');
    expect(capabilityLabel(tOf('nl'), { atom: 'add', noun: 'note' })).toBe('Toevoegen · notitie');
    expect(capabilityLabel(tOf('en'), { atom: 'list', noun: 'note' })).toBe('List · note');
  });
  it('an unknown verb or noun falls back to its id (as the screens did)', () => {
    expect(capabilityLabel(tOf('nl'), { atom: 'frob', noun: 'gizmo' })).toBe('frob · gizmo');
  });
});
