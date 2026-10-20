/**
 * What a picker offers, from the reply of the read its field names (`pickerSource.listOp`) — one mapping both shells'
 * forms use. `listMyCircles` answers `{circles, names}` (not `items`), so a mapping that only knew items offered an
 * EMPTY list for "which circle"; pair circles (a contact's two-person circle) are not offered as a circle to pick.
 */
import { describe, it, expect } from 'vitest';
import { pickerChoices, makePickerFetcher, onlyChoice } from '../../src/forms/pickerChoices.js';
import { pairCircleIdFor } from '../../src/v2/pairRoster.js';

describe('pickerChoices', () => {
  it('a circle list: id and the name a person gave it; a pair circle is left out', () => {
    const pair = pairCircleIdFor('me-key', 'them-key');
    expect(pickerChoices({ circles: ['thuis', { groupId: 'werk' }, pair], names: { thuis: 'Thuis' } }))
      .toEqual([{ id: 'thuis', label: 'Thuis' }, { id: 'werk', label: 'werk' }]);
  });
  it('items, entries, or a bare list: id (or webid) and its words', () => {
    expect(pickerChoices({ items: [{ id: 'a', label: 'A' }, { webid: 'w', name: 'Wim' }] })).toEqual([{ id: 'a', label: 'A' }, { id: 'w', label: 'Wim' }]);
    expect(pickerChoices({ entries: [{ id: 'e', text: 'melk' }] })).toEqual([{ id: 'e', label: 'melk' }]);
    expect(pickerChoices([{ id: 'x', title: 'X' }])).toEqual([{ id: 'x', label: 'X' }]);
    expect(pickerChoices(null)).toEqual([]);
  });
  it('the fetcher calls the declared read on its declared app (else the field\'s own), and maps the reply', async () => {
    const asked = [];
    const fetch = makePickerFetcher(async (app, op, args) => { asked.push([app, op, args]); return { circles: ['thuis'], names: { thuis: 'Thuis' } }; }, 'household');
    expect(await fetch({ listOp: 'listMyCircles', appOrigin: 'pinboard' })).toEqual([{ id: 'thuis', label: 'Thuis' }]);
    expect(asked).toEqual([['pinboard', 'listMyCircles', {}]]);
  });
  it('one choice is no question: onlyChoice names it; none or several, null', () => {
    expect(onlyChoice([{ id: 'thuis', label: 'Thuis' }])).toBe('thuis');
    expect(onlyChoice([])).toBe(null);
    expect(onlyChoice([{ id: 'a' }, { id: 'b' }])).toBe(null);
  });
});
