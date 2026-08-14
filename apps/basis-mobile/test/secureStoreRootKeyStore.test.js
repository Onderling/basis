/**
 * The device-keystore door for the owner-root seed — and the seam that matters: the
 * FIRST-RUN restore door and the BOOT must consult the SAME keystore. The 2026-07-30
 * lesson in this area was that a restore which seeds a different door than the boot
 * reads is a restore that silently does nothing; so the last test here CROSSES the
 * seam: restore with the keystore, boot with the keystore, same person.
 */
import { describe, it, expect } from 'vitest';
import { makeSecureStoreRootKeyStore } from '../src/core/secureStoreRootKeyStore.js';
import { restoreFromMnemonic } from '../src/core/restoreFromMnemonic.js';
import { bootAgentBundle } from '../src/core/agentBundle.js';

/** expo-secure-store's async trio over a Map — what the OS keystore looks like to us. */
function fakeSecureStore(store = new Map()) {
  return {
    store,
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked-this-device-only',
    optionsSeen: [],
    async getItemAsync(k, o) { this.optionsSeen.push(o); return this.store.get(k) ?? null; },
    async setItemAsync(k, v, o) { this.optionsSeen.push(o); this.store.set(k, v); },
    async deleteItemAsync(k, o) { this.optionsSeen.push(o); this.store.delete(k); },
  };
}

function fakeAsyncStorage(store = new Map()) {
  return {
    store,
    getItem: async (k) => (store.has(k) ? store.get(k) : null),
    setItem: async (k, v) => { store.set(k, v); },
    removeItem: async (k) => { store.delete(k); },
    getAllKeys: async () => [...store.keys()],
  };
}

describe('makeSecureStoreRootKeyStore', () => {
  it('round-trips a seed and passes the device-only accessibility option', async () => {
    const ss = fakeSecureStore();
    const door = makeSecureStoreRootKeyStore(ss);
    const seed = new Uint8Array(32).map((_, i) => i);
    await door.setSeed(seed);
    expect(await door.getSeed()).toEqual(seed);
    expect(ss.optionsSeen.every((o) => o?.keychainAccessible === ss.WHEN_UNLOCKED_THIS_DEVICE_ONLY)).toBe(true);
    await door.deleteSeed();
    expect(await door.getSeed()).toBe(null);
  });

  it('what sits in the keystore is an encoding, never the 24 words', async () => {
    const ss = fakeSecureStore();
    await makeSecureStoreRootKeyStore(ss).setSeed(new Uint8Array(32).fill(3));
    const stored = [...ss.store.values()][0];
    expect(typeof stored).toBe('string');
    expect(stored).not.toContain(' ');
  });
});

describe('the restore door and the boot door are the SAME keystore', () => {
  const BOOT_TIMEOUT = 60000;

  it('restore seeds the keystore (not AsyncStorage); the next boot reads it back as the same person',
    { timeout: BOOT_TIMEOUT }, async () => {
      // An "old phone": boot once to mint an identity, reveal its phrase.
      const oldPhone = fakeAsyncStorage();
      const b1 = await bootAgentBundle({ asyncStorage: oldPhone });
      const before = b1.agent.sa.agent.identity.pubKey;
      const { mnemonic } = await b1.callSkill('household', 'revealOwnerPhrase', {});

      // The reinstall on a device WITH a keystore: first-run restore, then the boot.
      const newPhone = fakeAsyncStorage();
      const keystore = fakeSecureStore();
      const r = await restoreFromMnemonic({ mnemonic, asyncStorage: newPhone, secureStore: keystore });
      expect(r).toEqual({ ok: true });
      // ONE seed behind the door — since the custody cutover that is the DELEGATION seed (the
      // restore ceremony enrolled this install; the root is never persisted anywhere).
      expect(keystore.store.size).toBe(1);
      // The owner-root vault carries only the NON-SECRET custody marker (mode + deviceId +
      // fingerprint tag) — never a seed or a phrase.
      const rootKeys = [...newPhone.store.keys()].filter((k) => k.startsWith('cc-owner-root:'));
      expect(rootKeys).toEqual(['cc-owner-root:custody-mode']);

      const b2 = await bootAgentBundle({ asyncStorage: newPhone, secureStore: keystore });
      expect(b2.agent.sa.agent.identity.pubKey).toBe(before);                // …and the boot found it there
    });
});
