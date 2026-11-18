import { describe, it, expect } from 'vitest';
import { entryKind, RETAIN, retentionWindowFor, SYNC, SIGNS, isMirroredKind } from '@onderling/item-store';
import { OWN_ACTION_KIND, makeOwnActionEntry, ownRetentionMs, OWN_KEEP_WEEKS, OWN_RECORD, DOORS, ownActIs, recordOwnAction, ownOutcome, ownActionRows, doorOnly, ownActionsLines } from '../src/ownActions.js';
import { EventLog } from '../src/eventLog.js';
import { allManifests } from '../src/v2/manifestSources.js';

const manifests = allManifests();

const WEEK = 7 * 24 * 60 * 60 * 1000;

describe('the person\'s own acts: the kind on the device log', () => {
  it('is system plumbing that never wakes, not audit, its own retention class, kept on this device only, mirrored to the person\'s own storage', () => {
    const k = entryKind(OWN_ACTION_KIND);
    expect(k).toMatchObject({ lane: 'system', wakes: false, retain: RETAIN.OWN, audit: false, syncPolicy: SYNC.NONE, signs: SIGNS.LOCAL });
    expect(isMirroredKind(OWN_ACTION_KIND)).toBe(true);
    expect(retentionWindowFor(RETAIN.OWN)).toBe(13 * WEEK);
  });

  it('the window is the person\'s setting in weeks (13 by default); 0 keeps everything; a bad value keeps the default', () => {
    expect(Number(OWN_KEEP_WEEKS)).toBe(13);
    expect(ownRetentionMs(4)).toBe(4 * WEEK);
    expect(ownRetentionMs(0)).toBe(Number.MAX_SAFE_INTEGER);
    expect(ownRetentionMs(-1)).toBe(13 * WEEK);
    expect(ownRetentionMs('x')).toBe(13 * WEEK);
    expect(OWN_RECORD.default ?? Boolean(OWN_RECORD)).toBeTruthy();
  });
});

describe('an own-action entry carries the whitelist and nothing else', () => {
  it('op, app, outcome, door, the circle, and the time; never arguments, text or another person', () => {
    const e = makeOwnActionEntry({ app: 'lists', op: 'addToList', outcome: 'ok', door: 'tap', circleId: 'c1', ts: 1000,
      args: { text: 'melk', who: 'Ans' }, person: 'Ans' });
    expect(e.type).toBe(OWN_ACTION_KIND);
    expect(e.circleId).toBe('c1');
    expect(e.ts).toBe(1000);
    expect(Object.keys(e.payload).sort()).toEqual(['app', 'door', 'op', 'outcome']);
    expect(JSON.stringify(e)).not.toMatch(/melk|Ans/);
  });

  it('a door it does not know is "unknown"; no op, no entry', () => {
    expect(makeOwnActionEntry({ app: 'lists', op: 'addToList', door: 'telepathy' }).payload.door).toBe('unknown');
    expect(DOORS).toContain('tap');
    expect(makeOwnActionEntry({ app: 'lists' })).toBe(null);
  });

  it('the log drops an own-action past its window, and keeps it all with 0', () => {
    let now = 100 * WEEK;
    const log = new EventLog({ now: () => now, retention: { own: ownRetentionMs(0) } });
    log.append(makeOwnActionEntry({ app: 'lists', op: 'addToList', outcome: 'ok', ts: now - 20 * WEEK }));
    log.append(makeOwnActionEntry({ app: 'lists', op: 'addToList', outcome: 'ok', ts: now - 1 * WEEK }));
    expect(log.query().filter((e) => e.type === OWN_ACTION_KIND).length).toBe(2);
    log.setRetention({ own: ownRetentionMs(13) });
    expect(log.query().filter((e) => e.type === OWN_ACTION_KIND).length).toBe(1);
  });
});

describe('which calls are the person\'s own acts (the outer waist)', () => {
  it('only a call that names a person door (Fable 2026-11-18: door-less is background); a door person never; an undeclared op never', () => {
    expect(ownActIs({ app: 'lists', op: 'addToList', ctx: { door: 'tap' }, manifests })).toBe(true);
    expect(ownActIs({ app: 'lists', op: 'addToList', ctx: {}, manifests }), 'a write no door names is background').toBe(false);
    expect(ownActIs({ app: 'lists', op: 'addToList', ctx: { door: 'unknown' }, manifests }), '"unknown" is no door').toBe(false);
    expect(ownActIs({ app: 'lists', op: 'addToList', ctx: { door: 'clock' }, manifests }), 'a planned row the person made').toBe(true);
    expect(ownActIs({ app: 'pinboard', op: 'listMyCircles', ctx: {}, manifests }), 'a paint read is not an act').toBe(false);
    expect(ownActIs({ app: 'lists', op: 'listEntries', ctx: { door: 'slash' }, manifests }), 'a read the person asked for').toBe(true);
    expect(ownActIs({ app: 'lists', op: 'addToList', ctx: { caller: 'someone-at-the-door' }, manifests }), 'a door person is not the owner').toBe(false);
    expect(ownActIs({ app: 'basis', op: 'noSuchOp', ctx: {}, manifests })).toBe(false);
  });

  it('records one entry per act with the outcome and the circle; the switch off records nothing; never an argument', () => {
    const appended = [];
    const deviceLog = { append: (e) => appended.push(e) };
    recordOwnAction({ manifests, deviceLog, enabled: true, app: 'lists', op: 'addToList', args: { circleId: 'c1', text: 'melk' }, ctx: { door: 'tap' }, result: { ok: true } });
    recordOwnAction({ manifests, deviceLog, enabled: true, app: 'lists', op: 'addToList', args: { groupId: 'g2' }, ctx: { door: 'phrase' }, result: { ok: false, error: 'x' } });
    recordOwnAction({ manifests, deviceLog, enabled: true, app: 'lists', op: 'addToList', args: { circleId: 'c3' }, ctx: {}, result: { ok: true } });   // background
    recordOwnAction({ manifests, deviceLog, enabled: true, app: 'pinboard', op: 'listMyCircles', args: {}, ctx: {}, result: { ok: true } });
    recordOwnAction({ manifests, deviceLog, enabled: false, app: 'lists', op: 'addToList', args: {}, ctx: { door: 'tap' }, result: { ok: true } });
    expect(appended.map((e) => [e.payload.op, e.payload.outcome, e.payload.door, e.circleId])).toEqual([
      ['addToList', 'ok', 'tap', 'c1'], ['addToList', 'failed', 'phrase', 'g2'],
    ]);
    expect(JSON.stringify(appended)).not.toMatch(/melk/);
  });

  it('a log that throws never breaks the act', () => {
    expect(() => recordOwnAction({ deviceLog: { append: () => { throw new Error('full'); } }, enabled: true, app: 'lists', op: 'addToList', ctx: {}, result: {} })).not.toThrow();
  });
});

