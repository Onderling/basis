/**
 * The bounded date reader (Fable, 2026-10-01): a day word — vandaag, morgen, overmorgen, a weekday as its next
 * occurrence, "volgende week <weekday>", and the English twins — plus an optional time ("om 10 uur", "om half 3",
 * "14:30", "at 3pm"). Anything else is not read (the model's, or "zeg de dag en de tijd"). On the household's own
 * clock (the box runs in its zone): never a UTC day.
 */
import { describe, it, expect } from 'vitest';
import { readDayAndTime } from '../src/forms/parseDate.js';

// Thursday 1 October 2026, 11:00 local
const now = () => new Date(2026, 9, 1, 11, 0);
const read = (s) => readDayAndTime(s, { now });

describe('readDayAndTime', () => {
  it('the day words', () => {
    expect(read('tandarts morgen')).toMatchObject({ day: '2026-10-02', time: null, rest: 'tandarts' });
    expect(read('vandaag')).toMatchObject({ day: '2026-10-01' });
    expect(read('overmorgen')).toMatchObject({ day: '2026-10-03' });
    expect(read('maandag')).toMatchObject({ day: '2026-10-05' });
    expect(read('donderdag')).toMatchObject({ day: '2026-10-01' });   // today is its own next occurrence
    expect(read('volgende week dinsdag')).toMatchObject({ day: '2026-10-06' });
    expect(read('tomorrow')).toMatchObject({ day: '2026-10-02' });
    expect(read('next week friday')).toMatchObject({ day: '2026-10-09' });
  });

  it('the times', () => {
    expect(read('tandarts morgen om 10 uur')).toEqual({ day: '2026-10-02', time: '10:00', rest: 'tandarts' });
    expect(read('kapper vrijdag om half 3')).toMatchObject({ day: '2026-10-02', time: '14:30', rest: 'kapper' });
    expect(read('overleg maandag 14:30')).toMatchObject({ day: '2026-10-05', time: '14:30', rest: 'overleg' });
    expect(read('dentist tomorrow at 3pm')).toMatchObject({ day: '2026-10-02', time: '15:00', rest: 'dentist' });
    expect(read('dentist tomorrow at 10am')).toMatchObject({ time: '10:00' });
    expect(read('ophalen morgen om 8 uur')).toMatchObject({ time: '08:00' });
  });

  it('anything else is not read', () => {
    expect(read('tandarts')).toBeNull();
    expect(read('volgende maand')).toBeNull();
    expect(read('15 oktober')).toBeNull();
    expect(read('morgenochtend')).toBeNull();
    expect(read('tandarts morgen om 25 uur')).toBeNull();
  });

  // the times people say in words (Fable's walk 2026-11-17: "ik moet vrijdag om half drie naar de tandarts" lost the time)
  it('the hour in words, half, quarter past and to, in both languages', () => {
    expect(read('vrijdag om half drie naar de tandarts')).toMatchObject({ day: '2026-10-02', time: '14:30', rest: 'naar de tandarts' });
    expect(read('vrijdag half 3 tandarts')).toMatchObject({ time: '14:30', rest: 'tandarts' });
    expect(read('morgen om drie uur kapper')).toMatchObject({ time: '15:00', rest: 'kapper' });
    expect(read('morgen om tien uur kapper')).toMatchObject({ time: '10:00', rest: 'kapper' });
    expect(read('morgen kwart over drie kapper')).toMatchObject({ time: '15:15', rest: 'kapper' });
    expect(read('morgen kwart voor elf kapper')).toMatchObject({ time: '10:45', rest: 'kapper' });
    expect(read('friday at half past two dentist')).toMatchObject({ time: '14:30', rest: 'dentist' });
    expect(read('tomorrow at quarter to ten dentist')).toMatchObject({ time: '09:45', rest: 'dentist' });
    expect(read('tomorrow at three dentist')).toMatchObject({ time: '15:00', rest: 'dentist' });
    // a number word that is no time stays in the title
    expect(read('morgen drie broden halen')).toMatchObject({ time: null, rest: 'drie broden halen' });
  });
});
