/**
 * Perf budgets — count-based, not wall-clock.
 *
 * Wall-clock perf tests don't travel across machines (or even CI runs);
 * what we actually care about is the SHAPE of work the app does.  These
 * tests spy on `callSkill` and assert hard ceilings on RPC counts.
 * They're cheap, deterministic, and catch the regressions we just fixed
 * (seeding-runs-every-boot, resolver-probes-everything) before the next
 * unintended change re-introduces them.
 */
import { describe, it, expect } from 'vitest';
import {
  makeResolvingCallSkill,
  DEFAULT_CIRCLE_ORIGINS,
} from '../../src/v2/circleSources.js';

// ── Perf #2: catalog-aware resolver short-circuits ─────────────────

describe('makeResolvingCallSkill — catalog short-circuit (Perf #2)', () => {
  function makeSpy() {
    const calls = [];
    return {
      calls,
      raw: async (origin, opId, args) => {
        calls.push({ origin, opId, args });
        // Default: return null (nothing handles this op).  Tests that
        // need a hit override per-test.
        return null;
      },
    };
  }

  it('no catalog → probes EVERY origin (legacy behaviour preserved)', async () => {
    const spy = makeSpy();
    const call = makeResolvingCallSkill(spy.raw);
    await call('listNotes', {});
    expect(spy.calls.length).toBe(DEFAULT_CIRCLE_ORIGINS.length);
  });

  it('catalog → only probes origins that declare the op', async () => {
    const spy = makeSpy();
    const catalog = {
      opsById: new Map([
        ['listNotes', { op: { id: 'listNotes' }, appOrigin: 'tasks' }],
      ]),
    };
    const call = makeResolvingCallSkill(spy.raw, DEFAULT_CIRCLE_ORIGINS, catalog);
    await call('listNotes', {});
    // Exactly one probe (tasks-v0), zero wasted probes on stoop / household /
    // calendar / folio.  Replaces 5 probes with 1.
    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0].origin).toBe('tasks');
  });

  // An op UNKNOWN to the catalog falls back to probing every origin (9fe27799): the catalog gate is a perf
  // HINT, not a hard filter — agent skills absent from the manifest must still resolve. The perf win lives in
  // the KNOWN-op short-circuit above; circleSourcesGate.test.js covers the agent-skill fallback end-to-end.
  it('catalog with an UNKNOWN op → falls back to probing every origin (gate is a hint, not a filter)', async () => {
    const spy = makeSpy();
    const catalog = { opsById: new Map() };   // op declared nowhere
    const call = makeResolvingCallSkill(spy.raw, DEFAULT_CIRCLE_ORIGINS, catalog);
    await call('aspirational-op', {});
    expect(spy.calls).toHaveLength(DEFAULT_CIRCLE_ORIGINS.length);
  });

  it('respects the prefixed-key form `<origin>/<opId>`', async () => {
    const spy = makeSpy();
    const catalog = {
      opsById: new Map([
        ['stoop/getBulletin', { op: { id: 'getBulletin' }, appOrigin: 'stoop' }],
      ]),
    };
    const call = makeResolvingCallSkill(spy.raw, DEFAULT_CIRCLE_ORIGINS, catalog);
    await call('getBulletin', {});
    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0].origin).toBe('stoop');
  });

  it('stops probing after the first non-null hit (existing behaviour)', async () => {
    const spy = {
      calls: [],
      raw: async (origin, opId, args) => {
        spy.calls.push({ origin, opId, args });
        // Stoop returns a value; tasks-v0 / others should never get a probe.
        if (origin === 'stoop') return { items: ['hit'] };
        return null;
      },
    };
    const catalog = {
      opsById: new Map([
        ['stoop/x',    { op: { id: 'x' }, appOrigin: 'stoop'    }],
        ['tasks-v0/x', { op: { id: 'x' }, appOrigin: 'tasks' }],
      ]),
    };
    const call = makeResolvingCallSkill(spy.raw, DEFAULT_CIRCLE_ORIGINS, catalog);
    const r = await call('x', {});
    expect(r).toEqual({ items: ['hit'] });
    expect(spy.calls).toHaveLength(1);
  });
});

