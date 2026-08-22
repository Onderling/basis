/**
 * basis — the LIVE no-pod group-key rotation: driven by the REAL `removeMember` op, not a harness stand-in.
 *
 * `appNoPodKeyRotation.test.js` proves the MECHANISM (key-events in the log) by calling the key-event
 * builders directly via the harness's `removeAndRotate`. This test proves the WIRING: that removing a member
 * through the production op path actually FIRES that mechanism. The path exercised end-to-end is
 *
 *   admin.callSkill('stoop','removeMember')  →  stoop removeMember skill (revokePodAccess)
 *     →  the per-circle control-agent ROUTER (stoopControlAgent)
 *       →  the circle producer's control agent (createControlAgent.removeMember → emitKeyEvent)
 *         →  the injected keyEventLog SINK  →  records the admin's copy + FANS the rotation key-event
 *            to the REMAINING members only, over the real InternalBus transport.
 *
 * No stand-in on the remove path. The producer + sink are the SAME `createCirclePodProducer` +
 * `makeKeyEventLogSink` the web shell (circleApp.js) wires; the harness only supplies node equivalents of
 * the transport addressing (member nodes) and the in-memory pod — exactly the seams the browser supplies too.
 *
 * No stand-in on the RECEIVE path either: the fanned key-event reaches B through the REAL `makePeerRouter`
 * dispatch → the REAL key-lane statement handler → the REAL `createKeyEventStore` (the exact modules
 * circleApp.js wires). Nothing in the harness records the key-event on B's behalf — the production receive is
 * what makes B hold v2 and read post-removal content, and what keeps C (never a recipient) unable to.
 *
 * Asserts, over THREE real agents on one shared bus (A admin + B + C), no pod / no browser / no relay:
 *   - the sealed circle is established through the producer; A seals content B and C both read;
 *   - A removes C via the REAL op → the control agent rotates + the sink fans the v2 key-event to B ALONE;
 *   - A seals NEW content under the new version → B (remaining) reads it, C canNOT (backward secrecy: C never
 *     received the rotation key-event, so its folded chain lacks the new version);
 *   - C still reads the PRE-removal content it was entitled to (removal denies the future, not the past).
 */
import { describe, it, expect, afterAll } from 'vitest';

import {
  bootRealAgentNode, connectNodesOverBus, createCircle, joinExistingCircle,
  sealCircleViaProducer, postSealed, readSealed, until, teardown,
} from './support/pairRealAgents.js';

const GID = 'sealed-circle-live-remove';

describe('no-pod key rotation fired by the REAL removeMember op (three real agents, one shared bus)', () => {
  let A; let B; let C;

  afterAll(async () => { await teardown(A, B, C); });

  it('the live removeMember op rotates the group key + fans it to the remaining member only (backward secrecy)', async () => {
    [A, B, C] = await Promise.all([
      bootRealAgentNode('A'), bootRealAgentNode('B'), bootRealAgentNode('C'),
    ]);
    await connectNodesOverBus([A, B, C]);

    // A creates ONE circle; B and C both join it (real join → membership trail + stoop MemberMap).
    await createCircle(A, { groupId: GID, name: 'Sealed Circle' });
    await joinExistingCircle(A, B, { groupId: GID, handle: 'bee' });
    await joinExistingCircle(A, C, { groupId: GID, handle: 'cee' });

    // Seal the circle through the REAL producer + control agent (wired with the production key-event sink):
    // this establishes v1 + fans the establishing key-event to B and C so all three hold the group key.
    await sealCircleViaProducer({ admin: A, members: [B, C], groupId: GID });
    await until(() => B.keyEvents.length >= 1 && C.keyEvents.length >= 1);
    expect(B.keyEvents.some((e) => e.version === 1)).toBe(true);
    expect(C.keyEvents.some((e) => e.version === 1)).toBe(true);

    // ── A posts content BOTH B and C can read (all three current members, version 1). ──
    const before = `before removal ${Date.now().toString(36)}`;
    const beforeEnv = await postSealed({ admin: A, members: [B, C], groupId: GID, text: before });
    await until(() => B.sealedContent.length >= 1 && C.sealedContent.length >= 1);
    expect(readSealed(B, beforeEnv, GID)).toBe(before);
    expect(readSealed(C, beforeEnv, GID)).toBe(before);

    // ── A removes C through the REAL op (the exact call the admin panel's onRemove makes). ──
    // The stoop skill → control-agent router → producer control agent → emitKeyEvent → sink → fan.
    const res = await A.agent.callSkill('stoop', 'removeMember', { groupId: GID, memberWebid: C.pubKey });
    expect(res?.error, `removeMember refused: ${res?.error}`).toBeFalsy();

    // The rotation key-event (v2) reached B (a remaining member) and NOT C (the departed). B holds it because
    // the PRODUCTION receive handler recorded it into B's PRODUCTION key-event store — no harness stand-in.
    const gotV2 = await until(() => B.keyEventStore.has(GID, 2));
    expect(gotV2, 'B received + recorded the rotation key-event via the production peer-router receive').toBeTruthy();
    expect(C.keyEventStore.has(GID, 2)).toBe(false);   // C was excluded from the fan → never recorded v2

    // ── A posts NEW content under the new version. ──
    const after = `after removal ${Date.now().toString(36)}`;
    const afterEnv = await postSealed({ admin: A, members: [B, C], groupId: GID, text: after });

    // C is still online and receives the (undecryptable) new content, but holds no v2 key → DENIED.
    await until(() => C.sealedContent.length >= 2);
    expect(() => readSealed(C, afterEnv, GID)).toThrow();          // backward secrecy — no pod involved
    // C still reads the PRE-removal content it was entitled to (removal denies the future, not the past).
    expect(readSealed(C, beforeEnv, GID)).toBe(before);

    // B (remaining member) decrypts EVERYTHING it is entitled to: both the pre-removal and the new content.
    await until(() => B.sealedContent.find((c) => c.env === afterEnv) || B.sealedContent.length >= 2);
    expect(readSealed(B, beforeEnv, GID)).toBe(before);
    expect(readSealed(B, afterEnv, GID)).toBe(after);
  }, 40000);
});
