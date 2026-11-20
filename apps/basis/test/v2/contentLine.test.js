/**
 * The content line (a circle's switches bind on every member's device): which settings a content statement is judged by.
 * A settings change names the content lane's tips as the admin's device held them; a statement that is one of those
 * tips or an ancestor of one is BEHIND that change and is judged by the settings before it. Behind nothing: the newest.
 */
import { describe, it, expect } from 'vitest';
import { isBehindLine, contentLineChanges, settingsForContent } from '../../src/v2/contentLine.js';

// a lane as a map hash -> {parent, deps}: a <- b <- c, and d beside c (both on b)
const lane = {
  a: { parent: null, deps: [] },
  b: { parent: 'a', deps: [] },
  c: { parent: 'b', deps: [] },
  d: { parent: null, deps: ['b'] },
};
const linksOf = (h) => lane[h] ?? null;

describe('behind a line', () => {
  it('a tip itself, and every ancestor through parent and deps, is behind; a later statement is not', () => {
    expect(isBehindLine('c', ['c'], linksOf)).toEqual({ behind: true });
    expect(isBehindLine('a', ['d'], linksOf)).toEqual({ behind: true });
    expect(isBehindLine('c', ['d'], linksOf)).toEqual({ behind: false });
  });

  it('a link this device does not hold yet makes the answer unknown (park it), never "not behind"', () => {
    const holey = (h) => (h === 'b' ? null : linksOf(h));
    expect(isBehindLine('a', ['c'], holey)).toEqual({ behind: false, gap: true });
  });

  it('an empty line has nothing behind it', () => {
    expect(isBehindLine('a', [], linksOf)).toEqual({ behind: false });
  });
});

const change = (version, author, policy, lines) => ({ kind: 'policy-update', author, hash: `${author}-${version}`, payload: { version, policy, contentUpTo: lines } });
const on = { capabilities: {} };
const off = { capabilities: { 'lists add entry': { enabled: false } } };

describe('the settings a content statement is judged by', () => {
  it('posted while on, switched off after: judged by the settings BEFORE the switch-off (it stays)', () => {
    const changes = contentLineChanges([change(1, 'A', on, { items: [] }), change(2, 'A', off, { items: ['c'] })]);
    expect(settingsForContent({ hash: 'b', lane: 'items', linksOf, changes })).toEqual({ policy: on });
  });

  it('behind no change (made while the switch-off was under way): the newest settings (deny-wins)', () => {
    const changes = contentLineChanges([change(1, 'A', on, { items: [] }), change(2, 'A', off, { items: ['b'] })]);
    expect(settingsForContent({ hash: 'c', lane: 'items', linksOf, changes })).toEqual({ policy: off });
  });

  it('the FIRST change it is behind decides, in version order, whatever order the changes arrive in', () => {
    const v3 = change(3, 'A', on, { items: ['d'] });
    const v2 = change(2, 'A', off, { items: ['c'] });
    const v1 = change(1, 'A', on, { items: [] });
    const changes = contentLineChanges([v3, v1, v2]);
    expect(settingsForContent({ hash: 'b', lane: 'items', linksOf, changes })).toEqual({ policy: on });
    expect(settingsForContent({ hash: 'd', lane: 'items', linksOf, changes })).toEqual({ policy: off });
  });

  it('two admins at one version: exempt only when behind BOTH lines', () => {
    const changes = contentLineChanges([
      change(1, 'A', on, { items: [] }),
      change(2, 'A', off, { items: ['c'] }),
      change(2, 'B', off, { items: ['a'] }),
    ]);
    expect(settingsForContent({ hash: 'a', lane: 'items', linksOf, changes })).toEqual({ policy: on });
    expect(settingsForContent({ hash: 'b', lane: 'items', linksOf, changes }).policy).toEqual(off);
  });

  it('the lanes are separate: an items line does not cover a chat statement', () => {
    const changes = contentLineChanges([change(1, 'A', on, { items: [] }), change(2, 'A', off, { items: ['c'] })]);
    expect(settingsForContent({ hash: 'b', lane: 'chat', linksOf, changes })).toEqual({ policy: off });
  });

  it('a gap under a line parks the statement', () => {
    const holey = (h) => (h === 'b' ? null : linksOf(h));
    const changes = contentLineChanges([change(1, 'A', on, { items: [] }), change(2, 'A', off, { items: ['c'] })]);
    expect(settingsForContent({ hash: 'a', lane: 'items', linksOf: holey, changes })).toEqual({ park: true });
  });

  it('no settings change at all: the circle\'s defaults (an empty policy)', () => {
    expect(settingsForContent({ hash: 'a', lane: 'items', linksOf, changes: [] })).toEqual({ policy: {} });
  });
});

describe('the settings change draws the line', () => {
  it('the emitter puts the content lanes\' tips on the policy-update, as the admin\'s device holds them', async () => {
    const { makePolicyUpdateEmitter } = await import('../../src/v2/policyUpdateLane.js');
    const appended = [];
    const rail = { append: async (circleId, entry) => { appended.push(entry); return { statement: { body: { hash: 'h' } } }; } };
    const emit = makePolicyUpdateEmitter({ rail, contentUpToFor: () => ({ items: ['i1'], chat: ['c1', 'c2'] }) });
    await emit({ groupId: 'g', policy: { capabilities: {} }, version: 2 });
    expect(appended[0].payload.contentUpTo).toEqual({ items: ['i1'], chat: ['c1', 'c2'] });
  });

  it('a reader that throws leaves the line empty on both lanes (nothing is put behind it), the change still goes', async () => {
    const { makePolicyUpdateEmitter } = await import('../../src/v2/policyUpdateLane.js');
    const appended = [];
    const rail = { append: async (circleId, entry) => { appended.push(entry); return { statement: { body: { hash: 'h' } } }; } };
    const emit = makePolicyUpdateEmitter({ rail, contentUpToFor: () => { throw new Error('no rail'); } });
    await emit({ groupId: 'g', policy: {}, version: 1 });
    expect(appended[0].payload.contentUpTo).toEqual({ items: [], chat: [] });
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
