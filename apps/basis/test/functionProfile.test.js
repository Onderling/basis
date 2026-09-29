/**
 * Whose profile a node runs decides whether its inbox is answered: a person's node never, a function's (the bot on
 * its own node) always. Through a real boot: the profile record carries the kind, and a fresh node is a person's.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { bootRealAgentNode, teardown } from './support/pairRealAgents.js';

const nodes = [];
afterAll(() => teardown(nodes));

describe('a node\'s profile kind', () => {
  it('a fresh node runs a person\'s profile; naming it a function\'s is read back from the record', async () => {
    const node = await bootRealAgentNode('kind');
    nodes.push(node);
    expect(await node.agent.profileKind()).toBe('person');
    await node.agent.markFunctionProfile();
    expect(await node.agent.profileKind()).toBe('function');
  }, 90_000);
});
