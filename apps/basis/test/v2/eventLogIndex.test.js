/**
 * THE LOG'S INDEX (fast start, step 2): a lane read costs its lane, not a copy of the whole log per statement. Before
 * it, every stored-statement lookup was `query({})` (a copy of the whole log plus a filter), and a membership read asked
 * for it once per statement it bound: two walks per statement (measured 1.98).
 */
import { describe, it, expect, vi } from 'vitest';
import { AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { EventLog } from '../../src/eventLog.js';
import { makeCircleEntryRail } from '../../src/v2/circleEntryRail.js';

const C = 'circle:idx';
const viaQuery = (log, type, circleId) => log.query({}).filter((e) => e.type === type && (e.circleId ?? e.payload?.circleId ?? null) === circleId);
const same = (log, type, c) => expect(log.entriesOf(type, c).map((e) => e.id)).toEqual(viaQuery(log, type, c).map((e) => e.id));

describe('the EventLog index answers what query + filter answers, after every kind of change', () => {
  it('append, re-append, compact, forget, purge, hydrate', () => {
    const log = new EventLog({ initial: [], muted: [] });
    for (let i = 0; i < 6; i++) log.appendSilentEntry({ circleId: i % 2 ? C : 'other', kind: 'membership', payload: { n: i }, id: `m${i}` });
    log.append({ id: 'chat1', app: 'chat', type: 'message', ts: Date.now(), payload: { circleId: C, text: 'hoi' } });
    same(log, 'membership', C); same(log, 'membership', 'other'); same(log, 'message', C);
    expect(log.entryById('m3')?.payload).toEqual({ n: 3 });
    log.append({ id: 'chat1', app: 'chat', type: 'message', ts: Date.now(), payload: { circleId: C, text: 'hoi!' } });   // re-append
    same(log, 'message', C);
    log.compactEntries(['m1'], (e) => ({ ...e, payload: { tombstone: true } }));
    expect(log.entryById('m1')?.payload).toEqual({ tombstone: true });
    same(log, 'membership', C);
    log.forgetCircle('other');
    same(log, 'membership', 'other'); expect(log.entryById('m0')).toBe(null);
    log.purgeConversation({ olderThanMs: -1, circleId: C });
    same(log, 'message', C);
    log.hydrate([{ id: 'h1', type: 'membership', circleId: C, payload: { n: 'h' }, ts: Date.now() }]);
    same(log, 'membership', C); expect(log.entryById('h1')).not.toBe(null);
  });
});

describe('a lane read walks the log a constant number of times, not per statement', () => {
  it('N statements bound by a verifier that looks up the lane each time: no whole-log walk per statement', async () => {
    const log = new EventLog({ initial: [], muted: [] });
    const me = await AgentIdentity.generate(new VaultMemory());
    let rail = null;
    rail = makeCircleEntryRail({
      eventLog: log, entryKind: 'governance', declaredKinds: ['propose'],
      signerFor: async () => ({ identity: me, ref: 'webid:me' }),
      // as the membership binder does (its chain map, its own-retirement cut): the lane's statements, per statement
      verifyBinding: async ({ circleId }) => { rail.storedStatements(circleId); return true; },
    });
    const N = 12;
    for (let i = 0; i < N; i++) await rail.append(C, { kind: 'propose', subject: `p${i}`, payload: { action: 'x', subject: {}, by: 'webid:me', at: i } });
    // read as ANOTHER device of the circle would: the statements are foreign there, so each one is bound by the verifier
    const other = await AgentIdentity.generate(new VaultMemory());
    let reader = null;
    reader = makeCircleEntryRail({
      eventLog: log, entryKind: 'governance', declaredKinds: ['propose'],
      signerFor: async () => ({ identity: other, ref: 'webid:other' }),
      verifyBinding: async ({ circleId }) => { reader.storedStatements(circleId); bound += 1; return true; },
    });
    let bound = 0;
    const spy = vi.spyOn(EventLog.prototype, 'query');
    try {
      const { events } = await reader.readVerified(C);
      expect(events).toHaveLength(N);
      expect(bound, 'the verifier was asked per statement').toBe(N);
      expect(spy.mock.calls.length, 'whole-log walks for one read of the lane').toBeLessThanOrEqual(1);
    } finally { spy.mockRestore(); }
  });
});
