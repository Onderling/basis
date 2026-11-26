/**
 * A PERSON CAN LOCK THEIR OWN BASIS IN THE BROWSER: the key door's lock (the browser's root-key door,
 * `@onderling/vault` RootKeyStoreWebCrypto).
 *
 * @guard while the door is locked its stored data holds no usable key: a copy of the browser's database opens to `locked`, a wrong secret does not unlock it, and getSeed throws KeyLocked, never null
 *
 * The secret wraps the door key (one slot of the passphrase kind, the key derived by Argon2id, the backup's own
 * function); while locked no key can be used. Switching the lock on re-keys the door once, and a failure before the
 * last step leaves the old door working. The door runs here on a fake IndexedDB with real WebCrypto; each test has a
 * database of its own (`dbName`), and the derivation runs with cheap parameters, as CloudBackup's tests do.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { RootKeyStoreWebCrypto, KeyLocked, KEY_LOCKED, RootKeyStoreMemory } from '@onderling/vault';
import { derivePassphraseKey } from '@onderling/core';

const CHEAP = Object.freeze({ m: 8, t: 1, p: 1 });
const kdf = (derive = derivePassphraseKey) => ({ name: 'argon2id', params: CHEAP, derive });
let n = 0;
const fresh = () => `door-test-${process.pid}-${(n += 1)}`;
const door = (dbName, o = {}) => new RootKeyStoreWebCrypto({ dbName, kdf: kdf(o.derive) });
const seedOf = () => crypto.getRandomValues(new Uint8Array(32));

function idb(name) {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = (e) => { e.target.result.createObjectStore('keys'); };
    r.onsuccess = (e) => resolve(e.target.result);
    r.onerror = (e) => reject(e.target.error);
  });
}
async function entries(name) {
  const db = await idb(name);
  const out = await new Promise((resolve, reject) => {
    const tx = db.transaction('keys', 'readonly'); const s = tx.objectStore('keys');
    const keys = s.getAllKeys(); const vals = s.getAll();
    tx.oncomplete = () => resolve(keys.result.map((k, i) => [k, vals.result[i]]));
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return out;
}
/** Every entry of one database into a fresh one: what someone who copies the browser's files has. */
async function copyDb(from, to) {
  const all = await entries(from);
  const db = await idb(to);
  await new Promise((resolve, reject) => {
    const tx = db.transaction('keys', 'readwrite'); const s = tx.objectStore('keys');
    for (const [k, v] of all) s.put(v, k);
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
  db.close();
}
const same = (a, b) => Buffer.from(a).equals(Buffer.from(b));

describe('the key door\'s lock', () => {
  it('1. a copy of a locked door\'s database is locked: getSeed throws KeyLocked, a wrong secret does not open it, no stored entry is a usable key', async () => {
    const name = fresh(); const d = door(name);
    await d.setSeed(seedOf());
    expect(await d.status()).toBe('open');
    await d.setLock('1234');
    const copy = fresh(); await copyDb(name, copy);
    const c = door(copy);
    expect(await c.status()).toBe('locked');
    const err = await c.getSeed().then(() => null, (e) => e);
    expect(err).toBeInstanceOf(KeyLocked);
    expect(err.code).toBe(KEY_LOCKED);
    expect(await c.unlock('4321')).toBe(false);
    expect(await c.status()).toBe('locked');
    const stored = await entries(copy);
    expect(stored.map(([k]) => k)).not.toContain('wrap-key');
    expect(stored.some(([, v]) => v instanceof CryptoKey)).toBe(false);
    // one slot of the passphrase kind, carrying what derives its key again (so the cost can be raised later)
    const slots = stored.find(([k]) => k === 'slots')?.[1];
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ kind: 'passphrase', kdf: { name: 'argon2id', params: CHEAP } });
  });

  it('2. the right secret opens the same seed as before the lock', async () => {
    const name = fresh(); const d = door(name); const seed = seedOf();
    await d.setSeed(seed); await d.setLock('een lange zin');
    const again = door(name);
    expect(await again.unlock('een lange zin')).toBe(true);
    expect(await again.status()).toBe('unlocked');
    expect(same(await again.getSeed(), seed)).toBe(true);
  });

  it('3. a failure after the slot is written and before the old key goes leaves a door that still gives the seed', async () => {
    const name = fresh(); const seed = seedOf();
    await door(name).setSeed(seed);
    // the derivation fails at its second call: the read back through the new slot
    let calls = 0;
    const failing = (...a) => { calls += 1; if (calls === 2) throw new Error('injected'); return derivePassphraseKey(...a); };
    const d = door(name, { derive: failing });
    await expect(d.setLock('1234')).rejects.toThrow();
    const after = door(name);
    expect(await after.status()).toBe('open');
    expect(same(await after.getSeed(), seed)).toBe(true);
  });

  it('4. setSeed on an unlocked door seals under the door key: lock, unlock, the new seed', async () => {
    const name = fresh(); const d = door(name);
    await d.setSeed(seedOf()); await d.setLock('1234');
    const next = seedOf();
    await d.setSeed(next);
    d.lock();
    expect(await d.status()).toBe('locked');
    await expect(d.setSeed(seedOf())).rejects.toBeInstanceOf(KeyLocked);
    expect(await d.unlock('1234')).toBe(true);
    expect(same(await d.getSeed(), next)).toBe(true);
    // a second lock over the first is refused (a new secret is: switch off, switch on), and the first still opens
    await expect(d.setLock('5678')).rejects.toThrow(/switch it off first/);
    d.lock(); expect(await d.unlock('1234')).toBe(true);
  });

  it('5. clearLock: back to open, the seed unchanged, no slot left', async () => {
    const name = fresh(); const d = door(name); const seed = seedOf();
    await d.setSeed(seed); await d.setLock('1234');
    await d.clearLock();
    const again = door(name);
    expect(await again.status()).toBe('open');
    expect(same(await again.getSeed(), seed)).toBe(true);
    expect((await entries(name)).map(([k]) => k)).not.toContain('slots');
  });

  it('6. start over still deletes the whole database with a locked door open in the same tab', async () => {
    const name = fresh(); const d = door(name);
    await d.setSeed(seedOf()); await d.setLock('1234');
    const locked = door(name);
    expect(await locked.status()).toBe('locked');
    await new Promise((resolve, reject) => {
      const r = indexedDB.deleteDatabase(name);
      r.onsuccess = resolve; r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error('blocked: the open door held the database'));
    });
    expect(await door(name).status()).toBe('empty');
  });
});

describe('the other doors have no lock', () => {
  it('answer `unlocked` with a seed and `empty` without', async () => {
    const m = new RootKeyStoreMemory();
    expect(await m.status()).toBe('empty');
    await m.setSeed(seedOf());
    expect(await m.status()).toBe('unlocked');
  });
});
