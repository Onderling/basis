/**
 * THE PERSONA RUNTIME — the keys an agent runs for ONE persona, named once.
 *
 * A persona is an identity on the wire: its profile seed (from the owner root), the device seed this device derives
 * its per-circle keys from (from the persona's wire device id), the device's delegation record, the per-circle
 * identities, addresses and sealing keys, the AUTHORITY its ceremony commitments name, and the starting point of its
 * rotating person key. Before this the bundle lived spread over the agent's boot as loose values for the one
 * persona that ran; it is built here, and the agent reads it.
 *
 * The agent runs one of these for EVERY persona the registry holds (`runPersona` in the agent): under root custody each
 * derives from the resident root; a delegated device runs only the personas a ceremony handed it (their delegation in
 * the persona's vault slots) and refuses any other id here, loudly (`ceremony-required`).
 *
 * What stays in the agent: the STATEFUL wiring around a persona (adopting a rotated person key, registering it with
 * the secure agent and the relays), because those reach parts of the agent built after this.
 */
import { VaultMemory, seedFromString, seedToString } from '@onderling/vault';
import {
  AgentIdentity, deriveCircleAddress, circleIdentity, deriveCircleSeed, signCeremonyCommitmentFromSeed, ceremonyCommitment,
  authorityPubKeyB64Of, signDeviceDelegation, deviceDelegationPubKey, deriveDeviceSeed, wireDeviceId, firstDeviceIdFor,
  b64encode, derivePersonKeySeed, derivePersonLinkKeySeed, personKeyPubKeyB64, loadPersonKey,
} from '@onderling/core';
import { sealingKeyPairFromNetworkKey } from '@onderling/pod-client';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';
import { DEVICE_DELEGATION_VAULT_KEY, personaVault } from './personaVault.js';

/** How many circle addresses one persona runtime keeps derived; past it the oldest is derived again on next use. */
const CIRCLE_ADDRESS_MEMO_MAX = param({ key: 'persona.circleAddressMemoMax', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 256 });

/**
 * Build one persona's runtime bundle.
 *
 * @param {object} a
 * @param {string} [a.profileId='default']  the persona
 * @param {object|null} a.ownerRoot          the owner root (a core Bootstrap) under root custody; null under delegation
 * @param {{mode: string, deviceId?: string}} a.custody  the custody marker's reading
 * @param {Uint8Array|null} [a.custodySeed]  delegation custody: the key door's (delegation) seed
 * @param {object} a.chatVault                the sealed chat vault (the chat seed, the person key, the delegation blob)
 * @returns {Promise<{
 *   profileId: string, profileSeed: Uint8Array|null, deviceDerivationSeed: Uint8Array|null, enrolledDevice: object|null,
 *   circleIdentityFor: (circleId: string) => Promise<object>, circleAddressFor: (circleId: string) => string,
 *   circleSealingKeyPairFor: (circleId: string) => object, authorityPubKeyB64: string|null,
 *   ceremonyCommitmentFor: (circleId: string) => string|null, signCeremonyCommitment: Function,
 *   initialPersonKey: object|null, derivedLinkKeyPub: string|null,
 *   chatId: object|null, personKey: object|null, personIdentity: object|null,
 * }>}
 */
