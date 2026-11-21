/**
 * A SEALED KEY-VALUE STORE NO LONGER TAKES A PLAIN VALUE AS GENUINE, AND A SEALED VALUE OPENS ONLY UNDER ITS OWN KEY
 * (the independent read of 2026-11-20, finding 4).
 *
 * The seal gave secrecy only: a plain value read as itself (so whoever can write the storage could plant a model
 * setting with their own endpoint, a policy, a peer graph), and a sealed value copied under another key opened there.
 * Now:
 *   • the content key's own vault record says whether this device ever wrote a plain value into a sealed store: a key
 *     minted from now on is stored with a form mark, and on such a device a plain (or unbound sealed) value is planted:
 *     "not readable", kept, never written over. A bare key is an older one: its plain and unbound values are the
 *     upgrade's, read once and rewritten bound (until the alpha build drops that path);
 *   • the storage key is sealed inside the value, so a value opens only under its own key.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { groupKeyStrategy } from '@onderling/pod-client';
import { setShellContentSeal, sealedKeyValue, sealedJsonIo, sealedLocalVault } from '../../src/v2/localStoreSeal.js';
import { ensureContentKey, contentSealStrategy, CONTENT_AT_REST_VAULT_KEY } from '../../src/v2/contentAtRest.js';

afterEach(() => setShellContentSeal(null));

function memVault(entries = {}) {
  const m = new Map(Object.entries(entries));
  return { get: async (k) => (m.has(k) ? m.get(k) : null), set: async (k, v) => { m.set(k, v); }, delete: async (k) => m.delete(k), _m: m };
}
function memStorage(entries = {}) {
  const m = new Map(Object.entries(entries));
  return {
    getItem: async (k) => (m.has(k) ? m.get(k) : null),
    setItem: async (k, v) => { m.set(k, String(v)); },
    removeItem: async (k) => { m.delete(k); },
    getAllKeys: async () => [...m.keys()],
    _m: m,
  };
}
const OLD_KEY = Buffer.from(new Uint8Array(32).fill(5)).toString('base64url');
/** A device whose content key was minted by this build. */
async function newKeyDevice() { const s = await contentSealStrategy(memVault()); setShellContentSeal(s); return s; }
/** A device upgraded from before: its vault holds a bare key. */
async function oldKeyDevice() { const s = await contentSealStrategy(memVault({ [CONTENT_AT_REST_VAULT_KEY]: OLD_KEY })); setShellContentSeal(s); return s; }
const MODEL = JSON.stringify({ provider: 'cloud', endpoint: 'https://planted.example' });

describe('the content key says whether plain values are refused', () => {
  it('a key minted now is stored with its form mark; the key itself is unchanged; it survives a restart', async () => {
    const vault = memVault();
    const k = await ensureContentKey(vault);
    expect(vault._m.get(CONTENT_AT_REST_VAULT_KEY)).toBe(`kv1:${k}`);
    expect((await contentSealStrategy(vault)).plainRefused).toBe(true);
    expect(await ensureContentKey(vault)).toBe(k);
  });

  it('a bare key is an older one: plain values are the upgrade\'s', async () => {
    const vault = memVault({ [CONTENT_AT_REST_VAULT_KEY]: OLD_KEY });
    expect(await ensureContentKey(vault)).toBe(OLD_KEY);
    expect((await contentSealStrategy(vault)).plainRefused).toBe(false);
    expect(vault._m.get(CONTENT_AT_REST_VAULT_KEY), 'an old key is not rewritten').toBe(OLD_KEY);
  });
});

describe('on a device whose key was minted now', () => {
  it('a planted plain value is not readable, kept, and not written over (strict)', async () => {
    await newKeyDevice();
    const s = memStorage({ 'cc.model': MODEL });
    const kv = sealedKeyValue(s, { name: 'the model setting', strict: true });
    expect(await kv.getItem('cc.model')).toBeNull();
    expect(s._m.get('cc.model')).toBe(MODEL);
    await expect(kv.setItem('cc.model', 'x')).rejects.toThrow();
  });

  it('a planted plain value is refused in the default mode too', async () => {
    await newKeyDevice();
    const kv = sealedKeyValue(memStorage({ 'cc.circlePolicy.c1': '{"admins":["me"]}' }), { name: 'the circle policy' });
    await expect(kv.getItem('cc.circlePolicy.c1')).rejects.toThrow();
  });

  it('an UNBOUND sealed value (sealed without its key) is refused', async () => {
    const strat = await newKeyDevice();
    const s = memStorage({ 'cc.model': strat.seal(MODEL) });
    expect(await sealedJsonIo(s).load('cc.model')).toBeNull();
  });

  it('what this store writes reads back', async () => {
    await newKeyDevice();
    const kv = sealedKeyValue(memStorage(), { name: 'x', strict: true });
    await kv.setItem('a', 'hello');
    expect(await kv.getItem('a')).toBe('hello');
  });
});

describe('a sealed value opens only under its own key', () => {
  for (const [label, device] of [['new key', newKeyDevice], ['old key', oldKeyDevice]]) {
    it(`copied to another key it is not readable there (${label})`, async () => {
      await device();
      const s = memStorage();
      const kv = sealedKeyValue(s, { name: 'x', strict: true });
      await kv.setItem('cc.circlePolicy.mine', '{"admins":["me"]}');
      s._m.set('cc.circlePolicy.theirs', s._m.get('cc.circlePolicy.mine'));
      expect(await kv.getItem('cc.circlePolicy.theirs')).toBeNull();
      expect(await kv.getItem('cc.circlePolicy.mine')).toBe('{"admins":["me"]}');
    });
  }

  it('the circle key vault too', async () => {
    await newKeyDevice();
    const raw = memVault();
    const v = sealedLocalVault(raw);
    await v.set('cc.circle-sealing-id:c1', '{"privateKey":"A"}');
    raw._m.set('cc.circle-sealing-id:c2', raw._m.get('cc.circle-sealing-id:c1'));
    expect(await v.get('cc.circle-sealing-id:c2')).toBeNull();
    expect(await v.get('cc.circle-sealing-id:c1')).toBe('{"privateKey":"A"}');
  });
});

describe('on an upgraded device (an older key)', () => {
  it('a plain value reads once and is rewritten sealed AND bound', async () => {
    await oldKeyDevice();
    const s = memStorage({ 'cc.model': MODEL });
    const kv = sealedKeyValue(s, { name: 'the model setting', strict: true });
    expect(await kv.getItem('cc.model')).toBe(MODEL);
    expect(s._m.get('cc.model')).not.toBe(MODEL);
    s._m.set('cc.other', s._m.get('cc.model'));
    expect(await kv.getItem('cc.other'), 'the resealed value is bound to its key').toBeNull();
  });

  it('an unbound sealed value reads once and is rewritten bound', async () => {
    const strat = await oldKeyDevice();
    const unbound = strat.seal(MODEL);
    const s = memStorage({ 'cc.model': unbound });
    const kv = sealedKeyValue(s, { name: 'the model setting', strict: true });
    expect(await kv.getItem('cc.model')).toBe(MODEL);
    expect(s._m.get('cc.model')).not.toBe(unbound);
    s._m.set('cc.other', s._m.get('cc.model'));
    expect(await kv.getItem('cc.other')).toBeNull();
  });
});
