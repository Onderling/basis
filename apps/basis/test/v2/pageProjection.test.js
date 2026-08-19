import { describe, it, expect } from 'vitest';
import { manifestPages, pageForOp, pageLabel, sectionForScreen } from '../../src/v2/pageProjection.js';
import { basisManifest } from '../../manifest.js';
import { stoopManifest } from '../../../stoop/manifest.js';

/**
 * D / consumer-switch — the shared selectors over renderWeb's PAGE
 * projection.  These prove the projection wiring is honest end-to-end:
 * the label flows manifest.surfaces.page.labelKey → renderWeb → pageLabel → t().
 */
describe('pageProjection — selectors over renderWeb(manifest).pages', () => {
  const SYNTH = {
    app: 'x',
    itemTypes: [],
    views: [],
    operations: [
      {
        id: 'settings', verb: 'list',
        surfaces: { page: { kind: 'side-panel', title: 'Settings', labelKey: 'circle.settings.title' } },
      },
      { id: 'noop', verb: 'do', surfaces: { chat: { hint: 'x' } } },
    ],
  };

  it('manifestPages returns the projected pages[] (declaration order)', () => {
    expect(manifestPages(SYNTH).map((p) => p.opId)).toEqual(['settings']);
  });

  it('manifestPages is [] for a page-less manifest', () => {
    expect(manifestPages({ app: 'e', itemTypes: [], views: [], operations: [] })).toEqual([]);
  });

  it('pageForOp selects the projected Page by opId, else null', () => {
    expect(pageForOp(SYNTH, 'settings')).toEqual({
      opId: 'settings', kind: 'side-panel', title: 'Settings', labelKey: 'circle.settings.title',
    });
    expect(pageForOp(SYNTH, 'noop')).toBeNull();
    expect(pageForOp(SYNTH, 'missing')).toBeNull();
  });

  it('pageLabel resolves labelKey via t() (Q22), else title, else fallback', () => {
    const t = (k) => `T:${k}`;
    // labelKey + t → localised
    expect(pageLabel({ labelKey: 'circle.settings.title', title: 'Settings' }, t, 'FB'))
      .toBe('T:circle.settings.title');
    // no t → raw title passthrough
    expect(pageLabel({ labelKey: 'circle.settings.title', title: 'Settings' }, undefined, 'FB'))
      .toBe('Settings');
    // no labelKey → title
    expect(pageLabel({ title: 'Settings' }, t, 'FB')).toBe('Settings');
    // page-less → fallback (graceful)
    expect(pageLabel(null, t, 'FB')).toBe('FB');
    expect(pageLabel(undefined, t, 'FB')).toBe('FB');
  });

  it('the REAL basis manifest projects a `settings` page carrying labelKey', () => {
    // This is the live wiring: the settings op declares surfaces.page +
    // labelKey, so the projection the running shell consumes is non-empty.
    const page = pageForOp(basisManifest, 'settings');
    expect(page).not.toBeNull();
    expect(page.kind).toBe('side-panel');
    expect(page.labelKey).toBe('circle.settings.title');
  });
});

/**
 * D-mig-1b consumer-switch — `sectionForScreen` resolves a live list-screen's
 * config FROM the composed manifests (renderWeb's NavModel.sections[]) instead
 * of a hardcoded `LIST_SCREENS` literal.  These prove the config the running
 * openCircleScreenPanel now consumes (appOrigin / fetch skill / category +
 * label field) flows manifest.views → renderWeb → sectionForScreen.
 */
describe('sectionForScreen — section selector over renderWeb(manifest).sections', () => {
  // Built the SAME way circleApp.js builds circleManifestsByOrigin: key each
  // composed manifest under its `app` (+ `appId`).  The real stoop manifest
  // (step 1a) declares the `contacts` + `noticeboard` views.
  const manifestsByOrigin = {};
  for (const m of [stoopManifest]) {
    if (m.app)   manifestsByOrigin[m.app]   = m;
    if (m.appId) manifestsByOrigin[m.appId] = m;
  }

  it('resolves `contacts` → stoop / listContacts / category (from the real manifest)', () => {
    const found = sectionForScreen(manifestsByOrigin, 'contacts');
    expect(found).not.toBeNull();
    expect(found.appOrigin).toBe('stoop');
    expect(found.section.dataSource.skillId).toBe('listContacts');
    expect(found.section.categoryField).toBe('category');
    expect(found.section.labelField).toBe('label');
  });

  it('resolves `noticeboard` → stoop / listOpen / kind (from the real manifest)', () => {
    const found = sectionForScreen(manifestsByOrigin, 'noticeboard');
    expect(found).not.toBeNull();
    expect(found.appOrigin).toBe('stoop');
    expect(found.section.dataSource.skillId).toBe('listOpen');
    expect(found.section.categoryField).toBe('kind');
    // labelField omitted on the noticeboard view → the panel defaults to 'label'.
    expect(found.section.labelField).toBeUndefined();
  });

  it('an unknown screenId → null', () => {
    expect(sectionForScreen(manifestsByOrigin, 'nope')).toBeNull();
    expect(sectionForScreen(manifestsByOrigin, '')).toBeNull();
    expect(sectionForScreen({}, 'contacts')).toBeNull();
    expect(sectionForScreen(null, 'contacts')).toBeNull();
  });

  it('mirrors the panel config-resolution: fetch skill + args + fields the shell derives', () => {
    // The exact resolution openCircleScreenPanel performs over the projected
    // section — proves the config sourced from the manifest matches what the
    // retired LIST_SCREENS literal supplied (stoop/listContacts/category).
    const { section, appOrigin } = sectionForScreen(manifestsByOrigin, 'contacts');
    const fetchSkill    = section.dataSource.skillId;
    const fetchArgs     = section.dataSource.args ?? {};
    const categoryField = section.categoryField;
    const labelField    = section.labelField ?? 'label';
    expect({ appOrigin, fetchSkill, fetchArgs, categoryField, labelField }).toEqual({
      appOrigin: 'stoop', fetchSkill: 'listContacts', fetchArgs: {}, categoryField: 'category', labelField: 'label',
    });
  });
});
