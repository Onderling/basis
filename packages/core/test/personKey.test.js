/**
 * The person key: derived from the root per profile and version, kept sealed on an enrolled device, announced to a
 * circle as `{ version, pubKey }`.
 */
import { describe, it, expect } from 'vitest';
import { Bootstrap } from '../src/identity/Bootstrap.js';
import { derivePersonKeySeed, derivePersonLinkKeySeed, personKeyPubKeyB64, personKeyAnnouncement, loadPersonKey, storePersonKey, signWithPersonKey, signPersonKeyLink, verifyPersonKeyChain, sealToPersonKey, openFromPersonKey } from '../src/identity/personKey.js';
import { VaultMemory } from '@onderling/vault';
import nacl from 'tweetnacl';
import { decode as b64decode } from '../src/crypto/b64.js';

const root = Bootstrap.create().bootstrap;
const profile = root.deriveAgentSeed('default');

describe('derivation', () => {
  it('is deterministic per (root, profile, version), differs per version, and is not the profile key', () => {
    const v1 = derivePersonKeySeed(profile, 1), again = derivePersonKeySeed(profile, 1), v2 = derivePersonKeySeed(profile, 2);
    expect(personKeyPubKeyB64(v1)).toBe(personKeyPubKeyB64(again));
    expect(personKeyPubKeyB64(v1)).not.toBe(personKeyPubKeyB64(v2));
    expect(personKeyPubKeyB64(v1)).not.toBe(personKeyPubKeyB64(profile));
    expect(personKeyPubKeyB64(derivePersonKeySeed(Bootstrap.create().bootstrap.deriveAgentSeed('default'), 1))).not.toBe(personKeyPubKeyB64(v1));
  });
  it('signs verifiably under its public key', () => {
    const seed = derivePersonKeySeed(profile, 1);
    const msg = new TextEncoder().encode('hoi');
    expect(nacl.sign.detached.verify(msg, b64decode(signWithPersonKey(seed, msg)), b64decode(personKeyPubKeyB64(seed)))).toBe(true);
  });
  it('refuses junk', () => {
    expect(() => derivePersonKeySeed(new Uint8Array(31), 1)).toThrow();
    expect(() => derivePersonKeySeed(profile, 0)).toThrow();
  });
});

describe('the announcement shape', () => {
  it('normalises a well-formed key and rejects the rest', () => {
    expect(personKeyAnnouncement({ version: 2, pubKey: 'K', extra: 1 })).toEqual({ version: 2, pubKey: 'K' });
    for (const bad of [null, {}, { version: 0, pubKey: 'K' }, { version: '1', pubKey: 'K' }, { version: 1 }, { version: 1, pubKey: '' }]) expect(personKeyAnnouncement(bad)).toBe(null);
  });
});

describe('the sealed-vault entry', () => {
  it('round-trips, never rolls back, and reads absent/malformed as null', async () => {
    const vault = new VaultMemory();
    expect(await loadPersonKey(vault)).toBe(null);
    const v1 = derivePersonKeySeed(profile, 1), v2 = derivePersonKeySeed(profile, 2);
    expect(await storePersonKey(vault, { version: 1, seed: v1 })).toBe(true);
    expect(await loadPersonKey(vault)).toMatchObject({ version: 1, seed: v1, reveals: {} });
    expect(await storePersonKey(vault, { version: 1, seed: v2 }), 'same version: kept').toBe(false);
    expect(await storePersonKey(vault, { version: 2, seed: v2, reveals: { c1: { rootPubKey: 'r', sig: 's' } } })).toBe(true);
    expect((await loadPersonKey(vault)).reveals, 'the reveals ride beside the key').toEqual({ c1: { rootPubKey: 'r', sig: 's' } });
    expect(await storePersonKey(vault, { version: 1, seed: v1 }), 'a lower version never lands').toBe(false);
    expect((await loadPersonKey(vault)).version).toBe(2);
    await vault.set('person-key', '{"version":3}');
    expect(await loadPersonKey(vault)).toBe(null);
  });
});

