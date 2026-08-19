/**
 * G7, the adoption half — basis actually turns the reachability oracle on.
 *
 * The original gap was "no live presence signal": basis never called `enableReachabilityOracle()` at all.
 * Trying to fix it surfaced why that was fortunate — the skill answers with a SIGNED list of every peer this
 * device can reach, which in a circle app is a contact graph handed to any authenticated caller.
 *
 * So the substrate was fixed first (deny-by-default unless the host says what each caller may learn), and
 * this is the second half: basis enabling it WITH a scope. The test that matters is not "is the skill
 * registered" but "does a stranger learn nothing" — a registered skill with a missing scope would look
 * identical from the outside until someone asked.
 */
import { describe, it, expect } from 'vitest';
import { bootRealAgentNode, teardown } from './support/pairRealAgents.js';

/** The oracle is registered on the CHAT/secure-mesh agent — that is the one peers invoke. */
const chatAgentOf = (node) => node.agent.sa.agent;
import { Parts } from '@onderling/core';

describe('basis enables the oracle, scoped', () => {
  let node;

  it('the skill is registered', async () => {
    node = await bootRealAgentNode('A');
    expect(chatAgentOf(node).skills.get('reachable-peers'), 'basis should expose reachable-peers').toBeTruthy();
  }, 30_000);

  it('a caller sharing no circle learns NOTHING — and cannot tell there is anything to learn', async () => {
    // The property the whole substrate change exists for. An unscoped oracle would answer with the full
    // peer list here; a scoped one answers with an empty claim that looks the same as having no peers.
    const skill = chatAgentOf(node).skills.get('reachable-peers');
    const out = await skill.handler({ parts: [], from: 'pk-total-stranger' });
    const claim = Parts.data(out);
    expect(claim?.body?.p ?? []).toEqual([]);
  }, 30_000);

  it('the claim is still a well-formed signed claim, not an error path', async () => {
    // Disclosing nothing must not mean returning nothing: hop routing consumes this, and a malformed
    // answer would degrade routing rather than privacy.
    const skill = chatAgentOf(node).skills.get('reachable-peers');
    const claim = Parts.data(await skill.handler({ parts: [], from: 'pk-stranger-2' }));
    expect(claim).toBeTruthy();
    expect(claim.body).toBeTruthy();
    expect(Array.isArray(claim.body.p)).toBe(true);
    expect(typeof claim.body.t).toBe('number');       // ttl — a real claim, just an empty one
  }, 30_000);

  it('enabling twice is idempotent — a re-boot path must not double-register', async () => {
    const before = chatAgentOf(node).skills.get('reachable-peers');
    chatAgentOf(node).enableReachabilityOracle({ peerScope: () => [] });
    expect(chatAgentOf(node).skills.get('reachable-peers')).toBe(before);
    await teardown(node);
  }, 30_000);
});
