/**
 * An unreadable content key is never silently replaced (ledger L1115).
 *
 * The device's content key lives in the sealed chat vault (contentAtRest.js). `ensureContentKey` used to read it with a
 * catch that answered null, so ANY failed read (a vault entry that would not decrypt, a storage error at start) minted a
 * new key and wrote it over the old one: every sealed row was then unreadable, and the strict stores started from empty
 * and wrote defaults over what they could not open. Now: a key is minted only when the vault answered "nothing stored";
 * a failed read throws a typed `ContentKeyUnreadable` and writes nothing. And a strict store never writes over a value
 * it could not open: that write is refused with a typed `StoredValueUnreadable` until a read of the key succeeds.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { groupKeyStrategy } from '@onderling/pod-client';
import {
  ensureContentKey, ContentKeyUnreadable, CONTENT_AT_REST_VAULT_KEY, isContentKeyUnreadable,
} from '../../src/v2/contentAtRest.js';
import {
  setShellContentSeal, sealedKeyValue, sealedJsonIo, sealedLocalVault, StoredValueUnreadable, onStoredValueRefused,
} from '../../src/v2/localStoreSeal.js';
import { bootFailureNotice } from '../../src/v2/bootFailure.js';
import en from '../../src/locales/circle.en.json' with { type: 'json' };
import nl from '../../src/locales/circle.nl.json' with { type: 'json' };

/** A vault whose reads can be made to fail, counting writes. */
function flakyVault(initial = {}) {
  const m = new Map(Object.entries(initial));
  const v = {
    failReads: 0, writes: 0,
    async get(k) {
      if (v.failReads > 0) { v.failReads -= 1; throw new Error('VaultEncrypted: decrypt failed'); }
      return m.has(k) ? m.get(k) : null;
    },
    async set(k, val) { v.writes += 1; m.set(k, val); },
    _m: m,
  };
  return v;
}

describe('ensureContentKey: mint only when nothing is stored (L1115)', () => {
  it('a failed read throws ContentKeyUnreadable and writes nothing', async () => {
    const vault = flakyVault({ [CONTENT_AT_REST_VAULT_KEY]: 'the-old-key' });
    vault.failReads = 1;
    const err = await ensureContentKey(vault).catch((e) => e);
    expect(err).toBeInstanceOf(ContentKeyUnreadable);
    expect(err.code).toBe('key-unreadable');
    expect(isContentKeyUnreadable(err)).toBe(true);
    expect(vault.writes).toBe(0);
    expect(vault._m.get(CONTENT_AT_REST_VAULT_KEY)).toBe('the-old-key');
  });

  it('the next read that succeeds returns the SAME key (try again works)', async () => {
    const vault = flakyVault({ [CONTENT_AT_REST_VAULT_KEY]: 'the-old-key' });
    vault.failReads = 1;
    await ensureContentKey(vault).catch(() => null);
    expect(await ensureContentKey(vault)).toBe('the-old-key');
    expect(vault.writes).toBe(0);
  });

  it('nothing stored: a key is minted once and kept', async () => {
    const vault = flakyVault();
    const k = await ensureContentKey(vault);
    expect(typeof k).toBe('string');
    expect(k.length).toBeGreaterThan(20);
    expect(await ensureContentKey(vault)).toBe(k);
    expect(vault.writes).toBe(1);
  });

  it('a stored value that is not a key is unreadable, not replaced', async () => {
    const vault = flakyVault({ [CONTENT_AT_REST_VAULT_KEY]: { not: 'a key' } });
    await expect(ensureContentKey(vault)).rejects.toBeInstanceOf(ContentKeyUnreadable);
    expect(vault.writes).toBe(0);
  });
});

const KEY_A = Buffer.from(new Uint8Array(32).fill(3)).toString('base64url');
const KEY_B = Buffer.from(new Uint8Array(32).fill(9)).toString('base64url');
function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, _m: m };
}

