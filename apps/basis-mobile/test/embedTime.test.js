/**
 * embed-time wizard + chrono fallback.
 *
 * Pins:
 *   1. embedTimeState.canSubmit / submitEmbedTime contract
 *   2. createTimeEmbed accepts natural-language dates via the
 *      chrono fallback added upstream in localBuiltins (the patch
 *      that lets /embed-time --when='tomorrow 3pm' work on both
 *      web + mobile).
 */
import { describe, it, expect, beforeEach } from 'vitest';

import {
  initialState, canSubmit, submitEmbedTime,
} from '../../basis/src/core/wizards/embedTimeState.js';

import { buildMobileLocalBuiltins } from '../src/core/hostOps.js';
import { createInitialThreadState, __resetThreadIdSeq } from '../src/core/threadState.js';

const t = (k, p) => p ? `[${k}](${Object.entries(p).map(([a, b]) => `${a}=${b}`).join(' ')})` : `[${k}]`;

describe('Bundle F P5 — embedTimeState', () => {
  it('canSubmit needs both title + when', () => {
    const s = initialState();
    expect(canSubmit(s)).toBe(false);
    s.title = 'BBQ';
    expect(canSubmit(s)).toBe(false);
    s.when = 'tomorrow';
    expect(canSubmit(s)).toBe(true);
    s.submitting = true;
    expect(canSubmit(s)).toBe(false);
  });

  it('submitEmbedTime dispatches basis.embed-time with form values', async () => {
    const calls = [];
    const callSkill = async (origin, opId, args) => {
      calls.push({ origin, opId, args });
      return { ok: true, message: '✓ Time embed created.' };
    };
    const s = initialState({ title: 'BBQ', when: 'tomorrow 3pm', duration: '90m' });
    const { result } = await submitEmbedTime({ state: { ...s }, callSkill });
    expect(result?.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].origin).toBe('basis');
    expect(calls[0].opId).toBe('embed-time');
    expect(calls[0].args.title).toBe('BBQ');
    expect(calls[0].args.when).toBe('tomorrow 3pm');
    expect(calls[0].args.duration).toBe('90m');
  });
});

describe('Bundle F P5 — localBuiltins.createTimeEmbed natural-language fallback', () => {
  beforeEach(() => __resetThreadIdSeq());

  /** Build a minimal mobile localBuiltins with a stub calendar.addEvent. */
  function buildHarness() {
    const calls = [];
    const threadStateRef = { current: createInitialThreadState() };
    const handlers = buildMobileLocalBuiltins({
      threadStateRef, setThreadState: (v) => { threadStateRef.current = typeof v === 'function' ? v(threadStateRef.current) : v; },
      agent:   { identity: { chat: { pubKey: 'pk', stableId: 'sid' }, host: { webid: 'https://a/profile#me' } } },
      catalogue: { opsById: new Map(), appOrigins: new Set(), appsById: new Map() },
      callSkill: async (origin, opId, args) => {
        calls.push({ origin, opId, args });
        if (origin === 'calendar' && opId === 'addEvent')         return { ok: true, itemId: 'ev-1' };
        if (origin === 'calendar' && opId === 'getEventSnapshot') return { id: 'ev-1', title: args.id, startsAt: '2026-05-30T15:00:00Z', endsAt: '2026-05-30T16:00:00Z' };
        return null;
      },
      t,
    });
    return { handlers, calls };
  }

  it('accepts ISO-shaped when (no chrono fallback needed)', async () => {
    const h = buildHarness();
    const r = await h.handlers['embed-time']({ title: 'BBQ', when: '2026-05-30T15:00:00Z' });
    expect(r?.ok).not.toBe(false);
    expect(h.calls.some((c) => c.origin === 'calendar' && c.opId === 'addEvent')).toBe(true);
  });

  it('falls back to chrono for natural-language dates ("tomorrow 3pm")', async () => {
    const h = buildHarness();
    const r = await h.handlers['embed-time']({ title: 'BBQ', when: 'tomorrow 3pm' });
    // Before this returned `{ok: false, error: 'bad_when'}`. With
    // the chrono fallback, calendar.addEvent IS called.
    expect(r?.ok).not.toBe(false);
    expect(h.calls.some((c) => c.origin === 'calendar' && c.opId === 'addEvent')).toBe(true);
  });

  it('still rejects unparseable junk ("not a date at all")', async () => {
    const h = buildHarness();
    const r = await h.handlers['embed-time']({ title: 'BBQ', when: 'not a date at all' });
    expect(r?.ok).toBe(false);
    expect(r.error).toContain('embed-time.bad_when');
  });

  it('returns no-title error when title is empty', async () => {
    const h = buildHarness();
    const r = await h.handlers['embed-time']({ when: '2026-05-30T15:00' });
    expect(r?.ok).toBe(false);
    expect(r.error).toContain('embed-time.no_title');
  });
});
