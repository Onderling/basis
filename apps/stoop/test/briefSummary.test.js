/**
 * Stoop — briefSummary tests.
 *
 * `stoop_briefSummary` is declared on `listOpen.surfaces.chat.brief`
 * in the stoop manifest; it contributes to basis's `/brief`
 * aggregator.  Mirrors folio's `folio_briefSummary` shape: returns
 * `{ok: true}` when no open posts exist (brief.js's isEmpty skips
 * the section) or `{items, message}` listing the topmost rows + a
 * count.
 */

import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

import { createNeighbourhoodAgent } from '../src/index.js';

const ANNE = 'https://id.example/anne';

async function callSkill(agent, skillId, args, fromWebid = ANNE) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  const result = await def.handler({
    parts:    args === undefined ? [] : [{ type: 'DataPart', data: args }],
    from:     fromWebid,
    agent,
    envelope: null,
  });
  return result;
}

async function makeBundle() {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  return createNeighbourhoodAgent({
    identity:   id,
    transport:  tx,
    offeringMatch: { group: 'oosterpoort', localActor: ANNE, peers: [] },
    members:    [{ webid: ANNE }],
  });
}

describe('stoop_briefSummary — Q30 contributor', () => {
  it('returns {ok: true} when no open posts (brief.js skips the section)', async () => {
    const bundle = await makeBundle();
    const reply = await callSkill(bundle.agent, 'stoop_briefSummary');
    expect(reply).toEqual({ ok: true });
  });

  it('returns items[] + count message when open posts exist', async () => {
    const bundle = await makeBundle();
    await callSkill(bundle.agent, 'postRequest', {
      intent: 'ask',
      text:   'Need a vacuum cleaner',
    });
    await callSkill(bundle.agent, 'postRequest', {
      intent: 'offer',
      text:   'Free moving boxes',
    });

    const reply = await callSkill(bundle.agent, 'stoop_briefSummary');
    expect(Array.isArray(reply.items)).toBe(true);
    expect(reply.items.length).toBeGreaterThanOrEqual(1);
    expect(reply.items.length).toBeLessThanOrEqual(3);
    expect(reply.message).toMatch(/circle request/);
  });

  it('caps items[] at 3 even with many open posts', async () => {
    const bundle = await makeBundle();
    for (let i = 0; i < 5; i++) {
      await callSkill(bundle.agent, 'postRequest', {
        intent: 'ask',
        text:   `Need item ${i}`,
      });
    }
    const reply = await callSkill(bundle.agent, 'stoop_briefSummary');
    expect(reply.items).toHaveLength(3);
    expect(reply.message).toContain('5');
  });

  it('singular "request" when exactly one open post', async () => {
    const bundle = await makeBundle();
    await callSkill(bundle.agent, 'postRequest', {
      intent: 'lend',
      text:   'Borrowable drill',
    });
    const reply = await callSkill(bundle.agent, 'stoop_briefSummary');
    expect(reply.message).toBe('1 circle request');
  });
});

describe('the brief counts only REAL noticeboard posts (the shared gate)', () => {
  it('chat lines and membership/rules bookkeeping neither count nor show as circle requests', async () => {
    const bundle = await makeBundle();
    // One real ask…
    await callSkill(bundle.agent, 'postRequest', { intent: 'ask', text: 'Need a ladder' });
    // …beside the store's system residents: a chat line (keyed by msgId — the shape the brief
    // displayed as a withdrawable "request" for a month), a rules doc, and a membership code.
    await bundle.itemStore.addItems([
      { type: 'circle-chat-message', text: 'hoi allemaal', visibility: 'household',
        source: { circleId: 'c-1', msgId: 'm-1' } },
      { type: 'group-rules', text: 'huisregels', visibility: 'household',
        source: { groupId: 'c-1', rules: { purpose: 'circle' }, version: 1 } },
      { type: 'membership-code', text: 'code', visibility: 'household',
        source: { groupId: 'c-1', code: 'ABC123', expiresAt: Date.now() + 60000 } },
    ], { actor: ANNE });

    const reply = await callSkill(bundle.agent, 'stoop_briefSummary');
    expect(reply.message).toBe('1 circle request');
    expect(reply.items).toHaveLength(1);
    expect(reply.items[0].label).toBe('Need a ladder');
    expect(reply.items.some((i) => i.label === 'hoi allemaal'), 'no chat line in the brief').toBe(false);
  });

  it('a store holding ONLY system items reads as empty — brief.js skips the section', async () => {
    const bundle = await makeBundle();
    await bundle.itemStore.addItems([
      { type: 'circle-chat-message', text: 'alleen chat', visibility: 'household',
        source: { circleId: 'c-1', msgId: 'm-2' } },
    ], { actor: ANNE });
    expect(await callSkill(bundle.agent, 'stoop_briefSummary')).toEqual({ ok: true });
  });
});
