/**
 * The owner's own skills are PRIVATE — reachable by the owner, never by anyone the owner trusts.
 *
 * Fifteen skills on the host agent are owner-only by their own comments: reveal the recovery phrase, overwrite the
 * owner root and enrol, retire devices, the sealed circle list, write the registry, hand out standing acting
 * authority. They sat at `trusted`, and `trusted` was only ever given to the owner's own key — so nothing noticed.
 * A household bot gives its admin `trusted` (a person who acts with standing but is not the owner), and at that
 * level the admin would have reached all fifteen. They are `private` now: SELF only, never granted (the gate refuses
 * `private` for anyone but the identities the host names as self when it builds the gate).
 *
 * Through the real composition: the booted agent's host gate, the owner's chat key as the caller.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { bootRealAgentNode, teardown } from './support/pairRealAgents.js';

const OWNER_ONLY = [
  'revealOwnerPhrase', 'grantSurface', 'revokeSurface', 'listSurfaceGrants', 'buildEnrollOffer', 'enrollDevice',
  'replaceDevice', 'revokeDevice', 'exportRecoveryFile', 'listRecoveryCircles', 'importRecoveryFile',
  'restoreStatus', 'restoreSource', 'restoreIntent', 'restoreOwnerPhrase',
];

const nodes = [];
afterAll(() => teardown(nodes));

describe('the owner\'s own skills', () => {
  it('a caller at the trusted level (a bot\'s admin) reaches none of them; the owner reaches every one', async () => {
    const node = await bootRealAgentNode('owner');
    nodes.push(node);
    const gate = node.agent.hostPolicyEngine;
    expect(gate, 'the host gate attached').toBeTruthy();
    for (const skillId of OWNER_ONLY) {
      await expect(
        gate.checkCaller({ callerId: 'telegram:111', skillId, unknownAs: 'trusted' }),
        `${skillId} is out of a trusted caller's reach`,
      ).rejects.toBeTruthy();
      const own = await gate.checkCaller({ callerId: node.pubKey, skillId });
      expect(own.skill.visibility, `${skillId} is declared private`).toBe('private');
    }
  }, 60_000);

});
