/**
 * A PERSONA'S PERSON KEY ARRIVES ON ITS OWN DEVICE — through the real agent's one person-key lane. A device holds its
 * general self and a persona; a hand-over for the persona (signed by the PERSONA's root authority, naming the persona)
 * lands in the persona: its key and its identity move to the new version, and the general self is untouched. The same
 * key relabelled as the general self's, or signed by the general self's authority while naming the persona, lands
 * nowhere.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { Bootstrap, b64encode, derivePersonKeySeed, personKeyPubKeyB64, personKeyFacts, signCeremonyReveal } from '@onderling/core';
import { bootRealAgentNode, teardown } from '../support/pairRealAgents.js';
import { PERSON_KEY_CARRY } from '../../src/v2/personKeySync.js';

describe("a persona's person key, handed over", () => {
  let node;
  afterAll(async () => { await teardown(node); });

  it('lands in the persona only; a relabelled or cross-signed one lands nowhere', async () => {
    node = await bootRealAgentNode('A', { agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() } });
    const phrase = (await node.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    const pid = (await node.agent.callSkill('agents', 'createProfile', { name: 'Buurt' })).id;
    const B = node.agent.persona(pid);
    const root = Bootstrap.fromMnemonic(phrase);
    const generalBefore = node.agent.personKey();
    const personaBefore = B.personKey?.version ?? null;
    expect(personaBefore).toBe(1);

    const carry = (subject, authority) => {
      const seed = derivePersonKeySeed(root.deriveAgentSeed(pid), 2);
      const facts = personKeyFacts({ version: 2, pubKey: personKeyPubKeyB64(seed) });
      const reveal = signCeremonyReveal(authority, { circleId: 'y1', kind: PERSON_KEY_CARRY, subject, authorRef: subject, facts });
      return { subtype: PERSON_KEY_CARRY, subject, version: 2, seed: b64encode(seed), reveals: { y1: reveal } };
    };
    const lane = node.agent.personKeySync.handlers[PERSON_KEY_CARRY];

    // the persona's key, relabelled as the general self's: refused (the general self's root did not sign it)
    await lane('addr:sibling', carry(node.agent.identity.chat.pubKey, root.deriveProfileAuthority(pid)));
    // the general self's authority signing a reveal that names the persona: refused (not the persona's root)
    await lane('addr:sibling', carry(B.chatId.pubKey, root.deriveProfileAuthority('default')));
    expect(B.personKey.version, 'nothing landed in the persona').toBe(1);
    expect(node.agent.personKey(), 'nothing landed in the general self').toEqual(generalBefore);

    // the persona's own: lands in the persona, its identity moves; the general self untouched
    const oldPersonaIdentity = B.personIdentity?.pubKey;
    await lane('addr:sibling', carry(B.chatId.pubKey, root.deriveProfileAuthority(pid)));
    expect(B.personKey.version).toBe(2);
    expect(B.personIdentity.pubKey).not.toBe(oldPersonaIdentity);
    expect(B.personIdentity.pubKey).toBe(personKeyPubKeyB64(B.personKey.seed));
    expect(node.agent.personKey(), 'the general self is untouched').toEqual(generalBefore);
  }, 60_000);
});
