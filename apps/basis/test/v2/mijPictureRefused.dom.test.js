// @vitest-environment happy-dom
//
// A picture disclosed to a circle that cannot carry it (no seal strategy for its media) says so on its Mij row —
// a share there leaves it out (Fable's ruling on L140(b)). Where the shell cannot say (no check wired), the row is as before.
import { describe, it, expect } from 'vitest';
import { renderMij } from '../../web/v2/circleMij.js';

const t = (k) => k;
const row = { personaId: 'default', personaName: 'Ik', key: 'profilePicture', rung: null, released: null };
const model = {
  ok: true, defaultId: 'default', general: { properties: [] }, personas: [],
  circles: [
    { circleId: 'podless', name: 'Zonder pod', rows: [row], addable: [], canWithdraw: false },
    { circleId: 'sealed', name: 'Met pod', rows: [row], addable: [], canWithdraw: false },
  ],
};
const note = (el, cid) => el.querySelector(`.cc-mij__table tr[data-circle-id="${cid}"] .cc-mij__not-here`);

describe('Mij — a picture disclosed where it cannot go', () => {
  it('says so on that circle\'s row only', () => {
    const el = document.createElement('div');
    renderMij(el, { model, t, canCarryMedia: (cid) => cid !== 'podless' });
    expect(note(el, 'podless')?.textContent).toBe('circle.mij.picture_not_here');
    expect(note(el, 'sealed')).toBeNull();
  });
  it('with no check wired, says nothing', () => {
    const el = document.createElement('div');
    renderMij(el, { model, t });
    expect(note(el, 'podless')).toBeNull();
  });
});
