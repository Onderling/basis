/**
 * The content line (a circle's switches bind on every member's device): which settings a content statement is judged by.
 * A settings change names the content lane's tips as the admin's device held them. Scanned from the NEWEST change: a
 * statement is judged by the settings after the newest change it is proven NOT behind; behind every change, by the
 * settings before the oldest. Not proven either way: every candidate is answered, and the rail judges under each.
 */
import { describe, it, expect } from 'vitest';
import { lineRelation, contentLineChanges, settingsForContent } from '../../src/v2/contentLine.js';

// a lane as a map hash -> {parent, deps}: a <- b <- c <- e, and d beside c (both on b)
const lane = {
  a: { parent: null, deps: [] },
  b: { parent: 'a', deps: [] },
  c: { parent: 'b', deps: [] },
  d: { parent: null, deps: ['b'] },
  e: { parent: 'c', deps: ['d'] },
};
const linksOf = (h) => lane[h] ?? null;
const pruned = (...gone) => (h) => (gone.includes(h) ? null : linksOf(h));

describe('a statement and one line', () => {
  it('behind: the walk from the tips finds it (a tip itself, or an ancestor through parent or deps)', () => {
    expect(lineRelation('c', ['c'], linksOf)).toBe('behind');
    expect(lineRelation('a', ['d'], linksOf)).toBe('behind');
  });

  it('not behind, proof (a): a tip is among the statement\'s own ancestors, even when the history under the tip is pruned', () => {
    expect(lineRelation('e', ['c'], pruned('a', 'b'))).toBe('not-behind');
  });

  it('not behind, proof (b): the full walk from the tips ends without it and without a missing link', () => {
    expect(lineRelation('d', ['c'], linksOf)).toBe('not-behind');
  });

  it('neither proof: unknown (never "not behind" on a guess)', () => {
    expect(lineRelation('d', ['c'], pruned('a', 'b'))).toBe('unknown');
  });

  it('an empty line: nothing is behind it', () => {
    expect(lineRelation('a', [], linksOf)).toBe('not-behind');
  });
});

const change = (version, author, policy, lines) => ({ kind: 'policy-update', author, hash: `${author}-${version}`, payload: { version, policy, contentUpTo: lines } });
const on = { capabilities: {} };
const off = { capabilities: { 'lists add list-item': { enabled: false } } };
const first = { features: { chat: true } };   // the circle's creation settings (the founder's first write, version 1)

describe('the settings a content statement is judged by', () => {
  it('posted while on, switched off after: behind the switch-off, judged by the settings before it (it stays)', () => {
    const changes = contentLineChanges([change(1, 'A', first, { items: [] }), change(2, 'A', off, { items: ['c'] })]);
    expect(settingsForContent({ hash: 'b', lane: 'items', linksOf, changes })).toEqual({ settings: [first] });
  });

  it('made while the switch-off was under way (not behind it): the newest settings (deny-wins)', () => {
    const changes = contentLineChanges([change(1, 'A', first, { items: [] }), change(2, 'A', off, { items: ['b'] })]);
    expect(settingsForContent({ hash: 'c', lane: 'items', linksOf, changes })).toEqual({ settings: [off] });
  });

  it('scanned from the newest change: a fresh statement is decided there, whatever the arrival order', () => {
    const changes = contentLineChanges([change(3, 'A', on, { items: ['c'] }), change(1, 'A', first, { items: [] }), change(2, 'A', off, { items: ['b'] })]);
    expect(settingsForContent({ hash: 'e', lane: 'items', linksOf, changes })).toEqual({ settings: [on] });
    expect(settingsForContent({ hash: 'c', lane: 'items', linksOf, changes })).toEqual({ settings: [off] });
    expect(settingsForContent({ hash: 'a', lane: 'items', linksOf, changes })).toEqual({ settings: [first] });
  });

  it('a pruned history and a fresh statement: decided at the newest change, never parked', () => {
    const changes = contentLineChanges([change(1, 'A', first, { items: [] }), change(2, 'A', off, { items: ['c'] })]);
    expect(settingsForContent({ hash: 'e', lane: 'items', linksOf: pruned('a', 'b'), changes })).toEqual({ settings: [off] });
  });

  it('off then on, the first line pruned: a statement made between them is judged by "off"', () => {
    // v2 switched off with the line at b; v3 switched on with the line at c. c was made while off.
    const changes = contentLineChanges([change(1, 'A', first, { items: [] }), change(2, 'A', off, { items: ['b'] }), change(3, 'A', on, { items: ['c'] })]);
    const r = settingsForContent({ hash: 'c', lane: 'items', linksOf: pruned('a', 'b'), changes });
    expect(r.settings[0]).toEqual(off);
  });

  it('neither proof at a change: both readings are answered (after it, and what the older changes give)', () => {
    const changes = contentLineChanges([change(1, 'A', first, { items: [] }), change(2, 'A', off, { items: ['c'] })]);
    expect(settingsForContent({ hash: 'd', lane: 'items', linksOf: pruned('a', 'b'), changes })).toEqual({ settings: [off, first] });
  });

  it('two admins at one version: exempt only when behind BOTH lines', () => {
    const changes = contentLineChanges([
      change(1, 'A', first, { items: [] }),
      change(2, 'A', off, { items: ['c'] }),
      change(2, 'B', off, { items: ['a'] }),
    ]);
    expect(settingsForContent({ hash: 'a', lane: 'items', linksOf, changes })).toEqual({ settings: [first] });
    expect(settingsForContent({ hash: 'b', lane: 'items', linksOf, changes })).toEqual({ settings: [off] });
  });

  it('the lanes are separate: an items line does not cover a chat statement', () => {
    const changes = contentLineChanges([change(1, 'A', first, { chat: [], items: [] }), change(2, 'A', off, { chat: [], items: ['c'] })]);
    expect(settingsForContent({ hash: 'b', lane: 'chat', linksOf, changes })).toEqual({ settings: [off] });
  });

  it('behind every change this device holds, and the oldest is not the first: the settings before it are not known', () => {
    const changes = contentLineChanges([change(4, 'A', off, { items: ['c'] })]);
    expect(settingsForContent({ hash: 'b', lane: 'items', linksOf, changes })).toEqual({ settings: [], beforeUnknown: true });
  });

  it('no settings change held at all: nothing is known (never an empty policy)', () => {
    expect(settingsForContent({ hash: 'a', lane: 'items', linksOf, changes: [] })).toEqual({ settings: [], beforeUnknown: true });
  });
});

