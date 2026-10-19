/**
 * A VANDAAG ROW'S ONE ACTION — declared by the noun's manifest (`presents.primary`), never known by basis by name:
 * a chore → done (the op that completes it, through the waist), an own note/appointment → open the "+" sheet on it,
 * a circle's row → open its circle. A row already done has no action; a noun that declares none has none.
 */
import { describe, it, expect } from 'vitest';
import { primaryActionFor } from '../../src/v2/rowPrimary.js';
import { OWN_DEVICES_SCOPE } from '../../src/v2/grantsManifest.js';

const manifests = [
  { app: 'tasks', operations: [{ id: 'completeTask', verb: 'complete', appliesTo: { type: 'task' }, params: [{ name: 'id', kind: 'string', required: true }] }],
    nouns: { task: { atoms: ['complete'], presents: { label: 'title', done: { field: 'completedAt' }, primary: 'complete' } } } },
  { app: 'household', operations: [], nouns: { note: { atoms: ['add', 'update'], presents: { label: 'text', primary: 'edit' } } } },
  { app: 'calendar', operations: [], nouns: { 'calendar-event': { atoms: ['add'], presents: { label: 'title', primary: 'open' } } } },
  { app: 'x', operations: [], nouns: { thing: { atoms: [], presents: { label: 'title' } } } },
];

describe('primaryActionFor', () => {
  it('a chore: done — the op that completes it, with the row and its circle', () => {
    const a = primaryActionFor({ id: 't1', circleId: 'kring' }, 'task', { manifests });
    expect(a).toEqual({ kind: 'op', app: 'tasks', opId: 'completeTask', args: { id: 't1', circleId: 'kring' }, labelKey: 'circle.vandaag.act_done' });
    expect(primaryActionFor({ id: 't2', circleId: 'kring', completedAt: 5 }, 'task', { manifests }), 'done already: nothing to do').toBe(null);
    expect(primaryActionFor({ id: 't3', own: true }, 'task', { manifests }).args.circleId).toBe(OWN_DEVICES_SCOPE);
  });
  it('an own note: the "+" sheet on it; a circle\'s note: its circle', () => {
    expect(primaryActionFor({ id: 'n1', own: true }, 'note', { manifests })).toMatchObject({ kind: 'edit-own', labelKey: 'circle.vandaag.act_edit' });
    expect(primaryActionFor({ id: 'n2', circleId: 'kring' }, 'note', { manifests })).toMatchObject({ kind: 'open-circle', circleId: 'kring', labelKey: 'circle.vandaag.act_open' });
  });
  it('open: a circle\'s row opens its circle; an own one opens the sheet', () => {
    expect(primaryActionFor({ id: 'e1', circleId: 'kring' }, 'calendar-event', { manifests })).toMatchObject({ kind: 'open-circle', circleId: 'kring' });
    expect(primaryActionFor({ id: 'e2', own: true }, 'calendar-event', { manifests })).toMatchObject({ kind: 'edit-own' });
  });
  it('a noun that declares no primary action has none', () => {
    expect(primaryActionFor({ id: 'x1', circleId: 'kring' }, 'thing', { manifests })).toBe(null);
  });
});
