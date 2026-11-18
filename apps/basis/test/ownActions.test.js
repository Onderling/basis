import { describe, it, expect } from 'vitest';
import { entryKind, RETAIN, retentionWindowFor, SYNC, SIGNS, isMirroredKind } from '@onderling/item-store';
import { OWN_ACTION_KIND, makeOwnActionEntry, ownRetentionMs, OWN_KEEP_WEEKS, OWN_RECORD, DOORS, ownActIs, recordOwnAction } from '../src/ownActions.js';
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
  it('an op that writes always; a read only when a door says a person asked; a door person never; an undeclared op never', () => {
    expect(ownActIs({ app: 'lists', op: 'addToList', ctx: {}, manifests })).toBe(true);
    expect(ownActIs({ app: 'pinboard', op: 'listMyCircles', ctx: {}, manifests }), 'a paint read is not an act').toBe(false);
    expect(ownActIs({ app: 'lists', op: 'listEntries', ctx: { door: 'slash' }, manifests }), 'a read the person asked for').toBe(true);
    expect(ownActIs({ app: 'lists', op: 'addToList', ctx: { caller: 'someone-at-the-door' }, manifests }), 'a door person is not the owner').toBe(false);
    expect(ownActIs({ app: 'basis', op: 'noSuchOp', ctx: {}, manifests })).toBe(false);
  });

  it('records one entry per act with the outcome and the circle; the switch off records nothing; never an argument', () => {
    const appended = [];
    const deviceLog = { append: (e) => appended.push(e) };
    recordOwnAction({ manifests, deviceLog, enabled: true, app: 'lists', op: 'addToList', args: { circleId: 'c1', text: 'melk' }, ctx: { door: 'tap' }, result: { ok: true } });
    recordOwnAction({ manifests, deviceLog, enabled: true, app: 'lists', op: 'addToList', args: { groupId: 'g2' }, ctx: {}, result: { ok: false, error: 'x' } });
    recordOwnAction({ manifests, deviceLog, enabled: true, app: 'pinboard', op: 'listMyCircles', args: {}, ctx: {}, result: { ok: true } });
    recordOwnAction({ manifests, deviceLog, enabled: false, app: 'lists', op: 'addToList', args: {}, ctx: {}, result: { ok: true } });
    expect(appended.map((e) => [e.payload.op, e.payload.outcome, e.payload.door, e.circleId])).toEqual([
      ['addToList', 'ok', 'tap', 'c1'], ['addToList', 'failed', 'unknown', 'g2'],
    ]);
    expect(JSON.stringify(appended)).not.toMatch(/melk/);
  });

  it('a log that throws never breaks the act', () => {
    expect(() => recordOwnAction({ deviceLog: { append: () => { throw new Error('full'); } }, enabled: true, app: 'lists', op: 'addToList', ctx: {}, result: {} })).not.toThrow();
  });
});
