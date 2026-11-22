/**
 * WHAT THIS DEVICE PROVED ABOUT A CONTENT STATEMENT, KEPT ON ITS OWN LOG. "S is behind change k" and "S is not behind
 * change k" never change once proven (ancestry is fixed), so the items rail keeps each proven answer as a SILENT entry of
 * its own kind on the device log, and a later judging never walks again, and never takes back a statement because the
 * links that proved it have aged out since. Where a take-back needs it (the row's first statement on this device's log:
 * nothing older on the log can rebuild the row), the row as it was is kept beside it.
 *
 * Four conditions hold the kind to that:
 *   1. device-local: never carried to the person's other devices, never in the history mirror or an export, never a
 *      count or a news line, never a wake (each device judges for itself; a sibling holds other links);
 *   2. no inbound door accepts it: nobody can hand this device a judgment;
 *   3. losing an entry only means judging again, never a different answer;
 *   4. the row as it was is kept only where the take-back needs it.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity, signSpine } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import {
  ENTRY_KINDS, ACCEPTS, SIGNS, SYNC, bindingOf, entryKind, retentionOf, isMirroredKind, kindWakes, memoryDataSource,
  createCircleStores,
} from '@onderling/item-store';
import { createRegistry, registerCanonicalTypes } from '@onderling/item-types';
import { EventLog, shouldWakeForEntry } from '../../src/eventLog.js';
import { createHistoryMirror } from '../../src/v2/historyMirror.js';
import { countsAsUnread, buildTilePreviews } from '../../src/v2/circleTilePreviews.js';
import { CONTENT_JUDGED, contentJudgmentsOn } from '../../src/v2/contentJudgments.js';
import { contentLineChanges, settingsForContent } from '../../src/v2/contentLine.js';
import { judgeItemStatement } from '../../src/v2/contentJudge.js';
import { makeItemsRail, makeItemsPeerHandler, ITEMS_BROADCAST } from '../../src/v2/itemsRail.js';
import { noteKeptPolicyChanges } from '../../src/v2/keptPolicyChanges.js';
import { POLICY_UPDATE_KIND } from '../../src/v2/policyUpdateLane.js';
import { allManifests } from '../../src/v2/manifestSources.js';

const CIRCLE = 'circle:judged';
const manifests = allManifests();
const change = (version, policy, items, hash) => ({ kind: POLICY_UPDATE_KIND, author: 'admin', hash, payload: { policy, version, contentUpTo: { items, chat: [] } } });
const ON = {};
const ADD_OFF = { capabilities: { 'tasks add task': { enabled: false } } };
const body = (hash) => ({ hash, kind: 'snapshot', payload: { item: { id: 'r1', type: 'task' } } });
// s1 ← s2 ← s3: a lane this device holds whole
const whole = { s1: { parent: null, deps: [] }, s2: { parent: 's1', deps: [] }, s3: { parent: 's2', deps: [] } };
const linksWhole = (h) => whole[h] ?? null;
// …and the same lane after s1 and s2 aged out
const linksAged = (h) => (h === 's3' ? whole.s3 : null);
const kept = [change(1, ON, [], 'p1'), change(2, ADD_OFF, ['s2'], 'p2')];

describe('the kind: a silent, device-local entry (its row in the entry-kinds table)', () => {
  it('system lane, no wake, not mirrored, signed by nobody, accepted from nobody, carried nowhere', () => {
    const d = ENTRY_KINDS[CONTENT_JUDGED];
    expect(d, 'declared in the table').toBeDefined();
    expect(d.lane).toBe('system');
    expect(d.wakes).toBe(false);
    expect(d.audit).toBe(false);
    expect(isMirroredKind(CONTENT_JUDGED)).toBe(false);
    const b = bindingOf(CONTENT_JUDGED);
    expect(b.signs).toEqual([SIGNS.LOCAL]);
    expect(b.accepts).toBe(ACCEPTS.NONE);
    expect(b.syncPolicy).toBe(SYNC.NONE);
    expect(kindWakes(CONTENT_JUDGED)).toBe(false);
  });

  it('it leaves with the items statements: the same retention class as the lane it judges', () => {
    expect(retentionOf(CONTENT_JUDGED)).toBe(retentionOf('items'));
    expect(entryKind(CONTENT_JUDGED).retain).toBe(entryKind('items').retain);
  });
});

describe('condition 1: device-local (no mirror, no export, no count, no wake)', () => {
  it('a judgment on the log never reaches the history mirror (which the export runs), a count, a tile or a wake', async () => {
    const log = new EventLog({ initial: [], muted: [] });
    const src = memoryDataSource();
    const mirror = createHistoryMirror({ eventLog: log, source: src, batchMax: 1, flushMs: 5 });
    await mirror.start();
    const j = contentJudgmentsOn(log, CIRCLE);
    j.prove('s-secret-hash', 'p2', 'behind');
    j.keepPrevious('s-secret-hash', { id: 'r1', type: 'task', text: 'the row as it was' });
    await mirror.flush();
    const keys = await src.list('basis/history/');
    const all = [];
    for (const k of keys) all.push(String(await src.read(k) ?? ''));
    expect(all.join('\n')).not.toContain('s-secret-hash');
    expect(all.join('\n')).not.toContain('the row as it was');
    const entries = log.query({}).filter((e) => e.type === CONTENT_JUDGED);
    expect(entries.length, 'the entries are on the log').toBe(2);
    for (const e of entries) {
      expect(shouldWakeForEntry(e)).toBe(false);
      expect(countsAsUnread(e, { myRefs: ['me'] })).toBe(false);
    }
    const tile = buildTilePreviews({ events: entries, circles: [{ id: CIRCLE, name: 'k' }], myRefs: ['me'] })[CIRCLE];
    expect(tile.unread).toBe(0);
    expect(tile.subtitle ?? null).toBeNull();
    await mirror.stop();
  });

  it('two devices in one process never share a judgment (keyed on each device\'s own log)', () => {
    const a = new EventLog({ initial: [], muted: [] });
    const b = new EventLog({ initial: [], muted: [] });
    contentJudgmentsOn(a, CIRCLE).prove('s3', 'p2', 'not-behind');
    expect(contentJudgmentsOn(a, CIRCLE).relation('s3', 'p2')).toBe('not-behind');
    expect(contentJudgmentsOn(b, CIRCLE).relation('s3', 'p2')).toBeUndefined();
  });
});

describe('condition 2: no inbound door accepts the kind', () => {
  it('a signed statement of that kind handed to the items lane\'s door is refused and never lands', async () => {
    const id = await AgentIdentity.generate(new VaultMemory());
    const log = new EventLog({ initial: [], muted: [] });
    const registry = createRegistry(); registerCanonicalTypes(registry);
    const stores = createCircleStores({ dataSource: memoryDataSource(), registry });
    const rail = makeItemsRail({
      eventLog: log, circleIdentityFor: async () => id, myRef: 'webid:me', callSkill: async () => ({}),
      storeFor: (cid) => stores.getStore(cid), verifyBinding: async () => true, judge: { manifests: () => manifests },
    });
    const forged = signSpine(id, { kind: CONTENT_JUDGED, circleId: CIRCLE, subject: 's3', payload: { hash: 's3', change: 'p2', rel: 'behind', authorRef: 'webid:other' } });
    const door = makeItemsPeerHandler({ rail });
    await door(null, { subtype: ITEMS_BROADCAST, circleId: CIRCLE, event: forged });
    expect(log.query({}).some((e) => e.type === CONTENT_JUDGED), 'no judgment was taken from a peer').toBe(false);
    expect(contentJudgmentsOn(log, CIRCLE).relation('s3', 'p2')).toBeUndefined();
  });
});

describe('a proven answer is kept, and outlives the links that proved it', () => {
  it('judged while the lane is whole: the proof is kept; after the links aged out the same verdict comes from it', () => {
    const log = new EventLog({ initial: [], muted: [] });
    const proofs = contentJudgmentsOn(log, CIRCLE);
    const first = judgeItemStatement({ body: body('s1'), act: 'add', linksOf: linksWhole, kept, manifests, proofs });
    expect(first.verdict, 'behind the switch-off: made while adding was on').toBe('apply');
    expect(proofs.relation('s1', 'p2')).toBe('behind');
    // the links aged out: without the kept proof s1's place is unknown and the readings differ
    const aged = (h) => null;
    expect(judgeItemStatement({ body: body('s1'), act: 'add', linksOf: aged, kept, manifests }).verdict).toBe('park');
    expect(judgeItemStatement({ body: body('s1'), act: 'add', linksOf: aged, kept, manifests, proofs }).verdict, 'from the kept proof').toBe('apply');
  });

  it('settingsForContent reads a kept relation before it walks, and keeps what it proves', () => {
    const changes = contentLineChanges(kept);
    const asked = [];
    const proofs = { relation: (h, c) => { asked.push([h, c]); return undefined; }, prove: (h, c, r) => asked.push(['prove', h, c, r]) };
    settingsForContent({ hash: 's3', lane: 'items', linksOf: linksWhole, changes, proofs });
    expect(asked).toContainEqual(['s3', 'p2']);
    expect(asked).toContainEqual(['prove', 's3', 'p2', 'not-behind']);
  });

  it('an unknown place is never kept as a proof', () => {
    const log = new EventLog({ initial: [], muted: [] });
    const proofs = contentJudgmentsOn(log, CIRCLE);
    const gap = (h) => (h === 's3' ? { parent: 'missing', deps: [] } : null);
    judgeItemStatement({ body: body('s3'), act: 'add', linksOf: gap, kept, manifests, proofs });
    expect(proofs.relation('s3', 'p2')).toBeUndefined();
  });
});

describe('condition 3: losing an entry only means judging again, never a different answer', () => {
  for (const [label, b, act] of [['an add after the line', 's3', 'add'], ['an add behind the line', 's1', 'add'], ['a change after the line', 's3', 'change']]) {
    it(`${label}: the same verdict with the proof, without it (links held), and never the opposite one (links gone)`, () => {
      const log = new EventLog({ initial: [], muted: [] });
      const proofs = contentJudgmentsOn(log, CIRCLE);
      const proven = judgeItemStatement({ body: body(b), act, linksOf: linksWhole, kept, manifests, proofs }).verdict;
      const lost = judgeItemStatement({ body: body(b), act, linksOf: linksWhole, kept, manifests, proofs: contentJudgmentsOn(new EventLog({ initial: [], muted: [] }), CIRCLE) }).verdict;
      expect(lost).toBe(proven);
      const blind = judgeItemStatement({ body: body(b), act, linksOf: b === 's3' ? linksAged : () => null, kept, manifests }).verdict;
      expect([proven, 'park']).toContain(blind);
    });
  }
});

describe('the act a snapshot was is kept from its arrival', () => {
  it('an add that links itself to a parent nobody holds stays an add when judged again (a sender picks its own links)', async () => {
    const id = await AgentIdentity.generate(new VaultMemory());
    const writer = await AgentIdentity.generate(new VaultMemory());
    const log = new EventLog({ initial: [], muted: [] });
    const registry = createRegistry(); registerCanonicalTypes(registry);
    const stores = createCircleStores({ dataSource: memoryDataSource(), registry });
    const rail = makeItemsRail({
      eventLog: log, circleIdentityFor: async () => id, myRef: 'webid:me', callSkill: async () => ({}),
      storeFor: (cid) => stores.getStore(cid), verifyBinding: async () => true, judge: { manifests: () => manifests },
    });
    noteKeptPolicyChanges(log, CIRCLE, [change(1, ON, [], 'p1'), change(2, ADD_OFF, [], 'p2')]);
    const forged = signSpine(writer, { kind: 'snapshot', circleId: CIRCLE, subject: 'f1', payload: { item: { id: 'f1', type: 'task', text: 'pretends to be old' }, authorRef: 'webid:writer' }, parent: 'nobody-holds-this' });
    await rail.ingest(CIRCLE, forged);
    expect(await stores.getStore(CIRCLE).get('f1'), 'an add after the switch-off').toBeFalsy();
    expect(contentJudgmentsOn(log, CIRCLE).act(forged.body.hash)).toBe('add');
    noteKeptPolicyChanges(log, CIRCLE, [change(1, ON, [], 'p1'), change(2, ADD_OFF, [], 'p2')]);
    await rail.rejudge(CIRCLE);
    expect(await stores.getStore(CIRCLE).get('f1'), 'judged again: still the add it arrived as').toBeFalsy();
  });
});

describe('condition 4: the row as it was, only where a take-back needs it', () => {
  async function receiver() {
    const id = await AgentIdentity.generate(new VaultMemory());
    const log = new EventLog({ initial: [], muted: [] });
    const registry = createRegistry(); registerCanonicalTypes(registry);
    const stores = createCircleStores({ dataSource: memoryDataSource(), registry });
    const writer = await AgentIdentity.generate(new VaultMemory());
    const make = () => makeItemsRail({
      eventLog: log, circleIdentityFor: async () => id, myRef: 'webid:me', callSkill: async () => ({}),
      storeFor: (cid) => stores.getStore(cid), verifyBinding: async () => true, judge: { manifests: () => manifests },
    });
    return { log, stores, writer, rail: make(), make };
  }
  const snap = (writer, item, parent = null, deps = []) => signSpine(writer, { kind: 'snapshot', circleId: CIRCLE, subject: item.id, payload: { item, authorRef: 'webid:writer' }, parent, deps });

  it('a row whose making is on the log: nothing kept (the log rebuilds it)', async () => {
    const { log, stores, writer, rail } = await receiver();
    noteKeptPolicyChanges(log, CIRCLE, [change(1, ON, [], 'p1')]);
    const store = stores.getStore(CIRCLE);
    const made = snap(writer, { id: 't1', type: 'task', text: 'made' });
    await rail.ingest(CIRCLE, made);
    const row = await store.get('t1');
    const edit = snap(writer, { ...row, text: 'edited', clock: (row.clock ?? 0) + 5 }, made.body.hash);
    await rail.ingest(CIRCLE, edit);
    expect(contentJudgmentsOn(log, CIRCLE).previous(edit.body.hash)).toBeNull();
  });

  it('a row older than the log: the row as it was is kept beside its first change, and a take-back after a restart puts it back', async () => {
    const { log, stores, writer, rail, make } = await receiver();
    noteKeptPolicyChanges(log, CIRCLE, [change(1, ON, [], 'p1')]);
    const store = stores.getStore(CIRCLE);
    await store.put({ id: 't2', type: 'task', text: 'older than the log' }, { sync: false });
    const old = await store.get('t2');
    const edit = snap(writer, { ...old, text: 'raced edit', clock: (old.clock ?? 0) + 5 }, 'gone-parent-hash');
    await rail.ingest(CIRCLE, edit);
    expect((await store.get('t2'))?.text).toBe('raced edit');
    expect(contentJudgmentsOn(log, CIRCLE).previous(edit.body.hash)?.text, 'kept on the device log').toBe('older than the log');
    // a restart: a new rail over the same log and store (the in-memory state is gone; the log is not)
    const again = make();
    const changeAtoms = manifests.find((m) => m.app === 'tasks').nouns.task.atoms.filter((a) => !['add', 'list', 'remove'].includes(a));
    const changesOff = { capabilities: Object.fromEntries(changeAtoms.map((a) => [`tasks ${a} task`, { enabled: false }])) };
    noteKeptPolicyChanges(log, CIRCLE, [change(1, ON, [], 'p1'), change(2, changesOff, [], 'p2')]);
    await again.rejudge(CIRCLE);
    expect((await store.get('t2'))?.text, 'the refused change taken back to the kept row').toBe('older than the log');
  });
});
