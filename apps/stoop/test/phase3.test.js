/**
 * Stoop V1 — Phase 3 skill-layer tests.
 *
 * Single-agent shape: tests focus on the skill semantics (kind +
 * dueAt, lend lifecycle, moderation skills, author hydration).  The
 * existing `integration.test.js` covers the multi-agent matchmaking
 * flow; we don't duplicate that here.
 */

import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { Reveals } from '@onderling/identity-resolver';
import { Notifier, InMemoryScheduleStore } from '@onderling/notifier';
import { InMemoryBridge } from '@onderling/chat-agent';

import { createNeighbourhoodAgent } from '../src/index.js';

const ANNE = 'https://id.example/anne';
const BOB  = 'https://id.example/bob';

async function callSkill(agent, skillId, args, fromWebid = ANNE) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({
    parts:    args === undefined ? [] : [DataPart(args)],
    from:     fromWebid,
    agent,
    envelope: null,
  });
}

/** Build a single-agent bundle with optional notifier + reveals + members. */
async function buildAgent({ notifier, reveals, members } = {}) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighbourhoodAgent({
    identity: id,
    transport: tx,
    offeringMatch: { group: 'oosterpoort', localActor: ANNE, peers: [] },
    members,
    notifier,
    reveals,
  });
  // OfferingMatch.broadcast requires start() even with zero peers.
  await bundle.offeringMatch.start();
  return bundle;
}

// ── kind vocabulary ────────────────────────────────────────────────────────

describe('Stoop V1 — postRequest kind vocabulary', () => {
  it('defaults to legacy `type: "request"` when no kind supplied', async () => {
    const bundle = await buildAgent();
    const res = await callSkill(bundle.agent, 'postRequest', { text: 'something', expectClaims: 0, timeoutMs: 1 });
    const item = await bundle.itemStore.getById(res.requestId);
    expect(item.type).toBe('request');
  });

  it('accepts intent: "ask" / "offer" / "lend" / "report" + stores canonical shape', async () => {
    // Phase 52.7.2 cut-over (2026-05-14): UI vocab `intent` → canonical
    // `{type, kind}` shape via canonicalAdapter.intentToCanonicalDraft.
    const EXPECTED = {
      'ask':    { type: 'request', kind: 'borrow' },
      'offer':  { type: 'offer',   kind: 'give' },
      'lend':   { type: 'offer',   kind: 'lend' },
      'report': { type: 'report' },                 // bespoke; no kind
    };
    for (const [intent, expected] of Object.entries(EXPECTED)) {
      const bundle = await buildAgent();
      const res = await callSkill(bundle.agent, 'postRequest',
        { text: intent, intent, expectClaims: 0, timeoutMs: 1 });
      const item = await bundle.itemStore.getById(res.requestId);
      expect(item.type).toBe(expected.type);
      if (expected.kind) expect(item.kind).toBe(expected.kind);
    }
  });

  it('accepts dueAt for lend posts and stores it', async () => {
    const bundle = await buildAgent();
    const due = Date.now() + 7 * 24 * 60 * 60 * 1000;
    const res = await callSkill(bundle.agent, 'postRequest', {
      text: 'aanhanger',
      intent: 'lend',
      dueAt: due,
      expectClaims: 0, timeoutMs: 1,
    });
    const item = await bundle.itemStore.getById(res.requestId);
    expect(item.dueAt).toBe(due);
  });
});

// ── Lend lifecycle: postRequest schedules, markReturned cancels ───────────

