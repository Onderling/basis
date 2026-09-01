/**
 * stoop manifest structural-invariants test.
 *
 * Asserts the DRAFT manifest validates via `@onderling/app-manifest`'s
 * `validateManifest` and conforms to the basic shape the slash + chat
 * surfaces require:
 *
 *   - validateManifest(stoopManifest).ok === true
 *   - every op id is unique
 *   - every op declares { id, verb, surfaces.chat.hint,
 *     surfaces.slash.command }
 *   - no slash command in stoop's set collides with household's
 *     (snapshot stoop's set; consumer can spot-check vs household
 *     manually per the audit's collision-policy guidance).
 *
 * Per `Project Files/projects/audit-slash-coverage.md`: cross-app collision *resolution* is
 * a consumer-side host policy, but explicitly chose the
 * grammar to MINIMISE collisions at the source.  This test pins the
 * stoop command set so the choice is auditable + regression-tested.
 */

import { describe, it, expect } from 'vitest';

import { validateManifest } from '@onderling/app-manifest';

import { stoopManifest }     from '../manifest.js';

// Frozen snapshot of household's slash commands as of 2026-05-20
// (apps/household/manifest.js lines 59/78/96/116/134/153/171/186/222).
// If household grows new commands, that's a *new* potential collision —
// re-run this test in CI to surface it.
const HOUSEHOLD_COMMANDS = Object.freeze([
  '/add',
  '/list',
  '/done',
  '/remove',
  '/help',
  '/task',
  '/tasks',
  '/claim',
  '/register',
]);

