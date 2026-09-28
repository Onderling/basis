/**
 * Self-tests for lint-manifest-scopes — a guard whose own logic is untested is not a guard.
 * `auditManifest` is driven with synthetic manifests: red on a writing op without `writes` and on a
 * manifest without `hosts`, green on correct ones; and the loader is checked against the real apps so
 * it cannot go blind silently.
 */
import { describe, it, expect } from 'vitest';
import { auditManifest, loadManifests } from './lint-manifest-scopes.mjs';
import { verbKind } from '../packages/app-manifest/src/atoms.js';

const ok = (ops) => ({ app: 'x', hosts: [], operations: ops });

describe('lint-manifest-scopes', () => {
  it('a writing atom op without `writes` is red', () => {
    const problems = auditManifest(ok([{ id: 'addThing', verb: 'add' }]));
    expect(problems.map((p) => p.opId)).toEqual(['addThing']);
  });

  it('an alias of a writing atom counts as writing (`edit` is `update`, `create` is `add`)', () => {
    expect(verbKind({}, 'edit')).toBe('write');
    expect(verbKind({}, 'create')).toBe('write');
    expect(verbKind({}, 'complete')).toBe('write');
    expect(verbKind({}, 'read')).toBe('read');
  });

  it('read atoms and domain verbs classified `read` do not need `writes`', () => {
    expect(auditManifest({ ...ok([
      { id: 'listThings', verb: 'list' },
      { id: 'getThing', verb: 'read' },
      { id: 'help', verb: 'help' },
    ]), domainVerbs: { help: 'read' } })).toEqual([]);
  });

  it('a domain verb nobody classified is red: "classify this verb: read or write"', () => {
    const problems = auditManifest({ ...ok([{ id: 'register', verb: 'register', writes: { scope: 'circle' } }]), domainVerbs: {} });
    expect(problems.map((p) => p.opId)).toEqual(['register']);
    expect(problems[0].message).toMatch(/classify this verb: read or write/);
  });

  it('a plain-array `domainVerbs` is red — the list says nothing about reading or writing', () => {
    const problems = auditManifest({ ...ok([{ id: 'help', verb: 'help' }]), domainVerbs: ['help'] });
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.every((p) => /classify this verb: read or write/.test(p.message))).toBe(true);
  });

  it('a domain verb classified `write` needs `writes` like an atom does', () => {
    const m = (op) => ({ ...ok([op]), domainVerbs: { register: 'write' } });
    expect(auditManifest(m({ id: 'registerName', verb: 'register' })).map((p) => p.opId)).toEqual(['registerName']);
    expect(auditManifest(m({ id: 'registerName', verb: 'register', writes: { scope: 'circle' } }))).toEqual([]);
  });

  it('an op that declares `appends` writes, whatever its verb — or with none', () => {
    const problems = auditManifest({ ...ok([
      { id: 'ingest', verb: 'ingest', appends: ['chat-message'] },
      { id: 'lane.statement', appends: [{ lane: 'x', kind: 'y' }] },
    ]), domainVerbs: { ingest: 'read' } });
    expect(problems.map((p) => p.opId)).toEqual(['ingest', 'lane.statement']);
  });

  it('a manifest without `hosts` is red, and hosts must be non-empty strings', () => {
    expect(auditManifest({ app: 'x', operations: [] })).toHaveLength(1);
    expect(auditManifest({ app: 'x', hosts: 'api.example', operations: [] })).toHaveLength(1);
    expect(auditManifest({ app: 'x', hosts: [''], operations: [] })).toHaveLength(1);
    expect(auditManifest({ app: 'x', hosts: ['api.example.org'], operations: [] })).toEqual([]);
  });

  it('an unknown scope is red, even on an op that would not need one', () => {
    const problems = auditManifest(ok([
      { id: 'a', verb: 'add', writes: { scope: 'everywhere' } },
      { id: 'b', verb: 'help', writes: 'device' },
    ]));
    expect(problems.map((p) => p.opId)).toEqual(['a', 'b']);
  });

  it('correct declarations are green', () => {
    expect(auditManifest(ok([
      { id: 'addTask', verb: 'add', writes: { scope: 'circle' } },
      { id: 'setName', verb: 'update', writes: { scope: 'person' } },
      { id: 'setRelay', verb: 'submit', writes: { scope: 'device' } },
      { id: 'listTasks', verb: 'list' },
    ]))).toEqual([]);
  });

  it('the loader reads the manifests the app composes — the app manifests AND the plumbing ones', async () => {
    const loaded = await loadManifests();
    const apps = loaded.map((m) => m.app);
    for (const a of ['basis', 'household', 'stoop', 'tasks', 'folio', 'calendar', 'lists', 'agents']) expect(apps).toContain(a);
    // Declared outside `apps/*/manifest.js`: the parameter register and the device-log lanes.
    for (const a of ['params', 'governance', 'membership', 'keys', 'grants', 'task-lane', 'chat-lane']) expect(apps).toContain(a);
    for (const m of loaded) expect(Array.isArray(m.manifest?.operations), m.app).toBe(true);
  });
});
