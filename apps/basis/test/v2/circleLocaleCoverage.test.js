// Fitness guard — every user-facing settings/screen label the B surfaces render
// MUST resolve to a real string in BOTH locales. A missing key would leak a raw
// i18n path onto the screen (e.g. "CIRCLE.SETTINGS.VIEW", "circle.settings.opt.chat"),
// which is exactly what device verification caught on 2026-07-02 (freedom matrix +
// ⋯-menu contacts item). Adding an axis/enum value or a screen labelKey without its
// locale entry now FAILS CI instead of shipping a raw key.
//
// Sources of truth (single-definition, imported — not copied):
//   · ENUM_AXES              — web/v2/circleSettings.js (which axes the form renders)
//   · CIRCLE_POLICY_ENUMS    — src/v2/circlePolicy.js  (the option values per axis)
//   · DEFAULT_CIRCLE_ORIGINS — src/v2/circleSources.js (app-label headers in the matrix)
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ENUM_AXES } from '../../web/v2/circleSettings.js';
import { CIRCLE_POLICY_ENUMS } from '../../src/v2/circlePolicy.js';
import { DEFAULT_CIRCLE_ORIGINS } from '../../src/v2/circleSources.js';
// Phase 4 §9 — the manifest-declared Connection & transport controls (source of truth, invariant #4).
import { settingsControlsFromManifest } from '../../src/v2/circleSettingsControls.js';
import { basisManifest } from '../../src/index.js';

const SETTINGS_CONTROLS = settingsControlsFromManifest(basisManifest);

const LOCALES = ['en', 'nl'];
const load = (lang) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../src/locales/circle.${lang}.json`, import.meta.url)), 'utf8'));

// Mirror the t() lookup: walk the dot-path into the nested { text, doc } tree and
// return the leaf `.text`. A missing node (or a node without `.text`) → undefined,
// which is how t() would fall back to echoing the raw key onto the surface.
function resolve(tree, key) {
  const path = key.replace(/^circle\./, '').split('.');
  let node = tree;
  for (const seg of path) {
    if (node == null || typeof node !== 'object') return undefined;
    node = node[seg];
  }
  return node && typeof node === 'object' ? node.text : undefined;
}

describe('circle settings/screen locale coverage', () => {
  for (const lang of LOCALES) {
    const tree = load(lang);

    it(`[${lang}] every rendered enum axis has a header label`, () => {
      const missing = ENUM_AXES.filter((axis) => typeof resolve(tree, `circle.settings.${axis}`) !== 'string');
      expect(missing, `missing circle.settings.<axis>: ${missing.join(', ')}`).toEqual([]);
    });

    it(`[${lang}] every option value of a rendered axis has a label`, () => {
      const missing = [];
      for (const axis of ENUM_AXES) {
        for (const value of CIRCLE_POLICY_ENUMS[axis] || []) {
          if (typeof resolve(tree, `circle.settings.opt.${value}`) !== 'string') missing.push(`${axis}:${value}`);
        }
      }
      expect(missing, `missing circle.settings.opt.<value>: ${missing.join(', ')}`).toEqual([]);
    });

    it(`[${lang}] every app in the freedom matrix has a header label`, () => {
      // basis is the shell's own origin (surfaces its infra ops as capabilities);
      // the rest are the default circle app origins.
      const origins = ['basis', ...DEFAULT_CIRCLE_ORIGINS];
      const missing = origins.filter((o) => typeof resolve(tree, `circle.settings.app.${o}`) !== 'string');
      expect(missing, `missing circle.settings.app.<origin>: ${missing.join(', ')}`).toEqual([]);
    });

    it(`[${lang}] the ⋯-menu / bot-reply screen labels resolve`, () => {
      // Screen list-surfaces reachable from the overflow menu or a bot reply.
      for (const screen of ['contacts', 'tasks', 'calendar']) {
        expect(resolve(tree, `circle.screen.open.${screen}`), `circle.screen.open.${screen}`).toBeTypeOf('string');
      }
    });

    it(`[${lang}] the SP-5b audience-scope caption resolves`, () => {
      // Non-dismissible caption a scoped list renders under its title.
      expect(resolve(tree, 'circle.screen.audience_scope'), 'circle.screen.audience_scope').toBeTypeOf('string');
    });

    it(`[${lang}] every §9 Connection control label/hint (+ option + disabled-hint) resolves`, () => {
      // Adding a manifest settings control (or an option) without its locale entry now FAILS CI
      // instead of shipping a raw key onto the settings surface.
      const missing = [];
      expect(resolve(tree, 'circle.settings.connection'), 'circle.settings.connection').toBeTypeOf('string');
      for (const c of SETTINGS_CONTROLS) {
        for (const key of [c.labelKey, c.hintKey, c.disabledHintKey].filter(Boolean)) {
          if (typeof resolve(tree, key) !== 'string') missing.push(key);
        }
        if (c.optLabelPrefix && Array.isArray(c.of)) {
          for (const opt of c.of) {
            if (typeof resolve(tree, `${c.optLabelPrefix}.${opt}`) !== 'string') missing.push(`${c.optLabelPrefix}.${opt}`);
          }
        }
      }
      expect(missing, `missing settings-control locale keys: ${missing.join(', ')}`).toEqual([]);
    });
  }
});
