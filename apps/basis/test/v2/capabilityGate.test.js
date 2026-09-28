/**
 * capabilityGate — B · default-deny authorization boundary.
 * Covers: default-on (unconfigured), app-level deny, (verb×noun) granularity,
 * arg-aware noun resolution, and domain-verb pass-through.
 */
import { describe, it, expect } from 'vitest';
import { effectiveCapabilities, checkCapability, capabilityKey } from '../../src/v2/capabilityGate.js';

const household = {
  app: 'household',
  itemTypes: ['shopping', 'task', 'contact'],
  domainVerbs: { help: 'read', register: 'write' },
  nouns: {
    shopping: { atoms: ['add', 'list', 'complete', 'remove'] },
    task:     { atoms: ['add', 'complete', 'claim'] },
    note:     { atoms: ['add', 'list', 'get', 'remove'] },   // §1b generic — declared, NO implementing op
  },
  operations: [
    { id: 'addItem',  verb: 'add',      params: [{ name: 'type', kind: 'enum', of: ['shopping'] }] },
    { id: 'addTask',  verb: 'add',      appliesTo: { type: 'task' } },
    { id: 'claim',    verb: 'claim',    appliesTo: { type: 'task' } },
    { id: 'help',     verb: 'help' },
    { id: 'register', verb: 'register', appliesTo: { type: 'contact' } },
  ],
};
const calendar = {
  app: 'calendar',
  itemTypes: ['calendar-event'],
  nouns: { 'calendar-event': { atoms: ['add', 'list', 'remove'] } },
  operations: [{ id: 'addEvent', verb: 'add', appliesTo: { type: 'calendar-event' } }],
};
const sources = [{ manifest: household }, { manifest: calendar }];

const op = (id) => [...household.operations, ...calendar.operations].find((o) => o.id === id);

describe('effectiveCapabilities', () => {
  it('unconfigured policy (apps=null) → every app enabled (default-on migration)', () => {
    const eff = effectiveCapabilities(sources, { apps: null });
    expect(eff.enabledApps).toBe(null);
    expect(eff.keys.has(capabilityKey('household', 'add', 'shopping'))).toBe(true);
    expect(eff.keys.has(capabilityKey('calendar', 'add', 'calendar-event'))).toBe(true);
  });
  it('a policy.apps list contributes only the enabled apps’ capabilities', () => {
    const eff = effectiveCapabilities(sources, { apps: ['household'] });
    expect(eff.enabledApps.has('household')).toBe(true);
    expect(eff.keys.has(capabilityKey('household', 'add', 'task'))).toBe(true);
    expect([...eff.keys].some((k) => k.startsWith('calendar '))).toBe(false);
  });

  it('Slice 2: the freedom template narrows BELOW app-level (a disabled cap leaves an enabled app)', () => {
    const template = { [capabilityKey('household', 'add', 'task')]: { enabled: false } };
    const eff = effectiveCapabilities(sources, { apps: ['household'], capabilities: template });
    expect(eff.keys.has(capabilityKey('household', 'add', 'shopping'))).toBe(true);   // still allowed
    expect(eff.keys.has(capabilityKey('household', 'add', 'task'))).toBe(false);      // ← narrowed out
    // and the gate refuses that specific op even though household is enabled
    const r = checkCapability({ op: op('addTask'), appOrigin: 'household', args: {} }, eff);
    expect(r).toMatchObject({ allow: false, code: 'capability-denied' });
  });
});

