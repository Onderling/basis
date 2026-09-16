/**
 * The person-key statement at the membership rail's door: it binds ONLY by a root reveal against the row's
 * ceremony commitment, the reveal covers the announced key, and a person announces only their own key. A
 * device that holds the current person key (a stolen one included) can therefore neither rotate nor substitute.
 */
import { describe, it, expect, vi } from 'vitest';
import { Bootstrap, ceremonyCommitment, rootPubKeyB64Of, signCeremonyReveal, PERSON_KEY_KIND, personKeyFacts } from '@onderling/core';
import { membershipBindingVerifier, MEMBERSHIP_RAIL_KINDS } from '../../src/v2/membershipRail.js';

const root = Bootstrap.create().bootstrap;
const pub = rootPubKeyB64Of(root.secret);
const CIRCLE = 'k1';
const ADA = 'w:ada';
const commitment = ceremonyCommitment(pub, CIRCLE);
const rosterWith = (rows) => vi.fn(async () => ({ members: rows }));
const announce = (version, pubKey, { subject = ADA, authorRef = ADA, secret = root.secret, facts } = {}) => ({
  author: 'addr:ada-phone', ref: authorRef, circleId: CIRCLE, kind: PERSON_KEY_KIND, subject,
  payload: { version, pubKey, reveal: signCeremonyReveal(secret, { circleId: CIRCLE, kind: PERSON_KEY_KIND, subject, authorRef, facts: facts === undefined ? personKeyFacts({ version, pubKey }) : facts }) },
});

describe('person-key binds by root reveal, covering the key', () => {
  it('the membership rail declares the kind', () => {
    expect(MEMBERSHIP_RAIL_KINDS).toContain(PERSON_KEY_KIND);
  });

  it('a ceremony announcement against the row\'s commitment binds', async () => {
    const verify = membershipBindingVerifier(rosterWith([{ webid: ADA, circleAddress: 'addr:ada-phone', ceremonyCommitment: commitment }]));
    expect(await verify(announce(2, 'ADA-KEY-2'))).toBe(true);
  });

  it('without the reveal, or with another root\'s reveal, or on a row with no commitment — nothing binds (deny by default)', async () => {
    const verify = membershipBindingVerifier(rosterWith([{ webid: ADA, circleAddress: 'addr:ada-phone', ceremonyCommitment: commitment }]));
    const bare = announce(2, 'ADA-KEY-2'); delete bare.payload.reveal;
    expect(await verify(bare), 'no reveal').toBe(false);
    expect(await verify(announce(2, 'ADA-KEY-2', { secret: Bootstrap.create().bootstrap.secret })), 'another root').toBe(false);
    const noCommit = membershipBindingVerifier(rosterWith([{ webid: ADA, circleAddress: 'addr:ada-phone' }]));
    expect(await noCommit(announce(2, 'ADA-KEY-2')), 'row without a commitment').toBe(false);
    const stranger = membershipBindingVerifier(rosterWith([]));
    expect(await stranger(announce(2, 'ADA-KEY-2')), 'no row').toBe(false);
  });

  it('the reveal COVERS the key: a valid reveal re-attached to another key or version is refused', async () => {
    const verify = membershipBindingVerifier(rosterWith([{ webid: ADA, circleAddress: 'addr:ada-phone', ceremonyCommitment: commitment }]));
    const good = announce(2, 'ADA-KEY-2');
    const swappedKey = { ...good, payload: { ...good.payload, pubKey: 'THIEF-KEY' } };
    const bumped = { ...good, payload: { ...good.payload, version: 3 } };
    expect(await verify(swappedKey)).toBe(false);
    expect(await verify(bumped)).toBe(false);
    // a reveal minted WITHOUT facts (as an address-revoke would be) does not bind a person-key
    expect(await verify(announce(2, 'ADA-KEY-2', { facts: null }))).toBe(false);
  });

  it('SELF-SUBJECT: a member cannot announce a key for someone else, even with their own valid reveal', async () => {
    const verify = membershipBindingVerifier(rosterWith([
      { webid: ADA, circleAddress: 'addr:ada-phone', ceremonyCommitment: commitment },
      { webid: 'w:bob', circleAddress: 'addr:bob' },
    ]));
    expect(await verify(announce(2, 'FOR-BOB', { subject: 'w:bob' }))).toBe(false);
  });

  it('a malformed announcement (no key / no version) binds nowhere', async () => {
    const verify = membershipBindingVerifier(rosterWith([{ webid: ADA, circleAddress: 'addr:ada-phone', ceremonyCommitment: commitment }]));
    expect(await verify(announce(undefined, 'ADA-KEY', { facts: null }))).toBe(false);
    expect(await verify(announce(2, '', { facts: null }))).toBe(false);
  });

  it('the self-binding shortcut does NOT apply to a ceremony kind: my own device\'s announcement needs the reveal too', async () => {
    const verify = membershipBindingVerifier(rosterWith([{ webid: ADA, circleAddress: 'addr:ada-phone', ceremonyCommitment: commitment }]),
      { circleIdentityFor: async () => ({ pubKey: 'addr:ada-phone' }) });
    const bare = announce(2, 'ADA-KEY-2'); delete bare.payload.reveal;
    expect(await verify(bare)).toBe(false);
    expect(await verify(announce(2, 'ADA-KEY-2'))).toBe(true);
  });
});
