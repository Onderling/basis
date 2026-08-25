/**
 * FITNESS — BOTH shells say HOW someone is an admin, and neither works it out for itself
 * (invariants 2 + 3 + 8).
 *
 * There are three ways to be a circle's admin: you made it, an admin promoted you, or the circle was
 * left without one and the projection handed it to you. Until the roster carried the difference, all
 * three rendered as the same word — and the third is the one nobody chose: not the person, not any
 * admin. It is the one a member most needs told, and it was the one nothing could say.
 *
 * Source-text guards, for the reason `shellsUseSharedMembershipHygiene` gives: the projection is
 * proven by its own suites (`apps/stoop/test/deriveRoster.test.js`,
 * `packages/kring-host/test/circleMembers.test.js`) and the web paint by a DOM test
 * (`test/v2/circleViewMembers.dom.test.js`), but `src/screens/**` has no coverage at all, so for
 * mobile this file is the only thing between a deleted line and one platform going quiet.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = (p) => fileURLToPath(new URL(p, import.meta.url));
const read = (p) => readFileSync(dir(p), 'utf8');

const WEB_MEMBERS_TAB  = read('../../web/v2/circleView.js');
const RN_MEMBERS_TAB   = read('../../../basis-mobile/src/screens/v2/CircleLauncherScreen.js');
const WEB_ADMIN_PANEL  = read('../../web/v2/circleAdminPanel.js');
const RN_ADMIN_PANEL   = read('../../../basis-mobile/src/screens/v2/CircleAdminPanelScreen.js');

describe('FITNESS — the member list names the admins on both shells', () => {
  const LISTS = [
    ['web (circleView.js)', WEB_MEMBERS_TAB],
    ['mobile (CircleLauncherScreen.js)', RN_MEMBERS_TAB],
  ];

  for (const [name, source] of LISTS) {
    it(`${name} badges the role`, () => {
      expect(source.includes('circle.admin.role.'),
        `${name} lists members without ever saying which of them run the circle`).toBe(true);
    });

    it(`${name} shows HOW they came by it, through the shared compute's label key`, () => {
      // `m.admin` is what `memberToViewAs` attaches (via `memberAdminStatus`), and `labelKey` is the
      // key it names. A shell picking its own key would be a second answer to the same question.
      expect(/m\.admin\b/.test(source), `${name} drops the provenance the roster carries`).toBe(true);
      expect(source.includes('m.admin.labelKey'),
        `${name} labels the provenance with a key of its own instead of the shared compute's`).toBe(true);
    });

    it(`${name} does not decide what "caretaker" means for itself`, () => {
      // Parsing `caretaker:<hash>` in a shell is how two platforms end up disagreeing about the one
      // case nobody chose. The shells compare the computed `via`; the raw word stays in shared code.
      expect(source.includes("'caretaker:'"), `${name} parses the raw provenance word itself`).toBe(false);
      expect(/adminVia\s*===/.test(source), `${name} branches on the raw provenance word itself`).toBe(false);
    });
  }
});

describe('FITNESS — the admin panel says it too, on both shells', () => {
  const PANELS = [
    ['web (circleAdminPanel.js)', WEB_ADMIN_PANEL],
    ['mobile (CircleAdminPanelScreen.js)', RN_ADMIN_PANEL],
  ];

  for (const [name, source] of PANELS) {
    it(`${name} reads the provenance through the shared \`memberAdminStatus\``, () => {
      // These panels are handed RAW `listGroupMembers` rows, so each has to read `adminVia` off the
      // row — through the ONE compute, never a per-panel reading of the same string.
      expect(source.includes('memberAdminStatus'),
        `${name} shows a role badge with no way of telling the three ways of holding it apart`).toBe(true);
      expect(source.includes('@onderling/kring-host/circleMembers'),
        `${name} does not import the shared compute (invariant 3)`).toBe(true);
    });

    it(`${name} labels it through t(), never a baked string`, () => {
      expect(/\b(tr|t)\(\s*(via\.labelKey|m\.admin\.labelKey)\s*\)/.test(source),
        `${name} does not resolve the provenance label through t() (invariant 8)`).toBe(true);
    });
  }
});
