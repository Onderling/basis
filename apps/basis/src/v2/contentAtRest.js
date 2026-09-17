/**
 * The device's CONTENT-at-rest key — the seal under a person's own words on their own disk.
 *
 * Key material was already sealed at rest (`VaultEncrypted` under `deriveVaultAtRestKey`); content was not.
 * A circle's items, the household list and the search index sat in IndexedDB, in AsyncStorage and in a file
 * in the clear, which is what made the front page's "sealed where it is stored" untrue on the one device the
 * person actually holds. Frits, 2026-09-10: *everything is encrypted at rest by default; a user may choose
 * otherwise, and that must never be the default.*
 *
 * ── Why this key is not the vault-at-rest key ───────────────────────────────────────────────────────
 * The vault key looked like the obvious answer, and it is the wrong one, for a reason that ships today: the
 * self-enroll ceremony (a root-custody device proving the phrase during a device revocation) ROTATES it,
 * root-derived → delegation-derived, and reseals every vault it knows about. Vaults are small and
 * enumerated, so rewriting them costs nothing. A person's messages and lists are neither, they are built
 * lazily per circle in the shell, and a store the ceremony never heard of would be stranded under a key the
 * next boot no longer derives.
 *
 * So content gets a key that never rotates: 32 random bytes, minted once per device, kept INSIDE the
 * already-sealed vault. The ceremony reseals that vault, the content key rides along inside it, and not one
 * item byte is rewritten. Rotation stays where rotation is cheap.
 *
 * Two consequences worth stating, because they are the trade:
 *   • **It is per DEVICE, not per person.** It is random, so it is not re-derivable from the phrase. Another
 *     of your devices cannot open this device's local store — which is right (they never share a disk) and
 *     is why it is not a restore path. Restore brings back the circles and re-syncs their content; it does
 *     not lift bytes off a lost machine.
 *   • **It is only as protected as the vault it sits in**, which is the vault-at-rest key, which is derived
 *     from the phrase and never persisted. That is the same protection the device's signing keys already
 *     have, and the honest ceiling: this closes a copied profile and a stolen disk, not a live session on an
 *     unlocked machine.
 *
 * The envelope is `groupKeyStrategy`'s — the same `fp1:` symmetric envelope the pod side already writes. No
 * new crypto, no second at-rest format to reason about.
 */
import { groupKeyStrategy } from '@onderling/pod-client';
import { seedToString } from '@onderling/vault';

/** The reserved vault entry holding this device's content key. */
export const CONTENT_AT_REST_VAULT_KEY = 'content-at-rest-key';

/** 32 random bytes, from whichever CSPRNG this platform has. Never `Math.random` — this is a key. */
function randomContentKey() {
  const out = new Uint8Array(32);
  if (typeof globalThis.crypto?.getRandomValues !== 'function') {
    throw new Error('contentAtRest: no CSPRNG available — refusing to mint a content key');
  }
  globalThis.crypto.getRandomValues(out);
  return out;
}

/**
 * Read this device's content key from the sealed vault, minting and storing it on first use.
 *
 * Idempotent: the second call returns the stored key, so every store on the device seals under one key and
 * a re-boot opens what the last boot wrote.
 *
 * @param {{get:Function, set:Function}} sealedVault  a vault ALREADY wrapped for at-rest encryption — the
 *   content key must never touch a plaintext store, which is the whole point of keeping it here.
 * @returns {Promise<string>} the key as b64url, the form `groupKeyStrategy` takes.
 */
export async function ensureContentKey(sealedVault) {
  if (!sealedVault || typeof sealedVault.get !== 'function' || typeof sealedVault.set !== 'function') {
    throw new Error('ensureContentKey: a sealed vault is required');
  }
  const existing = await sealedVault.get(CONTENT_AT_REST_VAULT_KEY).catch(() => null);
  if (typeof existing === 'string' && existing.length > 0) return existing;
  const minted = seedToString(randomContentKey());
  await sealedVault.set(CONTENT_AT_REST_VAULT_KEY, minted);
  return minted;
}

/**
 * This device's content-seal strategy — `{ seal, open }` over the local stores.
 *
 * `open` passes NON-SEALED text through unchanged (`openWithGroupKey` does this by design), which is what
 * makes the no-migration decision work: rows written before sealing stay readable instead of turning into
 * noise, and nothing has to walk a live store at boot.
 *
 * @param {{get:Function, set:Function}} sealedVault
 * @returns {Promise<{seal:(t:string)=>string, open:(t:string)=>string}>}
 */
export async function contentSealStrategy(sealedVault) {
  return groupKeyStrategy({ groupKey: await ensureContentKey(sealedVault) });
}