describe('stoop manifest — Slice D.1 structural invariants', () => {
  it('validates via @onderling/app-manifest validateManifest', () => {
    const result = validateManifest(stoopManifest);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('every op id is unique', () => {
    const ids = stoopManifest.operations.map((op) => op.id);
    const set = new Set(ids);
    expect(set.size).toBe(ids.length);
  });

  // Part G dissolve (2026-06-17) — every op declares { id, verb,
  // surfaces.chat.hint }.  `surfaces.slash.command` is required for
  // SLASH-callable ops; button-only ops (e.g. startDm) legitimately have
  // NO slash command — so the slash assertion is conditional on the op
  // declaring a slash surface.
  it('every op declares { id, verb, surfaces.chat.hint } (+ valid slash.command when present)', () => {
    for (const op of stoopManifest.operations) {
      expect(op.id, `op missing id: ${JSON.stringify(op)}`).toBeTruthy();
      expect(typeof op.id, `${op.id} id-type`).toBe('string');

      expect(op.verb, `${op.id} verb`).toBeTruthy();
      expect(typeof op.verb, `${op.id} verb-type`).toBe('string');

      expect(op.surfaces, `${op.id} surfaces`).toBeDefined();
      expect(op.surfaces.chat, `${op.id} surfaces.chat`).toBeDefined();
      expect(op.surfaces.chat.hint, `${op.id} surfaces.chat.hint`).toBeTruthy();
      expect(typeof op.surfaces.chat.hint, `${op.id} hint-type`).toBe('string');

      if (op.surfaces.slash) {
        expect(op.surfaces.slash.command, `${op.id} surfaces.slash.command`).toBeTruthy();
        expect(typeof op.surfaces.slash.command, `${op.id} command-type`).toBe('string');
        expect(op.surfaces.slash.command.startsWith('/'), `${op.id} command starts with /`).toBe(true);
      } else {
        // No slash → must have an alternate surface (button / page).
        //
        // THE CONTROL, not merely a `ui` block. This read `op.surfaces.ui ?? op.surfaces.page` for a
        // long time, and a bare `ui: { confirm }` satisfied it — so `setMemberRole` passed this very
        // check while declaring how to ASK before an action nobody could take: no control, no slash,
        // and therefore no way to reach the op except by asking the assistant in words. The rule's
        // sentence was right and its test was one level too shallow, which is the most expensive kind
        // of green there is. A confirm is a question about an act; it is not a way to perform one.
        expect(
          op.surfaces.ui?.control ?? op.surfaces.page,
          `${op.id} declares no way IN: no slash command, and surfaces.ui carries no control `
          + `(${JSON.stringify(op.surfaces.ui ?? null)}). A confirm is not a surface.`,
        ).toBeTruthy();
      }
    }
  });

  it('and that rule BITES: a confirm-only op is not a way in', () => {
    // The assertion above is the one that let `setMemberRole` ship unreachable, so it is worth
    // proving that its replacement actually refuses the shape it used to accept — rather than
    // trusting that a stricter-looking expression is stricter.
    const confirmOnly = { chat: { hint: 'x' }, ui: { confirm: { severity: 'warn' } } };
    const withControl = { chat: { hint: 'x' }, ui: { control: 'button', confirm: { severity: 'warn' } } };
    const asPage      = { chat: { hint: 'x' }, page: 'somewhere' };

    const oldRule = (sf) => !!(sf.ui ?? sf.page);
    const newRule = (sf) => !!(sf.ui?.control ?? sf.page);

    expect(oldRule(confirmOnly), 'the old rule accepted a confirm as a surface').toBe(true);
    expect(newRule(confirmOnly), 'a confirm is a question about an act, not a way to perform one').toBe(false);
    expect(newRule(withControl)).toBe(true);
    expect(newRule(asPage)).toBe(true);
  });

  it("does not collide with household's slash commands (minimise-collision goal)", () => {
    const stoopCommands = stoopManifest.operations
      .map((op) => op.surfaces.slash?.command)
      .filter(Boolean);
    const collisions = stoopCommands.filter((c) => HOUSEHOLD_COMMANDS.includes(c));
    expect(
      collisions,
      `stoop commands ${JSON.stringify(stoopCommands)} collide with household commands ${JSON.stringify(collisions)}`,
    ).toEqual([]);
  });

  // Part G dissolve (2026-06-17) — the former mockStoopManifest's
  // chat-shell ops (holiday-mode / contacts / wizards / groups / share-qr
  // / startDm + the thin listFeed/getStoopProfile aliases) folded in, so
  // the op set grew from the D.1 ~14 to 33.  2026-07-18: +1 for the
  // legacy `setMySkills` alias op (kept so the old `/skills` slash trigger
  // still dispatches after the skill→offering op-id rename) → 34.
  // 2026-08-24: -1, the legacy `setMySkills` alias retired (no back-compat; `/offerings` is the
  // one route to the op it aliased) → 98.
  // 2026-08-20: +2 for the rules-update rider — `recordGroupRulesUpdate` (the receive half —
  // plumbing, ui control 'none') and `broadcastCircleGovernance` (the fan, declared like its
  // membership/chat/task siblings — it predated the callskill-literals guard undeclared).
  // 2026-08-21: +1 for `getGroupRulesUpdateStatement` (the durable-head read the catch-up serves
  // after the lane's audit window — the final setting is never deletable), +1 for
  // `recordRosterSeed` (the pod-less enroll roster-seed's local write) → 97, then
  // `broadcastCircleKeyStatement` (the key-rotation fan) and `setMemberRole` (promote/demote on the
  // spine) → 99, then -3 for the three mute ops: blocking a person is a whole-device decision
  // and the shell owns the one set, so this app reads it and no longer offers a door to it → 96.
  // This number is a snapshot on purpose: adding an op to the waist should be a deliberate act
  // that someone updates a count for, not something that slips in unremarked.
  it('ships the full chat+slash surface (one stoop manifest, 96 ops)', () => {
    expect(stoopManifest.operations.length).toBe(96);
  });

  // No two ops may declare the same slash command (Part G hard guardrail
  // — no double-handlers).
  it('no two ops claim the same slash command', () => {
    const cmds = stoopManifest.operations
      .map((op) => op.surfaces.slash?.command)
      .filter(Boolean);
    const dup = cmds.filter((c, i) => cmds.indexOf(c) !== i);
    expect(dup).toEqual([]);
  });

  // Part G dissolve (2026-06-17) — adds the app-local chat-shell types
  // 'post'/'contact'/'member' (used by the relocated ops' appliesTo +
  // the feed/contacts views) on top of the eight D.1 substrate types.
  it('declares the eight substrate itemTypes + the three Part-G chat-shell types', () => {
    expect(stoopManifest.itemTypes).toEqual([
      'ask',
      'offer',
      'lend',
      'report',
      'group-rules',
      'rules-accept',
      'group-leave',
      'request',
      'post',
      'contact',
      'member',
    ]);
  });

  // adoption (2026-05-21) — signOutOfPod gets a warn-level
  // confirm.  Profile.html's sign-out button currently mirrors the
  // message verbatim (manifest is source-of-truth; page hand-coded
  // confirm references the same text).
  it('signOutOfPod declares Q27 confirm with severity:warn (Dutch message)', () => {
    const op = stoopManifest.operations.find((o) => o.id === 'signOutOfPod');
    expect(op).toBeTruthy();
    expect(op.surfaces.ui.confirm).toEqual({
      severity: 'warn',
      message:  'Uitloggen van je pod?  Lopende synchronisatie wordt afgebroken.',
    });
  });
});
