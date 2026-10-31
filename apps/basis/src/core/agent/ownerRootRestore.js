/**
 * Restoring an identity from its 24-word phrase — ONE implementation, two doors.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────────────────────────────────
 * There were two restore paths and only one of them restored anything.
 *
 *   • The in-app wizard → `callSkill('household', 'restoreOwnerPhrase')` → **correct**: it writes the owner
 *     root and re-derives the default profile from it.
 *   • The FIRST-RUN door ("I have a recovery phrase" on the welcome screen) →
 *     `basis-mobile/src/core/restoreFromMnemonic.js` → **wrong**: it wrote only the chat vault, from the
 *     mnemonic's raw entropy, and never touched the owner root. The next boot found an empty owner-root
 *     vault, minted a fresh RANDOM root, and re-keyed every per-circle address.
 *
 * The cruel part is which door a real person reaches. Someone reinstalling the app has no identity yet, so
 * the working wizard is unreachable — **the only door available to them was the broken one.** And
 * `realAgent.js` already knew: its `restoreOwnerPhrase` comment says "NOT the shared `restoreFromMnemonic`
 * (legacy direct-seed)". The trap was documented and left wired up.
 *
 * So the restore is defined once, here, and both doors call it. A second implementation of "restore an
 * identity" is not a duplication problem, it is a losing-someone's-identity problem.
 *
 * ── What a restore IS ────────────────────────────────────────────────────────────────────────────────────
 * Exactly two writes, in this order:
 *   1. the owner root SEED into the platform key door — the ONE secret per install; everything else
 *      derives from it. (The phrase itself is never persisted; it stays in the user's hands.)
 *   2. the default profile's chat identity, derived from that root via `deriveAgentSeed('default')`.
 *
 * Write 2 is not optional and is not merely a cache: without it a stale chat identity from a previous
 * install would be picked up on the next boot in preference to the restored one.
 */

import { AgentIdentity, Bootstrap, deriveCircleRoot, deriveDeviceSeed, wireDeviceId, deriveVaultAtRestKeyFrom, signDeviceDelegation, deviceDelegationPubKey, derivePersonKeySeed, derivePersonLinkKeySeed, personKeyPubKeyB64, storePersonKey } from '@onderling/core';
import { VaultEncrypted, migrateVaultToEncrypted, seedToString } from '@onderling/vault';
import { loadProfile } from '@onderling/agent-registry';
import { cutoverToDelegation } from './ownerRootCustody.js';
import { markForgetPending } from '../../v2/enrolForgets.js';

/** The profile the chat identity is derived from. */
export const DEFAULT_PROFILE = 'default';

/**
 * The sealed-vault key holding an enrolled device's delegation: `{ seed, deviceId, label? }` with
 * `seed` base64url. Its PRESENCE is what makes a boot an ENROLLED boot: per-circle keys derive
 * from this seed instead of the profile seed, so this device presents its own address in every
 * circle (the add-a-device model). Written only here, through the vault-at-rest layer.
 */
/** The unsealed-vault note a phrase ceremony leaves for the next boot (see the restore-finish flow). */
export const RESTORE_PENDING_KEY = 'restore-pending';
// The delegation blob's slot is one of a persona's vault slots (personaVault.js); re-exported for the callers that
// import it from here.
export { DEVICE_DELEGATION_VAULT_KEY } from './personaVault.js';
import { DEVICE_DELEGATION_VAULT_KEY, CIRCLE_ROOT_VAULT_KEY, HELD_PERSONAS_VAULT_KEY, RECOVERY_SEAL_VAULT_KEY, RECOVERY_SEAL_LABEL, personaVault } from './personaVault.js';

