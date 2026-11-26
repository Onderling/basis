/**
 * Start this device over from your phrase (ledger L1115, Fable's ruling and review): the phrase first and checked,
 * nothing cleared before a correct one IN THIS RUN; then mark, clear, mark "cleared", restore, unmark; a mark found at a
 * boot clears nothing by itself; the web clear takes only what is Basis's; a blocked delete is a failure.
 */
import { describe, it, expect } from 'vitest';
import { Bootstrap } from '@onderling/core';
import { RootKeyStoreMemory } from '@onderling/vault';
import {
  checkPhraseForThisDevice, startDeviceOver, readStartOverMark, cancelStartOver, cancelStartOverAsks, wipeKeyValueStorage, deleteDatabases,
  START_OVER_PENDING_KEY,
} from '../../src/v2/startOver.js';
import { isBasisStorageKey, isBasisDatabase } from '../../src/v2/basisStorageNames.js';
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
const MARK = `basis.owner-root:${START_OVER_PENDING_KEY}`;
const CUSTODY = `basis.owner-root:${CUSTODY_MODE_KEY}`;
const delegationMarker = (extra = {}) => JSON.stringify({ mode: 'delegation', deviceId: 'd1', profileId: 'p1', ...extra });

describe('the phrase first, and checked (L1115)', () => {
  it('a root-mode device: another root is refused, its own taken as known; a malformed phrase is invalid', async () => {
    const mine = Bootstrap.create(); const other = Bootstrap.create();
    const rootKeyStore = new RootKeyStoreMemory(); await rootKeyStore.setSeed(mine.bootstrap.secret);
    expect(await checkPhraseForThisDevice(mine.mnemonic, { rootKeyStore })).toMatchObject({ ok: true, known: true });
    expect(await checkPhraseForThisDevice(other.mnemonic, { rootKeyStore })).toEqual({ ok: false, code: 'other-phrase' });
    expect(await checkPhraseForThisDevice('twee woorden', { rootKeyStore })).toEqual({ ok: false, code: 'invalid' });
  });

  it('a delegation device with a READABLE door: its own phrase is taken (the door holds the delegation seed, not the root)', async () => {
    const mine = Bootstrap.create(); const delegation = Bootstrap.create();
    const rootKeyStore = new RootKeyStoreMemory(); await rootKeyStore.setSeed(delegation.bootstrap.secret);
    // a delegation marker WITHOUT a fingerprint (realAgent writes `fingerprint ?? undefined`)
    const markerVault = markerVaultOver(asyncStorage({ [CUSTODY]: delegationMarker() }));
    expect(await checkPhraseForThisDevice(mine.mnemonic, { rootKeyStore, markerVault })).toMatchObject({ ok: true, known: false });
  });

  it('a delegation marker that names the root compares with it', async () => {
    const mine = Bootstrap.create(); const other = Bootstrap.create();
    const markerVault = markerVaultOver(asyncStorage({ [CUSTODY]: delegationMarker({ fingerprint: mine.bootstrap.fingerprint() }) }));
    expect(await checkPhraseForThisDevice(other.mnemonic, { markerVault })).toEqual({ ok: false, code: 'other-phrase' });
    expect(await checkPhraseForThisDevice(mine.mnemonic, { markerVault })).toMatchObject({ ok: true, known: true });
  });

  it('an unreadable marker or door: any valid phrase, and it says it could not check (known: false)', async () => {
    const other = Bootstrap.create();
    const brokenVault = { get: async () => { throw new Error('marker unreadable'); } };
    const mine = Bootstrap.create();
    const rootKeyStore = new RootKeyStoreMemory(); await rootKeyStore.setSeed(mine.bootstrap.secret);
    expect(await checkPhraseForThisDevice(other.mnemonic, { rootKeyStore, markerVault: brokenVault })).toMatchObject({ ok: true, known: false });
    const brokenDoor = { getSeed: async () => { throw new Error('door unreadable'); } };
    expect(await checkPhraseForThisDevice(other.mnemonic, { rootKeyStore: brokenDoor })).toMatchObject({ ok: true, known: false });
  });

  it('a resumed start-over checks against the mark\'s fingerprint (the device\'s own is gone with the clear)', async () => {
    const mine = Bootstrap.create(); const other = Bootstrap.create();
    const markFingerprint = mine.bootstrap.fingerprint();
    expect(await checkPhraseForThisDevice(other.mnemonic, { markFingerprint })).toEqual({ ok: false, code: 'other-phrase' });
    expect(await checkPhraseForThisDevice(mine.mnemonic, { markFingerprint })).toMatchObject({ ok: true, known: true });
  });
});

