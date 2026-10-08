/**
 * The agent answers in the person's language. Every shell hands the agent its translator (`opts.t`); the op replies the
 * agent shapes itself — a task added, a post placed, a step that needs confirming — used to come back in English all
 * the same, so a Dutch screen showed "✓ Added task: …" under a Dutch composer. Booted the way a shell boots it, with a
 * Dutch translator read from the shared locale bundle.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { bootRealAgentNode, teardown } from './support/pairRealAgents.js';
import { tNl as tr } from './support/bundleTranslator.js';

const nodes = [];
afterAll(() => teardown(nodes));

describe('the agent answers in the person\'s language', () => {
  it('adding a task, posting, and the steps that need a confirm all come back in Dutch', async () => {
    const node = await bootRealAgentNode('replies-nl', { agentOpts: { t: tr } });
    nodes.push(node);
    const { agent } = node;

    const added = await agent.callSkill('tasks', 'addTask', { text: 'ramen lappen', circleId: 'c-nl' });
    expect(added?.ok, JSON.stringify(added)).toBe(true);
    expect(added.message).toBe('✓ Taak toegevoegd: ramen lappen');

    const archive = await agent.callSkill('tasks', 'archiveCircle', {});
    expect(archive.ok).toBe(false);
    expect(archive.error).toBe('Archiveren maakt de kring alleen-lezen. Doe het opnieuw met --confirm=true om door te gaan.');

    const leave = await agent.callSkill('stoop', 'leaveGroup', {});
    expect(leave.ok).toBe(false);
    expect(leave.error).toBe('Een kring verlaten kun je niet terugdraaien. Doe het opnieuw met --confirm=true om door te gaan.');

    const posted = await agent.callSkill('stoop', 'postRequest', { intent: 'ask', text: 'wie heeft er een ladder?' });
    expect(posted?.ok, JSON.stringify(posted)).toBe(true);
    expect(posted.message).toBe('✓ Geplaatst: wie heeft er een ladder?');
  }, 90_000);
});