describe('checkCapability — default-deny', () => {
  const enabledAll = effectiveCapabilities(sources, { apps: null });
  const onlyHousehold = effectiveCapabilities(sources, { apps: ['household'] });

  it('allows an in-set capability (arg-resolved noun)', () => {
    expect(checkCapability({ op: op('addItem'), appOrigin: 'household', args: { type: 'shopping' } }, enabledAll))
      .toMatchObject({ allow: true });
    expect(checkCapability({ op: op('addTask'), appOrigin: 'household', args: {} }, enabledAll))
      .toMatchObject({ allow: true });
  });

  it('DENIES an op from a disabled app (the leakage fix — even when invoked directly)', () => {
    const r = checkCapability({ op: op('addEvent'), appOrigin: 'calendar', args: {} }, onlyHousehold);
    expect(r.allow).toBe(false);
    expect(r.code).toBe('app-disabled');
  });

  it('DENIES a capability absent from the effective set (verb×noun granularity)', () => {
    // Effective set has add/list/complete/remove on shopping; `claim` on shopping is NOT granted.
    const narrow = { keys: new Set([capabilityKey('household', 'add', 'shopping')]), enabledApps: new Set(['household']) };
    const r = checkCapability({ op: { verb: 'claim', appliesTo: { type: 'shopping' } }, appOrigin: 'household', args: {} }, narrow);
    expect(r.allow).toBe(false);
    expect(r.code).toBe('capability-denied');
  });

  it('lets a domain verb through for an enabled app (help/register aren’t capabilities)', () => {
    expect(checkCapability({ op: op('help'), appOrigin: 'household' }, onlyHousehold)).toMatchObject({ allow: true });
    expect(checkCapability({ op: op('register'), appOrigin: 'household', args: {} }, onlyHousehold)).toMatchObject({ allow: true });
  });

  it('but STILL denies a domain verb from a DISABLED app', () => {
    const r = checkCapability({ op: { verb: 'sync' }, appOrigin: 'folio' }, onlyHousehold);
    expect(r.allow).toBe(false);
    expect(r.code).toBe('app-disabled');
  });

  it('fails closed on a missing appOrigin (routing defect)', () => {
    expect(checkCapability({ op: op('addTask'), args: {} }, enabledAll).allow).toBe(false);
  });
});

describe('checkCapability — GENERIC (op-less) capabilities (§1b, the gate-gap fix)', () => {
  const enabledAll   = effectiveCapabilities(sources, { apps: null });
  const onlyCalendar = effectiveCapabilities(sources, { apps: ['calendar'] });

  it('the declared op-less `note` caps are IN the effective set (declaring a noun gates it)', () => {
    expect(enabledAll.keys.has(capabilityKey('household', 'add', 'note'))).toBe(true);
    expect(enabledAll.keys.has(capabilityKey('household', 'remove', 'note'))).toBe(true);
  });

  it('authorises a generic (atom×noun) via explicit atom/noun — no `op` object needed', () => {
    const r = checkCapability({ atom: 'add', noun: 'note', appOrigin: 'household', args: { body: 'x' } }, enabledAll);
    expect(r).toMatchObject({ allow: true, capability: capabilityKey('household', 'add', 'note') });
  });

  it('an atom ALIAS resolves the same (create→add·note)', () => {
    expect(checkCapability({ atom: 'create', noun: 'note', appOrigin: 'household' }, enabledAll).allow).toBe(true);
  });

  it('THE GAP FIX: a generic cap of a DISABLED app is denied, not silently allowed', () => {
    // Pre-fix, an op-less dispatch fell through `!atom` → allow:true unconditionally.
    const r = checkCapability({ atom: 'add', noun: 'note', appOrigin: 'household' }, onlyCalendar);
    expect(r).toMatchObject({ allow: false, code: 'app-disabled' });
  });

  it('a generic cap narrowed out by the freedom template is denied (capability-denied)', () => {
    const template = { [capabilityKey('household', 'remove', 'note')]: { enabled: false } };
    const eff = effectiveCapabilities(sources, { apps: ['household'], capabilities: template });
    expect(checkCapability({ atom: 'add',    noun: 'note', appOrigin: 'household' }, eff)).toMatchObject({ allow: true });
    expect(checkCapability({ atom: 'remove', noun: 'note', appOrigin: 'household' }, eff))
      .toMatchObject({ allow: false, code: 'capability-denied' });
  });

  it('an undeclared generic noun (no key) is denied', () => {
    expect(checkCapability({ atom: 'add', noun: 'ghost', appOrigin: 'household' }, enabledAll))
      .toMatchObject({ allow: false, code: 'capability-denied' });
  });
});
