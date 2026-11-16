/**
 * When the "+" read a day but no time, it asks for the time in the person's words: the DAY in words ("dinsdag 17 nov."),
 * never the stored form (2026-11-17). One sentence, from shared code, which both sheets show.
 */
import { it, expect } from 'vitest';
import { plusAskTime, PLUS_ACTS } from '../../src/v2/vandaagPlus.js';

const appt = PLUS_ACTS.find((a) => a.id === 'calendar.calendar-event');
const t = (k, v) => `${k}|${v?.day ?? ''}`;

it('asks for the time with the day in words, in the person\'s language', () => {
  const nl = plusAskTime(appt, { when: '2026-11-17' }, { t, lang: 'nl' });
  expect(nl).toMatch(/^circle\.vandaag\.plus_which_time\|dinsdag 17 nov/);
  expect(nl).not.toContain('2026-11-17');
  expect(plusAskTime(appt, { when: '2026-11-17' }, { t, lang: 'en' })).toMatch(/Tuesday 17 Nov/);
});
it('asks nothing when a time is there, or no day', () => {
  expect(plusAskTime(appt, { when: '2026-11-17T10:00' }, { t, lang: 'nl' })).toBe(null);
  expect(plusAskTime(appt, {}, { t, lang: 'nl' })).toBe(null);
});
