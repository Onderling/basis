/**
 * personKey — the PERSON-level signing key: rotating, per profile, rotated only in a ceremony.
 *
 * The design (plans/NOTE-binding-levels.md §10.1, Frits 2026-09-15): the person level signs with a key that ROTATES,
 * never the static profile key that every device — a stolen one included — holds forever. Version n is derived from
 * the root (the phrase) and the profile: `HKDF(profileSeed, salt, "person-key:<n>")`. So a root-custody device
 * re-derives the current version at boot, and an enrolled device — which never holds the root — is handed the current
 * version's seed at its ceremony (the one moment the phrase is typed there) and keeps it in its sealed vault.
 *
 * Version 1 is announced to a circle by the JOIN (or the circle's `create`), device-in-circle signed — the same
 * trust as the join itself (Frits 2026-09-16, option A): a thief who holds the device holds the current key anyway.
 * Every LATER version is announced by a root-revealed `person-key` statement (security/personKeyFold.js), which
 * a device cannot mint. The rotation ceremony is the next step; this module is the key and its two homes.
 */
import nacl from 'tweetnacl';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { encode as b64encode, decode as b64decode } from '../crypto/b64.js';
import { AgentIdentity } from './AgentIdentity.js';
import { VaultMemory } from '@onderling/vault';

const HKDF_INFO_NS = 'onderling-identity-v1:';
// FIXED domain-separation salt — permanent, never change (would re-key every person key).
const _PERSON_KEY_SALT = new TextEncoder().encode('onderling-person-key-v1');

/** The sealed-vault entry a device keeps: `{ version, seed, reveals }` (seed b64; the ceremony's per-circle reveals, for the hand-over). */
export const PERSON_KEY_VAULT_KEY = 'person-key';

/**
 * The seed of person key version `version` for a profile.
 * @param {Uint8Array} profileSeed  the profile's derivation seed (`root.deriveAgentSeed(profileId)`)
 * @param {number} version  1, 2, …
 * @returns {Uint8Array} 32 bytes
 */
export function derivePersonKeySeed(profileSeed, version) {
  if (!(profileSeed instanceof Uint8Array) || profileSeed.length !== 32) throw new Error('derivePersonKeySeed: profileSeed must be a 32-byte Uint8Array');
  if (!Number.isInteger(version) || version < 1) throw new Error('derivePersonKeySeed: version must be a positive integer');
  const info = new TextEncoder().encode(`${HKDF_INFO_NS}person-key:${version}`);
  return hkdf(sha256, profileSeed, _PERSON_KEY_SALT, info, 32);
}

/** The public key (b64) behind a person-key seed — what a circle learns. */
export function personKeyPubKeyB64(seed) {
  if (!(seed instanceof Uint8Array) || seed.length !== 32) throw new Error('personKeyPubKeyB64: seed must be a 32-byte Uint8Array');
  return b64encode(nacl.sign.keyPair.fromSeed(seed).publicKey);
}

/** Sign with a person-key seed (b64 signature). */
export function signWithPersonKey(seed, messageBytes) {
  const kp = nacl.sign.keyPair.fromSeed(seed);
  return b64encode(nacl.sign.detached(messageBytes, kp.secretKey));
}

/** The announcement shape a join or create carries: `{ version, pubKey }`, or null when malformed. */
export function personKeyAnnouncement(pk) {
  if (!pk || !Number.isInteger(pk.version) || pk.version < 1 || typeof pk.pubKey !== 'string' || !pk.pubKey) return null;
  return { version: pk.version, pubKey: pk.pubKey };
}

const LINK_DOMAIN = 'onderling-person-key-link-v1';

/** The bytes a chain link signs: version n+1 and its key, bound to the version that vouches for it. */
export function personKeyLinkMessage({ version, pubKey, prevVersion }) {
  return new TextEncoder().encode(`${LINK_DOMAIN}|${prevVersion}|${version}|${pubKey}`);
}

/**
 * THE CHAIN — how someone who knew version n learns version n+1 without the root: each new version is vouched for
 * by the one before it, signed with the previous seed at the rotation ceremony. A contact who holds version n
 * verifies the links from n upward and arrives at the current key; a device that holds only the current seed
 * cannot forge a link for a version it never held. Public material (keys and signatures), so it may be pulled by
 * anyone who knows the person — but it is the PERSON's cross-circle identity, so it is handed to contacts, never
 * fanned into circles (those learn the key root-revealed, per circle).
 * @returns {{ version: number, pubKey: string, prevVersion: number, sig: string }}
 */
export function signPersonKeyLink(prevSeed, { version, pubKey, prevVersion }) {
  if (!Number.isInteger(version) || !Number.isInteger(prevVersion) || prevVersion !== version - 1) throw new Error('signPersonKeyLink: version must follow prevVersion');
  if (typeof pubKey !== 'string' || !pubKey) throw new Error('signPersonKeyLink: pubKey required');
  return { version, pubKey, prevVersion, sig: signWithPersonKey(prevSeed, personKeyLinkMessage({ version, pubKey, prevVersion })) };
}

