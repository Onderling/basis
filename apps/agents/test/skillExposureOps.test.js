/**
 * The per-skill exposure OPS, end to end over a real registry (P1 §5's surface half).
 *
 * The model is unit-tested in `@onderling/agent-registry`; this proves the op layer: the owner-key
 * gate reaches the persisted entry, a circle admin can narrow but not widen, and the read model the
 * toggle list renders from agrees with what the card advertises.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createAgentRegistry, projectAgentCard } from '@onderling/agent-registry';
import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';
import { setAgentSkillExposure, getAgentSkillExposure } from '../src/cores.js';

const OWNER = 'fp-owner-abc';

async function rig() {
  const pseudoPod = createPseudoPod({ backend: createMemoryBackend(), mode: 'standalone', deviceId: 'dev-1' });
  const registry  = createAgentRegistry({ pseudoPod, deviceId: 'dev-1' });
  await registry.register({
    agentId: 'bot-x', pubKey: 'pub-x', agentUri: 'agent:bot-x', role: 'service',
    ownerFingerprint: OWNER,
    capabilities: ['summarise', 'translate'],
    grants: [{ tokenId: 't1', skill: 'summarise', capability: 'read', expiresAt: null }],
  });
  return { registry, store: { registry } };
}

describe('setAgentSkillExposure — the owner gate reaches the stored entry', () => {
  let store, registry;
  beforeEach(async () => { ({ store, registry } = await rig()); });

  it('the owner hides a skill and it is persisted + gone from the card', async () => {
    const r = await setAgentSkillExposure(store, {
      agentId: 'bot-x', skillId: 'translate', exposed: false, bySigner: OWNER,
    });
    expect(r.ok).toBe(true);

    const entry = (await registry.list()).find((a) => a.agentId === 'bot-x');
    expect(entry.exposure.hidden).toContain('translate');
    expect(projectAgentCard(entry).skills.map((s) => s.id)).toEqual(['summarise']);
  });

  it('a NON-owner signature changes nothing — and the entry is untouched', async () => {
    const r = await setAgentSkillExposure(store, {
      agentId: 'bot-x', skillId: 'translate', exposed: false, bySigner: 'fp-someone-else',
    });
    expect(r).toEqual({ ok: false, reason: 'not-owner' });
    const entry = (await registry.list()).find((a) => a.agentId === 'bot-x');
    expect(entry.exposure.hidden).toEqual([]);   // no partial write
  });

  it('an unknown agent is reported, not silently created', async () => {
    expect(await setAgentSkillExposure(store, { agentId: 'nope', skillId: 's', exposed: false, bySigner: OWNER }))
      .toEqual({ ok: false, reason: 'agent-not-found' });
  });

  it('a circle admin narrows inside their circle only', async () => {
    const r = await setAgentSkillExposure(store, {
      agentId: 'bot-x', skillId: 'summarise', exposed: false, circleId: 'c1', isAdmin: true,
    });
    expect(r.ok).toBe(true);
    const entry = (await registry.list()).find((a) => a.agentId === 'bot-x');
    expect(projectAgentCard(entry, { circleId: 'c1' }).skills.map((s) => s.id)).toEqual(['translate']);
    expect(projectAgentCard(entry, { circleId: 'c2' }).skills.map((s) => s.id).sort())
      .toEqual(['summarise', 'translate']);
  });

  it('a circle admin CANNOT reveal what the owner hid, and a non-admin cannot touch it', async () => {
    await setAgentSkillExposure(store, { agentId: 'bot-x', skillId: 'translate', exposed: false, bySigner: OWNER });
    expect(await setAgentSkillExposure(store, {
      agentId: 'bot-x', skillId: 'translate', exposed: true, circleId: 'c1', isAdmin: true,
    })).toEqual({ ok: false, reason: 'cannot-widen' });
    expect(await setAgentSkillExposure(store, {
      agentId: 'bot-x', skillId: 'summarise', exposed: false, circleId: 'c1', isAdmin: false,
    })).toEqual({ ok: false, reason: 'admin-only' });
  });
});

describe('getAgentSkillExposure — the read model behind the toggle list', () => {
  it('lists every skill with its current state, and agrees with the card', async () => {
    const { store, registry } = await rig();
    await setAgentSkillExposure(store, { agentId: 'bot-x', skillId: 'translate', exposed: false, bySigner: OWNER });

    const view = await getAgentSkillExposure(store, { agentId: 'bot-x' });
    expect(view.ok).toBe(true);
    expect(view.skills).toEqual([
      { id: 'summarise', exposed: true },
      { id: 'translate', exposed: false },
    ]);
    // The list and the card must never disagree about which skills EXIST — only about which are shown.
    const entry = (await registry.list()).find((a) => a.agentId === 'bot-x');
    expect(view.skills.filter((s) => s.exposed).map((s) => s.id))
      .toEqual(projectAgentCard(entry).skills.map((s) => s.id));
  });

  it('answers "as seen in this circle"', async () => {
    const { store } = await rig();
    await setAgentSkillExposure(store, { agentId: 'bot-x', skillId: 'summarise', exposed: false, circleId: 'c1', isAdmin: true });
    const inC1 = await getAgentSkillExposure(store, { agentId: 'bot-x', circleId: 'c1' });
    const inC2 = await getAgentSkillExposure(store, { agentId: 'bot-x', circleId: 'c2' });
    expect(inC1.skills.find((s) => s.id === 'summarise').exposed).toBe(false);
    expect(inC2.skills.find((s) => s.id === 'summarise').exposed).toBe(true);
  });

  it('an unknown agent returns an empty list rather than throwing', async () => {
    const { store } = await rig();
    expect(await getAgentSkillExposure(store, { agentId: 'nope' }))
      .toEqual({ ok: false, reason: 'agent-not-found', skills: [] });
  });
});
