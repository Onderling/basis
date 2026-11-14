/**
 * A CIRCLE LINK PROOF NAMES THE MEMBER. A link proof said only "whoever holds this address's key linked it to this
 * circle" (circle + address), so a member could put a COPY of another member's address and proof on their OWN roster row
 * (the announce recorder lets a member write only their own row, and checked only the proof). Then the roster showed the
 * other member's address as one of the copier's devices, and this device bound that address to the COPIER as a person:
 * the other member's own messages, signed by that address's key, would be attributed to the copier.
 * The proof now names the member too; a copied proof does not verify for anyone else, and is refused.
 * Three real agents on one bus: A the admin, B the copier, C whose address is copied.
 */
import { describe, it, expect, afterAll } from 'vitest';
import {
  bootRealAgentNode, connectNodesOverBus, createCircle, joinExistingCircle, bindCircleAddresses, teardown,
} from './support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../src/v2/householdRosterPairing.js';

const GID = 'link-binds-member';

describe('a circle link proof names the member', () => {
  let A; let B; let C;
  afterAll(async () => { await teardown(A, B, C); });

  it('a member who copies another member\'s address and proof onto their own row is refused; the address stays the other member\'s', async () => {
    [A, B, C] = await Promise.all([bootRealAgentNode('A'), bootRealAgentNode('B'), bootRealAgentNode('C')]);
    await connectNodesOverBus([A, B, C]);
    await createCircle(A, { groupId: GID, name: 'Link' });
    await joinExistingCircle(A, B, { groupId: GID, handle: 'bee' });
    await joinExistingCircle(A, C, { groupId: GID, handle: 'cee' });
    await bindCircleAddresses([A, B, C], GID);
    await Promise.all([A, B, C].map((n) => bindCircleAddressKeysFor({ agent: n.agent, circleId: GID })));

    const cAddr = C.agent.circleAddressFor(GID);
    expect(A.agent.sa?.resolver?.pubKeyForAddr?.(cAddr), 'before: C\'s address is C').toBe(C.pubKey);

    // B copies C's address and C's own proof (what C announces) onto B's own row, through the announce recorder
    const proof = await C.agent.signCircleLink(GID, GID, cAddr);
    const recorded = await A.agent.callSkill('pinboard', 'recordCircleAddressAnnouncement', {
      groupId: GID, memberWebid: B.pubKey, circleAddress: cAddr, circleAddressProof: proof,
    });
    await bindCircleAddressKeysFor({ agent: A.agent, circleId: GID });

    const rows = (await A.agent.callSkill('pinboard', 'listGroupMembers', { groupId: GID }))?.members ?? [];
    const bRow = rows.find((m) => m?.webid === B.pubKey);
    const bAddrs = [bRow?.circleAddress, ...(bRow?.circleAddresses ?? []).map((p) => (typeof p === 'string' ? p : p?.address))];
    expect(recorded?.ok, `the copied proof was accepted for B: ${JSON.stringify(recorded)}`).not.toBe(true);
    expect(bAddrs, 'the roster shows C\'s address as one of B\'s devices').not.toContain(cAddr);
    expect(A.agent.sa?.resolver?.pubKeyForAddr?.(cAddr), 'C\'s address resolves to B as a person').toBe(C.pubKey);
  }, 90_000);
});
