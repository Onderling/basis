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
        expect(op.surfaces.ui ?? op.surfaces.page, `${op.id} has a non-slash surface`).toBeTruthy();
      }
    }
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
  it('ships the full chat+slash surface (one stoop manifest, 93 ops)', () => {
    expect(stoopManifest.operations.length).toBe(93);
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
