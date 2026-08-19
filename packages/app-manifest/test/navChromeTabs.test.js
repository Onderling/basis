/**
 * Nav-chrome (D / Surface 1) — the TAB BAR kind: `renderWeb`/`renderMobile`
 * projection of `manifest.tabs → NavModel.tabs`, plus `validateManifest`
 * enforcement of the NavItem contract.
 *
 * Pure-data: inline synthetic manifests, no consumer dependency.  Mirrors the
 * `surfaces.page → NavModel.pages` slice (renderWeb.test.js) so the two
 * nav-chrome projections stay consistent.
 */
import { describe, it, expect } from 'vitest';

import { renderWeb } from '../src/renderWeb.js';
import { renderMobile } from '../src/renderMobile.js';
import { validateManifest, NAV_TARGET_KINDS } from '../src/validate.js';

const BASE = {
  app:       'synth',
  itemTypes: ['task'],
  operations: [
    { id: 'me', verb: 'list', params: [], surfaces: { slash: { command: '/me' } } },
  ],
  tabs: [
    { id: 'screens',   labelKey: 'x.tab.screens',   target: { kind: 'nav', to: 'screens' } },
    { id: 'circles',   labelKey: 'x.tab.circles',   target: { kind: 'nav', to: 'circles' } },
    { id: 'contacten', labelKey: 'x.tab.contacten', target: { kind: 'nav', to: 'contacten' } },
    { id: 'mij',       labelKey: 'x.tab.mij',       target: { kind: 'op',  opId: 'me' } },
  ],
};

describe('nav-chrome tabs — renderWeb projection', () => {
  it('projects manifest.tabs into NavModel.tabs, in declaration order', () => {
    const nav = renderWeb(BASE);
    expect(nav.tabs.map((t) => t.id)).toEqual(['screens', 'circles', 'contacten', 'mij']);
    expect(nav.tabs.map((t) => t.labelKey)).toEqual([
      'x.tab.screens', 'x.tab.circles', 'x.tab.contacten', 'x.tab.mij',
    ]);
  });

  it('preserves the NavTarget union (nav root vs op) verbatim', () => {
    const nav = renderWeb(BASE);
    expect(nav.tabs[0].target).toEqual({ kind: 'nav', to: 'screens' });
    expect(nav.tabs[3].target).toEqual({ kind: 'op', opId: 'me' });
  });

  it('passes an optional icon through', () => {
    const nav = renderWeb({
      ...BASE,
      tabs: [{ id: 'mij', labelKey: 'x.tab.mij', icon: 'person', target: { kind: 'op', opId: 'me' } }],
    });
    expect(nav.tabs[0].icon).toBe('person');
  });

  it('omits the tabs key entirely for a tab-less manifest (shape unchanged)', () => {
    const { tabs, ...noTabs } = BASE;
    const nav = renderWeb(noTabs);
    expect(nav).not.toHaveProperty('tabs');
    expect(Object.keys(nav).sort()).toEqual(['app', 'globals', 'sections']);
  });

  it('renderWeb ≡ renderMobile for the tabs projection (cross-surface)', () => {
    expect(renderMobile(BASE).tabs).toEqual(renderWeb(BASE).tabs);
  });
});

describe('nav-chrome tabs — validateManifest', () => {
  it('accepts a well-formed tabs block', () => {
    expect(validateManifest(BASE).ok).toBe(true);
  });

  it('rejects a tab missing labelKey (invariant #8)', () => {
    const bad = { ...BASE, tabs: [{ id: 'x', target: { kind: 'nav', to: 'x' } }] };
    const res = validateManifest(bad);
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.path === '/tabs/0/labelKey')).toBe(true);
  });

  it('rejects a duplicate tab id', () => {
    const dup = {
      ...BASE,
      tabs: [
        { id: 'a', labelKey: 'k', target: { kind: 'nav', to: 'a' } },
        { id: 'a', labelKey: 'k', target: { kind: 'nav', to: 'b' } },
      ],
    };
    const res = validateManifest(dup);
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.code === 'duplicate-nav-id')).toBe(true);
  });

  it('rejects an unknown target.kind', () => {
    const bad = { ...BASE, tabs: [{ id: 'x', labelKey: 'k', target: { kind: 'route', to: 'x' } }] };
    const res = validateManifest(bad);
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.path === '/tabs/0/target/kind')).toBe(true);
    // The allow-list is exactly {nav, op} — the shared nav-chrome vocabulary.
    expect(NAV_TARGET_KINDS).toEqual(['nav', 'op']);
  });

  it("requires target.to for kind 'nav' and target.opId for kind 'op'", () => {
    const missingTo = { ...BASE, tabs: [{ id: 'x', labelKey: 'k', target: { kind: 'nav' } }] };
    expect(validateManifest(missingTo).errors.some((e) => e.path === '/tabs/0/target/to')).toBe(true);
    const missingOp = { ...BASE, tabs: [{ id: 'x', labelKey: 'k', target: { kind: 'op' } }] };
    expect(validateManifest(missingOp).errors.some((e) => e.path === '/tabs/0/target/opId')).toBe(true);
  });

  it("strict mode flags a kind:'op' tab whose opId resolves to no operation", () => {
    const bad = {
      ...BASE,
      tabs: [{ id: 'x', labelKey: 'k', target: { kind: 'op', opId: 'ghostOp' } }],
    };
    const res = validateManifest(bad, { strict: true });
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.code === 'unknown-skillId')).toBe(true);
    // ... and passes strict when the op exists (the 'me' target in BASE).
    expect(validateManifest(BASE, { strict: true }).ok).toBe(true);
  });

  it('rejects a non-array tabs', () => {
    expect(validateManifest({ ...BASE, tabs: {} }).errors.some((e) => e.path === '/tabs')).toBe(true);
  });
});
