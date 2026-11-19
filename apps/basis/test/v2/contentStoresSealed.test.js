/**
 * The person's content stores are sealed at rest (ledger L1083 b). Each of these kept a person's content as plain JSON
 * in localStorage (web) / AsyncStorage (phone). Each now goes through `sealedKeyValue` in strict mode (localStoreSeal.js):
 * sealed with the device's content key, keys legible, a write before the key refused, a read before it "not readable
 * yet", an old plain value resealed at its first read. Per store: what lands in storage is not readable, and it opens
 * with the key through the store's own read. The stores read at the first frame (the page book, the availability, the
 * contact names) WAIT for the key instead of reading as empty, and nothing seeds or overwrites in the meantime.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { groupKeyStrategy } from '@onderling/pod-client';
import { localStorageMappingsStore } from '@onderling/kring-host/mappingsStore';
import { setShellContentSeal, sealedKeyValue, sealedJsonIo } from '../../src/v2/localStoreSeal.js';
import { sealedPolicyHeadStore } from '../../src/v2/policyUpdateLane.js';
import { createCircleRecipePendingStoreLocal } from '../../src/v2/circleRecipePendingStorage.js';
import { createCircleRulesPendingStoreLocal } from '../../src/v2/circleRulesPendingStorage.js';
import { createMemberOverrideStore, localStorageOverrideIo } from '../../src/v2/circlePolicyStore.js';
import { createAvailabilityStore, localStorageAvailabilityIo } from '../../src/v2/memberAvailability.js';
import { createSharedWithMeStore, localStorageSharedWithMeIo } from '../../src/v2/sharedWithMeStore.js';
import { localUserScreenStore } from '../../src/v2/userScreens.js';
import { ensureVandaagBook } from '../../src/v2/vandaag.js';
import { sealedContactNameStore } from '../../src/v2/contactsSource.js';
import { createDisclosureShareMemo, localStorageDisclosureShareIo } from '../../src/core/handlers/personaPropsUpdate.js';
import { createActionFrequencyStore, actionFrequencyIo } from '../../src/v2/actionFrequency.js';
import { circleOfferingDraftIo } from '../../src/v2/circleOfferingDraft.js';
import { createAgentRequestStore } from '../../src/v2/agentRequest.js';

const KEY = Buffer.from(new Uint8Array(32).fill(3)).toString('base64url');
const seal = () => setShellContentSeal(groupKeyStrategy({ groupKey: KEY }));
const MARK = 'Oma-Truus-verjaardag';

/** A localStorage-shaped store (sync; listing by key(i)/length), as the web hands its stores. */
function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
    _m: m,
  };
}
const rawValues = (s) => [...s._m.values()].join('\n');
const tick = (ms = 30) => new Promise((r) => { setTimeout(r, ms); });

afterEach(() => setShellContentSeal(null));

/** [name, make(storage) → {write(), read()}] — `write` stores something carrying MARK, `read` reads it back. */
const STORES = [
  ['cc.circlePolicyHead.*', (s) => { const h = sealedPolicyHeadStore(s); return { write: () => h.write('c1', { version: 2, statement: { text: MARK } }), read: async () => (await h.read('c1'))?.statement?.text }; }],
  ['cc.circleRecipePending.*', (s) => { const p = createCircleRecipePendingStoreLocal(s); return { write: () => p.set('c1', { name: MARK }), read: async () => (await p.get('c1'))?.name }; }],
  ['cc.circleRulesPending.*', (s) => { const p = createCircleRulesPendingStoreLocal(s); return { write: () => p.set('c1', { text: MARK }), read: async () => (await p.get('c1'))?.text }; }],
  ['cc.circleOverride.*', (s) => { const o = createMemberOverrideStore(localStorageOverrideIo(s)); return { write: () => o.update('c1', { chatOff: true }), read: async () => ((await o.get('c1'))?.chatOff === true ? MARK : 'not kept'), mark: 'chatOff' }; }],
  ['cc.availability', (s) => { const a = createAvailabilityStore(localStorageAvailabilityIo(s)); return { write: () => a.update({ holiday: { active: true, until: '2099-01-01' } }), read: async () => ((await a.get()).holiday.until === '2099-01-01' ? MARK : 'not kept'), mark: '2099-01-01' }; }],
  ['cc.sharedWithMe', (s) => { const w = createSharedWithMeStore(localStorageSharedWithMeIo(s)); return { write: () => w.add({ sealed: { id: 'r1', text: MARK }, itemMeta: { title: MARK }, from: 'x', receivedAt: 1 }), read: async () => JSON.stringify(await w.list()) }; }],
  ['cc.userScreens', (s) => { const u = localUserScreenStore(s); return { write: () => u.set({ screens: [{ id: 'p1', name: MARK, blocks: [] }], activeId: 'p1' }), read: async () => (await u.get()).screens[0]?.name }; }],
  ['cc.contactNames', (s) => { const n = sealedContactNameStore(s); return { write: () => n.remember([{ contactId: 'k1', name: MARK }]), read: async () => (await n.read()).k1?.name }; }],
  ['cc.sharedDisclosure.*', (s) => { const io = localStorageDisclosureShareIo(s); return { write: () => createDisclosureShareMemo(io).set('c1', 'p1', { name: MARK }), read: async () => (await createDisclosureShareMemo(io).get('c1', 'p1'))?.name }; }],
  ['cc.actionFrequency', (s) => { const io = actionFrequencyIo(s); return { write: () => io.save({ [MARK]: { add: 3 } }), read: async () => Object.keys((await io.load()) ?? {})[0] }; }],
  ['cc.circleSkill.*', (s) => { const io = circleOfferingDraftIo(s); return { write: () => io.save('c1', { offers: [MARK] }), read: async () => (await io.load('c1'))?.offers?.[0] }; }],
  ['cc.agentRequestQueue', (s) => { const io = sealedJsonIo(s); const st = createAgentRequestStore({ io: { load: (k) => io.load(k), save: (k, v) => io.save(k, v) } }); return { write: () => st.save({ id: 'q1', circleId: 'c1', label: MARK, requestedAt: 1 }), read: async () => JSON.stringify(await st.listForCircle('c1')) }; }],
  ['onderling.mappings:*', (s) => { const m = localStorageMappingsStore(sealedKeyValue(s, { strict: true })); return { write: () => m.write('pod://x/a', { label: MARK }), read: async () => (await m.read('pod://x/a'))?.bytes?.label }; }],
];

