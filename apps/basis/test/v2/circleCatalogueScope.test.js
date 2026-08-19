import { describe, it, expect } from 'vitest';
import { scopeCatalogueToApps } from '../../src/v2/circleCatalogueScope.js';
import { buildToolDescriptors } from '../../src/v2/interpretCommand.js';

function makeCatalogue() {
  const ch = { chat: { hint: 'x' } };                       // every real op has a chat surface
  const opsById = new Map([
    ['me',           { op: { id: 'me', verb: 'list', surfaces: ch },     appOrigin: 'basis' }],
    ['transportMode',{ op: { id: 'transportMode', surfaces: ch },        appOrigin: 'basis' }],
    ['addTask',      { op: { id: 'addTask', verb: 'add', surfaces: ch }, appOrigin: 'tasks' }],
    ['addItem',      { op: { id: 'addItem', verb: 'add', surfaces: ch }, appOrigin: 'household' }],
    ['markReturned', { op: { id: 'markReturned', surfaces: ch },         appOrigin: 'stoop' }],
  ]);
  const commandMenu = [
    { command: '/me',      opId: 'me',      appOrigin: 'basis' },
    { command: '/addtask', opId: 'addTask', appOrigin: 'tasks' },
    { command: '/add',     opId: 'addItem', appOrigin: 'household' },
  ];
  return { opsById, commandMenu, replyShapeFor: () => null, appOrigins: ['basis', 'tasks', 'household', 'stoop'] };
}

describe('scopeCatalogueToApps (Part D — catalogue scoping)', () => {
  it('default scope drops basis infra ops (keeps the circle apps)', () => {
    const c = scopeCatalogueToApps(makeCatalogue());
    expect([...c.opsById.keys()].sort()).toEqual(['addItem', 'addTask', 'markReturned']);
    expect(c.opsById.has('me')).toBe(false);
    expect(c.opsById.has('transportMode')).toBe(false);
  });

  it('an explicit apps list narrows further', () => {
    expect([...scopeCatalogueToApps(makeCatalogue(), ['household']).opsById.keys()]).toEqual(['addItem']);
  });

  it('filters the commandMenu by appOrigin too', () => {
    expect(scopeCatalogueToApps(makeCatalogue()).commandMenu.map((e) => e.opId)).toEqual(['addTask', 'addItem']);
  });

  it('empty apps array falls back to the default scope', () => {
    const c = scopeCatalogueToApps(makeCatalogue(), []);
    expect(c.opsById.has('me')).toBe(false);
    expect(c.opsById.has('addTask')).toBe(true);
  });

  it('preserves catalogue helpers + returns non-catalogue input unchanged', () => {
    expect(typeof scopeCatalogueToApps(makeCatalogue()).replyShapeFor).toBe('function');
    expect(scopeCatalogueToApps(null)).toBe(null);
    const x = { foo: 1 };
    expect(scopeCatalogueToApps(x)).toBe(x);
  });

  it('the scoped catalogue yields an LLM tool list WITHOUT the infra ops (the device-run /me fix)', () => {
    const ids = buildToolDescriptors(scopeCatalogueToApps(makeCatalogue())).map((t) => t.id);
    expect(ids).not.toContain('me');
    expect(ids).not.toContain('transportMode');
    expect(ids).toContain('addTask');
    expect(ids).toContain('addItem');
  });
});
