/**
 * EVERY REFUSAL SAYS WHY (L857). A statement a device refuses (its signature, its format, whose key it is, a gate)
 * leaves one record in the device's own structured log (`@onderling/logger`: codes and counts, never content), so a
 * walk, a bug report or the log report can name it. Found on 2026-11-13: every old-format spine statement on a phone
 * was refused with nothing in the log.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { dumpLogs, clearLogs } from '@onderling/logger';
import { makeRefusalLog, refusalCode } from '../../src/v2/refusalLog.js';
import { makeCircleEntryRail } from '../../src/v2/circleEntryRail.js';

const CIRCLE = 'circle:g1';
const refusals = () => dumpLogs().filter((r) => r.code === 'refused');

function fakeEventLog() {
  const entries = [];
  const byId = new Set();
  return {
    entries,
    query() { return entries.slice(); },
    appendSilentEntry({ circleId, kind, payload, id }) {
      if (byId.has(id)) return entries.find((e) => e.id === id);
      byId.add(id);
      const entry = { id, type: kind, circleId, payload, silent: true };
      entries.push(entry);
      return entry;
    },
  };
}

describe('the refusal log', () => {
  beforeEach(() => clearLogs());

  it('a reason becomes a short code; the part after the colon is its detail', () => {
    expect(refusalCode('unsupported version: onderling/spine.v1')).toEqual({ reason: 'unsupported-version', detail: 'onderling/spine.v1' });
    expect(refusalCode('bad signature')).toEqual({ reason: 'bad-signature', detail: null });
    expect(refusalCode(null)).toEqual({ reason: 'unknown', detail: null });
  });

  it('a reason outside the closed set is "other"; a detail keeps only a short run of safe characters', () => {
    expect(refusalCode('totally new reason x1: whatever')).toEqual({ reason: 'other', detail: null });
    const r = refusalCode('unsupported version: <script>alert(1)</script>' + 'v'.repeat(200));
    expect(r.reason).toBe('unsupported-version');
    expect(r.detail.length).toBeLessThanOrEqual(32);
    expect(r.detail).toMatch(/^[A-Za-z0-9._/-]+$/);
    // a sender minting reasons cannot grow the table: every unknown head is one key
    const log = makeRefusalLog({ now: () => 0, windowMs: 1000 });
    for (let i = 0; i < 500; i += 1) log.note({ lane: 'membership', check: 'verify', reason: `made up ${i}: x` });
    expect(log.size).toBe(1);
  });

  it('the first refusal is written at once; repeats are counted and written once per window', () => {
    let t = 0;
    const r = makeRefusalLog({ now: () => t, windowMs: 1000 });
    r.note({ lane: 'membership', check: 'verify', reason: 'unsupported version: onderling/spine.v1' });
    for (let i = 0; i < 395; i += 1) r.note({ lane: 'membership', check: 'verify', reason: 'unsupported version: onderling/spine.v1' });
    expect(refusals().length, 'one record for the first, the rest wait for the window').toBe(1);
    t = 1500;
    r.note({ lane: 'membership', check: 'verify', reason: 'unsupported version: onderling/spine.v1' });
    const recs = refusals();
    expect(recs.length).toBe(2);
    expect(recs[1].f).toMatchObject({ lane: 'membership', check: 'verify', reason: 'unsupported-version', checks: 396, totalChecks: 397 });
  });

  it('a refused statement read through the rail leaves a record naming the lane, the check and why', async () => {
    const me = { ref: 'webid:alice', identity: await AgentIdentity.generate(new VaultMemory()) };
    const eventLog = fakeEventLog();
    const rail = makeCircleEntryRail({
      eventLog, signerFor: async () => ({ identity: me.identity, ref: me.ref }), entryKind: 'governance', declaredKinds: ['propose'],
      refusalLog: makeRefusalLog({ now: () => 0, windowMs: 1000 }),
    });
    await rail.append(CIRCLE, { kind: 'propose', subject: 'p1', payload: { action: 'x', subject: {}, by: me.ref, at: 0 } });
    // the statement as a device that kept the OLD format holds it
    eventLog.entries[0].payload = { ...eventLog.entries[0].payload, body: { ...eventLog.entries[0].payload.body, v: 'onderling/spine.v1' } };
    const { bodies } = await rail.readVerifiedBodies(CIRCLE);
    expect(bodies.length, 'refused').toBe(0);
    const recs = refusals();
    expect(recs.length, 'the refusal is in the log').toBeGreaterThanOrEqual(1);
    expect(recs[0]).toMatchObject({ tag: 'rail', code: 'refused', f: { lane: 'governance', check: 'verify', reason: 'unsupported-version' } });
    expect(JSON.stringify(recs[0]), 'no circle id or key in the record').not.toMatch(/circle:g1|webid:alice/);
  });
});