describe('Stoop V1 — lend lifecycle (postRequest + markReturned + notifier)', () => {
  function buildNotifier() {
    let now = 1_700_000_000_000;
    const timers = [];
    const setTimeoutFn   = (fn, delay) => { const id = timers.length; timers.push({ fn, fireAt: now + delay, cancelled: false }); return id; };
    const clearTimeoutFn = (id) => { if (timers[id]) timers[id].cancelled = true; };
    const advance = async (ms) => {
      now += ms;
      let fired;
      do {
        fired = false;
        for (const t of timers) {
          if (!t.cancelled && t.fireAt <= now) { t.cancelled = true; fired = true; await t.fn(); }
        }
      } while (fired);
    };
    const channel = new InMemoryBridge({ id: 'push' });
    const notifier = new Notifier({
      channels: { push: channel },
      store:    new InMemoryScheduleStore(),
      now:           () => now,
      setTimeoutFn,
      clearTimeoutFn,
    });
    return { notifier, channel, advance, getNow: () => now };
  }

  it('lend post with dueAt schedules a return reminder', async () => {
    const { notifier, channel, advance, getNow } = buildNotifier();
    await notifier.start();
    const bundle = await buildAgent({ notifier });

    const dueAt = getNow() + 30 * 24 * 60 * 60 * 1000;     // 30 days from now
    const res = await callSkill(bundle.agent, 'postRequest', {
      text:  'aanhanger',
      intent:  'lend',
      dueAt,
      expectClaims: 0, timeoutMs: 1,
      // Default lead = 24h before dueAt → fires at dueAt - 24h.
    });

    expect(channel.outbox).toHaveLength(0);
    await advance(29 * 24 * 60 * 60 * 1000);             // jump to 24h before due
    expect(channel.outbox).toHaveLength(1);
    expect(channel.outbox[0].text).toMatch(/aanhanger/);
    expect(channel.outbox[0].text).toMatch(/due back/);

    expect(res.requestId).toBeTruthy();
  });

  it('markReturned cancels the scheduled reminder + completes the item', async () => {
    const { notifier, channel, advance, getNow } = buildNotifier();
    await notifier.start();
    const bundle = await buildAgent({ notifier });

    const dueAt = getNow() + 30 * 24 * 60 * 60 * 1000;
    const post = await callSkill(bundle.agent, 'postRequest', {
      text: 'aanhanger', intent: 'lend', dueAt, expectClaims: 0, timeoutMs: 1,
    });

    const ret = await callSkill(bundle.agent, 'markReturned', { requestId: post.requestId });
    expect(ret.item.completedAt).toBeTruthy();

    // Advance past the reminder time — channel must stay empty.
    await advance(60 * 24 * 60 * 60 * 1000);
    expect(channel.outbox).toHaveLength(0);
  });

  it('cancelRequest also cancels a pending lend reminder', async () => {
    const { notifier, channel, advance, getNow } = buildNotifier();
    await notifier.start();
    const bundle = await buildAgent({ notifier });

    const dueAt = getNow() + 30 * 24 * 60 * 60 * 1000;
    const post = await callSkill(bundle.agent, 'postRequest', {
      text: 'borduurmachine', intent: 'lend', dueAt, expectClaims: 0, timeoutMs: 1,
    });
    await callSkill(bundle.agent, 'cancelRequest', { requestId: post.requestId });

    await advance(60 * 24 * 60 * 60 * 1000);
    expect(channel.outbox).toHaveLength(0);
  });

  it('without a notifier configured, lend posts still work (no reminder)', async () => {
    const bundle = await buildAgent();
    const res = await callSkill(bundle.agent, 'postRequest', {
      text: 'borduurmachine', intent: 'lend', dueAt: Date.now() + 86_400_000, expectClaims: 0, timeoutMs: 1,
    });
    expect(res.requestId).toBeTruthy();
  });
});

// ── Mute / report ─────────────────────────────────────────────────────────

describe('Stoop V1 — moderation skills (report)', () => {
  it('reportPost creates a type:"report" item referencing the original', async () => {
    const bundle = await buildAgent();

    // First, post something to report on.
    const original = await callSkill(bundle.agent, 'postRequest', { text: 'spam', intent: 'ask', expectClaims: 0, timeoutMs: 1 });

    const r = await callSkill(bundle.agent, 'reportPost', {
      itemId: original.requestId,
      reason: 'irrelevant for the circle',
    });
    expect(r.reportId).toBeTruthy();

    const stored = await bundle.itemStore.getById(r.reportId);
    expect(stored.type).toBe('report');
    expect(stored.text).toMatch(/Report on/);
    expect(stored.source.reportTarget).toBe(original.requestId);
    expect(stored.source.reason).toBe('irrelevant for the circle');
  });

  it('reportPost rejects missing itemId', async () => {
    const bundle = await buildAgent();
    expect(await callSkill(bundle.agent, 'reportPost', {})).toEqual({ error: 'itemId required' });
  });
});

// ── Author hydration via Reveals + MemberMap ──────────────────────────────

