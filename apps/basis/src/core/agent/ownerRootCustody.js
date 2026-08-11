/**
 * Owner-root custody — how a boot obtains the ONE identity secret, and where it lives.
 *
 * The recovery phrase (herstelzin, 24 words) is the USER's artifact: shown once, held on
 * paper, never persisted by the app. What a device keeps between launches is the 32-byte
 * seed the phrase encodes, behind the platform's key door (`RootKeyStore`):
 * the OS keystore on mobile, a non-extractable-WebCrypto wrap in the browser, a plain
 * vault only where no stronger door exists.
 *
 * Boot order (`ensureOwnerRoot`):
 *   1. the key door — a stored seed is THE identity; use it.
 *   2. the legacy cleartext phrase (installs from before the custody cutover) — adopt it:
 *      seed into the key door, VERIFY it reads back, only then delete the stored phrase.
 *      The readback check matters: the phrase copy being deleted may be the only one in
 *      existence if the user never wrote theirs down, so the new home is proven first.
 *   3. neither — a fresh account: mint a root, seed the door, and the phrase exists only
 *      on the reveal screen from here on.
 */
import { Bootstrap } from '@onderling/core';
import { RootKeyStoreVault, RootKeyStoreWebCrypto } from '@onderling/vault';

/** The vault key the PRE-CUTOVER cleartext phrase lived under (migration source only). */
export const LEGACY_OWNER_PHRASE_KEY = 'owner-phrase';

const sameBytes = (a, b) => a instanceof Uint8Array && b instanceof Uint8Array
  && a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Choose the strongest key door this runtime offers.
 * @param {object} o
 * @param {import('@onderling/vault').Vault} o.fallbackVault  backs the seed where no
 *        platform door exists (Node hosts, tests, degraded browsers).
 */
export function pickRootKeyStore({ fallbackVault } = {}) {
  // The WebCrypto door only in a REAL browser (`window`), not wherever `indexedDB` happens to be
  // polyfilled: its database name is fixed, so it is one-door-per-origin — correct where one origin
  // is one user, wrong in a Node test process that boots several agents and has `fake-indexeddb`
  // installed globally (every agent would read the first one's seed and become the same person).
  if (typeof window !== 'undefined' && typeof indexedDB !== 'undefined'
    && typeof crypto !== 'undefined' && crypto.subtle) {
    try { return new RootKeyStoreWebCrypto(); } catch { /* fall through */ }
  }
  return new RootKeyStoreVault({ vault: fallbackVault });
}

/**
 * Read-or-adopt-or-create the owner root. Never overwrites an existing identity.
 *
 * @param {object} o
 * @param {import('@onderling/vault').RootKeyStore} o.rootKeyStore
 * @param {import('@onderling/vault').Vault} [o.legacyVault]  where a pre-cutover install
 *        stored the cleartext phrase; migrated away on first boot through here.
 * @returns {Promise<Bootstrap>}
 */
export async function ensureOwnerRoot({ rootKeyStore, legacyVault } = {}) {
  const seed = await rootKeyStore.getSeed();
  if (seed) return Bootstrap.fromSeed(seed);

  let phrase = null;
  try { phrase = await legacyVault?.get(LEGACY_OWNER_PHRASE_KEY); } catch { /* treat as absent */ }
  if (phrase && typeof phrase === 'string' && phrase.trim().length > 0) {
    const root = Bootstrap.fromMnemonic(phrase);
    await rootKeyStore.setSeed(root.secret);
    const readback = await rootKeyStore.getSeed();
    if (sameBytes(readback, root.secret)) {
      await legacyVault.delete(LEGACY_OWNER_PHRASE_KEY);
    }
    // A failed readback keeps the phrase in place — worse at rest, but never identity-losing;
    // the next boot retries the adoption.
    return root;
  }

  const { bootstrap } = Bootstrap.create();
  await rootKeyStore.setSeed(bootstrap.secret);
  return bootstrap;
}
