/**
 * slashFilter — unit tests for the pure slash-suggest filter
 * (2026-05-24).
 *
 * Mirrors the suggest semantics from
 * apps/basis/web/main.js's `refreshSuggest`.
 */
import { describe, it, expect } from 'vitest';
import { filterSlashSuggestions, DEFAULT_SUGGEST_LIMIT } from '../src/core/slashFilter.js';

/** A tiny fake catalogue with enough variety for the matchers below. */
function makeCatalogue(commands) {
  return { commandMenu: commands.map((c) => ({ command: c, appOrigin: 'x', opId: c.slice(1) })) };
}

describe('filterSlashSuggestions', () => {
  it('returns [] when input is empty', () => {
    const catalogue = makeCatalogue(['/post', '/help-with', '/dm']);
    expect(filterSlashSuggestions({ input: '', catalogue })).toEqual([]);
  });

  it('returns [] when input has no leading /', () => {
    const catalogue = makeCatalogue(['/post', '/help-with', '/dm']);
    expect(filterSlashSuggestions({ input: 'post', catalogue })).toEqual([]);
    expect(filterSlashSuggestions({ input: 'hello', catalogue })).toEqual([]);
  });

  it('returns [] in args mode (after a space)', () => {
    const catalogue = makeCatalogue(['/post', '/help-with', '/dm']);
    expect(filterSlashSuggestions({ input: '/post ', catalogue })).toEqual([]);
    expect(filterSlashSuggestions({ input: '/post hello', catalogue })).toEqual([]);
  });

  it('prefix-matches a typed slash', () => {
    const catalogue = makeCatalogue(['/post', '/help-with', '/dm', '/done']);
    const r = filterSlashSuggestions({ input: '/p', catalogue });
    expect(r.map((m) => m.command)).toEqual(['/post']);
  });

  it('lists all matches when input is just /', () => {
    const catalogue = makeCatalogue(['/post', '/help-with', '/dm']);
    const r = filterSlashSuggestions({ input: '/', catalogue });
    expect(r.map((m) => m.command)).toEqual(['/post', '/help-with', '/dm']);
  });

  it('is case-insensitive', () => {
    const catalogue = makeCatalogue(['/Post', '/PaSt']);
    const r = filterSlashSuggestions({ input: '/p', catalogue });
    expect(r).toHaveLength(2);
  });

  it('caps at the default limit', () => {
    const cmds = Array.from({ length: 30 }, (_, i) => `/cmd-${i}`);
    const catalogue = makeCatalogue(cmds);
    const r = filterSlashSuggestions({ input: '/', catalogue });
    expect(r).toHaveLength(DEFAULT_SUGGEST_LIMIT);
  });

  it('honours an explicit limit', () => {
    const cmds = Array.from({ length: 30 }, (_, i) => `/cmd-${i}`);
    const catalogue = makeCatalogue(cmds);
    expect(filterSlashSuggestions({ input: '/', catalogue, limit: 5 })).toHaveLength(5);
    expect(filterSlashSuggestions({ input: '/', catalogue, limit: 100 })).toHaveLength(30);
  });

  it('skips malformed commandMenu entries', () => {
    const catalogue = { commandMenu: [
      { command: '/ok' },
      { command: 42 },
      null,
      { command: null },
    ] };
    const r = filterSlashSuggestions({ input: '/', catalogue });
    expect(r).toHaveLength(1);
    expect(r[0].command).toBe('/ok');
  });

  it('handles missing catalogue/commandMenu gracefully', () => {
    expect(filterSlashSuggestions({ input: '/', catalogue: {} })).toEqual([]);
    expect(filterSlashSuggestions({ input: '/', catalogue: null })).toEqual([]);
  });
});
