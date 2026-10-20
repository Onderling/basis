/**
 * Vandaag's "+" sheet opened on an own appointment: "Delen met…" lists the contacts a pair circle connects, and a pick
 * hands that contact to the host; a note (no share act) shows no such list.
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from 'vitest';
import { renderVandaagPlus } from '../web/v2/vandaagPlus.js';
import { PLUS_ACTS } from '../src/v2/vandaagPlus.js';

const t = (k) => k;
const appt = PLUS_ACTS.find((a) => a.noun === 'calendar-event');
const note = PLUS_ACTS.find((a) => a.noun === 'note');

describe('the own sheet shares an appointment with a contact', () => {
  it('one button per contact; a pick hands the act and the contact to the host', () => {
    const picked = [];
    const el = renderVandaagPlus(document.createElement('div'), { t, actId: appt.id, editing: true, values: { title: 'tandarts' },
      shareTargets: [{ id: 'webid:bob', label: 'Bob' }], onShare: (a, c) => picked.push([a, c]) });
    const btns = [...el.querySelectorAll('.circle-vandaag-plus__share-to')];
    expect(btns.map((b) => b.textContent)).toEqual(['Bob']);
    expect(el.querySelector('.circle-vandaag-plus__share p').textContent).toBe('circle.button.calendar.shareEvent');
    btns[0].click();
    expect(picked).toEqual([[appt.id, 'webid:bob']]);
  });
  it('nobody connected: says so, offers nothing', () => {
    const el = renderVandaagPlus(document.createElement('div'), { t, actId: appt.id, editing: true, shareTargets: [], onShare: () => {} });
    expect(el.querySelector('.circle-vandaag-plus__share-none').textContent).toBe('circle.vandaag.plus_share_none');
    expect(el.querySelectorAll('.circle-vandaag-plus__share-to')).toHaveLength(0);
  });
  it('a note, or a new appointment: no share list', () => {
    expect(renderVandaagPlus(document.createElement('div'), { t, actId: note.id, editing: true, shareTargets: [], onShare: () => {} })
      .querySelector('.circle-vandaag-plus__share')).toBe(null);
    expect(renderVandaagPlus(document.createElement('div'), { t, actId: appt.id, editing: false, shareTargets: [], onShare: () => {} })
      .querySelector('.circle-vandaag-plus__share')).toBe(null);
  });
});
