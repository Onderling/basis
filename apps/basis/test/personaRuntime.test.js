/**
 * THE PERSONA RUNTIME — the bundle of keys an agent runs for one persona, named once (`createPersonaRuntime`): its
 * profile seed, the device seed it derives per-circle keys from, the device's delegation record, its per-circle
 * identities and addresses, the authority its commitments name, and its person key's starting point.
 *
 * With N = 1 this is a pure refactor: the agent builds the 'default' persona through the factory, and everything it
 * exposes agrees with what the factory derives. The two-persona promises are written now and stay `todo` until a
 * second persona runs on the wire.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { Bootstrap, deriveDeviceSeed, deriveCircleAddress, ceremonyCommitment, authorityPubKeyB64Of } from '@onderling/core';
import { createPersonaRuntime } from '../src/core/agent/personaRuntime.js';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';

const CIRCLE = 'circle-persona-runtime';

describe('createPersonaRuntime — one persona\'s keys, named once (N = 1)', () => {
  it('the default persona under root custody: a device seed from its wire id, per-circle keys and a commitment from it', async () => {
    const root = Bootstrap.create().bootstrap;
    const p = await createPersonaRuntime({ profileId: 'default', ownerRoot: root, custody: { mode: 'root' }, chatVault: new VaultMemory() });
    expect(p.profileId).toBe('default');
    expect(p.enrolledDevice?.deviceId).toMatch(/^d-[0-9a-f]{32}$/);
    const seed = deriveDeviceSeed(root.deriveAgentSeed('default'), p.enrolledDevice.deviceId);
    expect(p.circleAddressFor(CIRCLE)).toBe(deriveCircleAddress(seed, CIRCLE));
    expect(p.authorityPubKeyB64).toBe(authorityPubKeyB64Of(root.deriveProfileAuthority('default')));
    expect(p.ceremonyCommitmentFor(CIRCLE)).toBe(ceremonyCommitment(p.authorityPubKeyB64, CIRCLE));
    expect((await p.circleIdentityFor(CIRCLE)).pubKey).toBe(p.circleAddressFor(CIRCLE));
    expect(p.initialPersonKey?.version).toBe(1);
  });

  it('a persona other than the default needs the owner root on the device — a delegated device cannot derive one', async () => {
    await expect(createPersonaRuntime({ profileId: 'p-0123456789ab', ownerRoot: null, custody: { mode: 'delegation', deviceId: 'd' }, chatVault: new VaultMemory() }))
      .rejects.toThrow(/ceremony-required/);
  });

  it('the agent runs the default persona through it: what the agent exposes is what the factory derives', async () => {
    const v = { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() };
    const agent = await createRealHouseholdAgent({ seedHousehold: false, ...v });
    const root = Bootstrap.fromMnemonic((await agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic);
    const id = (await agent.callSkill('agents', 'getProfileProperties', { id: 'default' }))?.properties;
    expect(id).toBeTruthy();
    expect(agent.ceremonyCommitmentFor(CIRCLE)).toBe(ceremonyCommitment(authorityPubKeyB64Of(root.deriveProfileAuthority('default')), CIRCLE));
    expect(agent.persona?.('default')?.circleAddressFor(CIRCLE)).toBe(agent.circleAddressFor(CIRCLE));
    // the live identities ride the persona: its chat identity is the agent's webid, its person key the agent's
    expect(agent.persona('default').chatId.pubKey).toBe(agent.identity.chat.pubKey);
    expect(agent.persona('default').personKey?.version).toBe(agent.personKey()?.version);
  }, 60_000);
});

describe('two personas on one device share nothing on the wire (waits on a second persona running)', () => {
  it.todo('no key, address, pair-circle id, relay socket, wire device id, commitment or sibling set in common');
  it.todo('a co-member of both sees two members with two commitments');
  // 'nothing root-level in either persona\'s records' — real now: personaCreateRunning.test.js
  it.todo('the phrase rebuilds both; the restore picker re-binds only the chosen one');
  it.todo('a revoked device loses every persona it held');
});
