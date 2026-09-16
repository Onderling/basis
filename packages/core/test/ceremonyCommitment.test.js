import { describe, it, expect } from 'vitest';
import { Bootstrap } from '../src/identity/Bootstrap.js';
import {
  ceremonyCommitment, rootPubKeyB64Of, signCeremonyReveal, verifyCeremonyReveal,
  signCeremonyCommitmentFromSeed, verifyCeremonyCommitmentDeclaration,
} from '../src/identity/ceremonyCommitment.js';
import { deriveCircleSeed, deriveCircleAddress } from '../src/identity/circleAddress.js';
import { circleAddressAnnouncement, verifyCircleAddressAnnouncement, ownCircleAddressAnnouncementFromSeed } from '../src/identity/circleAddressAnnouncement.js';
import { signCircleLinkFromSeed } from '../src/identity/circleLink.js';

const root = Bootstrap.create().bootstrap;
const pub = rootPubKeyB64Of(root.secret);

describe('the ceremony commitment — who may retire a device address', () => {
  it('is per circle, deterministic, and does not correlate circles', () => {
    expect(ceremonyCommitment(pub, 'a')).toBe(ceremonyCommitment(pub, 'a'));
    expect(ceremonyCommitment(pub, 'a')).not.toBe(ceremonyCommitment(pub, 'b'));
    expect(ceremonyCommitment(pub, 'a')).toHaveLength(64);
  });
  it('a reveal binds to exactly one (circle, kind, subject, ref)', () => {
    const facts = { circleId: 'a', kind: 'address-revoke', subject: 'addr-1', authorRef: 'webid:x' };
    const reveal = signCeremonyReveal(root.secret, facts);
    const commitment = ceremonyCommitment(pub, 'a');
    expect(verifyCeremonyReveal(reveal, { ...facts, commitment })).toBe(true);
    expect(verifyCeremonyReveal(reveal, { ...facts, subject: 'addr-2', commitment })).toBe(false);
    expect(verifyCeremonyReveal(reveal, { ...facts, circleId: 'b', commitment: ceremonyCommitment(pub, 'b') })).toBe(false);
    expect(verifyCeremonyReveal(reveal, { ...facts, commitment: ceremonyCommitment(rootPubKeyB64Of(Bootstrap.create().bootstrap.secret), 'a') })).toBe(false);
    expect(verifyCeremonyReveal(null, { ...facts, commitment })).toBe(false);
    expect(verifyCeremonyReveal(reveal, { ...facts, commitment: null })).toBe(false);
  });
  it('a declared commitment on an announcement is signed by the proven circle key; a substituted one voids the announcement', () => {
    const seed = root.deriveAgentSeed('default');
    const circleSeed = deriveCircleSeed(seed, 'a');
    const address = deriveCircleAddress(seed, 'a');
    const commitment = ceremonyCommitment(pub, 'a');
    const proof = signCeremonyCommitmentFromSeed(circleSeed, { circleId: 'a', circleAddress: address, commitment });
    expect(verifyCeremonyCommitmentDeclaration({ circleId: 'a', circleAddress: address, commitment, proof })).toBe(true);
    const ann = circleAddressAnnouncement({
      circleId: 'a', memberWebid: 'webid:x', circleAddress: address,
      circleAddressProof: signCircleLinkFromSeed(seed, 'a', 'a', address),
      ceremonyCommitment: commitment, ceremonyCommitmentProof: proof,
    });
    expect(verifyCircleAddressAnnouncement(ann, 'a')?.ceremonyCommitment).toBe(commitment);
    const tampered = { ...ann, ceremonyCommitment: ceremonyCommitment(pub, 'b') };
    expect(verifyCircleAddressAnnouncement(tampered, 'a'), 'a relayed announcement with a swapped commitment is refused whole').toBeNull();
    // an announcement without a commitment still verifies (the address alone)
    expect(verifyCircleAddressAnnouncement(ownCircleAddressAnnouncementFromSeed({ derivationSeed: seed, circleId: 'a', memberWebid: 'webid:x' }), 'a')).toBeTruthy();
  });
});

describe('a reveal may cover the kind\'s own FACTS (the person-key announcement covers the key it announces)', () => {
  it('a reveal minted over facts verifies only with the same facts — not without them, not with other facts', () => {
    const base = { circleId: 'a', kind: 'person-key', subject: 'webid:x', authorRef: 'webid:x' };
    const commitment = ceremonyCommitment(pub, 'a');
    const reveal = signCeremonyReveal(root.secret, { ...base, facts: 'person-key|2|KEY-2' });
    expect(verifyCeremonyReveal(reveal, { ...base, commitment, facts: 'person-key|2|KEY-2' })).toBe(true);
    expect(verifyCeremonyReveal(reveal, { ...base, commitment }), 'the facts are part of what was signed').toBe(false);
    expect(verifyCeremonyReveal(reveal, { ...base, commitment, facts: 'person-key|2|KEY-OTHER' }), 'a swapped key fails').toBe(false);
    expect(verifyCeremonyReveal(reveal, { ...base, commitment, facts: 'person-key|3|KEY-2' }), 'a bumped version fails').toBe(false);
  });
  it('a reveal minted WITHOUT facts (address-revoke) is unchanged, and does not verify against facts', () => {
    const base = { circleId: 'a', kind: 'address-revoke', subject: 'addr-1', authorRef: 'webid:x' };
    const commitment = ceremonyCommitment(pub, 'a');
    const reveal = signCeremonyReveal(root.secret, base);
    expect(verifyCeremonyReveal(reveal, { ...base, commitment })).toBe(true);
    expect(verifyCeremonyReveal(reveal, { ...base, commitment, facts: null })).toBe(true);
    expect(verifyCeremonyReveal(reveal, { ...base, commitment, facts: '' })).toBe(true);
    expect(verifyCeremonyReveal(reveal, { ...base, commitment, facts: 'anything' })).toBe(false);
  });
});
