/**
 * A SEALED ROW OPENS ONLY UNDER ITS OWN ID, IN ITS OWN STORE (the sealed key-value stores got this first; the row
 * backends are the same hole). The backend read a row by id and opened whatever sealed body was stored there, so
 * someone who can write the storage could put one row's sealed body under another row's id. Now the store's name and
 * the row's id are sealed inside the row; a row sealed for another id or another store is not readable (kept, not
 * written over). An UNBOUND row (sealed before this) or a plain one: refused on a device whose content key was minted
 * since (`plainRefused`), read on an older key (the upgrade's, bound at its next write; the alpha build drops that path).
 */
import { describe, it, expect } from 'vitest';
import { createMemoryBackend } from '../src/MemoryBackend.js';
import { createSealingBackend } from '../src/SealingBackend.js';

const keyed = (tag, extra = {}) => ({
  seal: (s) => `fp1:${tag}:${s}`,
  open: (s) => {
    const t = String(s);
    if (!t.startsWith('fp1:')) return t;
    if (!t.startsWith(`fp1:${tag}:`)) throw new Error('wrong key');
    return t.slice(`fp1:${tag}:`.length);
  },
  ...extra,
});
const quiet = () => {};
const raw = async (inner, ref) => { const r = await inner.get(ref); return (r && typeof r === 'object' && 'bytes' in r) ? r.bytes : r; };

describe('a sealed row is bound to its id and its store', () => {
  for (const [label, strat] of [['a key minted now', keyed('A', { plainRefused: true })], ['an older key', keyed('A', { plainRefused: false })]]) {
    it(`a row's body copied under another id does not open there (${label})`, async () => {
      const inner = createMemoryBackend();
      const b = createSealingBackend({ backend: inner, getStrategy: async () => strat, onWarn: quiet, markScope: 'basis.circle-c1' });
      await b.put('items/mine', { text: 'mine' });
      await inner.put('items/theirs', await raw(inner, 'items/mine'));
      expect(await b.get('items/theirs')).toBeNull();
      expect((await b.get('items/mine'))?.bytes).toMatchObject({ text: 'mine' });
    });

    it(`a row from another store does not open here (${label})`, async () => {
      const inner = createMemoryBackend();
      const other = createMemoryBackend();
      await createSealingBackend({ backend: other, getStrategy: async () => strat, onWarn: quiet, markScope: 'basis.circle-c2' }).put('items/x', { text: 'c2' });
      await inner.put('items/x', await raw(other, 'items/x'));
      const b = createSealingBackend({ backend: inner, getStrategy: async () => strat, onWarn: quiet, markScope: 'basis.circle-c1' });
      expect(await b.get('items/x')).toBeNull();
    });
  }

  it('on a key minted now an unbound or plain row is refused; on an older key it reads', async () => {
    const unbound = `fp1:A:j${JSON.stringify({ text: 'old' })}`;
    for (const [plainRefused, want] of [[true, null], [false, { text: 'old' }]]) {
      const inner = createMemoryBackend();
      await inner.put('items/old', unbound);
      await inner.put('items/plain', JSON.stringify({ text: 'plain' }));
      const b = createSealingBackend({ backend: inner, getStrategy: async () => keyed('A', { plainRefused }), onWarn: quiet, markScope: 's' });
      if (want) expect((await b.get('items/old'))?.bytes).toMatchObject(want); else expect(await b.get('items/old')).toBeNull();
      if (plainRefused) expect(await b.get('items/plain')).toBeNull(); else expect(await b.get('items/plain')).not.toBeNull();
    }
  });
});