describe('Stoop V1 — author hydration on listOpen / listMyRequests', () => {
  it('without explicit members, the local actor is still hydrated (Phase 14 fix: factory seeds self)', async () => {
    // The factory seeds the local actor's own MemberMap entry on
    // construction so chat.send / whoAmI / resolveByWebid work
    // without requiring setMyHandle.  As a side effect, listOpen
    // hydrates the author block on the local actor's own posts.
    const bundle = await buildAgent();
    await callSkill(bundle.agent, 'postRequest', { text: 'paint', intent: 'ask', expectClaims: 0, timeoutMs: 1 });
    const r = await callSkill(bundle.agent, 'listOpen');
    expect(r.items[0].addedBy).toBe(ANNE);
    expect(r.items[0].addedByDisplay).toBeTruthy();
    // No handle / displayName set yet → render falls back to the
    // WebID's tail label.
    expect(r.items[0].addedByDisplay.handle).toBeNull();
    expect(r.items[0].addedByDisplay.isRevealed).toBe(false);
  });

  it('with reveals + members, listOpen hydrates @handle by default', async () => {
    const reveals = new Reveals();
    const initialMembers = [
      { webid: ANNE, handle: 'oosterpoort-bird-23', displayName: 'Anne van Dijk' },
    ];
    const bundle = await buildAgent({ reveals, members: initialMembers });

    await callSkill(bundle.agent, 'postRequest', { text: 'paint', intent: 'ask', expectClaims: 0, timeoutMs: 1 });
    const r = await callSkill(bundle.agent, 'listOpen');

    expect(r.items[0].addedByDisplay.render).toBe('@oosterpoort-bird-23');
    expect(r.items[0].addedByDisplay.isRevealed).toBe(false);
    expect(r.items[0].addedByDisplay.handle).toBe('oosterpoort-bird-23');
    expect(r.items[0].addedByDisplay.displayName).toBe('Anne van Dijk');
  });

  it('per-group reveal flips the rendered name to displayName', async () => {
    const reveals = new Reveals();
    reveals.setGroupReveal('oosterpoort', true);
    const initialMembers = [
      { webid: ANNE, handle: 'oosterpoort-bird-23', displayName: 'Anne van Dijk' },
    ];
    const bundle = await buildAgent({ reveals, members: initialMembers });

    await callSkill(bundle.agent, 'postRequest', { text: 'paint', intent: 'ask', expectClaims: 0, timeoutMs: 1 });
    const r = await callSkill(bundle.agent, 'listOpen');
    expect(r.items[0].addedByDisplay.render).toBe('Anne van Dijk');
    expect(r.items[0].addedByDisplay.isRevealed).toBe(true);
  });

  it('listMyRequests hydrates the same way', async () => {
    const reveals = new Reveals();
    const initialMembers = [
      { webid: ANNE, handle: 'oosterpoort-bird-23', displayName: 'Anne van Dijk' },
    ];
    const bundle = await buildAgent({ reveals, members: initialMembers });

    await callSkill(bundle.agent, 'postRequest', { text: 'paint', intent: 'ask', expectClaims: 0, timeoutMs: 1 });
    const r = await callSkill(bundle.agent, 'listMyRequests');
    expect(r.items).toHaveLength(1);
    expect(r.items[0].addedByDisplay.render).toBe('@oosterpoort-bird-23');
  });
});

// ── intent filter on listOpen ─────────────────────────────────────────────

describe('Stoop V1 — listOpen filters by intent', () => {
  it('listOpen({intent: "lend"}) returns only lends', async () => {
    const bundle = await buildAgent();
    await callSkill(bundle.agent, 'postRequest', { text: 'aanhanger', intent: 'lend', expectClaims: 0, timeoutMs: 1 });
    await callSkill(bundle.agent, 'postRequest', { text: 'fiets',     intent: 'ask', expectClaims: 0, timeoutMs: 1 });
    await callSkill(bundle.agent, 'postRequest', { text: 'tuingoed',  intent: 'offer', expectClaims: 0, timeoutMs: 1 });

    const r = await callSkill(bundle.agent, 'listOpen', { intent: 'lend' });
    expect(r.items).toHaveLength(1);
    expect(r.items[0].text).toBe('aanhanger');
  });

  it('listOpen() without intent returns all items', async () => {
    const bundle = await buildAgent();
    await callSkill(bundle.agent, 'postRequest', { text: 'aanhanger', intent: 'lend', expectClaims: 0, timeoutMs: 1 });
    await callSkill(bundle.agent, 'postRequest', { text: 'fiets',     intent: 'ask', expectClaims: 0, timeoutMs: 1 });
    const r = await callSkill(bundle.agent, 'listOpen');
    expect(r.items).toHaveLength(2);
  });
});
