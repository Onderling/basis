/**
 * D / Surface 1 (MOBILE parity) — the CircleTabBar roster is sourced from the
 * manifest TAB-BAR projection (`renderMobile(manifest).tabs`), not a hardcoded
 * `TABS` literal.
 *
 * The RN component renders each tab as
 *   circleTabsMobile(basisManifest).map((tab) => <Text>{t(tab.labelKey)}</Text>)
 * (see src/screens/v2/CircleTabBar.js).  RN screens can't render under Vitest
 * (see vitest.config.js), so this exercises the SAME shared pure selector + the
 * real mobile t() the component wires — the roster flows
 *   manifest.tabs → renderMobile → circleTabsMobile → t()
 * mirroring the web drift-guard (test/circleTabBar.test.js).  Reusing
 * tabProjection.js (mobile sibling) keeps the selection logic in ONE shared
 * module, so web ≡ mobile by construction (invariants #1/#2/#3).
 */
import { describe, it, expect } from 'vitest';

import { circleTabsMobile } from '../../basis/src/v2/tabProjection.js';
import { basisManifest } from '../../basis/src/index.js';
import { t } from '../src/core/localisation.js';

describe('D / Surface 1 — mobile CircleTabBar roster from the manifest projection', () => {
  it('renderMobile projects the five tabs in order with their locale keys', () => {
    const tabs = circleTabsMobile(basisManifest);
    expect(tabs.map((tab) => tab.id)).toEqual(['screens', 'circles', 'nearby', 'contacten', 'mij']);
    expect(tabs.map((tab) => tab.labelKey)).toEqual([
      'circle.tab.screens', 'circle.tab.circles', 'circle.tab.nearby', 'circle.tab.contacten', 'circle.tab.mij',
    ]);
  });

  it('each tab label resolves from the manifest labelKey via t() (invariant #8)', () => {
    for (const tab of circleTabsMobile(basisManifest)) {
      const label = t(tab.labelKey);
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
      // t() yields translated text, not the raw key echoed back.
      expect(label).not.toBe(tab.labelKey);
    }
  });

  it('the "mij" tab targets the me op; the others are app-nav roots', () => {
    const tabs = circleTabsMobile(basisManifest);
    const mij = tabs.find((tab) => tab.id === 'mij');
    expect(mij.target).toEqual({ kind: 'op', opId: 'me' });
    for (const id of ['screens', 'circles', 'contacten']) {
      expect(tabs.find((tab) => tab.id === id).target).toEqual({ kind: 'nav', to: id });
    }
  });

  it('is a genuine projection consumer: a different manifest drives a different roster', () => {
    const synthetic = {
      app: 'synthetic',
      operations: [],
      tabs: [{ id: 'only', labelKey: 'circle.tab.mij', target: { kind: 'nav', to: 'only' } }],
    };
    const tabs = circleTabsMobile(synthetic);
    expect(tabs.map((tab) => tab.id)).toEqual(['only']);
  });
});
