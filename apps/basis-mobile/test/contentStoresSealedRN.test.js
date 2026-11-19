/**
 * The phone's content stores are sealed at rest (ledger L1083 b) — the same shared ios as the web, over AsyncStorage.
 * Per store: what lands in AsyncStorage is not readable, and it opens with the key through the store's own read. The
 * phone's extension mappings are NOT here: they are read at the start of the boot, before the key exists (the guard's
 * baseline says where).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { groupKeyStrategy } from '@onderling/pod-client';
import { setShellContentSeal } from '../../basis/src/v2/localStoreSeal.js';
import { sealedPolicyHeadStore } from '../../basis/src/v2/policyUpdateLane.js';
import { sealedContactNameStore } from '../../basis/src/v2/contactsSource.js';
import { actionFrequencyIo } from '../../basis/src/v2/actionFrequency.js';
import { circleOfferingDraftIo } from '../../basis/src/v2/circleOfferingDraft.js';
import { makeMemberOverrideStoreRN, makeAvailabilityStoreRN, makeSharedWithMeStoreRN, makeUserScreenStoreRN } from '../src/core/circleStoresRN.js';
import { makeCircleRecipePendingStoreRN } from '../src/core/circleRecipePendingStorageRN.js';
import { makeCircleRulesPendingStoreRN } from '../src/core/circleRulesPendingStorageRN.js';

const MARK = 'Oma-Truus-verjaardag';
afterEach(() => setShellContentSeal(null));

function asyncStorage() {
  const m = new Map();
  return {
    getItem: async (k) => (m.has(k) ? m.get(k) : null),
    setItem: async (k, v) => { m.set(k, String(v)); },
    removeItem: async (k) => { m.delete(k); },
    getAllKeys: async () => [...m.keys()],
    multiRemove: async (ks) => { for (const k of ks) m.delete(k); },
    _m: m,
  };
}

const STORES = [
  ['cc.circlePolicyHead.*', (s) => { const h = sealedPolicyHeadStore(s); return { write: () => h.write('c1', { version: 2, statement: { text: MARK } }), read: async () => (await h.read('c1'))?.statement?.text }; }],
  ['cc.circleRecipePending.*', (s) => { const p = makeCircleRecipePendingStoreRN(s); return { write: () => p.set('c1', { name: MARK }), read: async () => (await p.get('c1'))?.name }; }],
  ['cc.circleRulesPending.*', (s) => { const p = makeCircleRulesPendingStoreRN(s); return { write: () => p.set('c1', { text: MARK }), read: async () => (await p.get('c1'))?.text }; }],
  ['cc.circleOverride.*', (s) => { const o = makeMemberOverrideStoreRN(s); return { write: () => o.update('c1', { chatOff: true }), read: async () => ((await o.get('c1'))?.chatOff ? MARK : ''), mark: 'chatOff' }; }],
  ['cc.availability', (s) => { const a = makeAvailabilityStoreRN(s); return { write: () => a.update({ holiday: { active: true, until: '2099-01-01' } }), read: async () => ((await a.get()).holiday.until === '2099-01-01' ? MARK : ''), mark: '2099-01-01' }; }],
  ['cc.sharedWithMe', (s) => { const w = makeSharedWithMeStoreRN(s); return { write: () => w.add({ sealed: { id: 'r1', text: MARK }, from: 'x', receivedAt: 1 }), read: async () => JSON.stringify(await w.list()) }; }],
  ['cc.userScreens', (s) => { const u = makeUserScreenStoreRN(s); return { write: () => u.set({ screens: [{ id: 'p1', name: MARK, blocks: [] }], activeId: 'p1' }), read: async () => (await u.get()).screens[0]?.name }; }],
  ['cc.contactNames', (s) => { const n = sealedContactNameStore(s); return { write: () => n.remember([{ contactId: 'k1', name: MARK }]), read: async () => (await n.read()).k1?.name }; }],
  ['cc.actionFrequency', (s) => { const io = actionFrequencyIo(s); return { write: () => io.save({ [MARK]: { add: 3 } }), read: async () => Object.keys((await io.load()) ?? {})[0] }; }],
  ['cc.circleSkill.*', (s) => { const io = circleOfferingDraftIo(s); return { write: () => io.save('c1', { offers: [MARK] }), read: async () => (await io.load('c1'))?.offers?.[0] }; }],
];

describe.each(STORES)('%s on the phone', (_n, make) => {
  it('what lands in AsyncStorage is not readable, and it opens with the key', async () => {
    setShellContentSeal(groupKeyStrategy({ groupKey: Buffer.from(new Uint8Array(32).fill(3)).toString('base64url') }));
    const s = asyncStorage();
    const store = make(s);
    await store.write();
    expect(s._m.size).toBeGreaterThan(0);
    expect([...s._m.values()].join('\n')).not.toContain(store.mark ?? MARK);
    expect(String(await store.read())).toContain(MARK);
  });
});
