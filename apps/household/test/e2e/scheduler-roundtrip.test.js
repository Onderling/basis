/**
 * scheduler-roundtrip.test.js — Phase 4 e2e.
 *
 * Wires Scheduler + HouseholdAgent + InMemoryStore + MockBridge.
 * Verifies:
 *   - Adding an item arms a NudgeTimer
 *   - Marking complete cancels the NudgeTimer
 *   - Letting the NudgeTimer mature posts a "what got done?" message
 *     via the bridge
 *   - Force-firing the daily digest posts a digest message
 *
 * Uses vi.useFakeTimers() so the 1-hour delay is deterministic.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { HouseholdAgent } from '../../src/HouseholdAgent.js';
import { MockBridge }     from '../../src/bridges/MockBridge.js';
import { InMemoryStore }  from '../../src/storage/InMemoryStore.js';
import { Scheduler }      from '../../src/scheduler/Scheduler.js';

const ALICE = 'https://id.example.org/alice#me';

function makeMsg(text) {
  return {
    bridgeId: 'mock', chatId: 'chat-1',
    messageId: `msg-${Math.random().toString(36).slice(2, 8)}`,
    sender: { displayName: 'alice', bridgeUid: 'alice', webid: ALICE },
    text, replyTo: null, isAddressed: true,
  };
}

/**
 * Let the post-timer async chain finish.
 *
 * `NudgeTimer.onFire` returns `void | Promise<void>`: the timer callback KICKS OFF the
 * scheduler → agent.dispatch → bridge.sendReply chain but does not await it. `advanceTimersByTimeAsync`
 * flushes microtasks once, which is usually enough and — under load, with the whole suite running —
 * sometimes is not. That produced a genuine intermittent failure, not a cross-file leak.
 *
 * So POSITIVE assertions wait for the observable instead of assuming it landed on a particular tick.
 * Bounded, and it still fails if the thing never happens. NEGATIVE assertions ("nothing fired yet") must
 * NOT use this — there is nothing to wait for, and waiting would only weaken them.
 */
async function settled(predicate, turns = 50) {
  for (let i = 0; i < turns; i++) {
    if (predicate()) return true;
    await vi.advanceTimersByTimeAsync(0);
  }
  return predicate();
}

