/**
 * FITNESS — BOTH shells offer the role change, and neither decides for itself what it will do
 * (invariants 1 + 2 + 3 + 8).
 *
 * `setMemberRole` worked end to end long before any surface offered it. It declares no slash command,
 * so with no control on either panel the only route a person had to it was asking the assistant in
 * words — the op existed, and there was no deterministic way in. That is the shape this guard exists
 * to keep from coming back on ONE platform: a control deleted from mobile leaves web fine and CI
 * green, and `src/screens/**` has no test coverage at all, so for mobile this file is the only thing
 * between a removed line and the platform going quiet again.
 *
 * What is checked is not that a button exists (a source guard cannot see one) but that each panel
 * reaches the SHARED decision and dispatches the SAME op — the two things that make the platforms one
 * surface rather than two implementations of an idea.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = (p) => fileURLToPath(new URL(p, import.meta.url));
const read = (p) => readFileSync(dir(p), 'utf8');

const WEB_ADMIN_PANEL = read('../../web/v2/circleAdminPanel.js');
const WEB_HOST        = read('../../web/v2/circleApp.js');
const RN_ADMIN_PANEL  = read('../../../basis-mobile/src/screens/v2/CircleAdminPanelScreen.js');

const PANELS = [
  ['web (circleAdminPanel.js)', WEB_ADMIN_PANEL],
  ['mobile (CircleAdminPanelScreen.js)', RN_ADMIN_PANEL],
];

describe('FITNESS — both admin panels offer the role change', () => {
  for (const [name, source] of PANELS) {
    it(`${name} asks the shared decision whether to offer it`, () => {
      expect(/roleControlFor\s*\(/.test(source),
        `${name} paints no role control — the op is reachable only by asking the assistant in words`).toBe(true);
      expect(/circleRoleControl\.js/.test(source),
        `${name} does not import the shared decision (invariant 3)`).toBe(true);
    });

    it(`${name} labels it through t(), never a baked string`, () => {
      expect(/\bt\w*\(\s*control\.labelKey\s*\)/.test(source),
        `${name} does not resolve the control's label through t() (invariant 8)`).toBe(true);
    });

    it(`${name} does not work out for itself who runs the circle`, () => {
      // Counting admins, or deciding what "the last one" means, in a shell is how two platforms end up
      // telling one circle two different stories about who it belongs to. The panels paint what the
      // shared decision returns; the counting stays in shared code.
      expect(/role\s*===\s*'admin'/.test(source), `${name} judges the admin role itself`).toBe(false);
      expect(/admins?\s*\.\s*length/.test(source), `${name} counts the circle's admins itself`).toBe(false);
      expect(/'handover'|'no-one-else'/.test(source),
        `${name} branches on the consequence itself instead of painting the one it was handed`).toBe(false);
    });
  }
});

describe('FITNESS — both shells dispatch the op, behind the confirm it declares', () => {
  // web dispatches from its host (showAdmin owns the panel's ops); mobile's screen is self-contained.
  const DISPATCHERS = [
    ['web (circleApp.js showAdmin)', WEB_HOST],
    ['mobile (CircleAdminPanelScreen.js)', RN_ADMIN_PANEL],
  ];

  for (const [name, source] of DISPATCHERS) {
    it(`${name} calls setMemberRole with the role the decision chose`, () => {
      expect(/'setMemberRole'/.test(source), `${name} never dispatches the op`).toBe(true);
      expect(/role:\s*control\.role/.test(source),
        `${name} names a role of its own rather than the one the shared decision chose`).toBe(true);
    });

    it(`${name} runs it through the SHARED confirm gate, not a second one`, () => {
      // The op declares `ui.confirm`; honouring that declaration is what makes the row button and the
      // chat path ask the same question. A shell-local window.confirm/Alert here would be a second gate
      // with its own rules about what counts as a yes.
      expect(/runConfirmGate\s*\(/.test(source), `${name} dispatches the role change with no confirmation`).toBe(true);
      expect(/roleChangeConfirm\s*\(/.test(source),
        `${name} builds its own confirmation instead of the op's declared one`).toBe(true);
    });

    it(`${name} says what happened through the decision's notice key`, () => {
      expect(/t\(\s*control\.noticeKey/.test(source),
        `${name} reports the outcome in words of its own`).toBe(true);
    });
  }
});
