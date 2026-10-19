/**
 * A type a manifest DECLARES (`nouns[noun].schema`) joins the node's registry at compose — a first-party noun under its
 * bare name, an extension's only under its own composed origin (`<origin>.<noun>`); a shadow of a type already there is
 * refused, loudly, and the extension brings none of its types. Its reminder moment is the noun's declared
 * `presents.moment` when it is scheduled (`order: 'asc'`).
 */
import { describe, it, expect } from 'vitest';
import { createRegistry, registerCanonicalTypes, registerDeclaredTypes, timeAnchorOf } from '../index.js';

const plants = {
  app: 'plants',
  nouns: {
    'plants.plant': {
      atoms: ['add', 'list', 'get', 'update', 'remove'],
      schema: { type: 'object', properties: { name: { type: 'string', minLength: 1 }, room: { type: 'string' }, waterAt: { type: 'string' } }, required: ['name'] },
      presents: { label: 'name', moment: 'waterAt', order: 'asc' },
    },
  },
};
const fresh = () => { const r = createRegistry(); registerCanonicalTypes(r); return r; };

describe('declared types', () => {
  it('an extension\'s noun is unknown until composed, then validates under its own origin', () => {
    const reg = fresh();
    expect(reg.validate({ type: 'plants.plant', name: 'Monstera' }).ok).toBe(false);
    const r = registerDeclaredTypes(reg, [{ origin: 'plants', manifest: plants }]);
    expect(r).toEqual({ registered: ['plants.plant'], refused: [] });
    expect(reg.validate({ type: 'plants.plant', name: 'Monstera', waterAt: '2026-10-20T08:00:00Z' }).ok).toBe(true);
    expect(reg.validate({ type: 'plants.plant', room: 'keuken' }).ok, 'its own schema holds: a name is required').toBe(false);
  });

  it('refused: a noun outside its composed origin, a shadow of a canonical type, a name the manifest picked for itself', () => {
    const reg = fresh();
    const outside = { app: 'plants', nouns: { note: { schema: { type: 'object' } } } };
    expect(registerDeclaredTypes(reg, [{ origin: 'plants', manifest: outside }]).refused).toEqual([{ origin: 'plants', noun: 'note', reason: 'not-in-origin' }]);
    // the origin is the catalogue's reading, not the manifest's own `app` — an extension calling itself household gets nothing
    const claims = { app: 'household', nouns: { 'household.chore': { schema: { type: 'object' } } } };
    expect(registerDeclaredTypes(reg, [{ origin: 'plants', manifest: claims }]).refused[0]).toMatchObject({ reason: 'not-in-origin' });
    // all or nothing: one bad noun and the extension brings none
    const mixed = { app: 'plants', nouns: { 'plants.plant': plants.nouns['plants.plant'], task: { schema: { type: 'object' } } } };
    const r = registerDeclaredTypes(reg, [{ origin: 'plants', manifest: mixed }]);
    expect(r.registered).toEqual([]);
    expect(reg.validate({ type: 'plants.plant', name: 'x' }).ok).toBe(false);
    // a first-party shadow of a canonical type is refused too
    expect(registerDeclaredTypes(reg, [{ origin: 'calendar', firstParty: true, manifest: { nouns: { task: { schema: { type: 'object' } } } } }]).refused[0]).toMatchObject({ reason: 'already-registered' });
  });

  it('the reminder moment: the frozen table first, else a scheduled noun\'s declared moment; unscheduled → none', () => {
    expect(timeAnchorOf('task')).toBe('dueAt');
    expect(timeAnchorOf('plants.plant')).toBe(null);
    expect(timeAnchorOf('plants.plant', { manifests: [plants] })).toBe('waterAt');
    const unscheduled = { nouns: { 'plants.plant': { presents: { moment: 'waterAt', order: 'desc' } } } };
    expect(timeAnchorOf('plants.plant', { manifests: [unscheduled] })).toBe(null);
  });
});