const _b64url = (bytes) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  // btoa is absent on some RN runtimes; Buffer is absent on the web — take whichever exists.
  const b64 = typeof btoa === 'function' ? btoa(s) : Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/**
 * A fresh internal device id, from a cryptographic random source or not at all. It needs no secrecy (the wire id is
 * keyed by its own secret salt) but it must be UNIQUE: two devices with one id derive one seed, one key set on two
 * devices, and neither could be retired alone — so a platform without a CSPRNG cannot enrol, rather than guessing.
 * @param {{ crypto?: { randomUUID?: () => string, getRandomValues?: (b: Uint8Array) => Uint8Array } }} [env]
 * @returns {string}
 */
export function newDeviceId({ crypto: c = globalThis.crypto } = {}) {
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new Error('enrol: this platform has no cryptographic random source — a device id cannot be minted safely');
  }
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Restore an identity from its recovery phrase.
 *
 * Pure orchestration over injected stores, so it runs identically at first-run (no agent exists yet)
 * and from inside a booted agent.
 *
 * @param {object} a
 * @param {string} a.mnemonic         the 24-word phrase, already normalised by the caller
 * @param {object} a.rootKeyStore     the platform key door the root SEED lives behind (the phrase
 *                                    itself is never persisted — it stays in the user's hands)
 * @param {object} a.chatVault        the BACKING vault for the default profile's chat identity
 *                                    (`cc-chat-id:`, unsealed) — this function seals it to the
 *                                    restored root and writes through the sealed layer, so the
 *                                    seed never sits in it as plaintext
 * @param {{label?: string}} [a.enrollDevice]
 *                                    ENROLL this install as a device of the profile (add-a-device):
 *                                    mints a fresh enrollment deviceId, derives the device's
 *                                    delegation seed from the restored profile seed, and writes the
 *                                    delegation blob through the SAME newly-sealed vault — so the
 *                                    next boot derives per-circle keys from the delegation and this
 *                                    device presents its own address in every circle. The blob must
 *                                    be written here, not by the caller: at ceremony time the
 *                                    caller's live vault wrapper is still sealed to the OLD root.
 * @param {import('@onderling/vault').Vault} [a.markerVault]
 *                                    the UNSEALED owner-root vault. Supplying it makes the ceremony
 *                                    END IN DELEGATION CUSTODY (the cutover): the key door holds
 *                                    the delegation seed, the vault-at-rest key derives from it,
 *                                    and the ROOT IS NEVER PERSISTED — the phrase stays the only
 *                                    way to reconstruct it. Absent → the pre-cutover behaviour
 *                                    (root in the key door) so legacy callers keep working.
 * @returns {Promise<{ok: true, pubKey: string, deviceId?: string, custody?: string} | {ok: false, code: string, detail?: string}>}
 */
export async function restoreOwnerRoot({ mnemonic, rootKeyStore, chatVault, enrollDevice, markerVault, throwawayCircleIds = [], personas = [], withDefault = true } = {}) {
  if (typeof mnemonic !== 'string' || !mnemonic.trim()) return { ok: false, code: 'empty' };
  if (!rootKeyStore || !chatVault) return { ok: false, code: 'no-vault' };

  let root;
  try { root = Bootstrap.fromMnemonic(mnemonic.trim()); }
  catch { return { ok: false, code: 'invalid' }; }
  // THE SELVES THIS DEVICE WILL HOLD: the general persona unless the person left it off, then the picked personas. The
  // first is the PRIMARY — the self this device speaks as, whose delegation seed the key door holds and the custody
  // marker names. A device holds at least one self; leaving the general persona off needs delegation custody (a
  // root-custody device derives every persona, so there is nothing to leave off).
  const picked = (Array.isArray(personas) ? personas : []).filter((pid, i, all) => typeof pid === 'string' && /^p-[0-9a-f]{12}$/.test(pid) && all.indexOf(pid) === i);
  if (!withDefault && (!picked.length || !markerVault)) return { ok: false, code: 'no-persona' };
  const primaryId = withDefault ? DEFAULT_PROFILE : picked[0];

  try {
    // Every phrase ceremony ENROLLS (a restore is enrollment as this profile's next device); the
    // delegation seed is deterministic from (phrase, profileId, deviceId).
    // The id the device shows is its persona-keyed WIRE id; the seed derives from it, so the phrase + the record's id
    // reproduce the seed anywhere (a revocation needs nothing else). The internal id stays in the sealed blob.
    const internalId = newDeviceId();
    // the PRIMARY's wire id and device seed: what the key door holds and the marker names
    const deviceId = wireDeviceId(root.deriveAgentSeed(primaryId), internalId);
    const delegationSeed = deriveDeviceSeed(root.deriveAgentSeed(primaryId), deviceId);
    const delegationCustody = !!markerVault;

    // 1. The key door FIRST: if the later steps fail, a boot still finds a working identity.
    //    Delegation custody: the door holds the DELEGATION seed — the root is never persisted.
    //    Legacy (no markerVault): the root seed, exactly as before the cutover.
    if (!delegationCustody) await rootKeyStore.setSeed(root.secret);

    // 2. The vault-at-rest layer, sealed under whichever seed this custody boots from (the PRIMARY's delegation seed,
    //    or the root's): every self's slots land through it. The fingerprint-bound migration wipes a previous identity's
    //    leftovers either way — the fingerprint stays the ROOT's, the "same person" tag across all their devices. A
    //    chat key is a CHILD of the root (`deriveAgentSeed`), never the mnemonic's raw entropy.
    const atRestKey = delegationCustody ? deriveVaultAtRestKeyFrom(delegationSeed) : root.deriveVaultAtRestKey();
    await migrateVaultToEncrypted({ backing: chatVault, key: atRestKey, fingerprint: root.fingerprint() });
    // 2–3. THE GENERAL PERSONA'S SLOTS (its chat seed, person key and delegation blob — the bare names, as personaVault
    //      names them), only when this device holds it: a device without it has nothing of it, not even an empty slot.
    let identity = null;
    const label = typeof enrollDevice?.label === 'string' && enrollDevice.label ? enrollDevice.label : null;
    if (withDefault) ({ identity } = await handGeneralPersona({ root, chatVault, atRestKey, deviceId, delegationSeed, internalId, label }));
    // 3b. THE PICKED PERSONAS (the picker): each is handed here, the one moment the root is in hand — its chat identity,
    //     its person key, and its own delegation (its wire id of this device, its device seed, the record signed by its
    //     own authority) — into its own slots. A delegated device can never derive a persona later; what it is not
    //     handed now, it does not run. The list it holds is a device entry, read at its boots.
    const held = await handPersonasInto({ root, chatVault, atRestKey, internalId, label, personas: picked });
    // without the general persona the primary is the first picked — the one this device now speaks as
    if (!withDefault) identity = { pubKey: (await AgentIdentity.restore(personaVault(new VaultEncrypted({ backing: chatVault, key: atRestKey }), primaryId)))?.pubKey ?? null };
    if (!withDefault && !held.includes(primaryId)) return { ok: false, code: 'storage', detail: 'the primary persona was not handed' };
    // The note the NEXT boot reads: a restore happened here, finish it (the restore-finish flow asks what
    // came back and what the person wants). Plain, device-local, cleared by that flow's first step.
    if (markerVault) { try { await markerVault.set(RESTORE_PENDING_KEY, JSON.stringify({ at: new Date().toISOString() })); } catch { /* the flow can be started by hand */ } }
    // …and the other note the next boot reads: forget what the THROWAWAY self wrote here. Every device boots
    // unenrolled first — a wiped one restoring from its phrase just as much as a second device being enrolled —
    // and the content key those bytes were sealed under has just been replaced. Same vault, same lifecycle as
    // the marker above; the clear itself is `enrolForgets.js`, read by each shell at boot.
    await markForgetPending(markerVault, enrollDevice ? 'enrol' : 'restore', throwawayCircleIds);

    // 4. THE CUTOVER (delegation custody only): the door's seed becomes the delegation; the
    //    marker names it + carries the root fingerprint the sealed vaults' sentinel was bound to.
    //    A failed cutover falls back to root custody so the ceremony never strands the device.
    if (delegationCustody) {
      const ok = await cutoverToDelegation({
        rootKeyStore, markerVault, delegationSeed, deviceId, profileId: primaryId, fingerprint: root.fingerprint(),
      });
      if (!ok) {
        await rootKeyStore.setSeed(root.secret);
        return { ok: true, pubKey: identity?.pubKey ?? null, deviceId, custody: 'root' };
      }
      return { ok: true, pubKey: identity?.pubKey ?? null, deviceId, custody: 'delegation' };
    }
    return { ok: true, pubKey: identity?.pubKey ?? null, deviceId, custody: 'root' };
  } catch (err) {
    return { ok: false, code: 'storage', detail: err?.message ?? String(err) };
  }
}

/**
 * The GENERAL PERSONA's slots on this device, at a phrase ceremony: its chat identity, its person key, and the delegation
 * blob (its wire id, its device seed, the record signed by its own authority). Written only when the device holds it.
 * @returns {Promise<{identity: object}>}
 */
/**
 * Hand a persona's CIRCLE ROOT to this device, at a phrase ceremony: the root of every per-circle key the persona
 * presents (one-way from its seed — no authority), so a device without the root presents the persona's one address in
 * each circle. Epoch 0 until a re-key exists to move it.
 */
async function handCircleRoot(slots, profileSeed, epoch = 0) {
  await slots.set(CIRCLE_ROOT_VAULT_KEY, JSON.stringify({ epoch, seed: seedToString(deriveCircleRoot(profileSeed, epoch)) }));
}

async function handGeneralPersona({ root, chatVault, atRestKey, deviceId, delegationSeed, internalId, label = null }) {
  // the general persona's slots (its chat seed, person key and delegation blob), as personaVault names them
  const sealedChat = personaVault(new VaultEncrypted({ backing: chatVault, key: atRestKey }), DEFAULT_PROFILE);
  const { identity } = await loadProfile({ ownerRoot: root, profileId: DEFAULT_PROFILE, vault: sealedChat });
  // 2b. The PERSON KEY (rotating, per profile): the one moment this device has the root, so it is handed
  //     the current version's seed and keeps it sealed. Version 1 until the rotation ceremony exists; a
  //     later ceremony only ever raises it.
  //     The link key's PUBLIC half rides with it (the seed is derived here, used for nothing, and dropped): this
  //     device builds cards and answers chain pulls with the pub; only a ceremony can vouch for a rotation.
  try {
    const profileSeed = root.deriveAgentSeed(DEFAULT_PROFILE);
    await storePersonKey(sealedChat, { version: 1, seed: derivePersonKeySeed(profileSeed, 1), linkKeyPub: personKeyPubKeyB64(derivePersonLinkKeySeed(profileSeed)) });
  }
  catch (err) { console.warn(`[ceremony] the person key could not be stored — this device announces no key at joins: ${err?.message ?? err}`); }

  // 3. The delegation blob (the label carrier + the enrolled-boot signal for root-custody
  //    installs; under delegation custody the key door + marker are the boot authority).
  const blob = { seed: _b64url(delegationSeed), deviceId, internalId };
  if (label) blob.label = label;
  // The ROOT-SIGNED delegation record, pre-signed HERE (the one moment the root exists) and
  // carried in the blob — the boot's registry self-heal registers it without ever needing the
  // root again. Non-secret: a statement + a signature.
  blob.record = signDeviceDelegation(root.deriveProfileAuthority(DEFAULT_PROFILE), {
    profileId: DEFAULT_PROFILE, deviceId, pubKey: deviceDelegationPubKey(delegationSeed),
  });
  if (blob.label) blob.record = { ...blob.record, label: blob.label };
  await sealedChat.set(DEVICE_DELEGATION_VAULT_KEY, JSON.stringify(blob));
  await handCircleRoot(sealedChat, root.deriveAgentSeed(DEFAULT_PROFILE));
  return { identity };
}

/**
 * HAND PERSONAS TO THIS DEVICE — at a phrase ceremony, the one moment the root is in hand: each picked persona's chat
 * identity, person key and its OWN delegation (its wire id of this device, its device seed, the record signed by its own
 * authority) into its slots; the device's held list grows by them. Shared by the enrol/restore ceremony and the later
 * "these personas here too" step (`receivePersonas`). A persona not handed is never run on a device without the root.
 * Every call also leaves the person's recovery seal (`RECOVERY_SEAL_VAULT_KEY`) on the device.
 *
 * @param {{ root: object, chatVault: object, atRestKey: Uint8Array, internalId: string, label?: string|null, personas: string[], isTombstoned?: (pid: string, wireId: string) => Promise<boolean> }} a
 *   `isTombstoned`: whether that wire id's record on the persona's row is a tombstone — the hand then takes the next
 *   generation (a persona removed here and handed again); absent, every hand is generation 0 (a new device).
 * @returns {Promise<string[]>} the device's held list after the hand-over
 */
/**
 * A persona's WIRE ID of this device, at a generation: generation 0 is the persona's seed over the device's internal id
 * (every device that never had the persona removed); generation n is over `${internalId}/n` — what a persona handed
 * again after its removal here shows, since generation 0's record is tombstoned on its row.
 * @param {Uint8Array} profileSeed @param {string} internalId @param {number} [gen]
 */
export function personaWireAt(profileSeed, internalId, gen = 0) { return wireDeviceId(profileSeed, gen ? `${internalId}/${gen}` : internalId); }

export async function handPersonasInto({ root, chatVault, atRestKey, internalId, label = null, personas = [], isTombstoned = async () => false } = {}) {
  const sealed = new VaultEncrypted({ backing: chatVault, key: atRestKey });
  const defaultSlots = personaVault(sealed, DEFAULT_PROFILE);
  let held = [];
  try { const list = JSON.parse((await defaultSlots.get(HELD_PERSONAS_VAULT_KEY)) ?? '[]'); held = Array.isArray(list) ? list : []; } catch { held = []; }
  for (const pid of Array.isArray(personas) ? personas : []) {
    if (typeof pid !== 'string' || !/^p-[0-9a-f]{12}$/.test(pid) || held.includes(pid)) continue;
    const pSeed = root.deriveAgentSeed(pid);
    const pVault = personaVault(sealed, pid);
    await loadProfile({ ownerRoot: root, profileId: pid, vault: pVault });
    await storePersonKey(pVault, { version: 1, seed: derivePersonKeySeed(pSeed, 1), linkKeyPub: personKeyPubKeyB64(derivePersonLinkKeySeed(pSeed)) });
    // the first generation whose record on the persona's row is not tombstoned (generation 0 unless it was removed here)
    let gen = 0;
    while (gen < 64 && await isTombstoned(pid, personaWireAt(pSeed, internalId, gen))) gen += 1;
    const pWire = personaWireAt(pSeed, internalId, gen);
    const pDeviceSeed = deriveDeviceSeed(pSeed, pWire);
    let pRecord = signDeviceDelegation(root.deriveProfileAuthority(pid), { profileId: pid, deviceId: pWire, pubKey: deviceDelegationPubKey(pDeviceSeed) });
    if (label) pRecord = { ...pRecord, label };
    await pVault.set(DEVICE_DELEGATION_VAULT_KEY, JSON.stringify({ seed: _b64url(pDeviceSeed), deviceId: pWire, internalId, record: pRecord, ...(label ? { label } : {}) }));
    await handCircleRoot(pVault, pSeed);
    held.push(pid);
  }
  await defaultSlots.set(HELD_PERSONAS_VAULT_KEY, JSON.stringify(held));
  // the recovery seal, which opens the person's recovery file and registry mirror whichever personas this device holds
  await defaultSlots.set(RECOVERY_SEAL_VAULT_KEY, seedToString(root.deriveAgentSeed(RECOVERY_SEAL_LABEL)));
  return held;
}
