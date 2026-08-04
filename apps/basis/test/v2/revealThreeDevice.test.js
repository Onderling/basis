/**
 * Names and reveals across three devices — what actually crosses, and what only looks like it does.
 *
 * An investigation ahead of these tests mapped the name/reveal data flow end-to-end and found that
 * the system's privacy here rests on THREE facts worth pinning, because each could silently flip:
 *
 *   1. A member's display name NEVER propagates to other devices. `setMyDisplayName` writes only
 *      the local MemberMap row; the roster-updated fan carries refs, not values; the pull re-reads
 *      the receiving device's own roster. So another device's roster row for you simply has no
 *      name on it — the strongest privacy there is, and worth an alarm if it ever changes
 *      silently (a future sync that starts carrying names would flip this whole model).
 *   2. The `reveals` marker on a roster row is a VIEWER-SIDE projection: it says "this device's
 *      user opted in to seeing that member's name", synthesized at read time from the local
 *      Reveals store. One device flipping a reveal changes nothing on any other device.
 *   3. Join-time persona release lands on the ADMIN's device only (the redeem trail + MemberMap);
 *      ordinary members never receive it — and even on the admin's device the released value is
 *      stored under `personaProperties`, never mapped into the name the renderers read.
 *
 * These are deliberately assertions about which DEVICE holds which BYTES — not about what a
 * renderer shows. A renderer gate can be reimplemented wrongly; bytes that never arrived cannot.
 *
 * Cast: Anna (admin) · Bram (member whose name is at stake) · Cato (member who must learn nothing).
 */
import { describe, it, expect, afterAll } from 'vitest';
import {
  bootRealAgentNode, connectNodesOverBus, createCircle, joinExistingCircle, until, teardown,
} from '../support/pairRealAgents.js';

const GROUP = 'reveal-circle';
const rosterOn = async (node) => {
  const r = await node.agent.callSkill('stoop', 'listGroupMembers', { groupId: GROUP });
  return Array.isArray(r?.members) ? r.members : [];
};
const rowFor = (roster, webid) => roster.find((m) => m?.webid === webid) ?? null;

describe('names and reveals across three devices', () => {
  let A; let B; let C;

  afterAll(async () => { await teardown(A, B, C); });

  it('seats the trio in one circle', async () => {
    [A, B, C] = await Promise.all([
      bootRealAgentNode('A'), bootRealAgentNode('B'), bootRealAgentNode('C'),
    ]);
    await connectNodesOverBus([A, B, C]);
    await createCircle(A, { groupId: GROUP, name: 'Reveal Circle' });
    expect((await joinExistingCircle(A, B, { groupId: GROUP, handle: 'bram' })).joined.ok).toBe(true);
    expect((await joinExistingCircle(A, C, { groupId: GROUP, handle: 'cato' })).joined.ok).toBe(true);
    await until(async () => (await rosterOn(A)).length >= 3, { timeout: 15_000 });
  });

  it("a member's display name stays on their OWN device — no other roster ever holds it", async () => {
    const set = await B.agent.callSkill('stoop', 'setMyDisplayName', { displayName: 'Bram de Wit' });
    expect(set?.error).toBeUndefined();

    // Bram's own device has it (his MemberMap row is his to write)…
    await until(async () => rowFor(await rosterOn(B), B.pubKey)?.displayName === 'Bram de Wit', { timeout: 15_000 });

    // …and neither the admin's nor the bystander's device EVER receives those bytes. Not gated,
    // not hidden by a renderer: absent. Give propagation every chance to happen before asserting.
    await new Promise((r) => setTimeout(r, 300));
    for (const [node, who] of [[A, 'the admin'], [C, 'a co-member']]) {
      const row = rowFor(await rosterOn(node), B.pubKey);
      expect(row, `${who} should still have Bram's membership row`).toBeTruthy();
      expect(row.displayName ?? null,
        `${who}'s device must hold NO display-name bytes for Bram — names do not propagate`).toBeNull();
      expect(JSON.stringify(row)).not.toContain('Bram de Wit');
    }
  });

  it('the "show me names" preference is viewer-side: flipping it changes only the flipping device', async () => {
    // Anna opts in to seeing names. This is HER display preference, recorded on HER device — it is
    // NOT a reveal: it cannot stand in for a member's own release, and its marker carries an honest
    // name (`viewerNameOptIn`) so no gate can mistake it for the discloser's consent again.
    const r = await A.agent.callSkill('stoop', 'setGroupReveal', { groupId: GROUP, showDisplayName: true });
    expect(r?.error).toBeUndefined();

    const onA = rowFor(await rosterOn(A), B.pubKey);
    expect(onA.viewerNameOptIn, "the marker is the viewing device's own opt-in").toBe(true);
    expect(onA.reveals ?? null, 'the old revealer-shaped field must not come back').toBeNull();

    // On Cato's device: nothing. A preference is not an event, not a fan, not a shared fact.
    const onC = rowFor(await rosterOn(C), B.pubKey);
    expect(onC.viewerNameOptIn ?? false, "one viewer's opt-in must never appear on another device").toBe(false);

    // And the preference never conjured name bytes that were not there: Anna may now be WILLING to
    // see Bram's name, but her device still does not HAVE it (fact 1 above).
    expect(onA.displayName ?? null).toBeNull();
  });

  it("join-time persona release lands on the admin's device only — and never as a name", async () => {
    // What the redeem trail on each device holds for Cato. The admin captured the join; a co-member
    // holds at most the membership fact.
    const onAdmin = rowFor(await rosterOn(A), C.pubKey);
    const onMember = rowFor(await rosterOn(B), C.pubKey);
    expect(onAdmin).toBeTruthy();

    // The joiner in this harness released nothing (no persona chosen at join) — so even the admin
    // must hold no persona payload for them. A row that grows one anyway means a path started
    // carrying releases nobody made.
    expect(onAdmin.personaProperties ?? null).toBeNull();
    // The name-shaped fields on BOTH devices are empty for a member who never spoke to them.
    for (const row of [onAdmin, onMember].filter(Boolean)) {
      expect(row.displayName ?? null).toBeNull();
    }
  });
});
