/**
 * A sealed store seals only the rows that changed (ledger L619, a phone start profile).
 *
 * `sealedPersist` sealed EVERY value of the whole map on every save, so one changed item re-sealed the entire store —
 * and the first save after a start re-sealed every row it had just opened. Now each key remembers the plain value it
 * last sealed (or opened) and that sealed form; an unchanged value reuses it, a changed one is always sealed fresh, and
 * a removed key leaves the memory.
 */
import { describe, it, expect } from 'vitest';
import { sealedPersist } from '../src/sealedPersist.js';

/** A seal that counts, and gives a fresh ciphertext every call (as a nonce would). */
function countingStrategy() {
  const s = { seals: 0, opens: 0 };
  let n = 0;
  s.seal = (t) => { s.seals += 1; n += 1; return `sealed:${n}:${Buffer.from(t).toString('base64')}`; };
  s.open = (t) => {
    s.opens += 1;
    if (!t.startsWith('sealed:')) return t;   // plain text passes through (the group-key open does)
    return Buffer.from(t.split(':')[2], 'base64').toString();
  };
  return s;
}
/** An adapter that keeps the last map it was handed (as a file/IndexedDB/AsyncStorage blob would). */
function memoryAdapter(initial = new Map()) {
  const a = { stored: new Map(initial), saves: 0 };
  a.load = async () => new Map(a.stored);
  a.save = async (m) => { a.saves += 1; a.stored = new Map(m); };
  a.scheduleSave = (m) => { a.saves += 1; a.stored = new Map(m); };
  a.flush = async (m) => { if (m) a.stored = new Map(m); };
  return a;
}
const rows = (n) => new Map(Array.from({ length: n }, (_, i) => [`mem://household/items/${i}`, JSON.stringify({ id: i, text: `item ${i}` })]));

describe('a sealed store seals only what changed', () => {
  it('N rows, one changes: one seal, not N', async () => {
    const strategy = countingStrategy();
    const adapter = memoryAdapter();
    const p = sealedPersist(adapter, strategy);
    const N = 50;
    const map = rows(N);
    await p.save(map);
    expect(strategy.seals).toBe(N);
    strategy.seals = 0;
    map.set('mem://household/items/7', JSON.stringify({ id: 7, text: 'changed' }));
    p.scheduleSave(map);
    expect(strategy.seals).toBe(1);
    // the changed row is sealed FRESH and opens to its new text; the others are byte-for-byte what was stored before
    const back = await sealedPersist(memoryAdapter(adapter.stored), countingStrategy()).load();
    expect(JSON.parse(back.get('mem://household/items/7')).text).toBe('changed');
    expect(JSON.parse(back.get('mem://household/items/3')).text).toBe('item 3');
  });

  it('the first save after a load reuses what was on disk: no row is sealed again unless it changed', async () => {
    const first = countingStrategy();
    const adapter = memoryAdapter();
    await sealedPersist(adapter, first).save(rows(20));
    const before = new Map(adapter.stored);

    const strategy = countingStrategy();
    const p = sealedPersist(adapter, strategy);
    const map = await p.load();
    expect(map.size).toBe(20);
    await p.save(map);
    expect(strategy.seals).toBe(0);
    expect([...adapter.stored]).toEqual([...before]);
  });

  it('a value that was plain on disk (written before sealing) is sealed at the next save, never kept plain', async () => {
    const adapter = memoryAdapter(new Map([['k', '{"text":"plain"}']]));
    const strategy = countingStrategy();
    const p = sealedPersist(adapter, strategy);
    await p.save(await p.load());
    expect(strategy.seals).toBe(1);
    expect(adapter.stored.get('k').startsWith('sealed:')).toBe(true);
  });

  it('a value changed and changed BACK is sealed fresh each time (never an older ciphertext for a value now on disk)', async () => {
    const strategy = countingStrategy();
    const adapter = memoryAdapter();
    const p = sealedPersist(adapter, strategy);
    const map = new Map([['k', 'A']]);
    await p.save(map);
    const sealedA = adapter.stored.get('k');
    map.set('k', 'B'); await p.save(map);
    map.set('k', 'A'); await p.save(map);
    expect(strategy.seals).toBe(3);
    expect(adapter.stored.get('k')).not.toBe(sealedA);
  });

  it('a removed key leaves the memory: re-added with the same value, it is sealed fresh', async () => {
    const strategy = countingStrategy();
    const p = sealedPersist(memoryAdapter(), strategy);
    const map = new Map([['a', '1'], ['b', '2']]);
    await p.save(map);
    map.delete('b'); await p.save(map);
    expect(strategy.seals).toBe(2);
    map.set('b', '2'); await p.save(map);
    expect(strategy.seals).toBe(3);
  });
});

