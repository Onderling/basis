/**
 * 5.9b-followup — boot-time BIP39 restore tests.
 *
 * Pure: a Map-backed AsyncStorage drives the full happy path + every
 * error branch.  No RN runtime, no real keychain — same shape the
 * shipping App.js gate will use, just stubbed.
 */
import { describe, it, expect } from 'vitest';
import {
  restoreFromMnemonic, normalizeMnemonic, countMnemonicWords,
  MNEMONIC_WORD_COUNT, CHAT_VAULT_KEY_PREFIX,
} from '../src/core/restoreFromMnemonic.js';
import { generateMnemonic, Bootstrap } from '@onderling/core';
import { VaultEncrypted } from '@onderling/vault';
import { VaultAsyncStorage } from '@onderling/react-native/identity/VaultAsyncStorage';

function makeStorage() {
  const map = new Map();
  return {
    map,
    getItem:    async (k) => (map.has(k) ? map.get(k) : null),
    setItem:    async (k, v) => { map.set(k, v); },
    removeItem: async (k) => { map.delete(k); },
    getAllKeys: async () => [...map.keys()],
  };
}

describe('normalizeMnemonic', () => {
  it('trims, lowercases, and collapses internal whitespace', () => {
    expect(normalizeMnemonic('  Linen   FIELD\n  garden  '))
      .toBe('linen field garden');
  });
  it('returns "" for non-strings + empty input', () => {
    expect(normalizeMnemonic(null)).toBe('');
    expect(normalizeMnemonic(undefined)).toBe('');
    expect(normalizeMnemonic('   ')).toBe('');
  });
});

describe('countMnemonicWords', () => {
  it('reports the live word count', () => {
    expect(countMnemonicWords('linen field garden')).toBe(3);
    expect(countMnemonicWords('linen')).toBe(1);
    expect(countMnemonicWords('')).toBe(0);
    expect(countMnemonicWords('   ')).toBe(0);
  });
});

describe('restoreFromMnemonic', () => {
  it('round-trips: generated mnemonic → seeded vault → key persisted', async () => {
    const asyncStorage = makeStorage();
    const phrase = generateMnemonic();
    expect(phrase.split(' ').length).toBe(MNEMONIC_WORD_COUNT);

    const r = await restoreFromMnemonic({ mnemonic: phrase, asyncStorage });
    expect(r.ok).toBe(true);

    // The keypair landed under cc-chat-id:agent-privkey — the same key
    // bootAgentBundle's VaultAsyncStorage will read on next boot — SEALED at rest
    // (the vault-at-rest layer): the raw value is ciphertext, never the seed envelope.
    const stored = await asyncStorage.getItem(`${CHAT_VAULT_KEY_PREFIX}agent-privkey`);
    expect(stored).toBeTruthy();
    expect(stored.startsWith('enc1:')).toBe(true);
    // …and it decrypts under the key the restored root derives — the same key the boot derives.
    const sealed = new VaultEncrypted({
      backing: new VaultAsyncStorage({ prefix: CHAT_VAULT_KEY_PREFIX, asyncStorage }),
      key: Bootstrap.fromMnemonic(phrase).deriveVaultAtRestKey(),
    });
    const parsed = JSON.parse(await sealed.get('agent-privkey'));
    expect(typeof parsed.current).toBe('string');
    expect(parsed.current.length).toBeGreaterThan(0);
  });

  it('rejects empty input → code:empty', async () => {
    const r = await restoreFromMnemonic({
      mnemonic: '   ', asyncStorage: makeStorage(),
    });
    expect(r).toEqual({ ok: false, code: 'empty' });
  });

  it('rejects wrong-length input → code:wrong-length', async () => {
    const r = await restoreFromMnemonic({
      mnemonic: 'linen field garden',          // 3 words, not 24
      asyncStorage: makeStorage(),
    });
    expect(r).toEqual({ ok: false, code: 'wrong-length' });
  });

  it('rejects bad-checksum input → code:invalid', async () => {
    // 24 valid-looking words from the BIP39 wordlist but checksum-broken.
    // We deliberately repeat "abandon" 24 times — wordlist-valid but
    // the last word's checksum bits won't match the entropy.
    const bogus = Array(24).fill('abandon').join(' ');
    const r = await restoreFromMnemonic({
      mnemonic: bogus, asyncStorage: makeStorage(),
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('invalid');
  });

  it('surfaces storage failure → code:storage', async () => {
    const broken = {
      getItem:    async () => null,
      setItem:    async () => { throw new Error('disk full'); },
      removeItem: async () => {},
      getAllKeys: async () => [],
    };
    const r = await restoreFromMnemonic({
      mnemonic: generateMnemonic(), asyncStorage: broken,
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('storage');
    expect(r.detail).toContain('disk full');
  });
});
