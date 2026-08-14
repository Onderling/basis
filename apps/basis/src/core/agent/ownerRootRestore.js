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

import { Bootstrap, deriveDeviceSeed, deriveVaultAtRestKeyFrom, signDeviceDelegation, deviceDelegationPubKey } from '@onderling/core';
import { VaultEncrypted, migrateVaultToEncrypted } from '@onderling/vault';
import { loadProfile } from '@onderling/agent-registry';
import { cutoverToDelegation } from './ownerRootCustody.js';

/** The profile the chat identity is derived from. */
export const DEFAULT_PROFILE = 'default';

/**
 * The sealed-vault key holding an enrolled device's delegation: `{ seed, deviceId, label? }` with
 * `seed` base64url. Its PRESENCE is what makes a boot an ENROLLED boot: per-circle keys derive
 * from this seed instead of the profile seed, so this device presents its own address in every
 * circle (the add-a-device model). Written only here, through the vault-at-rest layer.
 */
export const DEVICE_DELEGATION_VAULT_KEY = 'device-delegation-seed';

const _b64url = (bytes) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  // btoa is absent on some RN runtimes; Buffer is absent on the web — take whichever exists.
  const b64 = typeof btoa === 'function' ? btoa(s) : Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** A fresh enrollment id — crypto.randomUUID where available, a random hex fallback elsewhere. */
const _newDeviceId = () => {
  try { if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID(); } catch { /* fall through */ }
  const bytes = new Uint8Array(16);
  try { crypto.getRandomValues(bytes); } catch { for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256); }
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
};

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
export async function restoreOwnerRoot({ mnemonic, rootKeyStore, chatVault, enrollDevice, markerVault } = {}) {
  if (typeof mnemonic !== 'string' || !mnemonic.trim()) return { ok: false, code: 'empty' };
  if (!rootKeyStore || !chatVault) return { ok: false, code: 'no-vault' };

  let root;
  try { root = Bootstrap.fromMnemonic(mnemonic.trim()); }
  catch { return { ok: false, code: 'invalid' }; }

  try {
    // Every phrase ceremony ENROLLS (a restore is enrollment as this profile's next device); the
    // delegation seed is deterministic from (phrase, profileId, deviceId).
    const deviceId = _newDeviceId();
    const delegationSeed = deriveDeviceSeed(root.deriveAgentSeed(DEFAULT_PROFILE), deviceId);
    const delegationCustody = !!markerVault;

    // 1. The key door FIRST: if the later steps fail, a boot still finds a working identity.
    //    Delegation custody: the door holds the DELEGATION seed — the root is never persisted.
    //    Legacy (no markerVault): the root seed, exactly as before the cutover.
    if (!delegationCustody) await rootKeyStore.setSeed(root.secret);

    // 2. The default profile, derived — never from the mnemonic's raw entropy: the chat key is a
    //    CHILD of the root (`deriveAgentSeed`). It lands through the vault-at-rest layer, sealed
    //    under whichever seed this custody boots from (the fingerprint-bound migration wipes a
    //    previous identity's leftovers either way — the fingerprint stays the ROOT's, the "same
    //    person" tag across all their devices).
    const atRestKey = delegationCustody ? deriveVaultAtRestKeyFrom(delegationSeed) : root.deriveVaultAtRestKey();
    await migrateVaultToEncrypted({ backing: chatVault, key: atRestKey, fingerprint: root.fingerprint() });
    const sealedChat = new VaultEncrypted({ backing: chatVault, key: atRestKey });
    const { identity } = await loadProfile({ ownerRoot: root, profileId: DEFAULT_PROFILE, vault: sealedChat });

    // 3. The delegation blob (the label carrier + the enrolled-boot signal for root-custody
    //    installs; under delegation custody the key door + marker are the boot authority).
    const blob = { seed: _b64url(delegationSeed), deviceId };
    if (typeof enrollDevice?.label === 'string' && enrollDevice.label) blob.label = enrollDevice.label;
    // The ROOT-SIGNED delegation record, pre-signed HERE (the one moment the root exists) and
    // carried in the blob — the boot's registry self-heal registers it without ever needing the
    // root again. Non-secret: a statement + a signature.
    blob.record = signDeviceDelegation(root.secret, {
      profileId: DEFAULT_PROFILE, deviceId, pubKey: deviceDelegationPubKey(delegationSeed),
    });
    if (blob.label) blob.record = { ...blob.record, label: blob.label };
    await sealedChat.set(DEVICE_DELEGATION_VAULT_KEY, JSON.stringify(blob));

    // 4. THE CUTOVER (delegation custody only): the door's seed becomes the delegation; the
    //    marker names it + carries the root fingerprint the sealed vaults' sentinel was bound to.
    //    A failed cutover falls back to root custody so the ceremony never strands the device.
    if (delegationCustody) {
      const ok = await cutoverToDelegation({
        rootKeyStore, markerVault, delegationSeed, deviceId, fingerprint: root.fingerprint(),
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
