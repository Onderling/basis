/**
 * The tasks engine is carried by the host: one agent per person, so the host key signs every task grant and bot token
 * and the host engine judges every tasks call. Proven on a real boot: the host key is self (`private`) — else every
 * token it issues dies at its own door as "not trusted" — a token signed by the retired tasks key is refused, a
 * host-signed token on no record is refused, the retired key is read once and forgotten, `private` stays the chat
 * key's and the host's alone, and a door's person reaches a tasks op by the host's own registry.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { AgentIdentity, CapabilityToken } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';

const deny = async (p) => { try { await p; return null; } catch (e) { return `${e.code ?? ''} ${e.message ?? e}`; } };
const refused = (r) => Boolean(r?.error) || r?.ok === false;

describe('tasks on the host', () => {
  let agent; let hostId; let retired; let retiredVault; let engine;
  beforeAll(async () => {
    const hostVault = new VaultMemory();
    hostId = await AgentIdentity.generate(hostVault);
    retiredVault = new VaultMemory();
    retired = await AgentIdentity.generate(retiredVault);
    agent = await createRealHouseholdAgent({ seedHousehold: false, hostVault, tasksIdentityVault: retiredVault });
    engine = agent.hostPolicyEngine;
  }, 120_000);

  it('the tasks skills are the host agent\'s: one key, no second tasks agent', () => {
    // boot (its probe, seeding and restores are token-less) completed with the composed engine attached
    expect(engine).toBeTruthy();
    const keys = agent.inProcessPubKeys();
    expect(keys.host).toBe(hostId.pubKey);
    expect(keys.tasks).toBe(hostId.pubKey);
    expect(Object.keys(agent.inProcessSkillIds())).toEqual(['host', 'pinboard']);
    expect(agent.inProcessSkillIds().host).toContain('listOpen');
  });

  it('a host-signed token clears the issuer check (it fails only as off the record); without the host\'s record it is "not trusted"', async () => {
    const holder = (await AgentIdentity.generate(new VaultMemory())).pubKey;
    const token = await CapabilityToken.issue(hostId, { agentId: hostId.pubKey, subject: holder, skill: 'listOpen', expiresIn: 60_000 });
    expect(await deny(engine.checkInbound({ peerPubKey: holder, skillId: 'listOpen', token: token.toJSON() }))).toMatch(/INVALID_TOKEN.*not active/);
    await engine.trustRegistry.setTier(hostId.pubKey, 'authenticated');
    try {
      expect(await deny(engine.checkInbound({ peerPubKey: holder, skillId: 'listOpen', token: token.toJSON() }))).toMatch(/not trusted/);
    } finally { await engine.trustRegistry.setTier(hostId.pubKey, 'private'); }
  });

  it('a token signed by the retired tasks key is refused at the host — no dual accept', async () => {
    const holder = (await AgentIdentity.generate(new VaultMemory())).pubKey;
    const old = await CapabilityToken.issue(retired, { agentId: retired.pubKey, subject: holder, skill: 'listOpen', expiresIn: 60_000 });
    expect(await deny(engine.checkInbound({ peerPubKey: holder, skillId: 'listOpen', token: old.toJSON() }))).toMatch(/INVALID_TOKEN/);
  });

  it('the retired tasks key is forgotten after boot (its prefix is empty: later boots re-sign nothing)', async () => {
    expect(await retiredVault.list()).toEqual([]);
  });

  it('private stays self: the chat key passes, the pinboard key and a raised stranger do not', async () => {
    const keys = agent.inProcessPubKeys();
    const chatKey = agent.sa?.agent?.identity?.pubKey ?? null;
    expect(chatKey, 'the chat key is reachable for this check').toBeTruthy();
    expect(await deny(engine.checkInbound({ peerPubKey: chatKey, skillId: 'revealOwnerPhrase' }))).toBeNull();
    expect(await deny(engine.checkInbound({ peerPubKey: keys.pinboard, skillId: 'revealOwnerPhrase' }))).toMatch(/INSUFFICIENT_TIER|NOT_SELF/);
    const stranger = (await AgentIdentity.generate(new VaultMemory())).pubKey;
    await engine.trustRegistry.setTier(stranger, 'private');
    expect(await deny(engine.checkInbound({ peerPubKey: stranger, skillId: 'revealOwnerPhrase' }))).toMatch(/NOT_SELF/);
  });

  it('a door\'s person reaches a tasks op by the host registry: a member lists, a stranger does not', async () => {
    await agent.setDoorCaller('telegram:1', 'member');
    expect(refused(await agent.callSkill('tasks', 'listOpen', {}, { caller: 'telegram:1' }))).toBe(false);
    expect(refused(await agent.callSkill('tasks', 'listOpen', {}, { caller: 'telegram:999' }))).toBe(true);
  });
});
