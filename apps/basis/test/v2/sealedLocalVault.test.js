/**
 * THE CIRCLE KEY VAULT — sealed on write, and the one migration this codebase deliberately does.
 *
 * Content at rest does NOT migrate: Frits, 2026-09-10, *"all data must be sealed, but from the start"* —
 * a pass over live data is the part that could lose someone's things, so a pre-seal row is left as it is.
 *
 * Key material goes the other way, and this is the test that says why it is safe to. There are three rows
 * per circle, they are read on every circle open, and a plaintext private key left behind does not merely
 * fail to protect new writes: it opens that circle's past and future for as long as it exists. So a
 * plaintext value found on read is written back sealed.
 *
 * The claim being pinned is that this cannot lose anything. The value is replaced only after the seal
 * succeeds, so the failure case leaves exactly what was there before — which is what the last test drives.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { groupKeyStrategy } from '@onderling/pod-client';
import { setShellContentSeal, sealedLocalVault } from '../../src/v2/localStoreSeal.js';

const KEY = 'A'.repeat(43);   // 32 bytes of b64url — fixed, so a failure reproduces
const SECRET = '{"publicKey":"MCowBQ","privateKey":"MC4CAQAw-this-must-never-be-readable"}';

/** A vault whose contents the test can look at directly, the way a copied profile would. */
function inspectableVault() {
  const m = new Map();
  return {
    raw: m,
    get:    async (k) => (m.has(k) ? m.get(k) : null),
    set:    async (k, v) => { m.set(k, String(v)); },
    delete: async (k) => { m.delete(k); },
    list:   async () => [...m.keys()],
  };
}

describe('the per-circle key vault seals what it holds', () => {
  beforeEach(() => setShellContentSeal(groupKeyStrategy({ groupKey: KEY })));

  it('a private key written through it is not in the store', async () => {
    const inner = inspectableVault();
    await sealedLocalVault(inner).set('cc.circle-sealing-id:c1', SECRET);

    const stored = inner.raw.get('cc.circle-sealing-id:c1');
    expect(stored, 'nothing was written').toBeTruthy();
    expect(stored, 'the private key is in the vault in the clear').not.toContain('MC4CAQAw');
    expect(stored.startsWith('fp1:'), 'it should be a sealed envelope').toBe(true);
  });

  it('…and comes back exactly as it went in', async () => {
    const inner = inspectableVault();
    const vault = sealedLocalVault(inner);
    await vault.set('cc.circle-groupkey:c1', SECRET);
    expect(await vault.get('cc.circle-groupkey:c1')).toBe(SECRET);
  });

  it('a key row written BEFORE sealing is readable, and is resealed on the way past', async () => {
    const inner = inspectableVault();
    // What an existing install has today: the row in the clear, put there before any of this existed.
    inner.raw.set('cc.circle-controller-key:c1', SECRET);
    const vault = sealedLocalVault(inner);

    // It still reads — the person does not lose the circle.
    expect(await vault.get('cc.circle-controller-key:c1'), 'an existing key row must stay readable').toBe(SECRET);

    // …and it is no longer in the clear behind it. This is the migration, and it is the whole argument
    // for treating key material differently from content: it converges without a boot pass, because a
    // key nobody reads is a key nobody is using.
    const after = inner.raw.get('cc.circle-controller-key:c1');
    expect(after.startsWith('fp1:'), 'the plaintext key row should have been resealed on read').toBe(true);
    expect(after, 'and the private key should be gone from the store').not.toContain('MC4CAQAw');

    // Reading it again still returns the same thing, now through the seal.
    expect(await vault.get('cc.circle-controller-key:c1')).toBe(SECRET);
  });

  it('a reseal that fails leaves the readable value alone — it can never lose a key', async () => {
    const inner = inspectableVault();
    inner.raw.set('cc.circle-sealing-id:c1', SECRET);
    // The write half breaks. The read must still hand back the key, and the store must still hold it:
    // a migration that can drop key material on a bad write is not one worth having.
    inner.set = async () => { throw new Error('storage full'); };

    const value = await sealedLocalVault(inner).get('cc.circle-sealing-id:c1');
    expect(value, 'a failed reseal must not swallow the key').toBe(SECRET);
    expect(inner.raw.get('cc.circle-sealing-id:c1'), 'and must leave the store as it found it').toBe(SECRET);
  });
});
