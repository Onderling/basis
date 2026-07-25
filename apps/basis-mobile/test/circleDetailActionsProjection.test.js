/**
 * D / Surface 2 (MOBILE parity) — the CircleDetail ⋯-menu roster is sourced from
 * the manifest DETAIL-ACTION-BAR projection (`renderMobile(manifest).actions`)
 * via the shared `circleActionsMobile` selector, not a hand-written list.
 *
 * RN screens can't render under Vitest (see vitest.config.js), so this exercises
 * the SAME shared pure selector + the real mobile t() the component wires — the
 * roster flows `manifest.actions → renderMobile → circleActionsMobile → t()`,
 * mirroring the web drift-guard (basis/test/v2/circleDetailBarProjection).
 * Reusing actionProjection.js (mobile sibling) keeps the selection + gating in
 * ONE shared module, so web ≡ mobile by construction (invariants #1/#2/#3).
 */
import { describe, it, expect } from 'vitest';

import {
  circleActions,
  circleActionsMobile,
  circleActionRoster,
} from '../../basis/src/v2/actionProjection.js';
import { basisManifest } from '../../basis/src/index.js';
import { DEFAULT_CIRCLE_POLICY } from '../../basis/src/v2/circlePolicy.js';
import { t } from '../src/core/localisation.js';

describe('D / Surface 2 — mobile CircleDetail action roster from the manifest projection', () => {
  it('projects the detail actions (default policy) in live-web-menu order, invite/contacts/share included', () => {
    const ids = circleActionsMobile(basisManifest, { policy: DEFAULT_CIRCLE_POLICY }).map((a) => a.id);
    // ONE manifest declaration; order mirrors the live web kring menu (back first
    // for the detail bar — the ⋯ menus filter it out in-shell).
    expect(ids).toEqual([
      'back', 'invite', 'settings', 'lists', 'contacts', 'override', 'viewAs',
      'advisor', 'skills', 'rules', 'recipes', 'admin', 'governance', 'share',
    ]);
    // files hidden (lists+notes off by default); share present (mobile platform).
    expect(ids).not.toContain('files');
    expect(ids).toContain('share');
    // invite + contacts (the live-web-menu additions) reach mobile too — both
    // platforms, no platform flag (each shell wires its own mechanism).
    expect(ids).toContain('invite');
    expect(ids).toContain('contacts');
  });

  it('each action label resolves from the manifest labelKey via t() (invariant #8)', () => {
    for (const action of circleActionsMobile(basisManifest, { policy: DEFAULT_CIRCLE_POLICY })) {
      const label = t(action.labelKey);
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toBe(action.labelKey);   // translated, not the raw key
    }
  });

  it('web ≡ mobile: the projected NavModel.actions roster is IDENTICAL (divergence gone)', () => {
    // renderMobile re-exports renderWeb → the unfiltered roster can never fork.
    expect(circleActionRoster(basisManifest)).toEqual(
      circleActionRoster(basisManifest, undefined),
    );
  });

  it('the only platform-driven difference is the manifest-declared mobile-only `share`', () => {
    const webIds    = circleActions(basisManifest, { policy: DEFAULT_CIRCLE_POLICY, platform: 'web' }).map((a) => a.id);
    const mobileIds = circleActionsMobile(basisManifest, { policy: DEFAULT_CIRCLE_POLICY }).map((a) => a.id);
    expect(mobileIds.filter((id) => id !== 'share')).toEqual(webIds);
    expect(webIds).not.toContain('share');    // no web CircleShareScreen yet
  });

  it('is a genuine projection consumer: a different manifest drives a different roster', () => {
    const synthetic = {
      app: 'synthetic',
      operations: [],
      actions: [{ id: 'only', labelKey: 'circle.back', target: { kind: 'nav', to: 'only' } }],
    };
    expect(circleActionsMobile(synthetic).map((a) => a.id)).toEqual(['only']);
  });
});
