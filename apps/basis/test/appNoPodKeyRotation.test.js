/**
 * basis — node-level, in-process NO-POD GROUP-KEY ROTATION (self-distributing key-events in the log).
 *
 * The gap this closes: today the shared-pod control-agent rotates the group key on a membership change, but the
 * NO-POD fan-out path drops a removed member from routing WITHOUT rotating the content key — so a removed member
 * keeps a working key. Here the group key + its rotations ride the durable membership LOG as key-events (each
 * sealed multi-recipient to the then-current members' stable sealing keys); a member folds the key-events it has
 * back into the key chain and reads exactly the versions it is entitled to. A leave/remove emits a rotation
 * key-event fanned to the REMAINING members only — the departed, absent from it, cannot fold the new version in.
 *
 * Proven over THREE REAL `createRealHouseholdAgent()` instances on ONE shared `InternalBus` (the pairRealAgents
 * pattern) — A (admin) + B + C, a genuine circle join, real sealing openers derived from each agent's identity,
 * key-events + sealed content fanned over the real transport with real hold-forward. NO pod, NO browser, NO
 * relay/NKN — seconds, deterministic. The RECEIVE side is the production path: a fanned key-event is recorded by
 * the real key-lane statement handler (dispatched by the real `makePeerRouter`) into the real per-circle
 * `createKeyEventStore`, and the read folds that store — no harness stand-in records or reads the key-events.
 *
 * Asserts:
 *   - A seals content C can read (both are current members) — no pod involved;
 *   - A removes C and rotates; A seals NEW content under the new version → B (remaining) reads it, C canNOT
 *     (backward secrecy: C never receives the rotation key-event, so its chain lacks the new version);
 *   - C still reads the PRE-removal content it was entitled to (removal denies the future, not the past);
 *   - a member (B) OFFLINE during the rotation catches the key-event up on reconnect (real presence-flush) and
 *     then decrypts everything it is entitled to.
 */
import { describe, it, expect, afterAll } from 'vitest';

import {
  bootRealAgentNode, connectNodesOverBus, createCircle, joinExistingCircle,
  bootSealedCircle, postSealed, removeAndRotate, readSealed,
  goOffline, goOnline, until, teardown,
} from './support/pairRealAgents.js';

const GID = 'sealed-circle';

describe('no-pod group-key rotation — key-events in the log (three real agents over a shared InternalBus)', () => {
  let A; let B; let C;

  afterAll(async () => { await teardown(A, B, C); });

  it('rotates the group key on removal with backward secrecy, and an offline member catches up', async () => {
    [A, B, C] = await Promise.all([
      bootRealAgentNode('A'), bootRealAgentNode('B'), bootRealAgentNode('C'),
    ]);
    await connectNodesOverBus([A, B, C]);

    // A creates ONE circle; B and C both join it (real join over the peer bridge → membership trail).
    await createCircle(A, { groupId: GID, name: 'Sealed Circle' });
    await joinExistingCircle(A, B, { groupId: GID, handle: 'bee' });
    await joinExistingCircle(A, C, { groupId: GID, handle: 'cee' });

    // Boot the sealed circle: A establishes version-1 group key + fans the key-event to B and C over the log.
    await bootSealedCircle({ admin: A, members: [B, C], groupId: GID });
    await until(() => B.keyEvents.length >= 1 && C.keyEvents.length >= 1);
    expect(B.keyEvents.length).toBe(1);
    expect(C.keyEvents.length).toBe(1);

    // ── A posts content BOTH B and C can read (all three are current members, version 1). ──
    const before = `before removal ${Date.now().toString(36)}`;
    const beforeEnv = await postSealed({ admin: A, members: [B, C], groupId: GID, text: before });
    await until(() => B.sealedContent.length >= 1 && C.sealedContent.length >= 1);
    expect(readSealed(B, beforeEnv, GID)).toBe(before);
    expect(readSealed(C, beforeEnv, GID)).toBe(before);   // C reads v1 content — it is a current member

    // ── B goes OFFLINE, then A removes C and ROTATES (fan the rotation key-event to the REMAINING members). ──
    await goOffline(B);
    await removeAndRotate({ admin: A, keep: [B], groupId: GID });   // C is NOT among the fan recipients

    // A posts NEW content under the new version. B is offline (its key-event + content are HELD, not lost);
    // C is online but was never sent the rotation key-event.
    const after = `after removal ${Date.now().toString(36)}`;
    const afterEnv = await postSealed({ admin: A, members: [B, C], groupId: GID, text: after });

    // C is still online and receives the (undecryptable) new content, but holds no v2 key → it is DENIED.
    await until(() => C.sealedContent.length >= 2);
    expect(() => readSealed(C, afterEnv, GID)).toThrow();          // backward secrecy — no pod involved
    // C still reads the PRE-removal content it was entitled to (removal denies the future, not the past).
    expect(readSealed(C, beforeEnv, GID)).toBe(before);

    // ── B RECONNECTS and announces itself → A flushes the held rotation key-event + new content to B. ──
    await goOnline(B, { announceTo: A });
    const gotKey = await until(() => B.keyEvents.length >= 2);
    const gotContent = await until(() => B.sealedContent.find((c) => c.env === afterEnv) || B.sealedContent.length >= 2);
    expect(gotKey, 'B caught the rotation key-event up on reconnect').toBeTruthy();
    expect(gotContent, 'B caught the new content up on reconnect').toBeTruthy();

    // B (remaining member) now decrypts EVERYTHING it is entitled to: both the pre-removal and the new content.
    expect(readSealed(B, beforeEnv, GID)).toBe(before);
    expect(readSealed(B, afterEnv, GID)).toBe(after);

    // Sanity: B's folded chain holds BOTH versions; C's holds only version 1 (it never got the rotation).
    expect(B.keyEvents.map((e) => e.version).sort()).toEqual([1, 2]);
    expect(C.keyEvents.map((e) => e.version)).toEqual([1]);
  }, 40000);
});
