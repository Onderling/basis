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
  it('three sections in order; each driver in its kind\'s section; other personal kinds show under Goals', () => {
    const s = driverSections(drivers);
    expect(s.map((x) => x.id)).toEqual(DRIVER_SECTION_IDS);
    expect(DRIVER_SECTION_IDS).toEqual(['offerings', 'interests', 'goals']);
    expect(s[0].rows.map((r) => r.key)).toEqual(['fietsen maken']);
    expect(s[1].tags).toEqual(['tuinieren', 'koken']);
    expect(s[1].key).toBe('interests');
    expect(s[2].rows.map((r) => r.key)).toEqual(['goal:leren zeilen', 'oud']);
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

describe('saveDriver / removeDriver — the one write path both shells call', async () => {
  const { saveDriver, removeDriver } = await import('../../src/v2/driversSection.js');
  const calls = [];
  const callSkill = async (app, op, args) => { calls.push([app, op, args]); return { ok: true }; };

  it('a goal → setProfileDriver with the projection\'s key and kind, on the persona', async () => {
    calls.length = 0;
    expect(await saveDriver({ callSkill, personaId: 'default', section: 'goals', input: { text: 'Leren zeilen', tags: 'water' } })).toEqual({ ok: true });
    expect(calls).toEqual([['agents', 'setProfileDriver', { id: 'default', key: 'goal:leren zeilen', kind: 'goal', text: 'Leren zeilen', tags: 'water' }]]);
  });
  it('interests with no tags left → the interests driver is removed, not written empty', async () => {
    calls.length = 0;
    await saveDriver({ callSkill, personaId: 'default', section: 'interests', input: { tags: [] } });
    expect(calls).toEqual([['agents', 'removeProfileDriver', { id: 'default', key: 'interests' }]]);
  });
  it('nothing to write → no call', async () => {
    calls.length = 0;
    expect(await saveDriver({ callSkill, personaId: 'default', section: 'goals', input: { text: ' ' } })).toEqual({ ok: false, reason: 'empty' });
    expect(calls).toEqual([]);
  });
  it('remove → removeProfileDriver by key', async () => {
    calls.length = 0;
    await removeDriver({ callSkill, personaId: 'p-1', key: 'goal:leren zeilen' });
    expect(calls).toEqual([['agents', 'removeProfileDriver', { id: 'p-1', key: 'goal:leren zeilen' }]]);
  });
});
