/**
 * Self-tests for lint-manifest-scopes — a guard whose own logic is untested is not a guard.
 * `auditManifest` is driven with synthetic manifests: red on a writing op without `writes` and on a
 * manifest without `hosts`, green on correct ones; and the loader is checked against the real apps so
 * it cannot go blind silently.
 */
import { describe, it, expect } from 'vitest';
import { auditManifest, isWritingOp, loadManifests } from './lint-manifest-scopes.mjs';

const ok = (ops) => ({ app: 'x', hosts: [], operations: ops });

describe('lint-manifest-scopes', () => {
  it('a writing atom op without `writes` is red', () => {
    const problems = auditManifest(ok([{ id: 'addThing', verb: 'add' }]));
    expect(problems.map((p) => p.opId)).toEqual(['addThing']);
  });

  it('an alias of a writing atom counts as writing (`edit` is `update`, `create` is `add`)', () => {
    expect(isWritingOp({ verb: 'edit' })).toBe(true);
    expect(isWritingOp({ verb: 'create' })).toBe(true);
    expect(isWritingOp({ verb: 'complete' })).toBe(true);
  });

  it('read atoms and undeclared domain verbs do not need `writes`', () => {
    expect(auditManifest(ok([
      { id: 'listThings', verb: 'list' },
      { id: 'getThing', verb: 'read' },
      { id: 'help', verb: 'help' },
    ]))).toEqual([]);
  });

  it('a domain-verb op that declares `appends` is writing', () => {
    const problems = auditManifest(ok([{ id: 'ingest', verb: 'ingest', appends: ['chat-message'] }]));
    expect(problems.map((p) => p.opId)).toEqual(['ingest']);
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

  it('the loader finds the real app manifests (it cannot go blind silently)', async () => {
    const apps = (await loadManifests()).map((m) => m.app);
    for (const a of ['basis', 'household', 'stoop', 'tasks-v0']) expect(apps).toContain(a);
    for (const m of await loadManifests()) expect(Array.isArray(m.manifest?.operations), m.app).toBe(true);
  });
});
