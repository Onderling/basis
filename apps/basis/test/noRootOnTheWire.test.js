/**
 * NOTHING ROOT-LEVEL ON THE WIRE. A delegation record rides every device statement and every sibling carry; its `by`
 * is the key that signed it. That key is the persona's AUTHORITY (`Bootstrap.deriveProfileAuthority`), never the
 * owner root: the root's public key or fingerprint in a record would link every persona of the person to anyone who
 * saw two records (a bot, a companion, a co-member of two circles).
 *
 * Red first against the real composition: the first device's self-minted record, and an enrolled device's record.
 */
import { describe, it, expect } from 'vitest';
import nacl from 'tweetnacl';
import { VaultMemory } from '@onderling/vault';
import { Bootstrap, ownerRootFingerprint, verifyDeviceDelegation, b64encode, ceremonyCommitment, signCeremonyReveal, verifyCeremonyReveal } from '@onderling/core';
import { DEVICE_DELEGATIONS_KEY } from '@onderling/agent-registry';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';

const boot = (vaults) => createRealHouseholdAgent({ seedHousehold: false, ...vaults });
const freshVaults = () => ({ ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() });
const pubB64 = (seed) => b64encode(nacl.sign.keyPair.fromSeed(seed).publicKey);

async function delegationRecords(agent) {
  const props = (await agent.callSkill('agents', 'getProfileProperties', { id: 'default' }))?.properties ?? {};
  const map = props[DEVICE_DELEGATIONS_KEY]?.value ?? props[DEVICE_DELEGATIONS_KEY] ?? {};
  return Object.values(map).filter((r) => r && typeof r === 'object' && r.by);
}

function expectAuthorityNotRoot(record, root) {
  expect(verifyDeviceDelegation(record), 'the record still verifies').toBe(true);
  expect(record.by, 'signed by the root').not.toBe(pubB64(root.secret));
  expect(ownerRootFingerprint(record.by), 'the root fingerprint on the record').not.toBe(root.fingerprint());
  expect(record.by, 'signed by the default persona\'s authority').toBe(pubB64(root.deriveProfileAuthority('default')));
}

describe('nothing root-level on the wire', () => {
  it('the first device\'s own delegation is signed by the persona\'s authority, not the root', async () => {
    const dev = await boot(freshVaults());
    const phrase = (await dev.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    const root = Bootstrap.fromMnemonic(phrase);
    const records = await delegationRecords(dev);
    expect(records.length).toBeGreaterThan(0);
    for (const r of records) expectAuthorityNotRoot(r, root);
  }, 60_000);

  it('an enrolled device\'s delegation is signed by the persona\'s authority, not the root', async () => {
    const dev1 = await boot(freshVaults());
    const phrase = (await dev1.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    const v2 = freshVaults();
    const dev2 = await boot(v2);
    const r = await dev2.callSkill('household', 'enrollDevice', { mnemonic: phrase, label: 'tweede' });
    expect(r?.outcome ?? r?.ok).toBeTruthy();
    const dev2b = await boot(v2);
    const records = await delegationRecords(dev2b);
    expect(records.length).toBeGreaterThan(0);
    for (const rec of records) expectAuthorityNotRoot(rec, Bootstrap.fromMnemonic(phrase));
  }, 60_000);

  it('the ceremony commitment names the authority: a reveal by the authority verifies, one by the root does not', async () => {
    const dev = await boot(freshVaults());
    const root = Bootstrap.fromMnemonic((await dev.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic);
    const circleId = 'circle-no-root';
    const commitment = dev.ceremonyCommitmentFor(circleId);
    expect(commitment).toBe(ceremonyCommitment(pubB64(root.deriveProfileAuthority('default')), circleId));
    expect(commitment).not.toBe(ceremonyCommitment(pubB64(root.secret), circleId));
    const facts = { circleId, kind: 'address-revoke', subject: 'an-address', authorRef: 'me' };
    expect(verifyCeremonyReveal(signCeremonyReveal(root.deriveProfileAuthority('default'), facts), { ...facts, commitment })).toBe(true);
    expect(verifyCeremonyReveal(signCeremonyReveal(root.secret, facts), { ...facts, commitment })).toBe(false);
  }, 60_000);

  it('a device statement that leaves the device (the identity-link offer) names the authority, never the root', async () => {
    const dev = await boot(freshVaults());
    const root = Bootstrap.fromMnemonic((await dev.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic);
    const made = await dev.signLinkOffer({ botAddress: 'a-bot-address' });
    expect(made?.root, 'the offer names its signer').toBe(pubB64(root.deriveProfileAuthority('default')));
    expect(made.offer).not.toContain(pubB64(root.secret));
    expect(made.offer).not.toContain(root.fingerprint());
  }, 60_000);
});
