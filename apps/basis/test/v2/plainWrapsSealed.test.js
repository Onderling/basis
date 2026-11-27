/**
 * The plain wraps of the ids-and-metadata stores are sealed at rest (ledger L1083 c): which ask posts the person
 * skipped for whom (`basis.askMatchSkips`) and the contacts' peer graph (`basis.peers:*`). One shared io / backend each; the
 * shell chooses only the storage. What lands in storage is not readable; it opens with the key through the store.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { groupKeyStrategy } from '@onderling/pod-client';
import { setShellContentSeal, sealedKeyValue } from '../../src/v2/localStoreSeal.js';
import { createAskMatchSkips, localStorageAskMatchSkipsIo, asyncStorageAskMatchSkipsIo } from '../../src/v2/askMatches.js';
import { createLocalStoragePeerBackend } from '../../src/web/localStoragePeerBackend.js';

const KEY = Buffer.from(new Uint8Array(32).fill(4)).toString('base64url');
const MARK = 'webid-of-henk-123';
afterEach(() => setShellContentSeal(null));

function webStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; }, _m: m };
}
function phoneStorage() {
  const m = new Map();
  return { getItem: async (k) => (m.has(k) ? m.get(k) : null), setItem: async (k, v) => { m.set(k, String(v)); }, removeItem: async (k) => { m.delete(k); }, getAllKeys: async () => [...m.keys()], _m: m };
}
const raw = (s) => [...s._m.values()].join('\n');

describe.each([['web', webStorage, localStorageAskMatchSkipsIo], ['phone', phoneStorage, asyncStorageAskMatchSkipsIo]])('basis.askMatchSkips on the %s', (_n, make, io) => {
  it('what is stored is not readable, and it opens with the key', async () => {
    setShellContentSeal(groupKeyStrategy({ groupKey: KEY }));
    const s = make();
    const skips = createAskMatchSkips(io(s));
    await skips.add('post-1', MARK);
    expect(raw(s)).not.toContain(MARK);
    expect((await createAskMatchSkips(io(s)).list()).join()).toContain(MARK);
  });
});

describe.each([['web', webStorage], ['phone', phoneStorage]])('basis.peers:* on the %s', (_n, make) => {
  it('what is stored is not readable, it opens with the key, and the keys still list', async () => {
    setShellContentSeal(groupKeyStrategy({ groupKey: KEY }));
    const s = make();
    const b = createLocalStoragePeerBackend({ storage: sealedKeyValue(s, { strict: true }) });
    await b.set('peer:abc', JSON.stringify({ name: MARK }));
    expect(raw(s)).not.toContain(MARK);
    expect(await b.get('peer:abc')).toContain(MARK);
    expect(await b.list()).toEqual(['peer:abc']);
  });
});
