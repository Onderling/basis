/**
 * basis — node-level regression for REGISTRY RESTORE-AND-OPEN (the READ side of the circle-membership
 * registry). Guards the consumer that was missing: write-on-join records a `{handle, address}` record per
 * circle on the default profile, but until now NOTHING read it back, so a circle only ever opened on a user
 * action — and a wiped-then-restored device (identity re-derived from the recovery phrase, but every circle
 * gone) stayed dark. `realAgent` now enumerates those records at boot and re-opens each circle
 * (`reopenMemberCircles`), which this test crosses directly.
 *
 * The seam this asserts: circle-membership REGISTRY (read) → `ensureCircleSync` (the real per-circle
 * store<->transport wire). We seed a membership through the REAL op (`agents.setProfileCircleMembership`,
 * the same op write-on-join calls), then run the REAL re-open the boot path runs, and assert it re-opened
 * EXACTLY the circle named in the registry — not a hardcoded set, and not a circle the registry never
 * mentioned. Then we prove the re-opened circle's store is genuinely LIVE by round-tripping a task through
 * it (tasks ride the one household store per G-C1).
 *
 * In-process, one agent (no pod, no mesh needed — this is about the registry→open wire, not fan-out).
 */
import { describe, it, expect, afterAll } from 'vitest';

import { bootRealAgentNode, teardown } from './support/pairRealAgents.js';

const RESTORED = 'restored-circle';       // a circle the device "belongs to" (has a membership record for)
const NEVER    = 'never-joined-circle';   // a circle with NO membership record — must NOT be re-opened

describe('registry restore-and-open — the boot re-open reads the membership registry and re-opens those circles', () => {
  let A;
  afterAll(async () => { await teardown(A); });

  it('re-opens exactly the circles in the membership registry (and the store is live), not a hardcoded set', async () => {
    A = await bootRealAgentNode('restorer');

    // A fresh boot knows no joined circles yet: the registry read comes back with nothing to re-open
    // (the default 'household' + tasks-primary are opened by their own eager boot steps, never via this loop).
    const before = await A.agent.reopenMemberCircles();
    expect(before.reopened, 'no membership records yet → nothing re-opened from the registry').not.toContain(RESTORED);

    // Record a membership the way JOIN does — the exact op (`setProfileCircleMembership`) write-on-join calls,
    // on the default profile. This is the durable "I belong to RESTORED" the restore path relies on.
    const wrote = await A.agent.callSkill('agents', 'setProfileCircleMembership', {
      id: 'default', circleId: RESTORED, handle: 'restorer', address: 'relay:restored-addr',
    });
    expect(wrote?.ok, 'the membership record was written').toBe(true);

    // Run the REAL re-open the boot path runs. It must now discover RESTORED from the registry and re-open it
    // — and must NOT invent a circle the registry never named.
    const after = await A.agent.reopenMemberCircles();
    expect(after.reopened, 'the circle named in the registry is re-opened').toContain(RESTORED);
    expect(after.reopened, 'a circle with no membership record is not re-opened').not.toContain(NEVER);

    // The re-open is not a no-op: the circle's ONE store is live, so a task round-trips through it.
    const created = await A.agent.callSkill('tasks', 'addTask', { text: 'after restore', circleId: RESTORED });
    expect(created?.ok, 'a task write into the re-opened circle succeeds').toBe(true);
    const listed = await A.agent.callSkill('tasks', 'listOpen', { circleId: RESTORED });
    const items = Array.isArray(listed?.items) ? listed.items : [];
    expect(items.find((t) => t.id === created.itemId), 'the task is readable back from the re-opened circle store').toBeTruthy();
  });
});
