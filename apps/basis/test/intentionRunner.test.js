/**
 * The runner: one host job that asks `due` and runs each due occurrence through the door AS its person, with the
 * occurrence id; a run that went through leaves a done-mark on the device log (first write wins) and moves the row;
 * a "not yet" (quiet hours) leaves it due; a failure is said once and tried again next tick. One row's failure never
 * stops another's.
 */
import { describe, it, expect, vi } from 'vitest';
import { memoryDataSource, ENTRY_KINDS, isAuditKind, kindWakes, retentionOf } from '@onderling/item-store';
import { EventLog } from '../src/eventLog.js';
import { createOwnDevicesStore } from '../src/v2/ownDevicesStore.js';
import { createIntentionBook } from '../src/v2/intentionBook.js';
import { createIntentionRunner, INTENTION_DONE_KIND } from '../src/v2/intentionRunner.js';

const TZ = 'Europe/Amsterdam';
const SUN_1930 = Date.parse('2026-10-11T17:30:00Z');
const weekly = (actsAs = 'telegram:1') => ({ trigger: { every: 'week', on: 'sun', at: '18:00' }, op: 'sendWeekOverview', appOrigin: 'assistant', args: {}, actsAs, label: 'week overview' });

async function world({ now = SUN_1930, run } = {}) {
  let at = now;
  const book = createIntentionBook({ store: createOwnDevicesStore({ dataSource: memoryDataSource() }), actor: 'bot', now: () => at });
  await book.load();
  const log = new EventLog({ initial: [], muted: [] });
  const calls = [];
  const fired = [];
  const runner = createIntentionRunner({
    book, log, tz: TZ, now: () => at,
    run: async (o) => { calls.push(o); return run ? run(o) : { ok: true }; },
    onFired: (e) => fired.push(e),
  });
  // rows are made before the Sunday, so that Sunday is owed
  const intend = async (spec) => { const keep = at; at = Date.parse('2026-10-05T10:00:00Z'); const r = await book.intend(spec); at = keep; return r; };
  return { book, log, runner, calls, fired, intend, setNow: (t) => { at = t; } };
}

describe('the done-mark kind', () => {
  it('is declared: system lane, never wakes, short retention, first write wins', () => {
    expect(ENTRY_KINDS[INTENTION_DONE_KIND]).toBeTruthy();
    expect(kindWakes(INTENTION_DONE_KIND)).toBe(false);
    expect(retentionOf(INTENTION_DONE_KIND)).toBe('short');
    expect(isAuditKind(INTENTION_DONE_KIND)).toBe(true);
  });
});

describe('the intention runner', () => {
  it('runs a due row once, as its person, with the occurrence id — and not again', async () => {
    const w = await world();
    const row = await w.intend(weekly());
    await w.runner.pass();
    expect(w.calls.map((c) => [c.appOrigin, c.op, c.actsAs, c.id])).toEqual([['assistant', 'sendWeekOverview', 'telegram:1', `${row.id}:2026-10-11`]]);
    expect(w.log.query({ filter: { type: INTENTION_DONE_KIND } })).toHaveLength(1);
    expect(w.fired).toEqual([expect.objectContaining({ occurrence: `${row.id}:2026-10-11`, outcome: 'ran', actsAs: 'telegram:1' })]);
    await w.runner.pass();
    expect(w.calls).toHaveLength(1);
  });

  it('a done-mark alone is enough: a crash between the mark and the row update does not run it twice', async () => {
    const w = await world();
    const row = await w.intend(weekly());
    w.log.append({ id: `${INTENTION_DONE_KIND}:${row.id}:2026-10-11`, type: INTENTION_DONE_KIND, ts: SUN_1930, payload: { occurrence: `${row.id}:2026-10-11` } });
    await w.runner.pass();
    expect(w.calls).toEqual([]);
  });

  it('a cancelled row and a row still ahead do not run', async () => {
    const w = await world({ now: Date.parse('2026-10-11T10:00:00Z') });   // Sunday morning
    const a = await w.intend(weekly('telegram:1'));
    await w.intend(weekly('telegram:2'));
    await w.book.cancel(a.id);
    await w.runner.pass();
    expect(w.calls).toEqual([]);
  });

  it('"not yet" (quiet hours) leaves it due and is said once; it runs when it can', async () => {
    let quiet = true;
    const w = await world({ run: () => (quiet ? { ok: false, notYet: 'quiet' } : { ok: true }) });
    await w.intend(weekly());
    await w.runner.pass();
    await w.runner.pass();
    expect(w.fired.map((f) => [f.outcome, f.reason])).toEqual([['not-yet', 'quiet']]);
    quiet = false;
    await w.runner.pass();
    expect(w.fired.map((f) => f.outcome)).toEqual(['not-yet', 'ran']);
    expect(w.log.query({ filter: { type: INTENTION_DONE_KIND } })).toHaveLength(1);
  });

  it("a failure is said once and tried again; one row's failure never stops another's", async () => {
    const w = await world({ run: (o) => { if (o.actsAs === 'telegram:1') throw new Error('door down'); return { ok: true }; } });
    await w.intend(weekly('telegram:1'));
    await w.intend(weekly('telegram:2'));
    await w.runner.pass();
    await w.runner.pass();
    expect(w.fired.filter((f) => f.actsAs === 'telegram:1').map((f) => [f.outcome, f.reason])).toEqual([['failed', 'door down']]);
    expect(w.fired.filter((f) => f.actsAs === 'telegram:2').map((f) => f.outcome)).toEqual(['ran']);
    expect(w.calls.filter((c) => c.actsAs === 'telegram:1')).toHaveLength(2);
  });

  it('two passes at once never run one occurrence twice', async () => {
    let release;
    const w = await world({ run: () => new Promise((r) => { release = () => r({ ok: true }); }) });
    await w.intend(weekly());
    const one = w.runner.pass();
    const two = w.runner.pass();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));   // the first pass reads the stores, then runs
    release();
    await Promise.all([one, two]);
    expect(w.calls).toHaveLength(1);
  });
});

