/**
 * WHO MAY WRITE TO A PERSONA FIRST, on a real agent: the persona's own policy (a profile property, Frits 2026-11-12:
 * "the persona can be the policy itself"). A person's is `request` until set; `setFirstMessages('open')` makes it open,
 * and the contact channel's door reads it through `messageRequests.policy(to)` for the address a turn arrived on.
 * FAIL CLOSED (Fable's review): an address that names none of this device's personas, or none at all, is `request`,
 * never the primary persona's policy, so a box whose primary is open does not let on a turn it cannot place.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { bootRealAgentNode, teardown } from './support/pairRealAgents.js';

describe('the persona is the policy for first messages', () => {
  let node;
  afterAll(async () => { await teardown(node); });

  it('a person\'s is request; set open, the door reads open at its address; set request again, it reads request', async () => {
    node = await bootRealAgentNode('policy', { contactChannel: true });
    expect(await node.agent.messageRequests.policy(node.pubKey)).toBe('request');
    expect(await node.agent.setFirstMessages('open')).toBe('open');
    expect(await node.agent.messageRequests.policy(node.pubKey)).toBe('open');
    expect(await node.agent.setFirstMessages('request')).toBe('request');
    expect(await node.agent.messageRequests.policy(node.pubKey)).toBe('request');
    await expect(node.agent.setFirstMessages('anyone')).rejects.toThrow();
  }, 60_000);

  it('with the primary persona OPEN, a turn with no address, or one that names none of my personas, is request', async () => {
    expect(await node.agent.setFirstMessages('open')).toBe('open');
    expect(await node.agent.messageRequests.policy(node.pubKey)).toBe('open');
    expect(await node.agent.messageRequests.policy()).toBe('request');
    expect(await node.agent.messageRequests.policy(null)).toBe('request');
    expect(await node.agent.messageRequests.policy('not-one-of-mine')).toBe('request');
  }, 60_000);
});
