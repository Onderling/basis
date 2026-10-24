/**
 * The person's drivers in three sections (Offerings · Interests · Goals) — one projection both shells paint, and the
 * write arguments every add / edit / remove sends, so neither shell derives a key or a kind.
 */
import { describe, it, expect } from 'vitest';
import { driverSections, driverWriteArgs, interestTagsAfter, DRIVER_SECTION_IDS } from '../../src/v2/driversSection.js';

const drivers = [
  { key: 'fietsen maken', kind: 'offering', text: 'fietsen maken', tags: ['fiets'] },
  { key: 'interests', kind: 'interest', text: '', tags: ['tuinieren', 'koken'] },
  { key: 'goal:leren zeilen', kind: 'goal', text: 'leren zeilen', tags: ['zeilen'] },
  { key: 'oud', kind: 'hobby', text: 'iets anders', tags: [] },
];

describe('driverSections', () => {
  it('three sections in order; each driver in its kind\'s section; other kinds stay out', () => {
    const s = driverSections(drivers);
    expect(s.map((x) => x.id)).toEqual(DRIVER_SECTION_IDS);
    expect(DRIVER_SECTION_IDS).toEqual(['offerings', 'interests', 'goals']);
    expect(s[0].rows.map((r) => r.key)).toEqual(['fietsen maken']);
    expect(s[1].tags).toEqual(['tuinieren', 'koken']);
    expect(s[1].key).toBe('interests');
    expect(s[2].rows.map((r) => r.key)).toEqual(['goal:leren zeilen']);
    expect(s.every((x) => typeof x.labelKey === 'string')).toBe(true);
  });

  it('an empty profile still has its three sections (each offers its add)', () => {
    const s = driverSections([]);
    expect(s.map((x) => [x.id, (x.rows ?? x.tags).length])).toEqual([['offerings', 0], ['interests', 0], ['goals', 0]]);
  });
});

describe('driverWriteArgs', () => {
  it('an offering is keyed by its phrase; a goal by its phrase under goal: — the same words never collide', () => {
    expect(driverWriteArgs('offerings', { text: 'Leren zeilen', tags: 'water' })).toEqual({ key: 'leren zeilen', kind: 'offering', text: 'Leren zeilen', tags: 'water' });
    expect(driverWriteArgs('goals', { text: 'Leren zeilen', tags: 'water' })).toEqual({ key: 'goal:leren zeilen', kind: 'goal', text: 'Leren zeilen', tags: 'water' });
  });
  it('interests are the one interests driver: its tags', () => {
    expect(driverWriteArgs('interests', { tags: ['tuinieren', 'koken'] })).toEqual({ key: 'interests', kind: 'interest', text: '', tags: 'tuinieren,koken' });
  });
  it('nothing to write → null', () => {
    expect(driverWriteArgs('goals', { text: '  ', tags: '' })).toBeNull();
    expect(driverWriteArgs('nope', { text: 'x' })).toBeNull();
  });
});

describe('interestTagsAfter', () => {
  it('adds a tag once, removes one, normalises case and spaces', () => {
    expect(interestTagsAfter(['koken'], { add: ' Tuinieren ' })).toEqual(['koken', 'tuinieren']);
    expect(interestTagsAfter(['koken', 'tuinieren'], { add: 'koken' })).toEqual(['koken', 'tuinieren']);
    expect(interestTagsAfter(['koken', 'tuinieren'], { remove: 'koken' })).toEqual(['tuinieren']);
  });
});
