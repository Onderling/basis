// @vitest-environment happy-dom
/**
 * Nearby screen, web surface (Nearby step E).
 *
 * The renderer is a projector — the interesting decisions were made by `createNearbyScreen` and arrive on
 * the model. What these pin is that the projector does not LOSE them:
 *
 *   • the visibility banner shows what the device is doing, and shouts when that disagrees with the ask;
 *   • row actions come from the model, so web cannot offer a stranger something mobile would not;
 *   • every string goes through `t()` (invariant 8) — no hardcoded English in the DOM.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderCircleNearby } from '../../web/v2/circleNearby.js';

/** Return the key itself, so a hardcoded string is immediately visible in an assertion. */
const t = (k) => k;

const model = (over = {}) => ({
  rows: [], counts: { total: 0, sharingAny: 0 },
  ownProfile: { pseudonym: 'ik', publishedSkills: [] },
  headerLabel: '0 of 0 share offerings with you',
  ...over,
});

const row = (over = {}) => ({
  id: 'peer-1', pseudonym: 'iemand', source: 'mdns', proximity: null,
  sharedSkills: [], allSkills: [], sharesAny: false, lastSeen: null,
  actions: [], isMember: false, note: 'nearby-not-member', ...over,
});

function render(m, opts = {}) {
  const el = document.createElement('div');
  renderCircleNearby(el, { model: m, t, ...opts });
  return el;
}

describe('the visibility banner', () => {
  it('says VISIBLE while announcing', () => {
    const el = render(model({ visibility: { publishing: true, degraded: false, unavailable: false } }));
    const banner = el.querySelector('.circle-nearby__visibility');
    expect(banner.dataset.visibility).toBe('visible');
    expect(banner.textContent).toContain('circle.nearbyScreen.visible_title');
    expect(banner.textContent).toContain('circle.nearbyScreen.visible_body');
  });

  it('says HIDDEN in ghost mode', () => {
    const el = render(model({ visibility: { publishing: false, degraded: false, unavailable: false } }));
    expect(el.querySelector('.circle-nearby__visibility').dataset.visibility).toBe('hidden');
  });

  it('THE ONE THAT MATTERS: degraded outranks everything and is announced to a screen reader', () => {
    // Asked to be hidden, still publishing. If this ever renders as "hidden", someone is misled about
    // whether a café full of strangers can see them.
    const el = render(model({ visibility: { publishing: true, degraded: true, unavailable: false } }));
    const banner = el.querySelector('.circle-nearby__visibility');
    expect(banner.dataset.visibility).toBe('still_visible');
    expect(banner.getAttribute('role')).toBe('alert');
    expect(banner.textContent).toContain('circle.nearbyScreen.still_visible_title');
  });

  it('UNAVAILABLE is not an alert — a laptop with no radio is not a privacy failure', () => {
    const el = render(model({ visibility: { publishing: false, degraded: false, unavailable: true } }));
    const banner = el.querySelector('.circle-nearby__visibility');
    expect(banner.dataset.visibility).toBe('unavailable');
    expect(banner.getAttribute('role')).toBeNull();
  });

  it('renders no banner when the model carries no visibility (old caller)', () => {
    expect(render(model()).querySelector('.circle-nearby__visibility')).toBeNull();
  });
});

describe('row actions', () => {
  it('renders the actions the model decided, and nothing else', () => {
    const el = render(model({ rows: [row({ actions: ['invite-to-circle', 'request-join'] })] }));
    const labels = [...el.querySelectorAll('.circle-nearby__action')].map((b) => b.dataset.action);
    expect(labels).toEqual(['invite-to-circle', 'request-join']);
    expect(el.querySelector('.circle-nearby__action--invite-to-circle').textContent)
      .toBe('circle.nearbyScreen.action_invite');
  });

  it('a stranger is LABELLED a stranger, not just missing a button', () => {
    const el = render(model({ rows: [row({ note: 'nearby-not-member' })] }));
    expect(el.querySelector('.circle-nearby__note').textContent)
      .toBe('circle.nearbyScreen.not_member_note');
  });

  it('a member gets no stranger note', () => {
    const el = render(model({ rows: [row({ isMember: true, note: null, actions: ['open-shared-circle'] })] }));
    expect(el.querySelector('.circle-nearby__note')).toBeNull();
    expect(el.querySelector('.circle-nearby__action--open-shared-circle')).toBeTruthy();
  });

  it('an action the renderer does not recognise is SKIPPED, never shown raw', () => {
    // Otherwise a new action id from shared code leaks an internal identifier into the UI.
    const el = render(model({ rows: [row({ actions: ['some-future-action', 'request-join'] })] }));
    const shown = [...el.querySelectorAll('.circle-nearby__action')].map((b) => b.dataset.action);
    expect(shown).toEqual(['request-join']);
  });

  it('clicking reports the action and the row', () => {
    const onAction = vi.fn();
    const r = row({ actions: ['request-join'] });
    const el = render(model({ rows: [r] }), { onAction });
    el.querySelector('.circle-nearby__action').click();
    expect(onAction).toHaveBeenCalledWith('request-join', expect.objectContaining({ id: 'peer-1' }));
  });

  it('no actions ⇒ no action bar at all', () => {
    const el = render(model({ rows: [row({ actions: [] })] }));
    expect(el.querySelector('.circle-nearby__actions')).toBeNull();
  });
});

describe('invariant 8 — every string is translated', () => {
  it('renders no hardcoded English anywhere on the screen', () => {
    const el = render(model({
      rows: [row({ actions: ['invite-to-circle', 'request-join', 'open-shared-circle'], sharedSkills: ['soep'] })],
      visibility: { publishing: true, degraded: true, unavailable: false },
      ownProfile: { pseudonym: 'ik', publishedSkills: [] },
    }));
    // With t = identity, anything user-visible is either a locale KEY or model-supplied data.
    const strings = [...el.querySelectorAll('button, .circle-nearby__visibility-title, .circle-nearby__visibility-body, .circle-nearby__note, .circle-nearby__own-title, .circle-nearby__own-skills')]
      .map((n) => n.textContent.trim())
      .filter(Boolean);
    for (const s of strings) {
      expect(s.startsWith('circle.'), `untranslated string in the DOM: "${s}"`).toBe(true);
    }
  });

  it('the empty state and own-profile footer still render', () => {
    const el = render(model());
    expect(el.querySelector('.circle-nearby__empty').textContent).toBe('circle.nearbyScreen.header_empty');
    expect(el.querySelector('.circle-nearby__own-skills').textContent)
      .toBe('circle.nearbyScreen.own_profile_empty');
  });

  it('back still works', () => {
    const onBack = vi.fn();
    const el = render(model(), { onBack });
    el.querySelector('.circle-nearby__back').click();
    expect(onBack).toHaveBeenCalled();
  });
});