describe('mark, clear, restore, unmark (L1115)', () => {
  it('the clear takes everything but the mark; the restore runs after it; the mark goes on success', async () => {
    const s = asyncStorage({ 'basis.chat-id:content-at-rest-key': 'broken', 'basis.circlePinned': 'x', [CUSTODY]: 'y' });
    const markerVault = markerVaultOver(s);
    const seen = [];
    const r = await startDeviceOver({
      phrase: 'p', fingerprint: 'fp', markerVault,
      wipe: async () => { seen.push(['wipe', [...s.m.keys()]]); await wipeKeyValueStorage(s, MARK); },
      restore: async () => { seen.push(['restore', [...s.m.keys()], s.m.get(MARK)]); s.m.set('basis.chat-id:agent-privkey', 'new'); return { ok: true }; },
    });
    expect(r).toEqual({ ok: true });
    expect(seen[0][1]).toContain(MARK);                 // marked before the clear
    expect(seen[1][1]).toEqual([MARK]);                 // only the mark left when the restore runs
    expect(JSON.parse(seen[1][2])).toMatchObject({ stage: 'cleared', fingerprint: 'fp' });
    expect(JSON.stringify([...s.m.values()])).not.toContain('p ');   // the phrase is never written
    expect([...s.m.keys()]).toEqual(['basis.chat-id:agent-privkey']);
  });

  it('a mark found at boot clears NOTHING by itself; cancel removes the mark and clears nothing more', async () => {
    const s = asyncStorage({ 'basis.chat-id:content-at-rest-key': 'broken', [MARK]: JSON.stringify({ stage: 'marked', fingerprint: 'fp' }) });
    const markerVault = markerVaultOver(s);
    expect(await readStartOverMark(markerVault)).toEqual({ stage: 'marked', fingerprint: 'fp' });
    expect(s.m.has('basis.chat-id:content-at-rest-key')).toBe(true);
    await cancelStartOver(markerVault);
    expect([...s.m.keys()]).toEqual(['basis.chat-id:content-at-rest-key']);
    expect(await readStartOverMark(markerVault)).toBe(null);
  });

  it('a mark another script wrote (no stage) reads as the worst case, "cleared": the shell warns before a cancel', async () => {
    const markerVault = markerVaultOver(asyncStorage({ [MARK]: '1' }));
    expect(await readStartOverMark(markerVault)).toEqual({ stage: 'cleared', fingerprint: null });
  });

  it('killed after each step: the mark says how far it got, and the next run finishes with the phrase', async () => {
    const steps = ['mark', 'wipe', 'restore'];
    for (const killAt of steps) {
      const s = asyncStorage({ 'basis.chat-id:content-at-rest-key': 'broken' });
      const markerVault = markerVaultOver(s);
      const kill = (at) => { if (at === killAt) throw new Error(`killed at ${at}`); };
      const run = startDeviceOver({
        phrase: 'p', fingerprint: 'fp', markerVault: { ...markerVault, set: async (k, v) => { await markerVault.set(k, v); if (JSON.parse(v).stage === 'marked') kill('mark'); } },
        wipe: async () => { await wipeKeyValueStorage(s, MARK); kill('wipe'); },
        restore: async () => { kill('restore'); return { ok: true }; },
      });
      if (killAt === 'wipe' || killAt === 'mark') expect(await run).toEqual({ ok: false, code: 'storage' });
      else await expect(run).rejects.toThrow(`killed at ${killAt}`);
      const mark = await readStartOverMark(markerVault);
      expect(mark).toMatchObject({ fingerprint: 'fp', stage: killAt === 'restore' ? 'cleared' : 'marked' });
      // the next run: the phrase again, the same order, the mark gone at the end
      const again = await startDeviceOver({ phrase: 'p', fingerprint: mark.fingerprint, markerVault, wipe: () => wipeKeyValueStorage(s, MARK), restore: async () => ({ ok: true }) });
      expect(again).toEqual({ ok: true });
      expect(await readStartOverMark(markerVault)).toBe(null);
    }
  });

  it('a delegation device killed after the key-value clear: the mark still says "marked", and cancel ASKS first', async () => {
    // the custody marker went with the key-value clear, the key door still holds the delegation seed: a cancel with no
    // word would let the next boot read that seed as a root. So any mark makes cancel ask.
    const s = asyncStorage({ [CUSTODY]: delegationMarker({ fingerprint: 'fp' }), 'basis.chat-id:content-at-rest-key': 'broken' });
    const markerVault = markerVaultOver(s);
    const run = startDeviceOver({ phrase: 'p', fingerprint: 'fp', markerVault, wipe: async () => { await wipeKeyValueStorage(s, MARK); throw new Error('killed inside the wipe'); }, restore: async () => ({ ok: true }) });
    expect(await run).toEqual({ ok: false, code: 'storage' });
    expect(s.m.has(CUSTODY)).toBe(false);
    const mark = await readStartOverMark(markerVault);
    expect(mark.stage).toBe('marked');
    expect(cancelStartOverAsks(mark)).toBe('may-be-cleared');
    expect(cancelStartOverAsks({ stage: 'cleared', fingerprint: null })).toBe('may-be-cleared');
    expect(cancelStartOverAsks(null)).toBe(null);
  });

  it('the first mark write fails: nothing cleared, a code, no throw', async () => {
    const s = asyncStorage({ 'basis.chat-id:x': 'y' });
    const markerVault = { ...markerVaultOver(s), set: async () => { throw new Error('quota'); } };
    let wiped = false;
    const r = await startDeviceOver({ phrase: 'p', markerVault, wipe: async () => { wiped = true; }, restore: async () => ({ ok: true }) });
    expect(r).toEqual({ ok: false, code: 'storage' });
    expect(wiped).toBe(false);
  });

  it('a shell that cannot clear all of it says so BEFORE the mark: nothing is touched', async () => {
    const s = asyncStorage({ 'basis.chat-id:x': 'y' });
    const markerVault = markerVaultOver(s);
    let wiped = false;
    const r = await startDeviceOver({ phrase: 'p', markerVault, canClear: async () => ({ ok: false, code: 'cannot-list' }), wipe: async () => { wiped = true; }, restore: async () => ({ ok: true }) });
    expect(r).toEqual({ ok: false, code: 'cannot-list' });
    expect(wiped).toBe(false);
    expect(await readStartOverMark(markerVault)).toBe(null);
  });

  it('a restore that fails keeps the mark at "cleared": the device does not come up as a fresh identity unasked', async () => {
    const s = asyncStorage({});
    const markerVault = markerVaultOver(s);
    const r = await startDeviceOver({ phrase: 'p', fingerprint: 'fp', markerVault, wipe: () => wipeKeyValueStorage(s, MARK), restore: async () => ({ ok: false, code: 'storage' }) });
    expect(r).toEqual({ ok: false, code: 'storage' });
    expect(await readStartOverMark(markerVault)).toEqual({ stage: 'cleared', fingerprint: 'fp' });
  });
});

