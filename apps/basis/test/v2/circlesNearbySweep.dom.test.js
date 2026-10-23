/**
 * Circles and Nearby speak one language: the two acts read "Kring maken" / "Ik heb een uitnodiging" wherever they appear,
 * in one style; Nearby is a tab, so it has no "← circles"; "Ask the room" is a button; and the room names you by your
 * handle — "jij (nog geen naam)" until you have one, never the switcher's bare "Jij".
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from 'vitest';
import { renderCircleLauncher } from '../../web/v2/circleLauncher.js';
import { renderCircleNearby } from '../../web/v2/circleNearby.js';
import { nearbyRoomSelfView } from '../../src/v2/nearbyIdentity.js';

const t = (k) => k;
const model = () => ({ rows: [], counts: { total: 0, sharingAny: 0 }, ownProfile: { pseudonym: 'ik', publishedSkills: [] }, headerLabel: '' });

describe('Circles: one wording pair, one style', () => {
  it('the launcher\'s two acts say what Vandaag\'s Begin card says, in the same style', () => {
    const el = document.createElement('div');
    renderCircleLauncher(el, { circles: [], t, onNewCircle: () => {}, onJoinCircle: () => {} });
    const n = el.querySelector('.circle-launcher__new');
    const j = el.querySelector('.circle-launcher__join');
    expect(n.textContent).toBe('circle.vandaag.onboarding_begin_create');
    expect(j.textContent).toBe('circle.vandaag.onboarding_begin_join');
    expect(n.className.replace('circle-launcher__new', '')).toBe(j.className.replace('circle-launcher__join', ''));
  });
});

describe('Nearby', () => {
  it('has no back link (it is a tab), and "Ask the room" is a primary button', () => {
    const el = document.createElement('div');
    renderCircleNearby(el, { model: model(), t, onBack: () => {}, onCompose: () => {} });
    expect(el.querySelector('.circle-nearby__back')).toBe(null);
    expect(el.querySelector('.circle-nearby__ask-compose')?.className).toMatch(/cc-btn--primary/);
  });

  it('names the general persona by its handle, or "jij (nog geen naam)" — a persona by its own name', () => {
    const r = { self: 'default', ask: false, choices: ['default'] };
    expect(nearbyRoomSelfView(r, [], { handle: 'anna' }).self).toEqual({ id: 'default', name: 'anna' });
    expect(nearbyRoomSelfView(r, []).self).toEqual({ id: 'default', nameKey: 'circle.nearbyScreen.no_name_yet' });
    const p = { self: 'p-1', ask: false, choices: ['p-1'] };
    expect(nearbyRoomSelfView(p, [{ id: 'p-1', name: 'Werk' }], { handle: 'anna' }).self).toEqual({ id: 'p-1', name: 'Werk' });
  });
});