/** A strategy over one key: it opens only what it sealed (another key's rows throw, as the group-key open does). */
function keyedStrategy(tag) {
  return {
    seal: (t) => `sealed:${tag}:${Buffer.from(t).toString('base64')}`,
    open: (t) => {
      if (!t.startsWith('sealed:')) return t;
      const [, k, body] = t.split(':');
      if (k !== tag) throw new Error('sealing: secretbox open failed (wrong key or corrupt envelope)');
      return Buffer.from(body, 'base64').toString();
    },
  };
}

describe('a row that will not open is kept, not deleted (ledger L1079)', () => {
  const stored = () => new Map([
    ['a', keyedStrategy('mine').seal('{"t":"A"}')],
    ['b', keyedStrategy('mine').seal('{"t":"B"}')],
    ['c', keyedStrategy('other').seal('{"t":"C"}')],
  ]);

  it('load, change one row, save: the unopenable row is written back byte for byte, never handed on', async () => {
    const adapter = memoryAdapter(stored());
    const warnings = [];
    const p = sealedPersist(adapter, keyedStrategy('mine'), (m) => warnings.push(m));
    const map = await p.load();
    expect([...map.keys()].sort()).toEqual(['a', 'b']);
    map.set('a', '{"t":"A2"}');
    await p.save(map);
    expect(adapter.stored.get('c')).toBe(stored().get('c'));
    expect(adapter.stored.size).toBe(3);
    await p.save(map);
    expect(warnings.filter((w) => w.includes('c:')).length).toBe(1);   // said once, by key
    expect(warnings.join(' ')).not.toContain('"t":"C"');
  });

  it('a row the CALLER removes goes; a row the wrapper could not open stays', async () => {
    const adapter = memoryAdapter(stored());
    const p = sealedPersist(adapter, keyedStrategy('mine'), () => {});
    const map = await p.load();
    map.delete('b');
    await p.save(map);
    expect([...adapter.stored.keys()].sort()).toEqual(['a', 'c']);
  });

  it('the caller writing a row under that key wins, and the kept bytes are forgotten', async () => {
    const adapter = memoryAdapter(stored());
    const p = sealedPersist(adapter, keyedStrategy('mine'), () => {});
    const map = await p.load();
    map.set('c', '{"t":"mine now"}');
    await p.save(map);
    expect(keyedStrategy('mine').open(adapter.stored.get('c'))).toBe('{"t":"mine now"}');
    map.delete('c');
    await p.save(map);
    expect(adapter.stored.has('c')).toBe(false);   // removed by the caller: the old bytes do not come back
  });

  it('composes with the sealed-row memory: unchanged rows are not resealed, a removed and re-added key is sealed fresh', async () => {
    let seals = 0;
    const base = keyedStrategy('mine');
    const strategy = { seal: (t) => { seals += 1; return base.seal(t); }, open: base.open };
    const adapter = memoryAdapter(stored());
    const p = sealedPersist(adapter, strategy, () => {});
    const map = await p.load();
    await p.save(map);
    expect(seals).toBe(0);
    map.delete('b'); await p.save(map);
    map.set('b', '{"t":"B"}'); await p.save(map);
    expect(seals).toBe(1);
    expect(adapter.stored.get('c')).toBe(stored().get('c'));
  });
});
