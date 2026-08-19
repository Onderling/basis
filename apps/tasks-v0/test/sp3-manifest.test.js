/**
 * V0 manifest test.
 *
 * Asserts:
 *   - The tasks-v0 manifest validates (`validateManifest`).
 *   - Every manifest op id matches a `defineSkill` id in
 *     `src/skills/index.js`'s `buildSkills()` output (so the manifest
 *     and the agent stay in sync — if a skill is renamed / removed,
 *     this test catches it before the LLM hits a wall).
 *   - `renderChat(manifest)` produces a well-formed toolCatalogue
 *     covering every op with the expected shape.
 *   - `commandMenu` is empty (no `surfaces.slash` in V0 — chat-only).
 *
 * No web-UI tests; the existing 47 test files cover that surface.
 */

import { describe, it, expect } from 'vitest';

import { renderChat, validateManifest } from '@onderling/app-manifest';

import { tasksManifest }          from '../manifest.js';
import { buildSkills }            from '../src/skills/index.js';
import { buildWorkspaceSkills }   from '../src/skills/workspace.js';
import { buildInboxSkills }       from '../src/skills/inbox.js';
import { buildSubtaskSkills }     from '../src/skills/subtasks.js';
import { buildCircleControlSkills } from '../src/skills/circleControls.js';
// Part G (2026-06-17) — the merged manifest now carries the chat-shell
// surface ops, whose skills live in these additional builders (the same
// set `wireSkills` registers).  Expand the coverage check to include them.
import { buildAvailabilitySkills }       from '../src/skills/availability.js';
import { buildPlannerSkills }            from '../src/skills/planner.js';
import { buildDashboardSkills }          from '../src/skills/dashboard.js';
import { buildMultiCircleOnboardingSkills } from '../src/skills/multiCircleOnboarding.js';

/**
 * Part G (2026-06-17) — chat-shell ops whose dispatch resolves through
 * realAgent.js (alias / derivation), NOT a same-named `defineSkill`:
 *   - myInbox        → aliased to `listMyInbox` (TASKS_OP_ALIAS)
 *   - listCircleMembers→ derived from `getCircleConfig` (members[] unpack)
 * These are intentional product semantics; exempt from the 1:1 check.
 */
const CHAT_SHELL_ALIAS_OPS = new Set(['myInbox', 'listCircleMembers']);

