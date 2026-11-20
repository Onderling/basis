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

  it('a ref never read, or deleted on purpose, can be written', async () => {
    const inner = createMemoryBackend();
    await createSealingBackend({ backend: inner, getStrategy: async () => keyed('A'), onWarn: quiet }).put('old', { v: 1 });
    const b = createSealingBackend({ backend: inner, getStrategy: async () => keyed('B'), onWarn: quiet });
    await b.put('fresh', { v: 1 });
    expect(await b.get('old')).toBe(null);
    await b.delete('old');
    await b.put('old', { v: 2 });
    const got = await b.get('old');
    expect(got?.bytes ?? got).toEqual({ v: 2 });
  });
});
