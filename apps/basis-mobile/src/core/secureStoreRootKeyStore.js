/**
 * The mobile key door for the owner-root seed — expo-secure-store, i.e. the Android
 * Keystore / iOS Keychain behind the device unlock. This is the adapter the custody
 * layer (`ownerRootCustody.js`) plugs into; the shell owns it because the shell owns
 * the native dependency (invariant 1: composition + adapter, no logic).
 *
 * `WHEN_UNLOCKED_THIS_DEVICE_ONLY`: the entry never leaves this device (no cloud
 * keychain backup) — by design, since the recovery phrase re-derives the seed anywhere,
 * and a synced copy would be one more place the secret lives.
 */
import { RootKeyStore, assertSeed, seedToString, seedFromString } from '@onderling/vault';

const SEED_KEY = 'cc-owner-root-seed';

/**
 * @param {object} secureStore  the expo-secure-store module (passed in from the app
 *        bootstrap, like asyncStorage is — keeps this file importable off-device).
 */
export function makeSecureStoreRootKeyStore(secureStore) {
  if (!secureStore || typeof secureStore.getItemAsync !== 'function') {
    throw new Error('makeSecureStoreRootKeyStore: an expo-secure-store module is required');
  }
  const opts = secureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY != null
    ? { keychainAccessible: secureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
    : {};

  return new (class extends RootKeyStore {
    async getSeed() {
      const s = await secureStore.getItemAsync(SEED_KEY, opts);
      if (s == null || s === '') return null;
      const seed = seedFromString(s);
      assertSeed(seed, 'secureStoreRootKeyStore.getSeed');
      return seed;
    }
    async setSeed(seed) {
      assertSeed(seed, 'secureStoreRootKeyStore.setSeed');
      await secureStore.setItemAsync(SEED_KEY, seedToString(seed), opts);
    }
    async deleteSeed() {
      await secureStore.deleteItemAsync(SEED_KEY, opts);
    }
  })();
}
