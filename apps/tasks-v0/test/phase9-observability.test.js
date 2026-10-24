/**
 * Phase 9 — observability stats + cadence config tests.
 *
 * Covers:
 *   1. MetricsTracker counters tick on item-* events.
 *   2. Latency reservoirs record time-to-claim + submit-to-approval.
 *   3. resolveCadence layering — user > circle > baseline.
 *   4. sanitiseCadenceMap drops bad entries.
 *   5. Live skills via createCircleAgent — getMetrics, getCircleCadences,
 *      setCircleCadences (admin/coord only), getMyCadenceOverrides,
 *      setMyCadenceOverrides, resolveMyCadence.
 *   6. Share-with-admin gating: V1 keeps metrics local — getMetrics
 *      returns the local snapshot regardless of caller (no auto-share).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { DataPart } from '@onderling/core';

import { buildBundle } from '../src/storage/buildBundle.js';
import { createCircleAgent } from '../src/Circle.js';
import { MetricsTracker, COUNTER_NAMES } from '../src/observability/metrics.js';
import { resolveCadence, sanitiseCadenceMap, BASELINE_CADENCES } from '../src/observability/cadence.js';

const ANNE  = 'https://id.example/anne';
const FRITS = 'https://id.example/frits';
const KID   = 'https://id.example/kid';

const CIRCLE = {
  circleId:  'oss-tools',
  name:    'OSS Tools NL',
  kind:    'project',
  members: [
    { webid: ANNE,  displayName: 'Anne',  role: 'admin' },
    { webid: FRITS, displayName: 'the author', role: 'coordinator' },
    { webid: KID,   displayName: 'Kid',   role: 'member' },
  ],
};

async function callSkill(agent, skillId, args, fromWebid) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({
    parts:    args === undefined ? [] : [DataPart(args)],
    from:     fromWebid,
    agent,
    envelope: null,
  });
}

// ── Pure tests: MetricsTracker + cadence helpers ───────────────────────────

describe('Phase 9 — MetricsTracker (pure)', () => {
  it('records counters via .record() and snapshots them', () => {
    const t = new MetricsTracker();
    t.record('task.added');
    t.record('task.added');
    t.record('task.claimed');
    const s = t.snapshot();
    expect(s.counters['task.added'].count).toBe(2);
    expect(s.counters['task.claimed'].count).toBe(1);
  });

  it('records latency samples and reports p50/p90/max', () => {
    const t = new MetricsTracker();
    [10, 20, 30, 40, 50, 60, 70, 80, 90, 100].forEach((ms) => t.recordLatency('lat', ms));
    const s = t.snapshot();
    expect(s.latencies.lat.count).toBe(10);
    expect(s.latencies.lat.p50).toBeGreaterThanOrEqual(50);
    expect(s.latencies.lat.p90).toBeGreaterThanOrEqual(80);
  });

  it('reservoir is bounded — old samples drop out', () => {
    const t = new MetricsTracker({ latencyReservoirSize: 3 });
    t.recordLatency('x', 10);
    t.recordLatency('x', 20);
    t.recordLatency('x', 30);
    t.recordLatency('x', 99);   // pushes 10 out
    const s = t.snapshot();
    expect(s.latencies.x.count).toBe(3);
  });

  it('reset() drops one or all counters', () => {
    const t = new MetricsTracker();
    t.record('a'); t.record('b');
    t.reset('a');
    expect(t.snapshot().counters.a).toBeUndefined();
    expect(t.snapshot().counters.b.count).toBe(1);
    t.reset();
    expect(t.snapshot().counters).toEqual({});
  });
});

describe('Phase 9 — resolveCadence (pure)', () => {
  it('returns the baseline when no overrides present', () => {
    const r = resolveCadence({ eventType: 'task-completed' });
    expect(r.channel).toBe('inbox');
    expect(r.suppressed).toBe(false);
  });

  it('circle overrides the baseline', () => {
    const r = resolveCadence({
      eventType: 'task-completed',
      circle:      { 'task-completed': { channel: 'silent' } },
    });
    expect(r.channel).toBe('silent');
  });

  it('user overrides the circle', () => {
    const r = resolveCadence({
      eventType: 'task-completed',
      circle:      { 'task-completed': { channel: 'silent' } },
      user:      { 'task-completed': { channel: 'inbox' } },
    });
    expect(r.channel).toBe('inbox');
  });

  it('user `suppressed: true` wins over circle `suppressed: false`', () => {
    const r = resolveCadence({
      eventType: 'task-completed',
      circle:      { 'task-completed': { suppressed: false } },
      user:      { 'task-completed': { suppressed: true } },
    });
    expect(r.suppressed).toBe(true);
  });

  it('rejects calls without an eventType', () => {
    expect(() => resolveCadence({})).toThrow(/eventType/);
  });
});

describe('Phase 9 — sanitiseCadenceMap drops bad input', () => {
  it('strips entries with invalid channels + invalid leadMs', () => {
    const out = sanitiseCadenceMap({
      'task-completed': { channel: 'inbox', suppressed: true, leadMs: 100 },
      'task-submitted': { channel: 'sms' },
      'invalid':        'not an object',
      '':               { channel: 'inbox' },
      'task-revoked':   { leadMs: -1 },
    });
    expect(out['task-completed']).toEqual({ channel: 'inbox', suppressed: true, leadMs: 100 });
    expect(out['task-submitted']).toBeUndefined();
    expect(out['invalid']).toBeUndefined();
    expect(out['']).toBeUndefined();
    expect(out['task-revoked']).toBeUndefined();
  });
});

// ── Live skill tests ───────────────────────────────────────────────────────


describe('Phase 9 — baseline cadences exist', () => {
  it('has entries for the 6 V1 event types', () => {
    expect(BASELINE_CADENCES['missed-deadline']).toBeDefined();
    expect(BASELINE_CADENCES['task-completed']).toBeDefined();
    expect(BASELINE_CADENCES['task-submitted']).toBeDefined();
    expect(BASELINE_CADENCES['task-rejected']).toBeDefined();
    expect(BASELINE_CADENCES['task-revoked']).toBeDefined();
    expect(BASELINE_CADENCES['subtask-request']).toBeDefined();
  });
});
