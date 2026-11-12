/**
 * WHO MAY WRITE TO A PERSONA FIRST, on a real agent: the persona's own policy (a profile property, Frits 2026-11-12:
 * "the persona can be the policy itself"). A person's is `request` until set; `setFirstMessages('open')` makes it open,
 * and the contact channel's door reads it through `messageRequests.policy()`.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { bootRealAgentNode, teardown } from './support/pairRealAgents.js';

describe('the persona is the policy for first messages', () => {
  let node;
  afterAll(async () => { await teardown(node); });

  it('a person\'s is request; set open, the door reads open; set request again, it reads request', async () => {
    node = await bootRealAgentNode('policy', { contactChannel: true });
    expect(await node.agent.messageRequests.policy()).toBe('request');
    expect(await node.agent.setFirstMessages('open')).toBe('open');
    expect(await node.agent.messageRequests.policy()).toBe('open');
    expect(await node.agent.setFirstMessages('request')).toBe('request');
    expect(await node.agent.messageRequests.policy()).toBe('request');
    await expect(node.agent.setFirstMessages('anyone')).rejects.toThrow();
  }, 60_000);
});
