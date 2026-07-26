/**
 * Fitness — the settings axes are ONE list, and every axis it names actually resolves.
 *
 * Found 2026-07-26 while adding `decisionDeadline`: web and mobile each carried their OWN `ENUM_AXES`
 * array, under the same copy-pasted comment, and they had DRIFTED — the mobile copy omitted
 * `storagePosture` and `sharePosture`, so a mobile admin could not set either. Nothing failed when that
 * happened, which is the actual defect (invariants 1/2/3: logic lives once, web ≡ mobile, no duplication).
 *
 * The list now lives in `src/v2/circlePolicy.js` and both shells import it. This guards that:
 *   1. neither shell reintroduces a local array;
 *   2. every axis has options, a section label, and per-option labels in BOTH locales.
 * Source-reading, deliberately: the failure mode is a shell declaring its own list, which no runtime
 * assertion against the shared module could ever see.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SETTINGS_ENUM_AXES, CIRCLE_POLICY_ENUMS, DEFAULT_CIRCLE_POLICY } from '../../src/v2/circlePolicy.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const locale = (lang) => JSON.parse(read(`../../src/locales/circle.${lang}.json`));
const at = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);

const SHELLS = [
  ['web', '../../web/v2/circleSettings.js'],
  ['mobile', '../../../basis-mobile/src/screens/v2/CircleSettingsScreen.js'],
];

describe('the settings axis list is shared, not copied', () => {
  it.each(SHELLS)('%s does not declare its own axis array', (_name, rel) => {
    const src = read(rel);
    // A local literal array of axis names is the drift. `= SETTINGS_ENUM_AXES` (or the re-export) is fine.
    const localLiteral = /(?:const|let|var)\s+\w*ENUM_AXES\w*\s*=\s*\[/.exec(src);
    expect(localLiteral, `${_name} re-declared the axis list as a literal — import SETTINGS_ENUM_AXES instead`).toBeNull();
  });

  it.each(SHELLS)('%s references the shared list by name', (_name, rel) => {
    expect(read(rel)).toContain('SETTINGS_ENUM_AXES');
  });

  it('every axis the surface renders has options declared', () => {
    for (const axis of SETTINGS_ENUM_AXES) {
      expect(CIRCLE_POLICY_ENUMS[axis], `${axis} has no options`).toBeTruthy();
      expect(CIRCLE_POLICY_ENUMS[axis].length).toBeGreaterThan(1);
      // …and the circle's default is one of them, or the radio group renders with nothing selected.
      expect(CIRCLE_POLICY_ENUMS[axis]).toContain(DEFAULT_CIRCLE_POLICY[axis]);
    }
  });

  it('every axis + option resolves in BOTH locales — no raw key reaches a surface', () => {
    for (const lang of ['en', 'nl']) {
      const L = locale(lang);
      for (const axis of SETTINGS_ENUM_AXES) {
        expect(at(L, `settings.${axis}`)?.text, `${lang}: settings.${axis}`).toBeTruthy();
        for (const opt of CIRCLE_POLICY_ENUMS[axis]) {
          expect(at(L, `settings.opt.${opt}`)?.text, `${lang}: settings.opt.${opt}`).toBeTruthy();
        }
      }
    }
  });

  it('option VALUES are globally unique, because the opt locale namespace is shared by every axis', () => {
    // `circle.settings.opt.<value>` is keyed on the value alone, so two axes sharing a value would show
    // each other's label. This is why `decisionDeadline` uses 'open-ended' and not 'none' (already taken).
    const seen = new Map();
    for (const axis of SETTINGS_ENUM_AXES) {
      for (const opt of CIRCLE_POLICY_ENUMS[axis]) {
        if (seen.has(opt)) {
          expect.fail(`option "${opt}" is used by both ${seen.get(opt)} and ${axis} — they would share one label`);
        }
        seen.set(opt, axis);
      }
    }
  });

  it('mobile gained the two axes it was missing', () => {
    // The specific regression this file exists for.
    expect(SETTINGS_ENUM_AXES).toContain('storagePosture');
    expect(SETTINGS_ENUM_AXES).toContain('sharePosture');
    expect(read('../../../basis-mobile/src/screens/v2/CircleSettingsScreen.js')).toContain('SETTINGS_ENUM_AXES');
  });
});