describe('the outcome: refused is not failed', () => {
  it('a gate or a rule that says no is refused; something that broke is failed; anything else is ok', () => {
    expect(ownOutcome({ ok: true })).toBe('ok');
    expect(ownOutcome({ items: [] })).toBe('ok');
    // the waist's refusals: the shape renderA2A already gives, the op's own "not yours", and "no self in this circle"
    expect(ownOutcome({ ok: false, error: 'not-bound', refusal: { layer: 'admission', code: 'not-bound' } })).toBe('refused');
    expect(ownOutcome({ ok: false, code: 'forbidden', error: 'not yours' })).toBe('refused');
    expect(ownOutcome({ ok: false, code: 'no-self', error: 'x' })).toBe('refused');
    // the kernel's gate throws
    const denied = Object.assign(new Error('denied'), { name: 'PolicyDeniedError', code: 'capability' });
    expect(ownOutcome(null, denied)).toBe('refused');
    // broken things
    expect(ownOutcome({ ok: false, code: 'not-found', error: 'x' })).toBe('failed');
    expect(ownOutcome({ ok: false, error: 'boom' })).toBe('failed');
    expect(ownOutcome(null, new Error('network'))).toBe('failed');
  });

  it('recordOwnAction writes refused for a call the waist turned down', () => {
    const deviceLog = new EventLog({ initial: [], muted: [] });
    recordOwnAction({ deviceLog, app: 'lists', op: 'addToList', args: { circleId: 'c1' }, ctx: { door: 'tap' }, result: { ok: false, code: 'forbidden', error: 'no' }, manifests });
    expect(deviceLog.query().find((e) => e.type === OWN_ACTION_KIND)?.payload?.outcome).toBe('refused');
  });
});

describe('reading the record back, and what goes down to the waist', () => {
  it('ownActionRows: only this kind, oldest first, the whitelisted fields', () => {
    const deviceLog = new EventLog({ initial: [], muted: [] });
    const t0 = Date.now() - 60_000;   // inside the retention window: the log drops what is older
    let t = t0;
    const now = () => (t += 10);
    recordOwnAction({ deviceLog, app: 'lists', op: 'addToList', args: { circleId: 'c1', item: 'melk' }, ctx: { door: 'tap' }, result: { ok: true }, manifests, now });
    deviceLog.append({ id: 'x', type: 'chat-message', ts: t0 + 15, circleId: 'c1', payload: { text: 'hoi' } });
    recordOwnAction({ deviceLog, app: 'lists', op: 'listLists', args: {}, ctx: { door: 'slash' }, result: { ok: true }, manifests, now });
    expect(ownActionRows(deviceLog)).toEqual([
      { ts: t0 + 10, circleId: 'c1', app: 'lists', op: 'addToList', outcome: 'ok', door: 'tap' },
      { ts: t0 + 20, circleId: null, app: 'lists', op: 'listLists', outcome: 'ok', door: 'slash' },
    ]);
  });
  it('doorOnly: the door and nothing else of a turn\'s context; no door, no context', () => {
    expect(doorOnly({ door: 'model', msgId: 'm1', history: [1] })).toEqual({ door: 'model' });
    expect(doorOnly({ msgId: 'm1' })).toBeUndefined();
    expect(doorOnly(undefined)).toBeUndefined();
  });
});

describe('the row\'s words under My data', () => {
  it('none, one and more read apart; off says nothing is being recorded, and keeps the count', () => {
    const t = (k, v) => (v ? `${k} ${JSON.stringify(v)}` : k);
    expect(ownActionsLines({ count: 0, t })).toEqual({ count: 'circle.mydata.own_actions_none', off: null });
    expect(ownActionsLines({ count: 1, t }).count).toBe('circle.mydata.own_actions_count_one');
    expect(ownActionsLines({ count: 7, t }).count).toBe('circle.mydata.own_actions_count_n {"count":7}');
    expect(ownActionsLines({ on: false, count: 7, t })).toEqual({ count: 'circle.mydata.own_actions_count_n {"count":7}', off: 'circle.mydata.own_actions_off' });
  });
});