describe.each(STORES)('%s', (_name, make) => {
  it('what lands in storage is not readable, and it opens with the key', async () => {
    seal();
    const s = memStorage();
    const store = make(s);
    await store.write();
    expect(s._m.size).toBeGreaterThan(0);
    expect(rawValues(s)).not.toContain(store.mark ?? MARK);
    expect(String(await store.read())).toContain(MARK);
  });
});

describe('stores read at the first frame wait for the key, and nothing seeds or overwrites before it', () => {
  it('the page book: a read before the key does NOT seed a fresh book over the person\'s own', async () => {
    const s = memStorage();
    seal();
    await localUserScreenStore(s).set({ screens: [{ id: 'mine', name: MARK, blocks: [] }], activeId: 'mine' });
    const before = s._m.get('cc.userScreens');
    setShellContentSeal(null);
    let done = null;
    const t = (k) => k;
    const seeding = ensureVandaagBook({ store: localUserScreenStore(s), t }).then((b) => { done = b; });
    await tick();
    expect(done).toBeNull();                            // "not read yet", never an empty book
    expect(s._m.get('cc.userScreens')).toBe(before);    // nothing written
    seal();
    await seeding;
    expect(done.screens.map((p) => p.name)).toEqual([MARK]);   // the person's own book, not a seeded one
    expect(s._m.get('cc.userScreens')).toBe(before);
  });

  it('the availability and the contact names: a read before the key waits, then gives the kept value', async () => {
    const s = memStorage();
    seal();
    await createAvailabilityStore(localStorageAvailabilityIo(s)).update({ holiday: { active: true, until: '2099-01-01' } });
    await sealedContactNameStore(s).remember([{ contactId: 'k1', name: MARK }]);
    setShellContentSeal(null);
    let avail = null; let names = null;
    const a = createAvailabilityStore(localStorageAvailabilityIo(s)).get().then((v) => { avail = v; });
    const n = sealedContactNameStore(s).read().then((v) => { names = v; });
    await tick();
    expect(avail).toBeNull();
    expect(names).toBeNull();
    seal();
    await Promise.all([a, n]);
    expect(avail.holiday.active).toBe(true);
    expect(names.k1.name).toBe(MARK);
  });

  it('a store read before the key that does not wait reads "nothing kept", and a write then is refused (nothing overwritten)', async () => {
    const s = memStorage();
    seal();
    await createSharedWithMeStore(localStorageSharedWithMeIo(s)).add({ sealed: { id: 'r1' }, from: 'x', receivedAt: 1 });
    const before = s._m.get('cc.sharedWithMe');
    setShellContentSeal(null);
    expect(await createSharedWithMeStore(localStorageSharedWithMeIo(s)).list()).toEqual([]);
    await createSharedWithMeStore(localStorageSharedWithMeIo(s)).clear().catch(() => {});
    expect(s._m.get('cc.sharedWithMe')).toBe(before);
  });

  it('an old PLAIN value is resealed once, at its first read with the key', async () => {
    const s = memStorage();
    s._m.set('cc.availability', JSON.stringify({ holiday: { active: true, until: '2099-01-01' } }));
    seal();
    expect((await createAvailabilityStore(localStorageAvailabilityIo(s)).get()).holiday.active).toBe(true);
    expect(s._m.get('cc.availability')).not.toContain('2099-01-01');
  });
});
