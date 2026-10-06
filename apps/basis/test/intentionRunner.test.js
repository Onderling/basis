/**
 * The runner: one host job that asks `due` and runs each due occurrence through the door AS its person, with the
 * occurrence id; a run that went through leaves a done-mark on the device log (first write wins) and moves the row;
 * a "not yet" (quiet hours) leaves it due; a failure is said once and tried again next tick. One row's failure never
 * stops another's.
 */
import { describe, it, expect } from 'vitest';
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
    release();
    await Promise.all([one, two]);
    expect(w.calls).toHaveLength(1);
  });
});