describe('the web clear: only what is Basis\'s, and a blocked delete is a failure (L1115)', () => {
  it('a key of the public site and a screen page\'s pairing stay; Basis\'s keys go', async () => {
    const s = asyncStorage({
      'basis.chat-id:content-at-rest-key': 'x', 'basis.lastTab': 'x', 'basis.theme': 'x', 'basis.app.lang': 'x',
      'site-cookie-consent': 'yes', 'onderling-screen:grant': 'g', [MARK]: 'm',
    });
    await wipeKeyValueStorage(s, MARK, { isOurs: isBasisStorageKey });
    expect([...s.m.keys()].sort()).toEqual([MARK, 'onderling-screen:grant', 'site-cookie-consent'].sort());
  });

  it('databases by name: Basis\'s, not the site\'s', () => {
    expect(['basis.pinboard', 'basis.circle-pod-abc', 'basis.root-key', 'basis.chat-id:'].every(isBasisDatabase)).toBe(true);
    // a name of the builds before the one prefix is not Basis's any more: the fresh start leaves it as dead bytes
    expect(['cc-pinboard-state', 'onderling-root-key', 'basis'].some(isBasisDatabase)).toBe(false);
    expect(isBasisDatabase('site-analytics')).toBe(false);
  });

  it('a delete another tab blocks is a failure with its own code, not a success', async () => {
    const idb = { deleteDatabase: () => { const req = {}; queueMicrotask(() => req.onblocked?.()); return req; } };
    await expect(deleteDatabases(idb, ['cc-x'])).rejects.toMatchObject({ code: 'blocked' });
    const s = asyncStorage({});
    const r = await startDeviceOver({ phrase: 'p', markerVault: markerVaultOver(s), wipe: () => deleteDatabases(idb, ['cc-x']), restore: async () => ({ ok: true }) });
    expect(r).toEqual({ ok: false, code: 'blocked' });
    expect(await readStartOverMark(markerVaultOver(s))).toMatchObject({ stage: 'marked' });
  });

  it('a delete that succeeds resolves', async () => {
    const gone = [];
    const idb = { deleteDatabase: (n) => { const req = {}; queueMicrotask(() => { gone.push(n); req.onsuccess?.(); }); return req; } };
    await deleteDatabases(idb, ['cc-a', 'cc-b']);
    expect(gone).toEqual(['cc-a', 'cc-b']);
  });
});
