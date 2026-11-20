/**
 * Start this device over from your phrase (ledger L1115, Fable's ruling): the phrase first and checked, nothing cleared
 * before a correct one; then mark, wipe, restore, unmark; a crash after the mark is finished by the next boot.
 */
import { describe, it, expect } from 'vitest';
import { Bootstrap } from '@onderling/core';
import { RootKeyStoreMemory } from '@onderling/vault';
import { checkPhraseForThisDevice, startDeviceOver, finishStartOver, wipeKeyValueStorage, START_OVER_PENDING_KEY } from '../../src/v2/startOver.js';
import { markerVaultOver } from '../../src/v2/enrolForgets.js';
import { CUSTODY_MODE_KEY } from '../../src/core/agent/ownerRootCustody.js';

function asyncStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    m,
    getItem: async (k) => (m.has(k) ? m.get(k) : null),
    setItem: async (k, v) => { m.set(k, String(v)); },
    removeItem: async (k) => { m.delete(k); },
    getAllKeys: async () => [...m.keys()],
    multiRemove: async (ks) => { for (const k of ks) m.delete(k); },
  };
}
const MARK = `cc-owner-root:${START_OVER_PENDING_KEY}`;

describe('the phrase first, and checked (L1115)', () => {
  it('a phrase of another root is refused where the device\'s fingerprint can be read; a malformed one is invalid', async () => {
    const mine = Bootstrap.create(); const other = Bootstrap.create();
    const rootKeyStore = new RootKeyStoreMemory(); await rootKeyStore.setSeed(mine.bootstrap.secret);
    expect(await checkPhraseForThisDevice(mine.mnemonic, { rootKeyStore })).toMatchObject({ ok: true });
    expect(await checkPhraseForThisDevice(other.mnemonic, { rootKeyStore })).toEqual({ ok: false, code: 'other-phrase' });
    expect(await checkPhraseForThisDevice('twee woorden', { rootKeyStore })).toEqual({ ok: false, code: 'invalid' });
  });

  it('a delegation device compares with its marker\'s fingerprint; an unreadable door takes a valid phrase', async () => {
    const mine = Bootstrap.create(); const other = Bootstrap.create();
    const s = asyncStorage({ [`cc-owner-root:${CUSTODY_MODE_KEY}`]: JSON.stringify({ mode: 'delegation', deviceId: 'd1', fingerprint: mine.bootstrap.fingerprint() }) });
    const markerVault = markerVaultOver(s);
    expect(await checkPhraseForThisDevice(other.mnemonic, { markerVault })).toEqual({ ok: false, code: 'other-phrase' });
    const broken = { getSeed: async () => { throw new Error('door unreadable'); } };
    expect(await checkPhraseForThisDevice(other.mnemonic, { rootKeyStore: broken })).toMatchObject({ ok: true });
  });
});

describe('mark, wipe, restore, unmark (L1115)', () => {
  it('the wipe takes everything but the mark; the restore runs after it; the mark goes on success', async () => {
    const s = asyncStorage({ 'cc-chat-id:content-at-rest-key': 'broken', 'cc.circlePinned': 'x', 'cc-owner-root:custody-mode': 'y' });
    const markerVault = markerVaultOver(s);
    const seen = [];
    const r = await startDeviceOver({
      phrase: 'p', markerVault,
      wipe: async () => { seen.push(['wipe', [...s.m.keys()]]); await wipeKeyValueStorage(s, MARK); },
      restore: async () => { seen.push(['restore', [...s.m.keys()]]); s.m.set('cc-chat-id:agent-privkey', 'new'); return { ok: true }; },
    });
    expect(r).toEqual({ ok: true });
    expect(seen[0][1]).toContain(MARK);           // marked before the wipe
    expect(seen[1][1]).toEqual([MARK]);           // only the mark left when the restore runs
    expect([...s.m.keys()]).toEqual(['cc-chat-id:agent-privkey']);
  });

  it('a crash after the wipe: the next boot finishes it and opens the restore door; a normal boot does nothing', async () => {
    const s = asyncStorage({ 'cc-chat-id:content-at-rest-key': 'broken' });
    const markerVault = markerVaultOver(s);
    await expect(startDeviceOver({ phrase: 'p', markerVault, wipe: async () => { await wipeKeyValueStorage(s, MARK); }, restore: async () => { throw new Error('crash'); } })).rejects.toThrow();
    s.m.set('cc-half-written', 'x');   // what a half-run restore left
    expect(await finishStartOver({ markerVault, wipe: () => wipeKeyValueStorage(s, MARK) })).toEqual({ startedOver: true });
    expect([...s.m.keys()]).toEqual([]);
    expect(await finishStartOver({ markerVault, wipe: () => wipeKeyValueStorage(s, MARK) })).toEqual({ startedOver: false });
  });
});
