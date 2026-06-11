import { describe, it, expect } from 'vitest';
import { scopeCatalogToApps } from '../../src/v2/circleCatalogScope.js';
import { buildToolDescriptors } from '../../src/v2/interpretCommand.js';

function makeCatalog() {
  const opsById = new Map([
    ['me',           { op: { id: 'me', verb: 'list' },     appOrigin: 'canopy-chat' }],
    ['transportMode',{ op: { id: 'transportMode' },        appOrigin: 'canopy-chat' }],
    ['addTask',      { op: { id: 'addTask', verb: 'add' }, appOrigin: 'tasks-v0' }],
    ['addItem',      { op: { id: 'addItem', verb: 'add' }, appOrigin: 'household' }],
    ['markReturned', { op: { id: 'markReturned' },         appOrigin: 'stoop' }],
  ]);
  const commandMenu = [
    { command: '/me',      opId: 'me',      appOrigin: 'canopy-chat' },
    { command: '/addtask', opId: 'addTask', appOrigin: 'tasks-v0' },
    { command: '/add',     opId: 'addItem', appOrigin: 'household' },
  ];
  return { opsById, commandMenu, replyShapeFor: () => null, appOrigins: ['canopy-chat', 'tasks-v0', 'household', 'stoop'] };
}

describe('scopeCatalogToApps (Part D — catalog scoping)', () => {
  it('default scope drops canopy-chat infra ops (keeps the circle apps)', () => {
    const c = scopeCatalogToApps(makeCatalog());
    expect([...c.opsById.keys()].sort()).toEqual(['addItem', 'addTask', 'markReturned']);
    expect(c.opsById.has('me')).toBe(false);
    expect(c.opsById.has('transportMode')).toBe(false);
  });

  it('an explicit apps list narrows further', () => {
    expect([...scopeCatalogToApps(makeCatalog(), ['household']).opsById.keys()]).toEqual(['addItem']);
  });

  it('filters the commandMenu by appOrigin too', () => {
    expect(scopeCatalogToApps(makeCatalog()).commandMenu.map((e) => e.opId)).toEqual(['addTask', 'addItem']);
  });

  it('empty apps array falls back to the default scope', () => {
    const c = scopeCatalogToApps(makeCatalog(), []);
    expect(c.opsById.has('me')).toBe(false);
    expect(c.opsById.has('addTask')).toBe(true);
  });

  it('preserves catalog helpers + returns non-catalog input unchanged', () => {
    expect(typeof scopeCatalogToApps(makeCatalog()).replyShapeFor).toBe('function');
    expect(scopeCatalogToApps(null)).toBe(null);
    const x = { foo: 1 };
    expect(scopeCatalogToApps(x)).toBe(x);
  });

  it('the scoped catalog yields an LLM tool list WITHOUT the infra ops (the device-run /me fix)', () => {
    const ids = buildToolDescriptors(scopeCatalogToApps(makeCatalog())).map((t) => t.id);
    expect(ids).not.toContain('me');
    expect(ids).not.toContain('transportMode');
    expect(ids).toContain('addTask');
    expect(ids).toContain('addItem');
  });
});
