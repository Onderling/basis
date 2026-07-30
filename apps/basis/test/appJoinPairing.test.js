/**
 * basis — node-level, in-process APP JOIN pairing gate.
 *
 * The full application-level circle join (createGroupV2 → build invite →
 * group-redeem over the peer bridge → membership trail → listGroupMembers roster)
 * had ONLY ever been exercised in the browser pairing journey — 7–40 min, flaky
 * over NKN, and the one thing the browser kept failing to confirm. This test runs
 * that EXACT flow between two REAL `createRealHouseholdAgent()` instances wired
 * over a shared `InternalBus` (the sendRouteResolution.test.js pattern), so the
 * join is deterministic and seconds-fast.
 *
 * Phase-1/2 acceptance asserted here, at the node level:
 *   - the join actually COMPLETES over the in-process transport (joined.ok);
 *   - BOTH the admin's and the joiner's `listGroupMembers` rosters show 2 members
 *     (the B1 fix — proof-derived roster from the redemption trail);
 *   - the entrust precondition: the mandate WIE (roster minus self) resolves peer B.
 *   - bonus: a chat A→B delivery over the same transport.
 *
 * See test/support/pairRealAgents.js for the reusable two-agent wiring helper.
 */
import { describe, it, expect, afterAll } from 'vitest';

import {
  bootRealAgentNode, connectAgentsOverBus, pairCircle, readRoster, until, teardown,
} from './support/pairRealAgents.js';

describe('app-level circle join between two real agents over a shared InternalBus', () => {
  let A; let B;

  afterAll(async () => { await teardown(A, B); });

  it('B redeems A\'s invite; both rosters show 2 members; the mandate WIE resolves peer B', async () => {
    // Boot two full app agents (each: chat secure-mesh + host + tasks + stoop + folio + agents).
    [A, B] = await Promise.all([bootRealAgentNode('A'), bootRealAgentNode('B')]);
    expect(A.pubKey).not.toBe(B.pubKey);   // distinct identities (fresh in-memory vaults)

    // Connect their chat agents in-process over ONE shared bus.
    await connectAgentsOverBus(A, B);

    // Drive the REAL pairing: A creates + invites, B redeems over the peer bridge.
    const groupId = 'peer-circle';
    const { created, invite, joined } = await pairCircle(A, B, { groupId, name: 'Peer Circle', handle: 'peerbee' });

    // The circle + invite were produced.
    expect(created.groupId).toBe(groupId);
    expect(created.code, 'createGroupV2 minted a membership code').toBeTruthy();
    expect(invite.uri, 'admin produced a onderling-invite URI').toMatch(/^onderling-invite:\/\//);

    // THE THING THE BROWSER COULD NOT CONFIRM: the full app join completed.
    expect(joined.error, `join must not error — got: ${JSON.stringify(joined.error)}`).toBeUndefined();
    expect(joined.ok, 'B joined the circle over the in-process transport').toBe(true);
    expect(joined.circleId).toBe(groupId);

    // Phase-1 acceptance (B1 fix): BOTH rosters show 2 members. Poll — the joiner's
    // mirror row lands right after the peer-bridge response resolves.
    const aRoster = await until(async () => {
      const r = await readRoster(A, groupId);
      return r.length >= 2 ? r : null;
    });
    const bRoster = await until(async () => {
      const r = await readRoster(B, groupId);
      return r.length >= 2 ? r : null;
    });

    expect(aRoster?.length, `admin roster shows both members — got ${JSON.stringify(aRoster)}`).toBe(2);
    expect(bRoster?.length, `joiner roster shows both members — got ${JSON.stringify(bRoster)}`).toBe(2);

    // Both rosters contain both identities.
    const aWebids = aRoster.map((m) => m.webid).sort();
    const bWebids = bRoster.map((m) => m.webid).sort();
    expect(aWebids).toEqual([A.pubKey, B.pubKey].sort());
    expect(bWebids).toEqual([A.pubKey, B.pubKey].sort());

    // Entrust precondition — the mandate WIE (roster minus self) resolves peer B
    // on the admin side (the empty-WIE "niemand anders" bug is exactly the empty roster).
    const wieOnA = aRoster.filter((m) => m.webid !== A.pubKey);
    expect(wieOnA.length, 'WIE lists exactly the other member').toBe(1);
    expect(wieOnA[0].webid, 'WIE resolves peer B').toBe(B.pubKey);

    // Bonus — a chat A→B message delivers over the same in-process transport.
    const body = `hoi vanaf A ${Date.now().toString(36)}`;
    await A.agent.sendPeerMessage(B.pubKey, { type: 'p2p-chat', subtype: 'chat-message', body });
    const gotChat = await until(() => B.received.find((m) => m.payload?.body === body));
    expect(gotChat, 'B received A\'s chat message').toBeTruthy();
    expect(gotChat.from).toBe(A.pubKey);
  });
});
