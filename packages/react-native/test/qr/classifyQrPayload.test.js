/**
 * classifyQrPayload — substrate-level coverage. The plug-in
 * dispatcher logic only; per-app classifier shapes are exercised
 * by each consumer's own tests (Pinboard's invite/contact/recovery
 * stays in apps/pinboard-mobile/test/qrScanner.test.js).
 */

import { describe, it, expect } from 'vitest';
import { classifyQrPayload } from '../../src/qr/classifyQrPayload.js';

describe('@onderling/react-native/qr classifyQrPayload — input handling', () => {
  it('returns {kind:"unknown"} for empty input', () => {
    expect(classifyQrPayload('')).toEqual({ kind: 'unknown' });
    expect(classifyQrPayload(null)).toEqual({ kind: 'unknown' });
    expect(classifyQrPayload('hi', 'not-an-array')).toEqual({ kind: 'unknown' });
  });

  it('returns {kind:"unknown"} when no classifier matches', () => {
    const cs = [{ kind: 'foo', classify: () => null }];
    expect(classifyQrPayload('bar', cs)).toEqual({ kind: 'unknown' });
  });
});

describe('@onderling/react-native/qr classifyQrPayload — dispatch', () => {
  it('returns the first matching classifier\'s output', () => {
    const cs = [
      { kind: 'first',  classify: (t) => t.startsWith('a') ? { match: 'a' } : null },
      { kind: 'second', classify: (t) => t.startsWith('a') ? { match: 'a-too' } : null },
    ];
    expect(classifyQrPayload('apple', cs)).toEqual({ kind: 'first', payload: { match: 'a' } });
  });

  it('falls through past null/undefined returns', () => {
    const cs = [
      { kind: 'a', classify: () => null },
      { kind: 'b', classify: () => undefined },
      { kind: 'c', classify: () => 'hit' },
    ];
    expect(classifyQrPayload('x', cs)).toEqual({ kind: 'c', payload: 'hit' });
  });

  it('swallows classifier exceptions and tries the next', () => {
    const cs = [
      { kind: 'a', classify: () => { throw new Error('boom'); } },
      { kind: 'b', classify: () => 'hit' },
    ];
    expect(classifyQrPayload('x', cs)).toEqual({ kind: 'b', payload: 'hit' });
  });

  it('skips malformed classifier entries', () => {
    const cs = [
      null,
      undefined,
      { kind: 'no-classify' },
      { classify: () => 'hit' },
      { kind: 'good', classify: () => 'win' },
    ];
    expect(classifyQrPayload('x', cs)).toEqual({ kind: 'good', payload: 'win' });
  });

  it('trims whitespace before passing to classifiers', () => {
    const cs = [{ kind: 'lit', classify: (t) => t === 'apple' ? 'ok' : null }];
    expect(classifyQrPayload('  apple  ', cs)).toEqual({ kind: 'lit', payload: 'ok' });
  });
});