afterEach(() => setShellContentSeal(null));

describe('a strict store never writes over a value it could not open (L1115)', () => {
  it('sealedKeyValue strict: the write is refused, the stored value stays', async () => {
    const s = memStorage();
    setShellContentSeal(groupKeyStrategy({ groupKey: KEY_A }));
    await sealedKeyValue(s, { strict: true }).setItem('cc.model', '{"endpoint":"mine"}');
    const before = s._m.get('cc.model');
    setShellContentSeal(groupKeyStrategy({ groupKey: KEY_B }));   // a key that cannot open it
    const kv = sealedKeyValue(s, { name: 'the model setting', strict: true });
    expect(await kv.getItem('cc.model')).toBe(null);
    const err = await kv.setItem('cc.model', '{"endpoint":"default"}').catch((e) => e);
    expect(err).toBeInstanceOf(StoredValueUnreadable);
    expect(err.code).toBe('stored-value-unreadable');
    expect(s._m.get('cc.model')).toBe(before);
  });

  it('sealedJsonIo: a save after an unopenable load is refused', async () => {
    const s = memStorage();
    setShellContentSeal(groupKeyStrategy({ groupKey: KEY_A }));
    await sealedJsonIo(s).save('cc.pins', { c1: true, c2: true });
    const before = s._m.get('cc.pins');
    setShellContentSeal(groupKeyStrategy({ groupKey: KEY_B }));
    const io = sealedJsonIo(s);
    expect(await io.load('cc.pins')).toBe(null);
    await expect(io.save('cc.pins', { c3: true })).rejects.toBeInstanceOf(StoredValueUnreadable);
    expect(s._m.get('cc.pins')).toBe(before);
  });

  it('a write is allowed again once the value reads; a remove does NOT lift the refusal (remove-then-set is a save)', async () => {
    const s = memStorage();
    setShellContentSeal(groupKeyStrategy({ groupKey: KEY_A }));
    await sealedKeyValue(s, { strict: true }).setItem('k', 'v1');
    const kv = sealedKeyValue(s, { strict: true });
    setShellContentSeal(groupKeyStrategy({ groupKey: KEY_B }));
    expect(await kv.getItem('k')).toBe(null);
    setShellContentSeal(groupKeyStrategy({ groupKey: KEY_A }));
    expect(await kv.getItem('k')).toBe('v1');
    await kv.setItem('k', 'v2');
    expect(await kv.getItem('k')).toBe('v2');
    setShellContentSeal(groupKeyStrategy({ groupKey: KEY_B }));
    expect(await kv.getItem('k')).toBe(null);
    await kv.removeItem('k');
    await expect(kv.setItem('k', 'fresh')).rejects.toBeInstanceOf(StoredValueUnreadable);
  });

  it('a NON-strict store keeps what it could not open too; an overwritable one (a cache) does not', async () => {
    const s = memStorage();
    setShellContentSeal(groupKeyStrategy({ groupKey: KEY_A }));
    await sealedKeyValue(s).setItem('cc.circlePolicy.c1', '{"pod":"mine"}');
    await sealedKeyValue(s).setItem('cc.blocks', '{"n":1}');
    const before = s._m.get('cc.circlePolicy.c1');
    setShellContentSeal(groupKeyStrategy({ groupKey: KEY_B }));
    const policy = sealedKeyValue(s, { name: 'the circle policy' });
    await expect(policy.getItem('cc.circlePolicy.c1')).rejects.toThrow();
    await expect(policy.setItem('cc.circlePolicy.c1', '{"pod":null}')).rejects.toBeInstanceOf(StoredValueUnreadable);
    expect(s._m.get('cc.circlePolicy.c1')).toBe(before);
    const cache = sealedKeyValue(s, { name: 'the page blocks cache', overwritable: true });
    await expect(cache.getItem('cc.blocks')).rejects.toThrow();
    await cache.setItem('cc.blocks', '{"n":2}');
    expect(await cache.getItem('cc.blocks')).toBe('{"n":2}');
  });

  it('a value that opens but is not JSON is not written over either', async () => {
    const s = memStorage();
    setShellContentSeal(groupKeyStrategy({ groupKey: KEY_A }));
    await sealedKeyValue(s, { strict: true }).setItem('cc.j', 'not json {');
    const before = s._m.get('cc.j');
    const io = sealedJsonIo(s);
    expect(await io.load('cc.j')).toBe(null);
    await expect(io.save('cc.j', { a: 1 })).rejects.toBeInstanceOf(StoredValueUnreadable);
    expect(s._m.get('cc.j')).toBe(before);
  });

  it('a key never read and absent can be written (a fresh store is not locked)', async () => {
    const s = memStorage();
    setShellContentSeal(groupKeyStrategy({ groupKey: KEY_A }));
    const kv = sealedKeyValue(s, { strict: true });
    await kv.setItem('new', 'x');
    expect(await kv.getItem('new')).toBe('x');
  });

  it('sealedLocalVault: a circle key it could not open is not written over', async () => {
    const m = new Map();
    const raw = { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); } };
    setShellContentSeal(groupKeyStrategy({ groupKey: KEY_A }));
    await sealedLocalVault(raw).set('cc.circle-sealing-id:c1', { privateKey: 'p' });
    const before = m.get('cc.circle-sealing-id:c1');
    setShellContentSeal(groupKeyStrategy({ groupKey: KEY_B }));
    const v = sealedLocalVault(raw);
    expect(await v.get('cc.circle-sealing-id:c1')).toBe(null);
    await expect(v.set('cc.circle-sealing-id:c1', { privateKey: 'new' })).rejects.toBeInstanceOf(StoredValueUnreadable);
    expect(m.get('cc.circle-sealing-id:c1')).toBe(before);
  });
});