describe('a row that lands in a circle store later', () => {
  it('is run on the next pass — the book is read again each pass, not only at boot', async () => {
    const { createCircleStores } = await import('@onderling/item-store');
    const { validate } = await import('@onderling/item-types');
    const home = createCircleStores({ dataSource: memoryDataSource(), registry: { validate } }).getStore('c-home');
    let at = SUN_1930;
    const book = createIntentionBook({ store: createOwnDevicesStore({ dataSource: memoryDataSource() }), circles: async () => [{ scope: 'c-home', store: home }], actor: 'bot', now: () => at });
    await book.load();
    const log = new EventLog({ initial: [], muted: [] });
    const calls = [];
    const runner = createIntentionRunner({ book, log, tz: TZ, now: () => at, run: async (o) => { calls.push(o); return { ok: true }; }, mayRun: () => true, claimAs: 'host-a' });
    await runner.pass();
    expect(calls).toEqual([]);
    // a member's device wrote it; it synced into this host's copy of the circle's store
    await home.put({ type: 'intention', ...weekly('telegram:2'), state: 'open', createdAt: '2026-10-05T10:00:00.000Z' }, { by: 'member' });
    await runner.pass();
    expect(calls.map((c) => c.actsAs)).toEqual(['telegram:2']);
  });
});

describe('who a circle row may act as', () => {
  async function circleWorld({ mayRun } = {}) {
    const { createCircleStores } = await import('@onderling/item-store');
    const { validate } = await import('@onderling/item-types');
    const home = createCircleStores({ dataSource: memoryDataSource(), registry: { validate } }).getStore('c-home');
    const book = createIntentionBook({ store: createOwnDevicesStore({ dataSource: memoryDataSource() }), circles: async () => [{ scope: 'c-home', store: home }], actor: 'bot', now: () => SUN_1930 });
    const calls = [];
    const fired = [];
    const runner = createIntentionRunner({ book, log: new EventLog({ initial: [], muted: [] }), tz: TZ, now: () => SUN_1930, run: async (o) => { calls.push(o); return { ok: true }; }, onFired: (e) => fired.push(e), claimAs: 'host-a', ...(mayRun ? { mayRun } : {}) });
    // any member can write a row naming anyone: the store does not prove who wrote it
    await home.put({ type: 'intention', ...weekly('telegram:admin'), state: 'open', createdAt: '2026-10-05T10:00:00.000Z' }, { by: 'member' });
    return { runner, calls, fired, book };
  }

  it('by default, a row from a circle\'s store is not run as the person it names — said once, not run', async () => {
    const w = await circleWorld();
    await w.runner.pass();
    await w.runner.pass();
    expect(w.calls).toEqual([]);
    expect(w.fired).toEqual([expect.objectContaining({ outcome: 'refused', actsAs: 'telegram:admin' })]);
  });

  it('a host\'s own rule may let one through (the op, the scope, who it acts as)', async () => {
    const w = await circleWorld({ mayRun: (o, scope) => (scope === 'c-home' && o.op === 'sendWeekOverview' ? true : 'no authority') });
    await w.runner.pass();
    expect(w.calls.map((c) => c.actsAs)).toEqual(['telegram:admin']);
  });
});