/**
 * Walk the chain from what is KNOWN — `{ version, pubKey }` — to the highest version the links vouch for.
 * Each link must be signed by the key of the version before it, starting from the known key. Returns the
 * current `{ version, pubKey }` (the known one when no link applies), or null when a link in the way fails.
 */
export function verifyPersonKeyChain(links, known) {
  if (!known || !Number.isInteger(known.version) || typeof known.pubKey !== 'string') return null;
  const byVersion = new Map();
  for (const l of Array.isArray(links) ? links : []) if (l && Number.isInteger(l.version)) byVersion.set(l.version, l);
  let cur = { version: known.version, pubKey: known.pubKey };
  for (;;) {
    const next = byVersion.get(cur.version + 1);
    if (!next) return cur;
    if (typeof next.pubKey !== 'string' || !next.pubKey || typeof next.sig !== 'string' || next.prevVersion !== cur.version) return null;
    let ok = false;
    try { ok = nacl.sign.detached.verify(personKeyLinkMessage(next), b64decode(next.sig), b64decode(cur.pubKey)); } catch { ok = false; }
    if (!ok) return null;
    cur = { version: next.version, pubKey: next.pubKey };
  }
}

/**
 * SEAL to a person key — a direct message's content, boxed to the recipient's current person key from the sender's
 * current person key (both Ed25519, converted to Curve25519 by the identity). What the transport carries stays
 * sealed to the recipient DEVICE; this seals to the PERSON: a revoked device, which still holds the profile key and
 * may still receive at the profile address, cannot open it.
 * @param {Uint8Array} senderSeed  the sender's current person-key seed
 * @param {string} recipientPubKey  the recipient's current person key (b64)
 * @param {object} content  JSON-serialisable
 * @returns {Promise<{ sealed: string, nonce: string }>}
 */
export async function sealToPersonKey(senderSeed, recipientPubKey, content) {
  const id = await AgentIdentity.fromSeed(senderSeed, new VaultMemory());
  const { nonce, ciphertext } = id.box(new TextEncoder().encode(JSON.stringify(content)), recipientPubKey);
  return { sealed: b64encode(ciphertext), nonce: b64encode(nonce) };
}

/** Open what `sealToPersonKey` made: my seed for the version it was sealed to, the sender's key it names. Null when it does not open. */
export async function openFromPersonKey(mySeed, senderPubKey, { sealed, nonce }) {
  try {
    const id = await AgentIdentity.fromSeed(mySeed, new VaultMemory());
    const plain = id.unbox(b64decode(sealed), b64decode(nonce), senderPubKey);
    if (!plain) return null;
    return JSON.parse(new TextDecoder().decode(plain));
  } catch { return null; }
}

/** Read the vault entry. Null when absent or malformed (an enrolled device from before person keys). */
export async function loadPersonKey(vault) {
  let raw = null;
  try { raw = await vault?.get?.(PERSON_KEY_VAULT_KEY); } catch { return null; }
  if (!raw) return null;
  try {
    const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Number.isInteger(o?.version) || o.version < 1 || typeof o?.seed !== 'string') return null;
    const seed = b64decode(o.seed);
    if (!(seed instanceof Uint8Array) || seed.length !== 32) return null;
    const reveals = (o.reveals && typeof o.reveals === 'object') ? o.reveals : {};
    const links = Array.isArray(o.links) ? o.links : [];
    const previous = [];
    for (const p of Array.isArray(o.previous) ? o.previous : []) {
      try { const ps = b64decode(p.seed); if (Number.isInteger(p.version) && ps instanceof Uint8Array && ps.length === 32) previous.push({ version: p.version, seed: ps }); } catch { /* skip */ }
    }
    return { version: o.version, seed, reveals, links, previous };
  } catch { return null; }
}

/** Write the vault entry — only ever a HIGHER version than what is there (a ceremony never rolls a key back). */
export async function storePersonKey(vault, { version, seed, reveals = {}, links = [], previous = [] }) {
  if (!Number.isInteger(version) || version < 1 || !(seed instanceof Uint8Array) || seed.length !== 32) throw new Error('storePersonKey: {version, seed} required');
  const have = await loadPersonKey(vault);
  if (have && have.version >= version) return false;
  // Older versions stay openable: what was sealed to version n before the rotation still arrives after it.
  const keep = new Map();
  for (const p of [...(have?.previous ?? []), ...(have ? [{ version: have.version, seed: have.seed }] : []), ...previous]) {
    if (p && Number.isInteger(p.version) && p.version < version && p.seed instanceof Uint8Array && p.seed.length === 32) keep.set(p.version, p.seed);
  }
  const allLinks = new Map();
  for (const l of [...(have?.links ?? []), ...(Array.isArray(links) ? links : [])]) if (l && Number.isInteger(l.version)) allLinks.set(l.version, l);
  await vault.set(PERSON_KEY_VAULT_KEY, JSON.stringify({
    version, seed: b64encode(seed), reveals: reveals && typeof reveals === 'object' ? reveals : {},
    links: [...allLinks.values()].sort((a, b) => a.version - b.version),
    previous: [...keep.entries()].sort((a, b) => a[0] - b[0]).map(([v, sd]) => ({ version: v, seed: b64encode(sd) })),
  }));
  return true;
}
