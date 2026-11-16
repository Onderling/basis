/**
 * IN A ROOM, ONLY THE ROOM SELF WHISPERS. While the LAN key is a room key of self S, the whisper offers only S's
 * secrets. Offering another persona's contact secret there would let that contact match on the connection that
 * speaks S's room key: the device would sign the OTHER persona's address on it, and the contact would learn that
 * S's room face is that persona — a persona link the arc forbids. At rest (a rest key, no persona face shown) every
 * persona's secrets stay offered.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { AgentIdentity } from '@onderling/core';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';

const vaults = () => ({ ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() });
const someone = async () => (await AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), new VaultMemory())).pubKey;

describe('in a room, only the room self whispers', () => {
  let A; let werk; let ofDefault; let ofWerk;
  beforeAll(async () => {
    A = await createRealHouseholdAgent({ seedHousehold: false, ...vaults() });
    werk = (await A.callSkill('agents', 'createProfile', { name: 'Werk' })).id;
    ofDefault = await someone(); ofWerk = await someone();
    await A.callSkill('pinboard', 'addContact', { webid: ofDefault, pubKey: ofDefault, peerAddr: ofDefault, displayName: 'Ann' });
    await A.callSkill('pinboard', 'addContact', { webid: ofWerk, pubKey: ofWerk, peerAddr: ofWerk, displayName: 'Bas', persona: werk });
  }, 120_000);
  afterAll(async () => { await A?.dispose?.(); });

  const accepts = async (entries, address) => {
    for (const e of entries) if (await e.accept(address)) return e;
    return null;
  };
  const defaultChat = () => A.persona('default').chatId?.pubKey ?? A.sa.identity.pubKey;
  const werkChat = () => A.persona(werk)?.chatId?.pubKey;

  it('at rest every persona\'s contacts are whispered', async () => {
    const entries = await A.lanWhisperSecrets({ lanSelf: null });
    expect(await accepts(entries, ofDefault), 'the default persona\'s contact').not.toBeNull();
    expect(await accepts(entries, ofWerk), 'Werk\'s contact').not.toBeNull();
  });

  it('in a room as Werk: only Werk\'s secrets; nothing that proves the default persona', async () => {
    expect(werkChat(), 'Werk runs on this device').toBeTruthy();
    const entries = await A.lanWhisperSecrets({ lanSelf: werk });
    expect(await accepts(entries, ofWerk), 'Werk\'s contact').not.toBeNull();
    expect(await accepts(entries, ofDefault), 'never the default persona\'s contact').toBeNull();
    expect(entries.some((e) => e.address === defaultChat()), 'nothing proves the default persona\'s chat key').toBe(false);
  });

  it('in a room as the default: nothing of Werk', async () => {
    const entries = await A.lanWhisperSecrets({ lanSelf: 'default' });
    expect(await accepts(entries, ofWerk)).toBeNull();
    expect(entries.some((e) => e.address === werkChat())).toBe(false);
  });
});
