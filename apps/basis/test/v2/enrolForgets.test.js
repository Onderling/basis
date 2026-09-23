/**
 * WHAT A FRESHLY ENROLLED DEVICE FORGETS.
 *
 * Every device boots unenrolled first: it has an identity of its own and writes content under it — a registry
 * record, a member map with itself in it, settings, held messages, and the device log, the record every lane
 * rides. The add-a-device ceremony then replaces that identity and its content key, and the old content becomes
 * bytes nobody on this device can open. The box has cleared them since 2026-09-14; web and mobile never did,
 * so a second device logs ten "stored here but not openable" warnings on its first boot and keeps them for ever.
 *
 * The delete is five lines. The LIST is the work — the shells had none, which is why this was never built — so
 * that is what these tests pin: the classification is total, the order is safe, and a failure keeps everything.
 */
import { describe, it, expect, vi } from 'vitest';
import { THROWAWAY_CONTENT, forgetThrowawaySelf } from '../../src/v2/enrolForgets.js';

/** a shell's storage, faked: named stores (an IndexedDB database / an AsyncStorage scope / a directory) + flat keys */
function fakeShell({ stores = [], keys = [], circleIds = [], failListing = false } = {}) {
  const live = { stores: new Set(stores), keys: new Set(keys) };
  return {
    live,
    dropped: { stores: [], keys: [] },
    listCircleIds: vi.fn(async () => { if (failListing) throw new Error('registry unreadable'); return circleIds; }),
    listKeys: vi.fn(async () => [...live.keys]),
    dropStore: vi.fn(async function (name) { live.stores.delete(name); this.dropped.stores.push(name); }),
    dropKey: vi.fn(async function (key) { live.keys.delete(key); this.dropped.keys.push(key); }),
  };
}
const shellOf = (o) => { const s = fakeShell(o); return { ...s, dropStore: (n) => { s.live.stores.delete(n); s.dropped.stores.push(n); }, dropKey: (k) => { s.live.keys.delete(k); s.dropped.keys.push(k); } }; };

describe('the classification is TOTAL — a store is content or it is kept, never unsaid', () => {
  it('names both sides, and no name sits on both', () => {
    const content = new Set([...THROWAWAY_CONTENT.stores, ...THROWAWAY_CONTENT.keys]);
    const kept = new Set(THROWAWAY_CONTENT.keep);
    expect(content.size, 'the content list is not empty').toBeGreaterThan(0);
    expect(kept.size, 'the keep list is not empty either — an unlisted survivor is how this goes wrong').toBeGreaterThan(0);
    const both = [...content].filter((n) => kept.has(n));
    expect(both, 'no name is on both sides').toEqual([]);
  });

  it('keeps the offer stash and the vault — the ceremony just wrote them', () => {
    // The box says it out loud: "the vaults the ceremony wrote and the offer stash stay." A device that forgets
    // the stash comes back enrolled and in no circle; one that forgets the vault is not enrolled at all.
    expect(THROWAWAY_CONTENT.keep).toContain('onderling.enrollOffer');
    expect(THROWAWAY_CONTENT.keep.some((k) => /vault/i.test(k)), 'the vault is named as a survivor').toBe(true);
  });

  it('clears the flags that gate the help circle TOGETHER — one without the other is an empty Uitleg', () => {
    // `helpCircleProvisioned` says the circle exists; `onboardingDone` says the bot already spoke in it. Clear
    // the first and keep the second and the enrolled person gets a fresh help circle that never says anything.
    expect(THROWAWAY_CONTENT.keys).toContain('cc.helpCircleProvisioned');
    expect(THROWAWAY_CONTENT.keys).toContain('cc.onboardingDone');
  });

  it('names the help circle\'s own stores, because the registry may not list them', () => {
    // `HELP_CIRCLE_ID` is the literal `cc-help`, so the throwaway self and the enrolled person share the store
    // NAME — the one database where two identities' sealed rows sit together. A throwaway self that never
    // provisioned it is not in the registry, so the registry-driven route would skip exactly that one.
    expect(THROWAWAY_CONTENT.stores).toContain('cc-circle-cc-help');
    expect(THROWAWAY_CONTENT.stores).toContain('cc-circle-cache-cc-help');
  });
});

describe('forgetThrowawaySelf — the order is the safety', () => {
  it('reads the circle ids BEFORE dropping the registry, and clears their stores too', async () => {
    const s = shellOf({ stores: ['cc-agent-registry', 'cc-circle-abc', 'cc-circle-cache-abc'], circleIds: ['abc'] });
    const r = await forgetThrowawaySelf(s);
    expect(r.ok).toBe(true);
    expect(s.listCircleIds).toHaveBeenCalled();
    expect(s.dropped.stores, 'the per-circle stores went with the registry').toEqual(
      expect.arrayContaining(['cc-agent-registry', 'cc-circle-abc', 'cc-circle-cache-abc']),
    );
    const registryAt = s.dropped.stores.indexOf('cc-agent-registry');
    const circleAt = s.dropped.stores.indexOf('cc-circle-abc');
    expect(circleAt, 'the circle store is named before the registry is gone').toBeLessThan(registryAt);
  });

  it('a registry that cannot be read clears NOTHING — half-cleared is a device in circles it cannot open', async () => {
    const s = shellOf({ stores: ['cc-agent-registry', 'cc-circle-abc'], keys: ['cc.contactNames'], failListing: true });
    const r = await forgetThrowawaySelf(s);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/circle-ids|registry/i);
    expect(s.dropped.stores, 'nothing was dropped').toEqual([]);
    expect(s.dropped.keys).toEqual([]);
  });

  it('clears the prefixed keys, and leaves the kept ones exactly alone', async () => {
    const s = shellOf({
      keys: ['cc.sharedDisclosure.default::abc', 'cc.contactNames', 'onderling.enrollOffer', 'basis.theme', 'circle.app.lang'],
    });
    const r = await forgetThrowawaySelf(s);
    expect(r.ok).toBe(true);
    expect([...s.live.keys].sort(), 'the survivors survived').toEqual(['basis.theme', 'circle.app.lang', 'onderling.enrollOffer']);
    expect(s.dropped.keys).toEqual(expect.arrayContaining(['cc.sharedDisclosure.default::abc', 'cc.contactNames']));
  });

  it('is a no-op it can report when there is nothing of a former self to forget', async () => {
    const s = shellOf({ stores: [], keys: ['basis.theme'] });
    const r = await forgetThrowawaySelf(s);
    expect(r).toMatchObject({ ok: true });
    expect(s.dropped.keys).toEqual([]);
  });
});