describe('the chain — the root-derived LINK KEY vouches for every version, so a contact who knew n learns the current key without the root, and a revoked device (which holds seed n, never the root) cannot forge n+1', () => {
  const v = (n) => derivePersonKeySeed(profile, n);
  const pub = (n) => personKeyPubKeyB64(v(n));
  const linkSeed = derivePersonLinkKeySeed(profile);
  const linkKeyPub = personKeyPubKeyB64(linkSeed);
  const known = (n) => ({ version: n, pubKey: pub(n), linkKeyPub });
  it('the link key is its own key: per profile, not per version, and never one of the person keys', () => {
    expect(linkSeed).toHaveLength(32);
    expect(derivePersonLinkKeySeed(profile)).toEqual(linkSeed);
    for (const n of [1, 2, 3]) expect(linkKeyPub).not.toBe(pub(n));
    expect(personKeyPubKeyB64(derivePersonLinkKeySeed(Bootstrap.create().bootstrap.deriveAgentSeed('default')))).not.toBe(linkKeyPub);
  });
  it('links signed with the link key verify from the known version up to the current one', () => {
    const l2 = signPersonKeyLink(linkSeed, { version: 2, pubKey: pub(2), prevVersion: 1 });
    const l3 = signPersonKeyLink(linkSeed, { version: 3, pubKey: pub(3), prevVersion: 2 });
    expect(verifyPersonKeyChain([l2, l3], known(1))).toEqual({ version: 3, pubKey: pub(3), linkKeyPub });
    expect(verifyPersonKeyChain([l3], known(2))).toEqual({ version: 3, pubKey: pub(3), linkKeyPub });
    expect(verifyPersonKeyChain([], known(2)), 'no link: what was known').toEqual(known(2));
    expect(verifyPersonKeyChain([l3], known(1)), 'a gap: the walk stops at what is known').toEqual(known(1));
    expect(verifyPersonKeyChain([{ ...l2, pubKey: 'SWAPPED' }], known(1))).toBe(null);
  });
  it('THE HOLE (2026-09-16): a link signed with seed n — what a revoked device holds — is REFUSED', () => {
    const forged = signPersonKeyLink(v(1), { version: 2, pubKey: 'THIEF', prevVersion: 1 });
    expect(verifyPersonKeyChain([forged], known(1))).toBe(null);
    // even a link naming the GENUINE next key is refused when seed n signed it: only the link key vouches
    const genuineKeyWrongSigner = signPersonKeyLink(v(1), { version: 2, pubKey: pub(2), prevVersion: 1 });
    expect(verifyPersonKeyChain([genuineKeyWrongSigner], known(1))).toBe(null);
    // a link key that is not the pinned one is a stranger's
    const other = derivePersonLinkKeySeed(Bootstrap.create().bootstrap.deriveAgentSeed('default'));
    expect(verifyPersonKeyChain([signPersonKeyLink(other, { version: 2, pubKey: 'THIEF', prevVersion: 1 })], known(1))).toBe(null);
  });
  it('a known key WITHOUT a pinned link key never advances — the contact must re-take the card', () => {
    const l2 = signPersonKeyLink(linkSeed, { version: 2, pubKey: pub(2), prevVersion: 1 });
    expect(verifyPersonKeyChain([l2], { version: 1, pubKey: pub(1) })).toEqual({ version: 1, pubKey: pub(1) });
  });
  it('a link must follow its predecessor', () => {
    expect(() => signPersonKeyLink(linkSeed, { version: 3, pubKey: pub(3), prevVersion: 1 })).toThrow();
  });
});

describe('the direct-message seal — to the person, not the device', () => {
  it('opens with the recipient\'s seed for that version and the sender\'s key; not with another seed', async () => {
    const anna = derivePersonKeySeed(profile, 2), bea = derivePersonKeySeed(Bootstrap.create().bootstrap.deriveAgentSeed('default'), 1);
    const box = await sealToPersonKey(anna, personKeyPubKeyB64(bea), { text: 'hoi bea', file: null });
    expect(await openFromPersonKey(bea, personKeyPubKeyB64(anna), box)).toEqual({ text: 'hoi bea', file: null });
    expect(await openFromPersonKey(derivePersonKeySeed(profile, 3), personKeyPubKeyB64(anna), box), 'a version the seal was not made for').toBe(null);
    expect(await openFromPersonKey(bea, personKeyPubKeyB64(derivePersonKeySeed(profile, 1)), box), 'the wrong sender key').toBe(null);
  });
});

describe('the vault entry keeps the chain, the older seeds and the link key\'s PUBLIC half — never its seed', () => {
  const linkSeed = derivePersonLinkKeySeed(profile);
  const linkKeyPub = personKeyPubKeyB64(linkSeed);
  it('a rotation keeps the previous seed and the links; a hand-over merges what it carries', async () => {
    const vault = new VaultMemory();
    const v1 = derivePersonKeySeed(profile, 1), v2 = derivePersonKeySeed(profile, 2), v3 = derivePersonKeySeed(profile, 3);
    await storePersonKey(vault, { version: 1, seed: v1, linkKeyPub });
    const l2 = signPersonKeyLink(linkSeed, { version: 2, pubKey: personKeyPubKeyB64(v2), prevVersion: 1 });
    await storePersonKey(vault, { version: 2, seed: v2, links: [l2] });
    let e = await loadPersonKey(vault);
    expect(e.previous).toEqual([{ version: 1, seed: v1 }]);
    expect(e.links).toEqual([l2]);
    expect(e.linkKeyPub, 'a later write without the pub keeps it').toBe(linkKeyPub);
    const l3 = signPersonKeyLink(linkSeed, { version: 3, pubKey: personKeyPubKeyB64(v3), prevVersion: 2 });
    await storePersonKey(vault, { version: 3, seed: v3, links: [l2, l3], previous: [{ version: 1, seed: v1 }, { version: 2, seed: v2 }] });
    e = await loadPersonKey(vault);
    expect(e.previous.map((p) => p.version)).toEqual([1, 2]);
    expect(e.links.map((l) => l.version)).toEqual([2, 3]);
  });
  it('the entry carries the link key\'s public half and nothing that derives its seed; a same-version write may only fill the pub in', async () => {
    const vault = new VaultMemory();
    const v1 = derivePersonKeySeed(profile, 1);
    expect(await storePersonKey(vault, { version: 1, seed: v1 })).toBe(true);
    expect((await loadPersonKey(vault)).linkKeyPub).toBe(null);
    expect(await storePersonKey(vault, { version: 1, seed: v1, linkKeyPub }), 'filling the pub in is a change').toBe(true);
    expect((await loadPersonKey(vault)).linkKeyPub).toBe(linkKeyPub);
    expect(await storePersonKey(vault, { version: 1, seed: v1, linkKeyPub }), 'the same again is not').toBe(false);
    expect(await storePersonKey(vault, { version: 1, seed: v1, linkKeyPub: 'OTHER' }), 'a pinned pub is never replaced').toBe(false);
    expect((await loadPersonKey(vault)).linkKeyPub).toBe(linkKeyPub);
    const raw = JSON.parse(await vault.get('person-key'));
    expect(Object.keys(raw).sort()).toEqual(['linkKeyPub', 'links', 'previous', 'reveals', 'seed', 'version']);
    expect(raw.linkKeyPub).toBe(linkKeyPub);
  });
});