describe('Phase 4 e2e — Scheduler + HouseholdAgent', () => {
  /** @type {InMemoryStore} */ let store;
  /** @type {MockBridge} */    let bridge;
  /** @type {Scheduler} */     let scheduler;
  /** @type {HouseholdAgent} */ let agent;

  beforeEach(async () => {
    vi.useFakeTimers();
    // Pin the clock to a MORNING: the fake timers start from the real time of day, and an evening run's
    // one-hour advance crossed the 20:00 daily digest, which posted beside the nudge and made every
    // count off by one (the "flake" of 2026-09-04 was the wall clock, not the scheduler).
    vi.setSystemTime(new Date('2026-01-05T09:00:00Z'));
    store    = new InMemoryStore();
    bridge   = new MockBridge();
    // Build the agent with a placeholder; rebind the scheduler's
    // `postToChat` to `agent.dispatch` after the agent exists.  We
    // avoid the chicken-and-egg by constructing scheduler with a thunk.
    /** @type {HouseholdAgent} */
    let agentRef;
    scheduler = new Scheduler({
      store,
      postToChat:    (chatId, replies) => agentRef.dispatch(chatId, replies),
      primaryChatId: 'chat-1',
      household:     { tz: 'UTC', nudgeDelayMs: 60 * 60 * 1000, digestAtLocal: '20:00' },
    });
    agent = new HouseholdAgent({ store, bridges: [bridge], scheduler });
    agentRef = agent;
    await agent.start();   // registers the handler on the bridge
    scheduler.start();
  });

  afterEach(async () => {
    await scheduler.stop();
    vi.useRealTimers();
  });

  // Note on MockBridge semantics: `emit()` invokes the agent's
  // handler and returns its Reply directly — it does NOT record into
  // bridge's queue.  Only `bridge.sendReply()` (called by
  // `agent.dispatch()` from the scheduler) appends to the queue.  So
  // `bridge.size()` measures *agent-initiated* posts (nudges +
  // digests), not the immediate replies to user commands.

  it('adding an item arms a 1-hour nudge that posts via the bridge after maturity', async () => {
    await bridge.emit(makeMsg('add shopping bread'));
    // Halfway: nothing should have been posted by the scheduler yet.
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(bridge.size()).toBe(0);
    // Mature: nudge fires → scheduler dispatches → bridge.sendReply called.
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 100);
    await settled(() => bridge.size() >= 1);
    expect(bridge.size()).toBe(1);
    const sent = bridge.pop();
    expect(sent.text).toMatch(/bread/i);
  });

  it('marking complete cancels the pending nudge', async () => {
    await bridge.emit(makeMsg('add shopping bread'));
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    await bridge.emit(makeMsg('done bread'));
    // Past the original 1 h — nothing should fire.
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 100);
    expect(bridge.size()).toBe(0);
  });

  it('a single nudge fires for the chat covering all pending items (drained set)', async () => {
    await bridge.emit(makeMsg('add shopping bread'));
    await bridge.emit(makeMsg('add shopping milk'));
    await bridge.emit(makeMsg('add shopping eggs'));
    // The most recent `schedule` resets the timer; nudge matures 1 h
    // after the LAST add.
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 100);
    await settled(() => bridge.size() >= 1);
    expect(bridge.size()).toBe(1);
    const sent = bridge.pop();
    // The single nudge's text references at least one of the pending items.
    expect(sent.text).toMatch(/bread|milk|eggs/i);
  });

  it('daily digest fires via fireDigestNow()', async () => {
    await bridge.emit(makeMsg('add shopping coffee'));
    await bridge.emit(makeMsg('add errand fix the bike'));
    // Drain whatever the nudge would have posted later, by completing
    // the items so the scheduler's pending set empties.
    await scheduler.fireDigestNow();
    const sent = bridge.pop();
    expect(sent).toBeTruthy();
    expect(sent.text).toMatch(/digest/i);
  });

  it('agent works without a scheduler attached (back-compat)', async () => {
    // Replace the wired-up agent + bridge with a fresh pair that has no scheduler.
    await agent.stop();
    await scheduler.stop();
    const freshBridge = new MockBridge();
    const noSchedAgent = new HouseholdAgent({ store, bridges: [freshBridge] });
    await noSchedAgent.start();
    const reply = await freshBridge.emit(makeMsg('add shopping bread'));
    expect(reply.replies[0].text).toMatch(/added/i);
    // No scheduler ⇒ no nudge fires.
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
    expect(freshBridge.size()).toBe(0);
    await noSchedAgent.stop();
  });
});

/* ─── 5.7c — quiet-hours / availability suppression hook ───── */