describe('the settings change draws the line', () => {
  const railOf = (appended) => ({ append: async (circleId, entry) => { appended.push(entry); return { statement: { body: { hash: 'h' } } }; } });

  it('the emitter puts the content lanes\' tips on the policy-update, as the admin\'s device holds them', async () => {
    const { makePolicyUpdateEmitter } = await import('../../src/v2/policyUpdateLane.js');
    const appended = [];
    const emit = makePolicyUpdateEmitter({ rail: railOf(appended), contentUpToFor: () => ({ items: ['i1'], chat: ['c1', 'c2'] }) });
    expect(await emit({ groupId: 'g', policy: { capabilities: {} }, version: 2 })).toBeTruthy();
    expect(appended[0].payload.contentUpTo).toEqual({ items: ['i1'], chat: ['c1', 'c2'] });
  });

  it('a lane it cannot read FAILS the change: an empty line would take back the whole history the switch covers', async () => {
    const { makePolicyUpdateEmitter } = await import('../../src/v2/policyUpdateLane.js');
    for (const contentUpToFor of [() => { throw new Error('no rail'); }, () => ({ items: ['i1'] }), () => null, undefined]) {
      const appended = [];
      const emit = makePolicyUpdateEmitter({ rail: railOf(appended), contentUpToFor });
      expect(await emit({ groupId: 'g', policy: {}, version: 1 })).toBe(null);
      expect(appended).toEqual([]);
    }
  });
});

describe('the one decision, asked by a rail', () => {
  it('a statement is judged by atom and noun, without an op and without a member\'s opt-outs', async () => {
    const { circleCapabilityVerdict } = await import('../../src/v2/circleActGate.js');
    const { allManifests } = await import('../../src/v2/manifestSources.js');
    const manifests = allManifests();
    const offPolicy = { capabilities: { 'lists add list-item': { enabled: false } } };
    expect(circleCapabilityVerdict({ app: 'lists', atom: 'add', noun: 'list-item', manifests, policy: offPolicy })).toEqual({ allow: false, code: 'capability-denied' });
    expect(circleCapabilityVerdict({ app: 'lists', atom: 'add', noun: 'list-item', manifests, policy: {} })).toEqual({ allow: true });
    // an app the circle switched off refuses every row of its types, whatever the atom
    expect(circleCapabilityVerdict({ app: 'tasks', atom: 'add', noun: 'task', manifests, policy: { features: { tasks: false } } })).toEqual({ allow: false, code: 'app-disabled' });
  });
});
