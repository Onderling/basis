/**
 * The signature memo keeps ONLY a passed check, keyed by the exact signed bytes: a repeat is free, a changed byte is
 * verified afresh, a failure is never remembered, and it stays bounded.
 */
import { describe, it, expect } from 'vitest';
import { createSignatureMemo } from '../src/security/signatureMemo.js';

const counting = (answer) => { const calls = []; return { calls, verify: (m, s, k) => { calls.push([m, s, k]); return answer(m, s, k); } }; };

describe('createSignatureMemo', () => {
  it('a passed check is remembered for exactly those bytes, signature and key', () => {
    const real = counting(() => true);
    const memo = createSignatureMemo({ verify: real.verify });
    for (let i = 0; i < 5; i++) expect(memo.verify('msg', 'sig', 'key')).toBe(true);
    expect(real.calls).toHaveLength(1);
    // one byte different anywhere: a different key, checked afresh
    memo.verify('msg!', 'sig', 'key'); memo.verify('msg', 'sig!', 'key'); memo.verify('msg', 'sig', 'key!');
    expect(real.calls).toHaveLength(4);
  });
  it('a failed check is never remembered', () => {
    const real = counting(() => false);
    const memo = createSignatureMemo({ verify: real.verify });
    for (let i = 0; i < 3; i++) expect(memo.verify('msg', 'sig', 'key')).toBe(false);
    expect(real.calls).toHaveLength(3);
    expect(memo.size).toBe(0);
  });
  it('bounded by BYTES: the least recently used goes first', () => {
    const real = counting(() => true);
    const one = createSignatureMemo({ verify: real.verify }); one.verify('a', 's', 'k');
    const memo = createSignatureMemo({ maxBytes: one.bytes * 2, verify: real.verify });
    memo.verify('a', 's', 'k'); memo.verify('b', 's', 'k');
    memo.verify('a', 's', 'k');            // a is now the most recent
    memo.verify('c', 's', 'k');            // evicts b
    expect(memo.size).toBe(2);
    real.calls.length = 0;
    memo.verify('a', 's', 'k'); expect(real.calls).toHaveLength(0);
    memo.verify('b', 's', 'k'); expect(real.calls).toHaveLength(1);
  });

  it('the bound holds a second read of 9,000 statements with no check (the default, real-sized entries)', () => {
    const real = counting(() => true);
    const memo = createSignatureMemo({ verify: real.verify });
    const key = 'K'.repeat(43); const sig = (i) => `${i}`.padStart(86, 'S');
    const msg = (i) => `{"body":${i}}`.padEnd(2000, ' ');   // a real stored statement is ~2 KB
    for (let i = 0; i < 9000; i++) memo.verify(msg(i), sig(i), key);
    real.calls.length = 0;
    for (let i = 0; i < 9000; i++) memo.verify(msg(i), sig(i), key);
    expect(real.calls, 'the second read checked again').toHaveLength(0);
  });

  it('the message part of the key is its digest: an entry costs the same for a 2 KB statement as for a short one', () => {
    const a = createSignatureMemo({ verify: () => true }); a.verify('x', 's', 'k');
    const b = createSignatureMemo({ verify: () => true }); b.verify('x'.repeat(4000), 's', 'k');
    expect(b.bytes).toBe(a.bytes);
  });

  it('the key names the VERIFIER: a circle-link "true" is not a plain-signature "true" over the same bytes', () => {
    const real = counting(() => true);
    const memo = createSignatureMemo({ verify: real.verify });
    const link = memo.verifierFor('circle-link');
    expect(link('m', 's', 'k')).toBe(true);
    expect(memo.verify('m', 's', 'k')).toBe(true);
    expect(real.calls, 'the plain check reused the link verdict').toHaveLength(2);
    expect(link('m', 's', 'k')).toBe(true);
    expect(real.calls).toHaveLength(2);
  });

  it('nothing but a passed real check writes the memo (the API has no setter)', () => {
    const memo = createSignatureMemo({ verify: () => false });
    expect(Object.keys(memo).sort()).toEqual(['bytes', 'size', 'verifierFor', 'verify']);
    memo.verify('m', 's', 'k');
    expect(memo.size).toBe(0);
  });
});