describe('Phase 4 e2e — Scheduler suppression hook (5.7c)', () => {
  /** @type {InMemoryStore} */ let store;
  /** @type {MockBridge} */    let bridge;

  beforeEach(() => {
    vi.useFakeTimers();
    store  = new InMemoryStore();
    bridge = new MockBridge();
  });
  afterEach(() => { vi.useRealTimers(); });

  async function harness(isSuppressed) {
    /** @type {HouseholdAgent} */
    let agentRef;
    const scheduler = new Scheduler({
      store,
      postToChat:    (chatId, replies) => agentRef.dispatch(chatId, replies),
      primaryChatId: 'chat-1',
      household:     { tz: 'UTC', nudgeDelayMs: 60 * 60 * 1000, digestAtLocal: '20:00' },
      isSuppressed,
    });
    const agent = new HouseholdAgent({ store, bridges: [bridge], scheduler });
    agentRef = agent;
    await agent.start();
    scheduler.start();
    return { agent, scheduler };
  }

  it('digest fires normally when no isSuppressed is wired', async () => {
    const { scheduler } = await harness();
    await bridge.emit(makeMsg('add shopping coffee'));
    await scheduler.fireDigestNow();
    expect(bridge.size()).toBe(1);
    await scheduler.stop();
  });

  it('digest is suppressed when isSuppressed returns true (quiet window)', async () => {
    let quiet = true;
    const { scheduler } = await harness(
      (recipient, kind) => kind === 'digest' && quiet,
    );
    await bridge.emit(makeMsg('add shopping coffee'));
    await scheduler.fireDigestNow();
    expect(bridge.size()).toBe(0);          // suppressed
    // Once the quiet window ends, the same fire delivers normally.
    quiet = false;
    await scheduler.fireDigestNow();
    expect(bridge.size()).toBe(1);
    await scheduler.stop();
  });

  it('nudges are also suppressed by the same predicate', async () => {
    let quiet = true;
    const { scheduler } = await harness(
      (recipient, kind) => kind === 'nudge' && quiet,
    );
    await bridge.emit(makeMsg('add shopping bread'));
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 100);
    expect(bridge.size()).toBe(0);          // nudge suppressed
    // Re-fire after the window lifts via a fresh add → fresh timer.
    quiet = false;
    await bridge.emit(makeMsg('add shopping milk'));
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 100);
    await settled(() => bridge.size() >= 1);
    expect(bridge.size()).toBe(1);
    await scheduler.stop();
  });

  it('setSuppressionPredicate swaps the hook at runtime (late availability load)', async () => {
    const { scheduler } = await harness();
    await bridge.emit(makeMsg('add shopping coffee'));
    scheduler.setSuppressionPredicate(() => true);
    await scheduler.fireDigestNow();
    expect(bridge.size()).toBe(0);
    scheduler.setSuppressionPredicate(null);
    await scheduler.fireDigestNow();
    expect(bridge.size()).toBe(1);
    await scheduler.stop();
  });

  it('fireDigestNow({force:true}) bypasses the suppression hook', async () => {
    const { scheduler } = await harness(() => true);
    await bridge.emit(makeMsg('add shopping coffee'));
    await scheduler.fireDigestNow();            // suppressed
    expect(bridge.size()).toBe(0);
    await scheduler.fireDigestNow({ force: true });
    expect(bridge.size()).toBe(1);
    await scheduler.stop();
  });

  it('a throwing isSuppressed never silently swallows the post', async () => {
    const origWarn = console.warn;
    const warnings = [];
    console.warn = (...a) => warnings.push(a);
    try {
      const { scheduler } = await harness(() => { throw new Error('quiet-store boom'); });
      await bridge.emit(makeMsg('add shopping coffee'));
      await scheduler.fireDigestNow();
      expect(bridge.size()).toBe(1);            // fail-open
      await scheduler.stop();
    } finally {
      console.warn = origWarn;
    }
  });

  it('integrates with isPushSuppressed(availability, now) from basis memberAvailability substrate', async () => {
    // Sanity-shape check — household doesn't directly import the
    // basis substrate, but the contract is documented as
    // "wraps `isPushSuppressed(getAvailability(recipient), now)`".
    // Locally simulate the contract: quiet-hours 22:00 → 07:30.
    const availability = {
      holiday:    { active: false, until: null },
      quietHours: { enabled: true, from: '22:00', to: '07:30', weekends: false },
    };
    // Pin "now" to 23:00 UTC — within the overnight window.
    vi.setSystemTime(new Date('2026-05-30T23:00:00Z'));
    const isQuiet = (_recipient, _kind, _now) => {
      const t = new Date(_now);
      const min = t.getUTCHours() * 60 + t.getUTCMinutes();
      const f = 22 * 60;
      const to = 7 * 60 + 30;
      return availability.quietHours.enabled && (min >= f || min < to);
    };
    const { scheduler } = await harness(isQuiet);
    await bridge.emit(makeMsg('add shopping coffee'));
    await scheduler.fireDigestNow();
    expect(bridge.size()).toBe(0);              // suppressed at 23:00
    // Step to 08:00 → out of quiet window.
    vi.setSystemTime(new Date('2026-05-31T08:00:00Z'));
    await scheduler.fireDigestNow();
    expect(bridge.size()).toBe(1);
    await scheduler.stop();
  });
});