export async function createPersonaRuntime({ profileId = 'default', ownerRoot = null, custody, custodySeed = null, chatVault, internalDeviceId = null } = {}) {
  const isDefault = profileId === 'default';
  // A persona other than the default derives everything from the root, so it runs only where the root is resident; a
  // delegated device is handed a persona at a ceremony (enrol/restore), never derives one.
  // A persona with no root resident runs only if it was HANDED here at a ceremony (its delegation blob in its slots).
  if (!isDefault) custody = { mode: ownerRoot ? 'root' : 'handed' };
  // The persona's slots in the device's chat vault (personaVault.js): its chat seed, person key and delegation blob.
  const vault = personaVault(chatVault, profileId);
  if (custody.mode === 'handed') {
    let handed = null;
    try { handed = await vault.get(DEVICE_DELEGATION_VAULT_KEY); } catch { handed = null; }
    if (!handed) throw new Error(`createPersonaRuntime: persona "${profileId}" was not handed to this device (ceremony-required)`);
  }
  // The persona's seed — the source of its chat identity, its device seed, its person key. Root custody only.
  const profileSeed = ownerRoot ? ownerRoot.deriveAgentSeed(profileId) : null;
  // The persona's AUTHORITY public key under root custody — derived once here, read below by the record re-sign check
  // and the ceremony commitment.
  const rootAuthorityPubKeyB64 = ownerRoot ? authorityPubKeyB64Of(ownerRoot.deriveProfileAuthority(profileId)) : null;

  // THE PERSON KEY (rotating, per profile — identity/personKey.js). A root-custody device re-derives the current
  // version each boot; an enrolled device was handed it at its ceremony and keeps it sealed. Absent on an enrolled
  // device from before person keys: it announces no key at joins, and says so once. The LINK KEY's public half rides
  // with it: root custody derives it; an enrolled device was handed it. The link SEED exists only inside a ceremony.
  const derivedLinkKeyPub = profileSeed ? personKeyPubKeyB64(derivePersonLinkKeySeed(profileSeed)) : null;
  const initialPersonKey = await (async () => {
    try {
      const stored = await loadPersonKey(vault);
      if (stored) return (stored.linkKeyPub || !derivedLinkKeyPub) ? stored : { ...stored, linkKeyPub: derivedLinkKeyPub };
    } catch { /* re-derive below */ }
    if (profileSeed) return { version: 1, seed: derivePersonKeySeed(profileSeed, 1), linkKeyPub: derivedLinkKeyPub };
    console.warn('[realAgent] no person key on this enrolled device — it announces none at joins; a phrase ceremony on it hands it one');
    return null;
  })();

  // The chat identity's seed in the vault. Root custody re-derives it; delegation custody CANNOT (the root is not
  // resident) — the identity was persisted at the ceremony, and its absence is a broken vault, not a re-derivable
  // state. Loud, never silently a new person.
  let chatSeedReadable = false;
  try { chatSeedReadable = (await vault.get('agent-privkey')) != null; } catch { /* unreadable → reseed */ }
  if (!chatSeedReadable) {
    if (!profileSeed) throw new Error('delegation custody: the chat identity vault is unreadable — restore with the recovery phrase');
    await AgentIdentity.fromSeed(profileSeed, vault);
  }

  // ── THE DEVICE DERIVATION ROOT ──────────────────────────────────────────────────────────────────────────────
  // An ENROLLED device (the delegation blob present — written sealed by the enrollment ceremony, see
  // ownerRootRestore.js) derives its PER-CIRCLE keys from its DELEGATION seed: every device of one person then presents
  // a DISTINCT address per circle (the roster row's address set), and revoking one device never touches another's
  // keys. The chat identity (the member's webid) stays PROFILE-derived on every device: the member is one.
  let deviceDerivationSeed = custodySeed ?? profileSeed;
  let enrolledDevice = custody?.mode === 'delegation' ? { deviceId: custody.deviceId } : null;
  // the device's own internal id, the same for every persona it runs (each shows its own wire id of it)
  let deviceInternalId = internalDeviceId;
  try {
    let blob = await vault.get(DEVICE_DELEGATION_VAULT_KEY);
    if (typeof blob === 'string') { try { blob = JSON.parse(blob); } catch { blob = null; } }
    if (blob && typeof blob === 'object' && typeof blob.seed === 'string' && typeof blob.deviceId === 'string') {
      if (custody?.mode === 'delegation') {
        // The blob is the LABEL + pre-signed-record carrier here; the key door + marker are the boot authority.
        if (enrolledDevice) {
          if (blob.label) enrolledDevice.label = blob.label;
          if (blob.record) enrolledDevice.record = blob.record;
        }
        // the device's own internal id rides the blob too — a later "these personas here too" derives each persona's
        // wire id of this device from it
        if (typeof blob.internalId === 'string' && blob.internalId) deviceInternalId = blob.internalId;
      } else {
        // Root custody, enrolled (the pre-cutover interim): the blob supplies the derivation root.
        const decoded = seedFromString(blob.seed);
        if (decoded instanceof Uint8Array && decoded.length === 32) {
          deviceDerivationSeed = decoded;
          // A record minted before the persona's authority signed names the ROOT as its signer. The root is resident
          // here, so it is re-signed in place by the authority — same id, same key, so no address moves; the id itself
          // becomes a wire id at this device's next phrase ceremony (the self-enrol migration mints one).
          if (ownerRoot && blob.record && blob.record.by !== rootAuthorityPubKeyB64) {
            try {
              const resigned = signDeviceDelegation(ownerRoot.deriveProfileAuthority(profileId), {
                profileId: blob.record.profileId ?? profileId, deviceId: blob.deviceId, pubKey: blob.record.pubKey,
              });
              blob.record = blob.record.label ? { ...resigned, label: blob.record.label } : resigned;
              await vault.set(DEVICE_DELEGATION_VAULT_KEY, JSON.stringify(blob));
            } catch (err) { console.warn(`[realAgent] could not re-sign this device's delegation by its authority: ${err?.message ?? err}`); }
          }
          deviceInternalId = typeof blob.internalId === 'string' ? blob.internalId : blob.deviceId;   // pre-wire-id blobs: the id WAS internal
          enrolledDevice = {
            deviceId: blob.deviceId, selfMinted: blob.selfMinted === true,
            ...(blob.label ? { label: blob.label } : {}),
            ...(blob.record ? { record: blob.record } : {}),
          };
        }
      }
    }
  } catch { /* unenrolled */ }

  // THE FIRST DEVICE ENROLS ITSELF AT FIRST BOOT (2026-09-16): under root custody with no delegation blob, mint a
  // device id, derive the device seed, sign the delegation record by the persona's authority, and keep the blob sealed
  // — what the enrol ceremony writes on a second device, minus the custody cutover. From here every device of a person
  // derives its per-circle addresses from a DEVICE seed; the profile seed derives nothing a peer sees.
  if (ownerRoot && !enrolledDevice && profileSeed) {
    try {
      // the internal id is root-derived, so a later device holding the phrase can re-derive this one; the id it SHOWS is
      // the persona-keyed wire id, and the seed derives from that (the phrase + the record's id reproduce it anywhere)
      const internalId = internalDeviceId ?? firstDeviceIdFor(ownerRoot);
      const deviceId = wireDeviceId(profileSeed, internalId);
      const seed = deriveDeviceSeed(profileSeed, deviceId);
      const record = signDeviceDelegation(ownerRoot.deriveProfileAuthority(profileId), { profileId, deviceId, pubKey: deviceDelegationPubKey(seed) });
      await vault.set(DEVICE_DELEGATION_VAULT_KEY, JSON.stringify({ seed: seedToString(seed), deviceId, internalId, record, selfMinted: true }));
      deviceDerivationSeed = seed;
      deviceInternalId = internalId;
      enrolledDevice = { deviceId, record, selfMinted: true };
    } catch (err) {
      console.warn(`[realAgent] the first device could not mint its delegation — the grants lane will not sign until it does: ${err?.message ?? err}`);
    }
  }

  // The per-circle SIGNING identity, one per circle, memoised — derived from THIS DEVICE'S derivation root, so this
  // device presents an honestly distinct address per circle. The vault is deliberately EPHEMERAL: a per-circle key
  // written to storage is one more copy of the thing we are trying not to spread. Re-derived every boot.
  const circleIdentities = new Map();   // circleId → Promise<AgentIdentity>
  const circleIdentityFor = (circleId) => {
    if (!circleIdentities.has(circleId)) {
      circleIdentities.set(circleId, circleIdentity(deviceDerivationSeed, circleId, new VaultMemory()));
    }
    return circleIdentities.get(circleId);
  };
  // Memoised on THIS runtime, keyed by circle id: the derivation (sha + an Ed25519 keypair in pure JS) ran dozens of
  // times per circle during a phone boot. Bounded; dies with the runtime; never persisted.
  const circleAddresses = new Map();   // circleId → address
  const circleAddressFor = (circleId) => {
    let address = circleAddresses.get(circleId);
    if (address === undefined) {
      address = deriveCircleAddress(deviceDerivationSeed, circleId);
      if (circleAddresses.size >= CIRCLE_ADDRESS_MEMO_MAX) circleAddresses.delete(circleAddresses.keys().next().value);
      circleAddresses.set(circleId, address);
    }
    return address;
  };
  // The current person key's pubKey, memoised against the key RECORD it was derived from: a rotation replaces
  // the record, so the next call derives afresh.
  let personKeyMemo = null;   // { record, pubKey }
  const personKeyPubOf = (record) => {
    if (!record) return null;
    if (personKeyMemo?.record !== record) personKeyMemo = { record, pubKey: personKeyPubKeyB64(record.seed) };
    return personKeyMemo.pubKey;
  };
  // ONE sealing key family: this device's per-circle SEALING keypair is the ed2curve image of its per-circle address
  // key — phrase-derivable, one per device, retired with the address.
  const circleSealingKeyPairFor = (circleId) => sealingKeyPairFromNetworkKey(b64encode(deriveCircleSeed(deviceDerivationSeed, circleId)));
  // THE CEREMONY COMMITMENT (core ceremonyCommitment.js): who may retire this persona's addresses in a circle. Its key
  // is the persona's AUTHORITY, never the root (the root's own key on the wire would link every persona). Under
  // delegation custody it rides the device's own record (`by` — the authority signed it).
  const authorityPubKeyB64 = rootAuthorityPubKeyB64 ?? (enrolledDevice?.record?.by ?? null);
  if (!authorityPubKeyB64 && typeof console !== 'undefined') console.warn('[ceremony] no owner-root public key on this device — its addresses cannot be retired by a ceremony until it re-enrolls');
  const ceremonyCommitmentFor = (circleId) => (authorityPubKeyB64 ? ceremonyCommitment(authorityPubKeyB64, circleId) : null);
  const signCeremonyCommitment = (circleId, address, commitment) =>
    signCeremonyCommitmentFromSeed(deriveCircleSeed(deviceDerivationSeed, circleId), { circleId, circleAddress: address, commitment });

  // The persona's chat identity: the secure agent loads the DEFAULT's from its slot; any other persona's is loaded here.
  const chatId = isDefault ? null : await AgentIdentity.restore(vault);

  return {
    profileId, vault, profileSeed, deviceDerivationSeed, enrolledDevice, internalDeviceId: deviceInternalId,
    circleIdentityFor, circleAddressFor, circleSealingKeyPairFor, personKeyPubOf,
    authorityPubKeyB64, ceremonyCommitmentFor, signCeremonyCommitment,
    initialPersonKey, derivedLinkKeyPub,
    // The persona's LIVE identities, set by the agent: its chat identity once the secure agent has loaded it from the
    // persona's slot, and its current person key (+ the identity it speaks as), which a rotation replaces.
    chatId,
    personKey: initialPersonKey,
    personIdentity: null,
  };
}
