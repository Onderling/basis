/**
 * D / Surface 2 (LIVE web menu) — `renderCircleView`'s ⋯ overflow menu is now
 * PROJECTED from `manifest.actions` via the shared `circleActions` selector, not
 * the hardcoded `MORE_ITEMS` literal (deleted).  These tests assert the LIVE web
 * menu renders exactly the projected + gate-filtered + handler-wired web set
 * (invariants #1/#3/#4), and that it matches the mobile roster modulo the
 * manifest-declared platform diff (`share`) — the divergence is gone.
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest';
import { renderCircleView } from '../../web/v2/circleView.js';
import { circleActions, circleActionsMobile, gatedActions } from '../../src/v2/actionProjection.js';
import { basisManifest } from '../../src/index.js';
import { DEFAULT_CIRCLE_POLICY, mergeCirclePolicy } from '../../src/v2/circlePolicy.js';

const t = (k, params) => (params && params.count != null ? `${k}:${params.count}` : k);
const circle = { id: 'g1', name: 'Selwerd', memberCount: 87 };

function mount() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

// The full host callback bag `showCircle` wires — keyed by manifest action id.
// (`share` is deliberately included to prove the platform gate drops it on web
// even when the host offers a callback.)
function fullMore() {
  return {
    invite: vi.fn(), settings: vi.fn(), lists: vi.fn(), contacts: vi.fn(),
    override: vi.fn(), viewAs: vi.fn(), advisor: vi.fn(), skills: vi.fn(),
    files: vi.fn(), rules: vi.fn(), recipes: vi.fn(), admin: vi.fn(), governance: vi.fn(), share: vi.fn(),
  };
}

const menuActions = (el) =>
  [...el.querySelectorAll('.circle-view__more-menu .circle-view__more-item')].map((b) => b.dataset.action);

describe('circle circle ⋯ menu — projected from manifest.actions (MORE_ITEMS gone)', () => {
  it('renders exactly the projected+gated web set, in manifest order (not a hardcoded list)', () => {
    const el = mount();
    renderCircleView(el, { circle, rows: [], t, policy: DEFAULT_CIRCLE_POLICY, more: fullMore() });
    // Expected = the web projection, filtered to ids the host wired a callback for.
    const more = fullMore();
    const expected = circleActions(basisManifest, { policy: DEFAULT_CIRCLE_POLICY, platform: 'web' })
      .map((a) => a.id)
      .filter((id) => typeof more[id] === 'function');
    expect(menuActions(el)).toEqual(expected);
    // The alpha trims the menu to invite · settings (back is a header affordance; alphaSurface.js). The
    // gates beneath it are unchanged, observable through `gatedActions`: viewAs + rules on by default,
    // files hidden (lists+notes off), share dropped by the platform gate (mobile-only).
    expect(menuActions(el)).toEqual(['invite', 'settings']);
    const gated = gatedActions(basisManifest, { policy: DEFAULT_CIRCLE_POLICY, platform: 'web' }).map((a) => a.id);
    expect(gated).toContain('viewAs');
    expect(gated).toContain('rules');
    expect(gated).not.toContain('files');
    expect(gated).not.toContain('share');
    expect(gated).toContain('contacts');
  });

  it('feature gate (requires) rides the projection: policy toggles add/remove items', () => {
    const noDir = mergeCirclePolicy(DEFAULT_CIRCLE_POLICY, { features: { memberDirectory: false, houseRules: false, lists: true } });
    const gated = gatedActions(basisManifest, { policy: noDir, platform: 'web' }).map((a) => a.id);
    expect(gated).not.toContain('viewAs');   // memberDirectory off
    expect(gated).not.toContain('rules');    // houseRules off
    expect(gated).toContain('files');        // lists on (lists || notes)
    const el = mount();
    renderCircleView(el, { circle, rows: [], t, policy: noDir, more: fullMore() });
    expect(menuActions(el)).toEqual(['invite', 'settings']);   // the painted menu is the alpha's, whatever the gates
  });

  it('handler-presence gate: an action with no more[id] callback is omitted', () => {
    const el = mount();
    // Only settings + invite wired → only those two show (in manifest order).
    renderCircleView(el, { circle, rows: [], t, policy: DEFAULT_CIRCLE_POLICY, more: { invite: vi.fn(), settings: vi.fn() } });
    expect(menuActions(el)).toEqual(['invite', 'settings']);
  });

  it('clicking a menu item fires its projected callback by id', () => {
    const el = mount();
    const more = fullMore();
    renderCircleView(el, { circle, rows: [], t, policy: DEFAULT_CIRCLE_POLICY, more });
    el.querySelector('.circle-view__more-menu [data-action="settings"]').click();
    expect(more.settings).toHaveBeenCalledTimes(1);
  });

  it('web live menu ≡ mobile menu, modulo the manifest-declared platform diff (share)', () => {
    const el = mount();
    renderCircleView(el, { circle, rows: [], t, policy: DEFAULT_CIRCLE_POLICY, more: fullMore() });
    const webMenu = menuActions(el);
    // The mobile menu projects the same roster minus `back` (a header affordance).
    const mobileMenu = circleActionsMobile(basisManifest, { policy: DEFAULT_CIRCLE_POLICY })
      .map((a) => a.id)
      .filter((id) => id !== 'back');
    // Identical: the alpha hides the only platform-specific action (share) on both shells.
    expect(mobileMenu).toEqual(webMenu);
    expect(webMenu).not.toContain('share');
  });
});
