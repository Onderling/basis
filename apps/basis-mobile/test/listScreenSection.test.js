/**
 * D-mig-mobile-1b (web≡mobile) — the mobile list-screen surface (`contacts` /
 * `noticeboard`) now SOURCES its fetch/render config from the projected manifest
 * SECTION via the shared `sectionForScreen` selector, instead of the retired
 * hardcoded literal that used to live in CircleLauncherScreen.js.
 *
 * This guards behaviour-preservation: over the REAL composed manifests the
 * launcher builds (`buildManifestsByOrigin()`), the projected section resolves
 * to EXACTLY the config the retired literal supplied — so the mobile list
 * surface renders identical rows, filter, searchFields, and app dispatch.
 *
 * Portable vitest (no RN render): the launcher's list-config resolution is a
 * pure selector over the composed manifests, so we exercise it directly.
 */
import { describe, it, expect } from 'vitest';
import { buildManifestsByOrigin } from '../src/core/composeManifests.js';
import { sectionForScreen } from '../../basis/src/v2/pageProjection.js';

// The exact config the deleted `LIST_SCREENS` literal supplied (the invariant
// the migration must preserve). `noticeboard` had no `searchFields` in the literal
// → CircleListScreen's buildScreenModel defaulted to `[labelField]` (= ['label']),
// which the projected section now declares explicitly (same behaviour).
const RETIRED_LITERAL = {
  contacts: { appOrigin: 'stoop', listOp: 'listContacts', categoryField: 'category', searchFields: ['label', 'handle'] },
  noticeboard: { appOrigin: 'stoop', listOp: 'listOpen',     categoryField: 'kind' },
};

describe('mobile list-screen config sourced from the projected manifest section', () => {
  const manifestsByOrigin = buildManifestsByOrigin();

  it('sectionForScreen("contacts") == the retired literal config', () => {
    const found = sectionForScreen(manifestsByOrigin, 'contacts');
    expect(found).toBeTruthy();
    const { section, appOrigin } = found;
    expect(appOrigin).toBe(RETIRED_LITERAL.contacts.appOrigin);
    expect(section.dataSource.skillId).toBe(RETIRED_LITERAL.contacts.listOp);
    expect(section.categoryField).toBe(RETIRED_LITERAL.contacts.categoryField);
    expect(section.searchFields).toEqual(RETIRED_LITERAL.contacts.searchFields);
    // labelField default the launcher applies (`section.labelField ?? 'label'`).
    expect(section.labelField ?? 'label').toBe('label');
  });

  it('sectionForScreen("noticeboard") == the retired literal config (listOpen, kind)', () => {
    const found = sectionForScreen(manifestsByOrigin, 'noticeboard');
    expect(found).toBeTruthy();
    const { section, appOrigin } = found;
    expect(appOrigin).toBe(RETIRED_LITERAL.noticeboard.appOrigin);
    expect(section.dataSource.skillId).toBe(RETIRED_LITERAL.noticeboard.listOp);
    expect(section.categoryField).toBe(RETIRED_LITERAL.noticeboard.categoryField);
    // labelField omitted in the literal → default 'label'.
    expect(section.labelField ?? 'label').toBe('label');
    // searchFields: the literal omitted it (buildScreenModel default [labelField]);
    // the projected section declares the equivalent ['label'] explicitly.
    expect(section.searchFields ?? ['label']).toEqual(['label']);
  });

  it('the launcher list-config resolution mirrors the retired literal for every screenId', () => {
    for (const [screenId, cfg] of Object.entries(RETIRED_LITERAL)) {
      const found = sectionForScreen(manifestsByOrigin, screenId);
      expect(found, `section for ${screenId}`).toBeTruthy();
      const { section, appOrigin } = found;
      // The exact fields the launcher's fetch effect now reads off the section.
      const resolved = {
        appOrigin,
        listOp: section.dataSource?.skillId,
        categoryField: section.categoryField,
      };
      expect(resolved).toEqual({
        appOrigin: cfg.appOrigin,
        listOp: cfg.listOp,
        categoryField: cfg.categoryField,
      });
    }
  });

  it('an unknown screenId resolves to null (no list surface)', () => {
    expect(sectionForScreen(manifestsByOrigin, 'nope-not-a-screen')).toBeNull();
  });
});
