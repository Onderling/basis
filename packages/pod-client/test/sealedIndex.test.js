import { describe, it, expect } from 'vitest';
import {
  createSealedIndex, upsertEntry, removeEntry, getEntry, decodePseudonym,
  queryIndex, semanticQuery, serializeIndex, parseIndex, shardKeyFor,
} from '../src/sealing/sealedIndex.js';
import { generateGroupKey, sealWithGroupKey, openWithGroupKey, isSealed } from '../src/sealing/index.js';

function sample() {
  let ix = createSealedIndex();
  ix = upsertEntry(ix, { id: '01A', type: 'task', ts: 100, tags: ['kitchen'], text: 'wash the dishes', meaning: 'wash the dishes' });
  ix = upsertEntry(ix, { id: '01B', type: 'task', ts: 300, tags: ['errand'], text: 'take out the bins' });
  ix = upsertEntry(ix, { id: '01C', type: 'note', ts: 200, tags: ['kitchen'], text: 'buy more soap' });
  return ix;
}

describe('sealedIndex — entries', () => {
  it('upsert is immutable + replaces by id; remove + getEntry work', () => {
    const a = createSealedIndex();
    const b = upsertEntry(a, { id: 'x', type: 'task', text: 'first' });
    expect(a.entries).toEqual({});                       // original untouched
    expect(getEntry(b, 'x').text).toBe('first');
    const c = upsertEntry(b, { id: 'x', type: 'task', text: 'second' });
    expect(getEntry(c, 'x').text).toBe('second');        // replaced
    expect(getEntry(removeEntry(c, 'x'), 'x')).toBeNull();
  });
  it('upsert keeps only known fields + requires an id', () => {
    const e = getEntry(upsertEntry(createSealedIndex(), { id: 'y', type: 'task', secret: 'leak', ts: 5 }), 'y');
    expect(e).toEqual({ id: 'y', type: 'task', ts: 5 });
    expect(() => upsertEntry(createSealedIndex(), { type: 'task' })).toThrow(/id required/);
  });
});

describe('sealedIndex — lexical query', () => {
  it('filters by type / tag / text and sorts newest first', () => {
    const ix = sample();
    expect(queryIndex(ix, { type: 'task' }).map((e) => e.id)).toEqual(['01B', '01A']);   // ts desc
    expect(queryIndex(ix, { tag: 'kitchen' }).map((e) => e.id)).toEqual(['01C', '01A']);
    expect(queryIndex(ix, { text: 'dishes' }).map((e) => e.id)).toEqual(['01A']);
    expect(queryIndex(ix, { limit: 1 }).map((e) => e.id)).toEqual(['01B']);               // newest overall
  });
  it('decodes pseudonym → meaning', () => {
    const ix = sample();
    expect(decodePseudonym(ix, '01A')).toBe('wash the dishes');
    expect(decodePseudonym(ix, '01B')).toBeNull();        // no meaning stored
  });
});

describe('sealedIndex — semantic (RAG) query', () => {
  it('ranks entries by cosine similarity to the query vector', () => {
    let ix = createSealedIndex();
    ix = upsertEntry(ix, { id: 'p', meaning: 'parallel', vector: [1, 0] });
    ix = upsertEntry(ix, { id: 'q', meaning: 'orthogonal', vector: [0, 1] });
    ix = upsertEntry(ix, { id: 'r', meaning: 'diagonal', vector: [1, 1] });
    ix = upsertEntry(ix, { id: 'n', meaning: 'no-vector' });           // skipped (no vector)
    const ranked = semanticQuery(ix, [1, 0], { limit: 2 });
    expect(ranked.map((s) => s.entry.id)).toEqual(['p', 'r']);
    expect(ranked[0].score).toBeCloseTo(1, 5);
  });
  it('returns [] for an empty query vector', () => {
    expect(semanticQuery(sample(), [])).toEqual([]);
  });
});

describe('sealedIndex — sharding', () => {
  it('shardKeyFor is stable + in range + distributes', () => {
    expect(shardKeyFor('01A', 4)).toBe(shardKeyFor('01A', 4));
    const buckets = new Set();
    for (let i = 0; i < 50; i++) { const b = shardKeyFor('id-' + i, 4); expect(b).toBeGreaterThanOrEqual(0); expect(b).toBeLessThan(4); buckets.add(b); }
    expect(buckets.size).toBeGreaterThan(1);              // not all in one bucket
  });
});

describe('sealedIndex — stored sealed (the P2 flow)', () => {
  it('serialize → seal → open → parse → query round-trips; the host blob is ciphertext', () => {
    const ix = sample();
    const gk = generateGroupKey();
    const blob = sealWithGroupKey(serializeIndex(ix), gk);   // what lands on the pod
    expect(isSealed(blob)).toBe(true);
    expect(blob).not.toContain('dishes');                    // host can't read the index
    const reopened = parseIndex(openWithGroupKey(blob, gk)); // client decrypts the one blob, queries in memory
    expect(queryIndex(reopened, { text: 'dishes' }).map((e) => e.id)).toEqual(['01A']);
  });
  it('parseIndex tolerates empty / garbled bodies', () => {
    expect(parseIndex('').entries).toEqual({});
    expect(parseIndex('not json').entries).toEqual({});
  });
});
