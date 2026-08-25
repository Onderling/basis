/**
 * FITNESS: every shared label map points at locale keys that actually exist, in BOTH languages.
 *
 * Added 2026-07-28 after a label map was written against a namespace that did not exist — the code was
 * fine, the strings were fine, and the UI would have rendered raw key names. Nothing catches that: a
 * missing translation is not an error, it is a string.
 *
 * This is the cheap half of `docs/conventions/shared-vocabularies.md`. It also fails when a locale key is
 * RENAMED and a map is left pointing at the old one, which is the more likely long-run drift.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import { DELIVERY_LABELS }        from '../../src/v2/deliveryState.js';
import { POINT_SOURCE_LABELS }    from '../../src/v2/connectionPoints.js';
import {
  NEARBY_ACTION_LABELS, NEARBY_ASK_LABELS, NEARBY_INVITE_LABELS,
} from '../../src/v2/nearbyScreen.js';
import { CIRCLE_KINDS }           from '../../src/v2/circleTemplates.js';
import { ROLE_CONTROL_KEYS }      from '../../src/v2/circleRoleControl.js';

/**
 * Vocabularies whose label keys are built by INTERPOLATION (`circle.kind.${k}`) rather than declared in
 * a map. Nothing had been checking these, and it showed: `CIRCLE_KINDS` gained `team` while the locale did
 * not, so the create wizard offered a fourth circle kind labelled `circle.kind.team` — the raw key, on
 * screen, in both languages. Found by walking S3 on a device (2026-07-29), which is far too late for a
 * missing string. An id list plus a key pattern is a label map with the checking filed off.
 */
const DERIVED = {
  'CIRCLE_KINDS → circle.kind.*': { ids: CIRCLE_KINDS, key: (id) => `circle.kind.${id}` },
};

const MAPS = {
  DELIVERY_LABELS,
  ROLE_CONTROL_KEYS,
  POINT_SOURCE_LABELS,
  NEARBY_ACTION_LABELS,
  NEARBY_ASK_LABELS,
  NEARBY_INVITE_LABELS,
};

/** Resolve a dotted key against a bundle whose leaves are `{ text, doc }`. */
function lookup(bundle, dotted) {
  // Keys are authored as `circle.a.b`; the bundle itself IS `circle`.
  const parts = dotted.replace(/^circle\./, '').split('.');
  let node = bundle;
  for (const p of parts) {
    if (!node || typeof node !== 'object') return null;
    node = node[p];
  }
  return typeof node?.text === 'string' ? node.text : null;
}

for (const lang of ['en', 'nl']) {
  describe(`FITNESS: shared label maps resolve in ${lang}`, () => {
    const bundle = JSON.parse(readFileSync(
      new URL(`../../src/locales/circle.${lang}.json`, import.meta.url), 'utf8',
    ));

    for (const [name, { ids, key }] of Object.entries(DERIVED)) {
      it(`${name} — every id has a label`, () => {
        const missing = ids.filter((id) => !lookup(bundle, key(id))).map((id) => key(id));
        expect(missing, `${name}: these ${lang} keys would render as raw keys on screen`).toEqual([]);
      });
    }

    for (const [name, map] of Object.entries(MAPS)) {
      it(`${name} — every key exists and is non-empty`, () => {
        const missing = Object.entries(map)
          .filter(([, key]) => !lookup(bundle, key))
          .map(([id, key]) => `${id} → ${key}`);
        expect(missing, `${name} points at ${lang} keys that do not exist`).toEqual([]);
      });

      it(`${name} — is frozen, so a renderer cannot mutate it`, () => {
        expect(Object.isFrozen(map)).toBe(true);
      });
    }
  });
}
