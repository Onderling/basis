/** The compare-and-swap write goes through the seal like every other write — the proxy must not forward it verbatim. */
import { describe, it, expect } from 'vitest';
import { createMemoryBackend } from '../src/MemoryBackend.js';
import { createSealingBackend } from '../src/SealingBackend.js';

const strategy = { seal: (s) => `sealed:${s}`, open: (s) => (String(s).startsWith('sealed:') ? String(s).slice(7) : s) };

describe('SealingBackend.putIf', () => {
  it('seals what it stores, and still compares', async () => {
    const inner = createMemoryBackend();
    const b = createSealingBackend({ backend: inner, getStrategy: async () => strategy });
    const w = await b.putIf('k', { secret: 1 }, null);
    expect(String((await inner.get('k')).bytes).startsWith('sealed:'), 'ciphertext at rest').toBe(true);
    expect(await b.putIf('k', { secret: 2 }, '"stale"')).toEqual({ conflict: true });
    expect(await b.putIf('k', { secret: 3 }, w.etag)).toMatchObject({ _v: 2 });
  });
  it('refuses without a key, like put', async () => {
    const b = createSealingBackend({ backend: createMemoryBackend(), getStrategy: async () => null });
    await expect(b.putIf('k', 1, null)).rejects.toThrow(/unsealed/);
  });
});
