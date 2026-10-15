/**
 * Vandaag's "+": an own note or an own appointment — into the person's own store (the own-devices scope), never a
 * circle. One shared model both shells paint: the two acts, their fields, and the op each compiles to.
 */
import { describe, it, expect } from 'vitest';
import { decodeGenericOpId } from '@onderling/app-manifest';
import { PLUS_ACTS, plusOp, plusFollowUp } from '../../src/v2/vandaagPlus.js';
import { OWN_DEVICES_SCOPE } from '../../src/v2/grantsManifest.js';

describe('Vandaag — the "+"', () => {
  it('offers two acts, each with its fields', () => {
    expect(PLUS_ACTS.map((a) => a.id)).toEqual(['own-note', 'own-appointment']);
    expect(PLUS_ACTS[1].fields.map((f) => f.name)).toEqual(['title', 'when']);
  });

  it('an own note compiles to the generic note add on the own scope', () => {
    const op = plusOp('own-note', { body: '  sleutel bij de buren ' });
    expect(op.app).toBe('household');
    expect(decodeGenericOpId(op.opId)).toMatchObject({ app: 'household', atom: 'add', noun: 'note' });
    expect(op.args).toEqual({ circleId: OWN_DEVICES_SCOPE, body: 'sleutel bij de buren' });
  });

  it('an own appointment compiles to addEvent with no circle, its moment as an ISO time', () => {
    const op = plusOp('own-appointment', { title: 'tandarts', when: '2026-10-20T14:00' });
    expect(op).toMatchObject({ app: 'calendar', opId: 'addEvent' });
    expect(op.args.title).toBe('tandarts');
    expect(op.args.circleId).toBeUndefined();
    expect(new Date(op.args.when).getTime()).toBe(new Date('2026-10-20T14:00').getTime());
  });

  it('a moment in words is read by the one bounded reader — and one it cannot read is said, not guessed', () => {
    const op = plusOp('own-appointment', { title: 'tandarts', when: 'morgen om 14:00' });
    const d = new Date(op.args.when);
    const tomorrow = new Date(Date.now() + 86_400_000);
    expect([d.getDate(), d.getHours(), d.getMinutes()]).toEqual([tomorrow.getDate(), 14, 0]);
    expect(plusOp('own-appointment', { title: 'x', when: 'ooit eens' })).toEqual({ error: 'circle.vandaag.plus_when_unread' });
  });

  it('an empty field is refused before any op', () => {
    expect(plusOp('own-note', { body: '  ' })).toEqual({ error: 'circle.vandaag.plus_empty' });
    expect(plusOp('own-appointment', { title: 'x', when: '' })).toEqual({ error: 'circle.vandaag.plus_empty' });
    expect(plusOp('nope', {})).toEqual({ error: 'circle.vandaag.plus_empty' });
  });
});

describe('Vandaag — where an own item shows', () => {
  const page = (blocks) => ({ screens: [{ id: 'p1', name: 'Vandaag', blocks }], activeId: 'p1' });
  it('a page without a notes block gets one, through the screen op, after an own note', () => {
    expect(plusFollowUp(page([{ id: 'b', type: 'calendar', config: {} }]), 'own-note'))
      .toEqual({ opId: 'screen-add-block', args: { pageId: 'p1', type: 'notes', config: { limit: 5 } } });
  });
  it('a page that already shows the type needs nothing', () => {
    expect(plusFollowUp(page([{ id: 'b', type: 'notes', config: {} }]), 'own-note')).toBe(null);
    expect(plusFollowUp(page([{ id: 'b', type: 'calendar', config: {} }]), 'own-appointment')).toBe(null);
  });
});