describe('what the launcher says (L1115)', () => {
  it('an unreadable content key: its own words and "try again"; anything else: the reason', () => {
    expect(bootFailureNotice(new ContentKeyUnreadable())).toEqual({ key: 'circle.boot_content_unreadable', params: {}, retry: true });
    expect(bootFailureNotice({ code: 'key-unreadable' })?.retry).toBe(true);
    expect(bootFailureNotice({ code: 'AGENT_WIRING_FAILED', cause: new ContentKeyUnreadable() })?.retry).toBe(true);
    expect(bootFailureNotice(new Error('boom'))).toEqual({ key: 'circle.boot_failed', params: { reason: 'boom' }, retry: false });
    expect(bootFailureNotice('as text')?.params.reason).toBe('as text');
    expect(bootFailureNotice(null)).toBe(null);
  });

  it('the words exist in both languages', () => {
    for (const loc of [en, nl]) {
      for (const k of ['boot_content_unreadable', 'boot_retry', 'stored_value_unreadable', 'stored_value_unreadable_ok']) expect(loc[k]?.text).toBeTruthy();
    }
  });

  it('a refused save is heard by the shell only when it was the person\'s own act (said: true)', async () => {
    const heard = [];
    const off = onStoredValueRefused((e) => heard.push(e));
    const s = memStorage();
    setShellContentSeal(groupKeyStrategy({ groupKey: KEY_A }));
    await sealedKeyValue(s, { strict: true }).setItem('cc.x', 'v');
    setShellContentSeal(groupKeyStrategy({ groupKey: KEY_B }));
    const background = sealedKeyValue(s, { name: 'the seen-marks', strict: true });
    await background.getItem('cc.x');
    await background.setItem('cc.x', 'w').catch(() => null);
    expect(heard).toEqual([]);
    const kv = sealedKeyValue(s, { name: 'the pins', strict: true, said: true });
    await kv.getItem('cc.x');
    await kv.setItem('cc.x', 'w').catch(() => null);
    off();
    expect(heard).toEqual([{ name: 'the pins', key: 'cc.x' }]);
  });
});
