/**
 * A moment that is coming, in a person's words: "vandaag om 14:00" / "morgen om 09:30" within two days, the date
 * after that (whenWords), and "gesloten" once past — for a vote's deadline on both shells.
 */
import { describe, it, expect } from 'vitest';
import { momentWords } from '../../src/v2/whenWords.js';
import { deadlineLine } from '../../src/v2/governanceView.js';

const t = (k, p) => (p ? `${k}|${JSON.stringify(p)}` : k);
const now = new Date('2026-10-20T10:00:00');

describe('momentWords', () => {
  it('today and tomorrow say so, with the time', () => {
    expect(momentWords(new Date('2026-10-20T14:00:00'), { t, now })).toBe('circle.when.today_at|{"time":"14:00"}');
    expect(momentWords(new Date('2026-10-21T09:30:00'), { t, now })).toBe('circle.when.tomorrow_at|{"time":"09:30"}');
  });
  it('later than tomorrow is the date (the one whenWords line)', () => {
    expect(momentWords(new Date('2026-10-24T09:00:00'), { t, now, locale: 'nl-NL' })).toMatch(/^za 24 okt\.? 09:00$/);
  });
  it('past is closed; nothing is nothing', () => {
    expect(momentWords(new Date('2026-10-20T09:59:00'), { t, now })).toBe('circle.when.closed');
    expect(momentWords(null, { t, now })).toBe('');
  });
});

describe('deadlineLine', () => {
  it('closes at a moment, closed once past, nothing without one', () => {
    expect(deadlineLine(new Date('2026-10-21T09:30:00'), { t, now })).toBe('circle.governance.deadline|{"when":"circle.when.tomorrow_at|{\\"time\\":\\"09:30\\"}"}');
    expect(deadlineLine(new Date('2026-10-19T09:00:00'), { t, now })).toBe('circle.when.closed');
    expect(deadlineLine(null, { t, now })).toBe('');
  });
});