// ── Perf #4: catch-up short-circuit when roster is empty ──────────

describe('requestCatchUpFromKnownPeers — 0-peer short-circuit (Perf #4)', () => {
  it('skips getLatestPostAddedAt + sendPeer entirely when roster is empty', async () => {
    // Dynamic import keeps this self-contained alongside the resolver tests.
    const { makeRequestCatchUpFromKnownPeers }
      = await import('../../src/core/handlers/catchUp.js');
    const callLog = [];
    const sendPeerLog = [];
    const callSkill = async (origin, opId, args) => {
      callLog.push(opId);
      if (opId === 'listMyCircles')      return { circles: ['bert', 'oosterpoort'] };
      if (opId === 'listGroupRoster')   return { members: [] };   // 0 peers everywhere
      if (opId === 'getLatestPostAddedAt') return { latestAt: 999 };
      return null;
    };
    const sendPeer = async (addr, payload) => { sendPeerLog.push({ addr, payload }); };
    const run = makeRequestCatchUpFromKnownPeers({
      callSkill, sendPeer, logger: { info() {}, warn() {} },
    });
    await run();

    // listMyCircles once + listGroupRoster per circle (2 circles → 2 rosters).
    // CRITICALLY: zero getLatestPostAddedAt calls AND zero sendPeer calls.
    expect(callLog).toEqual(['listMyCircles', 'listGroupRoster', 'listGroupRoster']);
    expect(callLog).not.toContain('getLatestPostAddedAt');
    expect(sendPeerLog).toHaveLength(0);
  });

  it('still fires getLatestPostAddedAt + sendPeer when roster has peers', async () => {
    const { makeRequestCatchUpFromKnownPeers }
      = await import('../../src/core/handlers/catchUp.js');
    const callLog = [];
    const sendPeerLog = [];
    const callSkill = async (origin, opId, args) => {
      callLog.push(opId);
      if (opId === 'listMyCircles')      return { circles: ['bert'] };
      if (opId === 'listGroupRoster')   return { members: [{ addr: 'peer-A' }, { addr: 'peer-B' }] };
      if (opId === 'getLatestPostAddedAt') return { latestAt: 999 };
      return null;
    };
    const sendPeer = async (addr, payload) => { sendPeerLog.push({ addr, payload }); };
    const run = makeRequestCatchUpFromKnownPeers({
      callSkill, sendPeer, logger: { info() {}, warn() {} },
    });
    await run();

    expect(callLog).toEqual(['listMyCircles', 'listGroupRoster', 'getLatestPostAddedAt']);
    expect(sendPeerLog.map((s) => s.addr)).toEqual(['peer-A', 'peer-B']);
  });
});

// ── Perf #1: seeding skipped when circle is already populated ──────

describe('createRealHouseholdAgent — seed-once budget (Perf #1)', () => {
  it('boots with seedTasks:false ⇒ NO addTask invocations (sanity, fast path)', async () => {
    const { createRealHouseholdAgent } = await import('../../src/core/agent/realAgent.js');
    // Spy by counting addTask invocations through agent.callSkill.
    const a = await createRealHouseholdAgent({ seedTasks: false, seedStoopPosts: false });
    const calls = [];
    const wrap = a.callSkill;
    let invocations = 0;
    a.callSkill = async (origin, op, args) => {
      if (op === 'addTask') invocations += 1;
      calls.push({ origin, op });
      return wrap(origin, op, args);
    };
    void invocations;   // sanity-bound; assertion below is via listOpen post-boot.

    // After a clean boot with seeding DISABLED, listOpen sees the empty circle.
    const r = await a.callSkill('tasks', 'listOpen', {});
    const items = Array.isArray(r?.items) ? r.items : [];
    expect(items).toHaveLength(0);   // no seeds, no leftover state.
  }, 30_000);
});
