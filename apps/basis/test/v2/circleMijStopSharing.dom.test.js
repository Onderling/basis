// @vitest-environment happy-dom
/**
 * TAKING A DISCLOSURE BACK (L115) — the affordance on Mij's per-circle table.
 *
 * Found on the live walk of v0.1.18: untick the last disclosed property and the circle's row collapsed to
 * "nothing shared" with NO action, so the withdrawal could never be pushed and every co-member kept the old
 * value. The mechanism was already right (an empty release is a real statement: the writer emits
 * `personaProperties: {}` and the fold treats it as a clear) — only the button was missing.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderMij } from '../../web/v2/circleMij.js';

const base = { ok: true, defaultId: 'default', general: { properties: [] }, personas: [] };
const circle = (over) => ({ circleId: 'k1', name: 'Kring', rows: [], addable: [], charter: null, ...over });
const render = (circles, onShareToCircle) => {
  const c = document.createElement('div');
  renderMij(c, { model: { ...base, circles }, t: (k) => k, onShareToCircle });
  return c;
};

describe('renderMij — stop sharing with a circle', () => {
  it('offers it on a circle that discloses nothing but still holds something on the lane', async () => {
    const shared = [];
    const el = render([circle({ canWithdraw: true })], async (cid, pid) => { shared.push([cid, pid]); return { ok: true }; });
    const btn = el.querySelector('.cc-mij__stop-sharing');
    expect(btn, 'the action is painted').toBeTruthy();
    expect(btn.textContent).toBe('circle.mij.stop_sharing');
    btn.click();
    await new Promise((r) => { setTimeout(r, 0); });
    expect(shared, 'the same op as sharing — an empty release is the clear').toEqual([['k1', 'default']]);
    expect(el.querySelector('.cc-mij__share-status').textContent).toBe('circle.mij.stopped_sharing');
  });
  it('does not offer it when the lane holds nothing either', () => {
    expect(render([circle({ canWithdraw: false })], () => {}).querySelector('.cc-mij__stop-sharing')).toBeNull();
  });
  it('does not offer it without the share seam (a composition that cannot push anything)', () => {
    expect(render([circle({ canWithdraw: true })], undefined).querySelector('.cc-mij__stop-sharing')).toBeNull();
  });
  it('says so when the push fails, and stays pressable', async () => {
    const el = render([circle({ canWithdraw: true })], async () => ({ ok: false, reason: 'no-lane' }));
    const btn = el.querySelector('.cc-mij__stop-sharing');
    btn.click();
    await new Promise((r) => { setTimeout(r, 0); });
    expect(el.querySelector('.cc-mij__share-status').textContent).toBe('circle.aboutme.share_failed');
    expect(btn.disabled).toBe(false);
  });
});
