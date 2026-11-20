/**
 * A sealed record this device cannot open is never written over (ledger L1115, Fable's review section 2).
 *
 * `get` answers null for an envelope the key cannot open (one bad row must not take a store down), and null is what
 * "absent" means, so a caller would then write a fresh record over it: the device-log snapshot hydrating empty and the
 * first append overwriting the whole record, an item store re-creating a row. Now the ref is remembered and a write to
 * it is refused (`code: 'stored-value-unreadable'`) until a read of it opens or it is deleted on purpose.
 * Also: a read BEFORE the key used a variable before its declaration (a ReferenceError on every such read).
 */
import { describe, it, expect } from 'vitest';
import { createMemoryBackend } from '../src/MemoryBackend.js';
import { createSealingBackend } from '../src/SealingBackend.js';

const keyed = (tag) => ({
  seal: (s) => `fp1:${tag}:${s}`,
  open: (s) => {
    const t = String(s);
    if (!t.startsWith('fp1:')) return t;
    if (!t.startsWith(`fp1:${tag}:`)) throw new Error('wrong key');
    return t.slice(`fp1:${tag}:`.length);
  },
});
const quiet = () => {};

describe('SealingBackend: what it could not open (L1115)', () => {
  it('before the key: a plain record reads as it stands, a sealed one as null (no ReferenceError)', async () => {
    const inner = createMemoryBackend();
    await inner.put('plain', 'hello');
    await inner.put('sealed', 'fp1:A:{"x":1}');
    const b = createSealingBackend({ backend: inner, getStrategy: async () => null, onWarn: quiet });
    const plain = await b.get('plain');
    expect(plain?.bytes ?? plain).toBe('hello');
    expect(await b.get('sealed')).toBe(null);
  });

  it('a record another key sealed reads null, and a write over it is refused; the record stays', async () => {
    const inner = createMemoryBackend();
    await createSealingBackend({ backend: inner, getStrategy: async () => keyed('A'), onWarn: quiet }).put('log', { lines: 100 });
    const before = (await inner.get('log')).bytes;
    const b = createSealingBackend({ backend: inner, getStrategy: async () => keyed('B'), onWarn: quiet });
    expect(await b.get('log')).toBe(null);
    const err = await b.put('log', { lines: 1 }).catch((e) => e);
    expect(err?.code).toBe('stored-value-unreadable');
    await expect(b.putIf('log', { lines: 1 }, null)).rejects.toMatchObject({ code: 'stored-value-unreadable' });
    expect((await inner.get('log')).bytes).toBe(before);
  });

  it('a ref never read can be written; a delete does NOT lift the refusal; a second wrapper over the same backend still refuses', async () => {
    const inner = createMemoryBackend();
    await createSealingBackend({ backend: inner, getStrategy: async () => keyed('A'), onWarn: quiet }).put('old', { v: 1 });
    const b = createSealingBackend({ backend: inner, getStrategy: async () => keyed('B'), onWarn: quiet });
    await b.put('fresh', { v: 1 });
    expect(await b.get('old')).toBe(null);
    const again = createSealingBackend({ backend: inner, getStrategy: async () => keyed('B'), onWarn: quiet });
    await expect(again.put('old', { v: 2 })).rejects.toMatchObject({ code: 'stored-value-unreadable' });
    await b.delete('old');
    await expect(b.put('old', { v: 2 })).rejects.toMatchObject({ code: 'stored-value-unreadable' });
  });
  it('a store rebuilt over the same storage (a new backend object, the same name) still refuses', async () => {
    const shared = createMemoryBackend();
    const over = (b) => ({ get: (...a) => shared.get(...a), put: (...a) => shared.put(...a), delete: (...a) => shared.delete(...a), list: (...a) => shared.list(...a) });
    await createSealingBackend({ backend: over(), getStrategy: async () => keyed('A'), onWarn: quiet, markScope: 'cc-circle-x' }).put('row', { v: 1 });
    const b1 = createSealingBackend({ backend: over(), getStrategy: async () => keyed('B'), onWarn: quiet, markScope: 'cc-circle-x' });
    expect(await b1.get('row')).toBe(null);
    const b2 = createSealingBackend({ backend: over(), getStrategy: async () => keyed('B'), onWarn: quiet, markScope: 'cc-circle-x' });
    await expect(b2.put('row', { v: 2 })).rejects.toMatchObject({ code: 'stored-value-unreadable' });
  });
});
