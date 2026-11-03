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
  it('bounded: the least recently used goes first', () => {
    const real = counting(() => true);
    const memo = createSignatureMemo({ max: 2, verify: real.verify });
    memo.verify('a', 's', 'k'); memo.verify('b', 's', 'k');
    memo.verify('a', 's', 'k');            // a is now the most recent
    memo.verify('c', 's', 'k');            // evicts b
    expect(memo.size).toBe(2);
    real.calls.length = 0;
    memo.verify('a', 's', 'k'); expect(real.calls).toHaveLength(0);
    memo.verify('b', 's', 'k'); expect(real.calls).toHaveLength(1);
  });
});
