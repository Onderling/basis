import { describe, it, expect } from 'vitest';
import { lastUpdated, architectureDateProblems } from './lint-architecture-date.mjs';

const doc = (d, body = 'body') => `# Architecture\n\n> **Last updated: ${d}** — note\n\n${body}\n`;

describe('lint-architecture-date', () => {
  it('reads the date, and refuses a line that is missing or not a real date', () => {
    expect(lastUpdated(doc('2026-11-12'))).toBe('2026-11-12');
    expect(lastUpdated('# Architecture\n')).toBeNull();
    expect(lastUpdated(doc('2026-02-30'))).toBeNull();
  });
  it('is quiet when the file is unchanged, or changed with a later date', () => {
    expect(architectureDateProblems(doc('2026-11-12'), doc('2026-11-12'), '2026-11-12')).toEqual([]);
    expect(architectureDateProblems(doc('2026-11-12', 'new'), doc('2026-11-05', 'old'), '2026-11-12')).toEqual([]);
  });
  it('is red when the file changed and the date did not move', () => {
    expect(architectureDateProblems(doc('2026-11-05', 'new'), doc('2026-11-05', 'old'), '2026-11-12').join('\n')).toMatch(/did not move/);
  });
  it('is red without the line, and for a date in the future', () => {
    expect(architectureDateProblems('# Architecture\n', null, '2026-11-12').join('\n')).toMatch(/no valid/);
    expect(architectureDateProblems(doc('2026-12-01'), null, '2026-11-12').join('\n')).toMatch(/future/);
  });
  it('skips the "moved" check when there is no base to compare with', () => {
    expect(architectureDateProblems(doc('2026-11-05', 'new'), null, '2026-11-12')).toEqual([]);
  });
});
