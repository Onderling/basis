/**
 * freedom — B · (ruling): the admin freedom template + gate-narrowing.
 */
import { describe, it, expect } from 'vitest';
import {
  buildCapabilityMatrix, effectiveCapabilityKeys, capabilityKey, affordanceTreatment,
  FREEDOM_LEVELS, OPT_OUT_CONSEQUENCES, DEFAULT_ROW,
} from '../src/index.js';

const tasks = {
  app: 'tasks', itemTypes: ['task'],
  nouns: { task: { atoms: ['add', 'complete'] } },
  operations: [
    { id: 'addTask', verb: 'add', appliesTo: { type: 'task' } },
    { id: 'doneTask', verb: 'complete', appliesTo: { type: 'task' } },
  ],
};
const pinboard = {
  app: 'pinboard', itemTypes: ['post'],
  nouns: { post: { atoms: ['add'] } },
  operations: [{ id: 'postRequest', verb: 'add', appliesTo: { type: 'post' } }],
};
const sources = [{ manifest: tasks }, { manifest: pinboard }];

describe('constants', () => {
  it('are the frozen ruling-Q3 vocabularies', () => {
    expect(FREEDOM_LEVELS).toEqual(['required', 'optional']);
    expect(OPT_OUT_CONSEQUENCES).toEqual(['greyed', 'hidden', 'limited']);
    expect(DEFAULT_ROW).toMatchObject({ enabled: true, freedom: 'optional', consequence: 'greyed' });
  });
});

describe('buildCapabilityMatrix', () => {
  it('one row per capability of enabled apps, defaults when the template is silent', () => {
    const rows = buildCapabilityMatrix(sources, { enabledApps: ['tasks', 'pinboard'] });
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey['tasks add task']).toMatchObject({ app: 'tasks', atom: 'add', noun: 'task', opId: 'addTask', enabled: true, freedom: 'optional', consequence: 'greyed' });
    expect(byKey['pinboard add post']).toMatchObject({ opId: 'postRequest', enabled: true });
  });

  it('a disabled app contributes no rows', () => {
    const rows = buildCapabilityMatrix(sources, { enabledApps: ['tasks'] });
    expect(rows.some((r) => r.app === 'pinboard')).toBe(false);
  });

  it('merges the admin template over defaults', () => {
    const template = {
      'tasks complete task': { freedom: 'required', consequence: 'hidden' },
      'pinboard add post': { enabled: false },
    };
    const byKey = Object.fromEntries(buildCapabilityMatrix(sources, { template }).map((r) => [r.key, r]));
    expect(byKey['tasks complete task']).toMatchObject({ freedom: 'required', consequence: 'hidden' });
    expect(byKey['pinboard add post'].enabled).toBe(false);
  });

  it('privacy floor forces optional even if the template says required', () => {
    const template = { 'tasks add task': { freedom: 'required', privacyFloor: true } };
    const row = buildCapabilityMatrix(sources, { template }).find((r) => r.key === 'tasks add task');
    expect(row).toMatchObject({ privacyFloor: true, freedom: 'optional' });   // floor wins
  });

  it('ignores unknown freedom/consequence values (falls back to default)', () => {
    const template = { 'tasks add task': { freedom: 'whatever', consequence: 'sparkle' } };
    const row = buildCapabilityMatrix(sources, { template }).find((r) => r.key === 'tasks add task');
    expect(row).toMatchObject({ freedom: 'optional', consequence: 'greyed' });
  });
});

describe('effectiveCapabilityKeys — the gate-narrowing', () => {
  it('drops below app-level: a disabled capability leaves the set while its app stays enabled', () => {
    const template = { 'pinboard add post': { enabled: false } };
    const keys = effectiveCapabilityKeys(sources, { enabledApps: ['tasks', 'pinboard'], template });
    expect(keys.has(capabilityKey('tasks', 'add', 'task'))).toBe(true);
    expect(keys.has(capabilityKey('pinboard', 'add', 'post'))).toBe(false);   // ← narrowed below app-level
  });

  it('with no template, every enabled-app capability is authorised (default-on)', () => {
    const keys = effectiveCapabilityKeys(sources, { enabledApps: ['tasks', 'pinboard'] });
    expect(keys.has('tasks add task')).toBe(true);
    expect(keys.has('tasks complete task')).toBe(true);
    expect(keys.has('pinboard add post')).toBe(true);
  });
});

describe('Slice 4 — member opt-outs narrow admin-template ∩ user-prefs', () => {
  it('matrix marks optOutable (optional or floor) + optedOut for this member', () => {
    const template = {
      'tasks add task': { freedom: 'required' },              // NOT opt-outable
      'tasks complete task': { freedom: 'optional' },          // opt-outable
      'pinboard add post': { privacyFloor: true },                // opt-outable (floor)
    };
    const rows = buildCapabilityMatrix(sources, { template, optOuts: ['tasks complete task', 'tasks add task', 'pinboard add post'] });
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by['tasks add task']).toMatchObject({ optOutable: false, optedOut: false });      // required → can't opt out
    expect(by['tasks complete task']).toMatchObject({ optOutable: true, optedOut: true });
    expect(by['pinboard add post']).toMatchObject({ optOutable: true, optedOut: true });          // floor
  });

  it('effectiveCapabilityKeys removes opted-out OPT-OUTABLE caps only', () => {
    const template = { 'tasks add task': { freedom: 'required' }, 'tasks complete task': { freedom: 'optional' } };
    // member tries to opt out of BOTH — only the optional one actually leaves the set
    const keys = effectiveCapabilityKeys(sources, { template, optOuts: ['tasks add task', 'tasks complete task'] });
    expect(keys.has('tasks add task')).toBe(true);         // required — opt-out ignored
    expect(keys.has('tasks complete task')).toBe(false);   // optional — opted out → gone
  });

  it('no optOuts ⇒ pure admin template (Slices 1–2 behaviour)', () => {
    const keys = effectiveCapabilityKeys(sources, {});
    expect(keys.has('tasks add task')).toBe(true);
    expect(keys.has('pinboard add post')).toBe(true);
  });
});

describe('affordanceTreatment (4c — consequence → UI)', () => {
  const matrix = buildCapabilityMatrix(sources, {
    template: { 'tasks add task': { enabled: false, consequence: 'hidden' }, 'tasks complete task': { freedom: 'optional', consequence: 'greyed' } },
    optOuts: ['tasks complete task'],
  });
  it('authorised cap → show', () => {
    expect(affordanceTreatment(matrix, { app: 'pinboard', atom: 'add', noun: 'post' })).toBe('show');
  });
  it('admin-disabled cap → its consequence (hidden→hide)', () => {
    expect(affordanceTreatment(matrix, { app: 'tasks', atom: 'add', noun: 'task' })).toBe('hide');
  });
  it('member-opted-out cap → its consequence (greyed→grey)', () => {
    expect(affordanceTreatment(matrix, { app: 'tasks', atom: 'complete', noun: 'task' })).toBe('grey');
  });
  it('unknown/domain cap → show', () => {
    expect(affordanceTreatment(matrix, { app: 'tasks', atom: 'help', noun: 'x' })).toBe('show');
    expect(affordanceTreatment(matrix, {})).toBe('show');
  });
});