describe('SP-3 V0: tasks-v0 manifest', () => {
  it('validateManifest = ok', () => {
    const { ok, errors } = validateManifest(tasksManifest);
    expect(ok, JSON.stringify(errors, null, 2)).toBe(true);
  });

  it('every manifest op id matches a defineSkill across the registered builders', () => {
    // V0 ops live in `buildSkills`; (2026-05-20) added
    // `getDagTree`, which lives in `buildWorkspaceSkills`..3
    // (2026-05-20) added `listMyInbox` + `clearInboxItem`, which live
    // in `buildInboxSkills`.  This is the same registration set that
    // `wireSkills` wires onto the meshAgent — expand here when new
    // builders surface manifest ops.
    const defs = [
      ...buildSkills({ bundleResolver: () => null }),
      ...buildWorkspaceSkills({ bundleResolver: () => null }),
      ...buildInboxSkills({ bundleResolver: () => null }),
      ...buildSubtaskSkills({ bundleResolver: () => null }),
      // adoption (2026-05-21) — archiveCircle + unarchiveCircle
      // declared in the manifest; their defineSkill lives in
      // buildCircleControlSkills.
      ...buildCircleControlSkills({ bundleResolver: () => null }),
      // Part G (2026-06-17) — chat-shell surface ops folded in from the
      // former mockTasksManifest; their skills live in these builders.
      ...buildAvailabilitySkills({ bundleResolver: () => null }),
      ...buildPlannerSkills({ bundleResolver: () => null }),
      ...buildDashboardSkills({ bundleResolver: () => null, circlesProvider: () => [] }),
      ...buildMultiCircleOnboardingSkills({ bundleResolver: () => null }),
    ];
    const skillIds = new Set(defs.map((d) => d.id));
    for (const op of tasksManifest.operations) {
      if (CHAT_SHELL_ALIAS_OPS.has(op.id)) continue;   // resolved via realAgent alias/derivation
      expect(
        skillIds,
        `manifest op "${op.id}" must have a matching skill in the registered builders`,
      ).toContain(op.id);
    }
  });

  it('confirmClaim op surfaces a button + slash (the claim-confirmation UX) and addTask offers the auto/explicit toggle', () => {
    const confirm = tasksManifest.operations.find((o) => o.id === 'confirmClaim');
    expect(confirm, 'confirmClaim op is declared').toBeTruthy();
    expect(confirm.verb).toBe('confirm');                          // the lifecycle atom
    expect(confirm.appliesTo).toEqual({ type: 'task', state: ['pending-confirmation'] });
    expect(confirm.surfaces?.ui?.control).toBe('button');         // the card 'Confirm claim' button
    expect(confirm.surfaces?.slash?.command).toBe('/confirm');    // the slash surface
    expect(confirm.params.some((p) => p.name === 'id' && p.required)).toBe(true);

    const addTask = tasksManifest.operations.find((o) => o.id === 'addTask');
    const mode = addTask.params.find((p) => p.name === 'claimConfirmation');
    expect(mode, 'addTask offers the confirmation-mode toggle at creation').toBeTruthy();
    expect(mode.kind).toBe('enum');
    expect(mode.of).toEqual(['auto', 'explicit']);
  });

  it('renderChat produces well-formed toolCatalogue covering every op', () => {
    const stub = Object.fromEntries(
      tasksManifest.operations.map((op) => [
        op.id,
        async () => ({ replies: [], stateUpdates: [] }),
      ]),
    );
    const out = renderChat(tasksManifest, {
      skillRegistry: stub,
      toSkillCtx:    (c) => c,
    });

    expect(out.toolCatalogue).toHaveLength(tasksManifest.operations.length);
    expect(Object.keys(out.toolHandlers)).toHaveLength(tasksManifest.operations.length);

    for (const t of out.toolCatalogue) {
      expect(t.id).toBeTruthy();
      expect(typeof t.description).toBe('string');
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.schema.type).toBe('object');
      expect(t.schema.properties).toBeTypeOf('object');
    }

    // Spot-check a state-gated op carries the multi-state array (F-SP3-a).
    const revoke = tasksManifest.operations.find((op) => op.id === 'revokeTask');
    expect(revoke.appliesTo.state).toEqual(['claimed', 'submitted', 'rejected']);
  });

  it('commandMenu carries the Part-G slash surface (folded in from mockTasksManifest)', () => {
    // Part G (2026-06-17): the manifest is now the single source of truth
    // for the chat-shell's slash/gate surface, so commandMenu is no longer
    // empty.  Spot-check the lifecycle commands are present.
    const out = renderChat(tasksManifest, {
      skillRegistry: {},
      toSkillCtx:    (c) => c,
    });
    expect(out.commandMenu.length).toBeGreaterThan(0);
    const commands = out.commandMenu.map((c) => c.command);
    expect(commands).toEqual(expect.arrayContaining([
      '/addtask', '/claim', '/complete-task', '/submit', '/approve', '/reject',
    ]));
  });

  it('inlineKeyboardFor honours F-SP3-a multi-state gates on real ops', () => {
    const stub = Object.fromEntries(
      tasksManifest.operations.map((op) => [op.id, async () => ({})]),
    );
    const out = renderChat(tasksManifest, { skillRegistry: stub, toSkillCtx: (c) => c });

    // A submitted task → submit's gate is ['claimed','rejected'] so it
    // should NOT match; approve and reject's gate is ['submitted'] so
    // both SHOULD match; revoke's gate includes 'submitted' so it
    // matches too; claim only matches 'open'.
    const submittedKeys = out.inlineKeyboardFor({ id: 't1', type: 'task', state: 'submitted' })
      .map((b) => b.callbackData.split(':')[0]);
    expect(submittedKeys).toEqual(expect.arrayContaining(['approveTask', 'rejectTask', 'revokeTask']));
    expect(submittedKeys).not.toContain('submitTask');
    expect(submittedKeys).not.toContain('claimTask');

    // An open task → claim matches; Part G (2026-06-17) also surfaces the
    // open/claimed-gated editTask + addSubtask row buttons (folded in from
    // the former mockTasksManifest), so assert membership not exact equality.
    const openKeys = out.inlineKeyboardFor({ id: 't2', type: 'task', state: 'open' })
      .map((b) => b.callbackData.split(':')[0]);
    expect(openKeys).toEqual(expect.arrayContaining(['claimTask']));
    expect(openKeys).not.toContain('submitTask');
    expect(openKeys).not.toContain('approveTask');
  });

  // adoption (2026-05-21) — circle lifecycle ops.
  it('archiveCircle declares Q27 confirm with severity:warn + Dutch-friendly message', () => {
    const op = tasksManifest.operations.find((o) => o.id === 'archiveCircle');
    expect(op).toBeTruthy();
    expect(op.appliesTo).toEqual({ type: 'circle' });
    expect(op.surfaces.ui.confirm).toEqual({
      severity: 'warn',
      message:  'Archive this circle?  Items are kept; new tasks are blocked until you unarchive.',
    });
  });

  it('unarchiveCircle has NO confirm (undo path; low-barrier)', () => {
    const op = tasksManifest.operations.find((o) => o.id === 'unarchiveCircle');
    expect(op).toBeTruthy();
    expect(op.appliesTo).toEqual({ type: 'circle' });
    expect(op.surfaces.ui).not.toHaveProperty('confirm');
  });

  it("archive ops do NOT surface on a task's inline keyboard (appliesTo: 'circle' scope)", () => {
    const stub = Object.fromEntries(
      tasksManifest.operations.map((op) => [op.id, async () => ({})]),
    );
    const out = renderChat(tasksManifest, { skillRegistry: stub, toSkillCtx: (c) => c });
    const openKeys = out.inlineKeyboardFor({ id: 't', type: 'task', state: 'open' })
      .map((b) => b.callbackData.split(':')[0]);
    expect(openKeys).not.toContain('archiveCircle');
    expect(openKeys).not.toContain('unarchiveCircle');
  });
});
