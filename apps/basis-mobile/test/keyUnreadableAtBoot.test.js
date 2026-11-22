/**
 * A key that cannot be read at a start stops the boot, writes nothing, and reaches the launcher as words with
 * "try again" (ledger L1115; the review of its first fix, section 1).
 *
 * Through the REAL boot the phone runs: `bootAgentBundle` (which wraps every boot error as AGENT_WIRING_FAILED, the
 * typed one in `cause`) over AsyncStorage vaults sealed by `VaultEncrypted`. A first boot writes the keys; a second
 * boot has ONE storage read fail (the content key, the host key, the custody marker) and must reject without a
 * single write; the launcher's decision (`bootFailureNotice`) reads the words and "try again" through the wrap; a
 * third boot, with nothing failing, comes up with the same keys.
 */
import { describe, it, expect } from 'vitest';
import { bootAgentBundle } from '../src/core/agentBundle.js';
import { bootFailureNotice } from '../../basis/src/v2/bootFailure.js';
import { isKeyUnreadable } from '../../basis/src/core/agent/keyUnreadable.js';

const REAL_BOOT = { timeout: 60_000 };

/** AsyncStorage over one Map that outlives "launches"; `failOnce(match)` makes the next matching read throw. */
function storage() {
  const store = new Map();
  let fail = null;
  let writes = 0;
  return {
    store,
    failOnce(match) { fail = match; },
    writes: () => writes,
    async getItem(k) {
      if (fail && fail(k)) { fail = null; throw new Error(`storage read failed: ${k}`); }
      return store.has(k) ? store.get(k) : null;
    },
    async setItem(k, v) { writes += 1; store.set(k, String(v)); },
    async removeItem(k) { writes += 1; store.delete(k); },
    async multiRemove(ks) { writes += 1; for (const k of ks) store.delete(k); },
    async getAllKeys() { return [...store.keys()]; },
  };
}

async function bootOnce(as) {
  const b = await bootAgentBundle({ asyncStorage: as });
  const ids = { host: b.agent?.hostPubKey ?? null, chat: b.agent?.pubKey ?? b.agent?.identity?.chat?.pubKey ?? null };
  await b.dispose?.();
  return ids;
}

// [what, which read fails, whether the first boot stores it] — a root-custody device holds no custody marker (absent
// means root mode), but every boot READS it, and a read that fails must not be taken for "absent"
const CASES = [
  ['the content key', (k) => k.startsWith('cc-chat-id:') && k.includes('content-at-rest-key'), true],
  ['the host key', (k) => k.startsWith('cc-host-id:') && k.includes('agent-privkey'), true],
  ['the custody marker', (k) => k.startsWith('cc-owner-root:') && k.includes('custody-mode'), false],
];

describe('a key that cannot be read at a start (L1115)', () => {
  for (const [what, match, stored] of CASES) {
    it(`${what}: the boot stops, nothing is written, the launcher gets the words and "try again"; the next start is the same device`, REAL_BOOT, async () => {
      const as = storage();
      const first = await bootOnce(as);
      if (stored) expect([...as.store.keys()].some(match), `the first boot wrote ${what}`).toBe(true);
      const before = new Map(as.store);
      const writesBefore = as.writes();

      as.failOnce(match);
      const err = await bootAgentBundle({ asyncStorage: as }).then((b) => { b.dispose?.(); return null; }, (e) => e);
      expect(err, 'the boot must not come up over an unreadable key').toBeTruthy();
      expect(err.code).toBe('AGENT_WIRING_FAILED');   // the phone's wrap, unchanged
      expect(isKeyUnreadable(err)).toBe(true);
      expect(bootFailureNotice(err)).toMatchObject({ key: 'circle.boot_content_unreadable', retry: true, startOver: true });
      expect(as.writes(), 'nothing written by the failed boot').toBe(writesBefore);
      expect(new Map(as.store)).toEqual(before);

      const again = await bootOnce(as);
      expect(again).toEqual(first);
      // the same device: every key entry the first boot wrote is the one the next boot runs on
      const keys = [...before.keys()].filter((k) => /agent-privkey|content-at-rest-key/.test(k));
      expect(keys.length).toBeGreaterThanOrEqual(2);
      for (const k of keys) expect(as.store.get(k), k).toBe(before.get(k));
    });
  }
});

describe('the way out: start this device over from its phrase (L1115)', () => {
  it('a content key that never reads: the start-over with this device\'s own phrase brings it back as the same person', REAL_BOOT, async () => {
    const { RootKeyStoreVault, ROOT_SEED_VAULT_KEY } = await import('@onderling/vault');
    const { VaultAsyncStorage } = await import('@onderling/react-native/identity/VaultAsyncStorage');
    const { Bootstrap } = await import('@onderling/core');
    const { checkPhraseForThisDevice, startDeviceOver, wipeKeyValueStorage, START_OVER_PENDING_KEY } = await import('../../basis/src/v2/startOver.js');
    const { markerVaultOver } = await import('../../basis/src/v2/enrolForgets.js');
    const { restoreFromMnemonic } = await import('../src/core/restoreFromMnemonic.js');
    const as = storage();
    const first = await bootOnce(as);
    // this device's own phrase, from its key door (a root-custody first boot)
    const ownerRootVault = new VaultAsyncStorage({ prefix: 'cc-owner-root:', asyncStorage: as });
    const rootKeyStore = new RootKeyStoreVault({ vault: ownerRootVault });
    expect(await ownerRootVault.get(ROOT_SEED_VAULT_KEY)).toBeTruthy();
    const phrase = Bootstrap.fromSeed(await rootKeyStore.getSeed()).toMnemonic();
    // the content key's entry is damaged for good: every start stops
    const ck = [...as.store.keys()].find((k) => k.startsWith('cc-chat-id:') && k.includes('content-at-rest-key'));
    as.store.set(ck, `${as.store.get(ck).slice(0, -8)}AAAAAAAA`);
    const err = await bootAgentBundle({ asyncStorage: as }).then((b) => { b.dispose?.(); return null; }, (e) => e);
    expect(bootFailureNotice(err)).toMatchObject({ retry: true, startOver: true });
    // another phrase is refused before anything is cleared
    const before = new Map(as.store);
    expect(await checkPhraseForThisDevice(Bootstrap.create().mnemonic, { rootKeyStore, markerVault: markerVaultOver(as) })).toEqual({ ok: false, code: 'other-phrase' });
    expect(new Map(as.store)).toEqual(before);
    // its own phrase: checked, then the shared order
    const checked = await checkPhraseForThisDevice(phrase, { rootKeyStore, markerVault: markerVaultOver(as) });
    expect(checked.ok).toBe(true);
    const r = await startDeviceOver({
      phrase: checked.phrase, markerVault: markerVaultOver(as),
      wipe: () => wipeKeyValueStorage(as, `cc-owner-root:${START_OVER_PENDING_KEY}`),
      restore: (p) => restoreFromMnemonic({ mnemonic: p, asyncStorage: as }),
    });
    expect(r).toEqual({ ok: true });
    expect(as.store.has(`cc-owner-root:${START_OVER_PENDING_KEY}`)).toBe(false);
    const after = await bootOnce(as);
    expect(first.chat, 'the bundle names its chat identity').toBeTruthy();
    expect(after.chat, 'the same person: the chat identity derives from the same root').toBe(first.chat);
  });
});
