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
import { THROWAWAY_CONTENT, forgetThrowawaySelf, markForgetPending, runPendingForget, FORGET_PENDING_KEY } from '../../src/v2/enrolForgets.js';

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

describe('§8c — the device comes back WHOLE after the clear', () => {
  /**
   * Fable's warning was that clearing the registry could leave a device enrolled in the vault and in no circle:
   * the ceremony writes its delegation record, `clearContent` drops the registry, and the consume step on the
   * next boot might assume the record is still there.
   *
   * It does not, and not by luck. Boot reads `enrolledDevice` from the CUSTODY MARKER and the delegation blob
   * in the VAULT (`realAgent.js` ~605–625), then self-heals the registry record from it — with the reason
   * written out where it is done: "the ceremony itself never had to write a registry it could not yet see
   * (pre-reload it was still the old install's)". That old install's registry is exactly what this clears. And
   * `consumeEnrollOffer` reads the OFFER STASH for which circles to join, never the registry; circles never
   * depend on the record either ("every address still proves itself at the roster").
   *
   * So the behaviour is safe because three inputs survive. This pins that they do — a later hand adding any of
   * them to the content list turns a passing enrol into a device that is nobody, and nothing else would fail.
   */
  const KEPT = (name) => THROWAWAY_CONTENT.keep.some((k) => k === name || k.endsWith(`:${name}`) || k.includes(name));

  it('keeps every input the boot self-heal and the consume step read', () => {
    // 1 · the custody marker and 2 · the delegation blob — where `enrolledDevice` comes from
    expect(KEPT('custody-mode'), 'the custody marker says this install is a delegation').toBe(true);
    expect(KEPT('device-delegation-seed'), 'the delegation blob carries the deviceId and the PRE-SIGNED record').toBe(true);
    // 3 · the offer stash — which circles to re-join
    expect(THROWAWAY_CONTENT.keep).toContain('onderling.enrollOffer');
  });

  it('and none of the three is also on the content side', () => {
    const content = [...THROWAWAY_CONTENT.stores, ...THROWAWAY_CONTENT.keys];
    for (const n of ['custody-mode', 'device-delegation-seed', 'onderling.enrollOffer', 'content-at-rest-key']) {
      expect(content.some((c) => c.includes(n)), `${n} is not cleared`).toBe(false);
    }
    // the prefixes are the other way a key can be swept up without ever being named
    for (const n of ['onderling.enrollOffer', 'custody-mode']) {
      expect(THROWAWAY_CONTENT.keyPrefixes.some((p) => n.startsWith(p)), `${n} is not caught by a prefix`).toBe(false);
    }
  });
});

describe('the NOTE, not a button — every path that enrols gets the clear', () => {
  /** a vault, faked: the plain device-local kind the marker lives in, beside `restore-pending` */
  const fakeVault = (initial = {}) => {
    const m = new Map(Object.entries(initial));
    return {
      m,
      get: async (k) => m.get(k) ?? null,
      set: async (k, v) => { m.set(k, v); },
      delete: async (k) => { m.delete(k); },
    };
  };

  it('a DIRECT op enrol clears on the next boot — no UI driven, which is how the walk enrols', async () => {
    // This is the whole reason for the note. The clear used to hang off the web flow's reload button and the
    // mobile modal's effect, and the live walk enrols with `window.onderlingCall('household','enrollDevice')`.
    // Both shapes would have passed their own tests while the one path people and walks take went past.
    const v = fakeVault();
    await markForgetPending(v, 'enrol', ['abc']);
    const s = shellOf({ stores: ['cc-agent-registry', 'cc-circle-abc'], keys: ['cc.contactNames'] });
    const r = await runPendingForget({ markerVault: v, shell: s });
    expect(r.ran).toBe(true);
    expect(s.dropped.stores, 'the noted circle went too').toEqual(expect.arrayContaining(['cc-circle-abc', 'cc-agent-registry']));
    expect(await v.get(FORGET_PENDING_KEY), 'the note is gone once the work is done').toBeNull();
  });

  it('carries the circle ids ON the note — at boot there is no agent to ask', async () => {
    // The per-circle stores are named after the THROWAWAY self's circles, which only its registry knows, and
    // boot has no agent. A shell's own `listCircleIds` would answer "none" and every per-circle store would be
    // skipped in silence — the half-cleared state the whole file exists to avoid.
    const v = fakeVault();
    await markForgetPending(v, 'enrol', ['zzz']);
    const s = shellOf({ stores: ['cc-circle-zzz'], circleIds: [] });   // the shell knows nothing
    await runPendingForget({ markerVault: v, shell: s });
    expect(s.dropped.stores).toContain('cc-circle-zzz');
  });

  it('a boot with no note does nothing at all', async () => {
    const s = shellOf({ stores: ['cc-agent-registry'] });
    const r = await runPendingForget({ markerVault: fakeVault(), shell: s });
    expect(r).toMatchObject({ ran: false, reason: 'nothing-pending' });
    expect(s.dropped.stores, 'an ordinary boot never clears anything').toEqual([]);
  });

  it('a REFUSED drop keeps the note, so the next boot tries again', async () => {
    // A blocked IndexedDB delete — another tab holding the database — is the real case. Counting it as success
    // would leave the bytes for ever with nothing left to say so.
    const v = fakeVault();
    await markForgetPending(v, 'enrol', []);
    const r = await runPendingForget({
      markerVault: v,
      shell: { dropStore: () => { throw new Error('blocked by another connection'); }, dropKey: () => {} },
    });
    expect(r.ran).toBe(true);
    expect(r.failed, 'the refusals are counted, not swallowed').toBeGreaterThan(0);
    expect(await v.get(FORGET_PENDING_KEY), 'the note STAYS').not.toBeNull();
  });

  it('a registry that cannot be read keeps the note too', async () => {
    const v = fakeVault();
    // no ids on the note, and the shell's fallback throws — nothing is dropped, so nothing is forgotten
    await markForgetPending(v, 'enrol', []);
    const s = shellOf({ stores: ['cc-agent-registry'], failListing: true });
    const r = await runPendingForget({ markerVault: v, shell: s });
    expect(r.ok).toBe(false);
    expect(s.dropped.stores).toEqual([]);
    expect(await v.get(FORGET_PENDING_KEY), 'still owed').not.toBeNull();
  });

  it('the restore door leaves the note too — a wiped device also booted unenrolled first', async () => {
    const v = fakeVault();
    await markForgetPending(v, 'restore', []);
    const note = JSON.parse(await v.get(FORGET_PENDING_KEY));
    expect(note.why).toBe('restore');
  });
});
