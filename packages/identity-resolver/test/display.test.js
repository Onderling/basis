/**
 * display — pure-fn coverage. Mirrors the assertions
 * apps/pinboard-mobile/test/{avatar,handle}.test.js exercise through
 * the re-export shims (if/when those test files exist).
 */

import { describe, it, expect } from 'vitest';
import {
  initials,
  paletteFor,
  PALETTE,
  validateHandle,
  normaliseHandle,
  HANDLE_LIMITS,
} from '../src/display.js';

describe('@onderling/identity-resolver/display — initials', () => {
  it('returns up to two letters', () => {
    expect(initials('Anne Doe')).toBe('AD');
    expect(initials('Anne')).toBe('A');
  });
  it('falls back to · for empty input', () => {
    expect(initials('')).toBe('·');
    expect(initials('   ')).toBe('·');
    expect(initials(null)).toBe('·');
  });
});

describe('@onderling/identity-resolver/display — paletteFor', () => {
  it('returns the same colour for the same name', () => {
    expect(paletteFor('Anne')).toBe(paletteFor('Anne'));
  });
  it('returns a colour from the canonical palette', () => {
    expect(PALETTE.includes(paletteFor('Anne'))).toBe(true);
  });
  it('falls back to PALETTE[0] for empty input', () => {
    expect(paletteFor('')).toBe(PALETTE[0]);
    expect(paletteFor(null)).toBe(PALETTE[0]);
  });
});

describe('@onderling/identity-resolver/display — validateHandle', () => {
  it('accepts well-formed handles', () => {
    expect(validateHandle('frits')).toEqual({ ok: true });
    expect(validateHandle('frits-de-roos')).toEqual({ ok: true });
    expect(validateHandle('a1b')).toEqual({ ok: true });
  });
  it('rejects empty', () => {
    expect(validateHandle('')).toEqual({ ok: false, reason: 'empty' });
    expect(validateHandle(null)).toEqual({ ok: false, reason: 'empty' });
  });
  it('rejects too short / too long', () => {
    expect(validateHandle('aa')).toEqual({ ok: false, reason: 'too_short' });
    expect(validateHandle('a'.repeat(33))).toEqual({ ok: false, reason: 'too_long' });
  });
  it('rejects bad characters', () => {
    expect(validateHandle('Alice')).toEqual({ ok: false, reason: 'bad_chars' });
    expect(validateHandle('-leading')).toEqual({ ok: false, reason: 'bad_chars' });
    expect(validateHandle('trailing-')).toEqual({ ok: false, reason: 'bad_chars' });
    expect(validateHandle('has space')).toEqual({ ok: false, reason: 'bad_chars' });
  });
  it('honours custom limits + patterns', () => {
    expect(validateHandle('ab', { minLen: 2 })).toEqual({ ok: true });
    expect(validateHandle('FRITS', { pattern: /^[A-Z]+$/ })).toEqual({ ok: true });
  });
  it('exposes HANDLE_LIMITS defaults', () => {
    expect(HANDLE_LIMITS).toEqual({ minLen: 3, maxLen: 32 });
  });
});

describe('@onderling/identity-resolver/display — normaliseHandle', () => {
  it('lowercases + drops disallowed chars', () => {
    expect(normaliseHandle('Anne Doe!')).toBe('annedoe');
    expect(normaliseHandle('a-b_c')).toBe('a-b_c');
  });
  it('returns "" for non-string input', () => {
    expect(normaliseHandle(null)).toBe('');
  });
});
