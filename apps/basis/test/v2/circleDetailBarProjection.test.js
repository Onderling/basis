/**
 * D / Surface 2 — the circle DETAIL ACTION BAR is now PROJECTED from
 * `manifest.actions` via the shared `circleActions` selector, not a hand-written
 * button list.  These tests assert the web bar renders exactly the projected +
 * gate-filtered action set (invariants #1/#3/#4), and that the projected roster
 * is IDENTICAL to mobile's (the divergence is gone by construction).
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from 'vitest';
import { renderCircleDetail } from '../../web/v2/circleDetail.js';
import { circleActions, circleActionsMobile, circleActionRoster, gatedActions } from '../../src/v2/actionProjection.js';
import { basisManifest } from '../../src/index.js';
import { DEFAULT_CIRCLE_POLICY, mergeCirclePolicy } from '../../src/v2/circlePolicy.js';

const t = (k) => k;

function mount() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

const barActions = (el) => [...el.querySelectorAll('.circle-detail__bar button')].map((b) => b.dataset.action);

describe('circle detail bar — projected from manifest.actions', () => {
  it('renders exactly the web projected+gated action set, in order (no hand-written list)', () => {
    const el = mount();
    renderCircleDetail(el, { circle: { id: 'g1', name: 'Selwerd' }, items: [], t, policy: DEFAULT_CIRCLE_POLICY });
    const projected = circleActions(basisManifest, { policy: DEFAULT_CIRCLE_POLICY, platform: 'web' });
    expect(barActions(el)).toEqual(projected.map((a) => a.id));
    // The alpha trims the bar to back · invite · settings (alphaSurface.js). The gates beneath it are
    // unchanged and observable through `gatedActions`: memberDirectory + houseRules on → viewAs + rules;
    // lists + notes off → files hidden; share is mobile-only → absent on web.
    expect(barActions(el)).toEqual(['back', 'invite', 'settings']);
    const gated = gatedActions(basisManifest, { policy: DEFAULT_CIRCLE_POLICY, platform: 'web' }).map((a) => a.id);
    expect(gated).toContain('viewAs');
    expect(gated).toContain('rules');
    expect(gated).not.toContain('files');
    expect(gated).not.toContain('share');
  });

  it('feature gate (requires) rides the projection: toggling policy adds/removes buttons', () => {
    const noDir = mergeCirclePolicy(DEFAULT_CIRCLE_POLICY, { features: { memberDirectory: false, houseRules: false, lists: true } });
    const gated = gatedActions(basisManifest, { policy: noDir, platform: 'web' }).map((a) => a.id);
    expect(gated).not.toContain('viewAs');   // memberDirectory off
    expect(gated).not.toContain('rules');    // houseRules off
    expect(gated).toContain('files');        // lists on (lists || notes)
    // and the painted bar follows the projection either way (the alpha trim hides files too)
    const el = mount();
    renderCircleDetail(el, { circle: { id: 'g1' }, items: [], t, policy: noDir });
    expect(barActions(el)).toEqual(circleActions(basisManifest, { policy: noDir, platform: 'web' }).map((a) => a.id));
  });

  it('labels resolve from the projected labelKey via t(); handlers fire by id', () => {
    const calls = [];
    const el = mount();
    renderCircleDetail(el, {
      circle: { id: 'g1' }, items: [], t, policy: DEFAULT_CIRCLE_POLICY,
      onBack: () => calls.push('back'), onSettings: () => calls.push('settings'),
    });
    const back = el.querySelector('[data-action="back"]');
    expect(back.textContent).toBe('circle.back');
    back.click();
    el.querySelector('[data-action="settings"]').click();
    expect(calls).toEqual(['back', 'settings']);
  });

  it('web ≡ mobile: the projected action roster is IDENTICAL (divergence killed)', () => {
    // The full projected NavModel.actions is the same object shape from either
    // projector — renderMobile re-exports renderWeb, so the roster can never fork.
    expect(circleActionRoster(basisManifest)).toEqual(
      circleActionRoster(basisManifest, undefined),
    );
    const webRoster    = circleActions(basisManifest, { policy: DEFAULT_CIRCLE_POLICY, platform: 'web' });
    const mobileRoster = circleActionsMobile(basisManifest, { policy: DEFAULT_CIRCLE_POLICY });
    // Same source, same gates → the two platform sets differ ONLY by the
    // manifest-declared `share` (mobile-only; no web CircleShareScreen yet).
    const webIds    = webRoster.map((a) => a.id);
    const mobileIds = mobileRoster.map((a) => a.id);
    expect(mobileIds).toEqual(webIds);   // the alpha hides the only platform-specific action (share) on both
    // beneath the trim the platform gate still holds: share is mobile-only
    expect(gatedActions(basisManifest, { policy: DEFAULT_CIRCLE_POLICY, platform: 'mobile', renderer: undefined }).map((a) => a.id)).toContain('share');
    expect(gatedActions(basisManifest, { policy: DEFAULT_CIRCLE_POLICY, platform: 'web' }).map((a) => a.id)).not.toContain('share');
    expect(webIds).not.toContain('share');
  });
});