describe('two hosts holding one circle row', () => {
  it('the first to claim it runs it; the other, once the claim has reached it, leaves it — that week and the next', async () => {
    const { createCircleStores } = await import('@onderling/item-store');
    const { validate } = await import('@onderling/item-types');
    // one store object stands for the circle's store once both hosts' copies agree (the sync is not under test here)
    const home = createCircleStores({ dataSource: memoryDataSource(), registry: { validate } }).getStore('c-home');
    await home.put({ type: 'intention', ...weekly('household'), state: 'open', createdAt: '2026-10-05T10:00:00.000Z' }, { by: 'member' });
    let at = SUN_1930;
    const host = (name) => {
      const book = createIntentionBook({ store: createOwnDevicesStore({ dataSource: memoryDataSource() }), circles: async () => [{ scope: 'c-home', store: home }], actor: name, now: () => at });
      const calls = [];
      const fired = [];
      const runner = createIntentionRunner({ book, log: new EventLog({ initial: [], muted: [] }), tz: TZ, now: () => at, claimAs: name, mayRun: () => true, run: async (o) => { calls.push(o); return { ok: true }; }, onFired: (e) => fired.push(e) });
      return { calls, fired, runner };
    };
    const a = host('host-a');
    const b = host('host-b');
    await a.runner.pass();
    expect((await home.get((await home.listByType('intention'))[0].id)).assignees).toEqual(['host-a']);
    await b.runner.pass();
    expect(a.calls).toHaveLength(1);
    expect(b.calls).toHaveLength(0);
    // that Sunday's run is on the row (its last run), so nothing is owed — host B is not even asked again
    expect(b.fired).toEqual([]);
    // a week on, the row is still host A's
    at = SUN_1930 + 7 * 86_400_000;
    await b.runner.pass();
    await a.runner.pass();
    expect(a.calls).toHaveLength(2);
    expect(b.calls).toHaveLength(0);
    expect(b.fired).toEqual([expect.objectContaining({ outcome: 'elsewhere', reason: 'claimed by host-a' })]);
  });
});

describe('event rows, on a change', () => {
  const eventRow = { trigger: { event: { kind: 'added', type: 'calendar-event' } }, op: 'announceChange', appOrigin: 'assistant', args: {}, actsAs: 'household', label: 'announce' };
  const appt = { id: 'e1', type: 'calendar-event', title: 'tandarts', startsAt: '2026-10-12T12:00:00.000Z', clock: 1 };

  it('a change fires the matching rows once, through the same run, with the change in its args', async () => {
    const w = await world();
    await w.book.intend(eventRow);
    await w.runner.onChange({ circleId: 'c1', before: null, after: appt });
    await w.runner.onChange({ circleId: 'c1', before: null, after: appt });   // the same change, delivered twice
    expect(w.calls).toHaveLength(1);
    expect(w.calls[0]).toMatchObject({ op: 'announceChange', actsAs: 'household', args: { change: { circleId: 'c1', itemId: 'e1' } } });
    expect(w.fired).toEqual([expect.objectContaining({ outcome: 'ran', occurrence: expect.stringMatching(/:e1:1$/) })]);
  });

  it('what a host writes while an event row runs fires no event row (no loops); a person\'s write does', async () => {
    let feed;
    const w = await world({ run: async () => { await feed({ circleId: 'c1', before: null, after: { ...appt, id: 'e2' } }, { origin: 'own' }); return { ok: true }; } });
    feed = (c, o) => w.runner.onChange(c, o);
    await w.book.intend(eventRow);
    await w.runner.onChange({ circleId: 'c1', before: null, after: appt }, { origin: 'own' });
    expect(w.calls.map((c) => c.args.change.itemId)).toEqual(['e1']);
    await w.runner.onChange({ circleId: 'c1', before: null, after: { ...appt, id: 'e3' } }, { origin: 'own' });
    expect(w.calls.map((c) => c.args.change.itemId)).toEqual(['e1', 'e3']);
  });
});

describe('what a fired row writes', () => {
  it('is written under the row\'s origin: the host\'s ambient origin is the row while its op runs', async () => {
    const { AsyncLocalStorage } = await import('node:async_hooks');
    const running = new AsyncLocalStorage();
    const seen = [];
    const book = createIntentionBook({ store: createOwnDevicesStore({ dataSource: memoryDataSource() }), actor: 'bot', now: () => SUN_1930 });
    await book.load();
    const runner = createIntentionRunner({
      book, log: new EventLog({ initial: [], muted: [] }), tz: TZ, now: () => SUN_1930,
      withOrigin: (origin, fn) => running.run(origin, fn),
      run: async () => { await Promise.resolve(); seen.push(running.getStore() ?? null); return { ok: true }; },
    });
    const row = await book.intend({ trigger: { event: { kind: 'added', type: 'calendar-event' } }, op: 'announceChange', appOrigin: 'assistant', args: {}, actsAs: 'household' });
    await runner.onChange({ circleId: 'c1', before: null, after: { id: 'e1', type: 'calendar-event', clock: 1 } });
    expect(seen).toEqual([{ intention: row.id }]);
    expect(running.getStore(), 'outside the run there is none').toBeUndefined();
  });
});
