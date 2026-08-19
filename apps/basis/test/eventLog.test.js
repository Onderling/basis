/**
 * basis — EventLog substrate tests.  v0.7.1.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  EventLog, RETENTION_MS, SYSTEM_APP,
  makeSilentEntry, makeAgentTrailEntry, RETENTION_DEFAULTS, isSilentEntry, shouldWakeForEntry,
} from '../src/eventLog.js';
import { EventRouter } from '../src/events.js';
import { ThreadStore } from '../src/threadStore.js';

const ev = (over = {}) => ({
  id: `e-${Math.random().toString(36).slice(2, 8)}`,
  ts: Date.now(),
  app: 'household',
  type: 'item-changed',
  payload: { message: 'hi' },
  ...over,
});

/**
 * Tests use small synthetic timestamps; we disable retention via
 * Infinity so events with ts:1000 don't get instantly pruned (they'd
 * be > 14 days old vs. real Date.now()).  The dedicated "prune"
 * test above sets a tight retention to exercise the prune path.
 */
const noPrune = () => ({ retentionMs: Infinity });

describe('EventLog — append + prune', () => {
  it("appends most-recent first", () => {
    const log = new EventLog(noPrune());
    log.append(ev({ id: '1', ts: 1000 }));
    log.append(ev({ id: '2', ts: 2000 }));
    log.append(ev({ id: '3', ts: 3000 }));
    expect(log.query().map((e) => e.id)).toEqual(['3', '2', '1']);
  });

  it("de-duplicates on id (re-append overwrites)", () => {
    const log = new EventLog(noPrune());
    log.append(ev({ id: '1', ts: 1000, payload: { message: 'v1' } }));
    log.append(ev({ id: '1', ts: 2000, payload: { message: 'v2' } }));
    expect(log.size).toBe(1);
    expect(log.query()[0].payload.message).toBe('v2');
  });

  it("ignores events with no id", () => {
    const log = new EventLog(noPrune());
    log.append({ ts: 1, app: 'x', type: 'y' });
    log.append({ id: '', ts: 1, app: 'x', type: 'y' });
    expect(log.size).toBe(0);
  });

  it("ignores null / non-object input", () => {
    const log = new EventLog(noPrune());
    log.append(null);
    log.append(undefined);
    log.append('not an event');
    expect(log.size).toBe(0);
  });

  it("prunes events older than retentionMs on every append", () => {
    let clock = 0;
    const log = new EventLog({ now: () => clock, retentionMs: 1000 });
    log.append(ev({ id: 'old', ts: 0 }));
    clock = 2000;
    log.append(ev({ id: 'new', ts: 2000 }));
    expect(log.size).toBe(1);
    expect(log.query()[0].id).toBe('new');
  });

  it("default retention is 14 days", () => {
    expect(RETENTION_MS).toBe(14 * 24 * 60 * 60 * 1000);
  });

  it("prune() returns the count of pruned events", () => {
    let clock = 0;
    const log = new EventLog({ now: () => clock, retentionMs: 1000 });
    log.append(ev({ id: 'a', ts: 0 }));
    log.append(ev({ id: 'b', ts: 100 }));
    log.append(ev({ id: 'c', ts: 200 }));
    clock = 1500;
    expect(log.prune()).toBe(3);
    expect(log.size).toBe(0);
  });
});

describe('EventLog — query', () => {
  const seed = () => {
    const log = new EventLog(noPrune());
    log.append(ev({ id: '1', ts: 1000, app: 'household', type: 'item-changed', actor: 'webid:anne' }));
    log.append(ev({ id: '2', ts: 2000, app: 'stoop',     type: 'notification', actor: 'webid:karl' }));
    log.append(ev({ id: '3', ts: 3000, app: 'household', type: 'notification', actor: 'webid:anne' }));
    log.append(ev({ id: '4', ts: 4000, app: 'tasks',  type: 'item-changed', actor: 'webid:maria' }));
    return log;
  };

  it("no filter → all events, most-recent first", () => {
    expect(seed().query().map((e) => e.id)).toEqual(['4', '3', '2', '1']);
  });

  it("flat filter — apps + eventTypes AND", () => {
    const r = seed().query({
      filter: { apps: ['household'], eventTypes: ['notification'] },
    });
    expect(r.map((e) => e.id)).toEqual(['3']);
  });

  it("expression-tree filter — OR of apps", () => {
    const r = seed().query({
      filter: { or: [{ apps: ['stoop'] }, { apps: ['tasks'] }] },
    });
    expect(r.map((e) => e.id)).toEqual(['4', '2']);
  });

  it("since cutoff", () => {
    const r = seed().query({ since: 2500 });
    expect(r.map((e) => e.id)).toEqual(['4', '3']);
  });

  it("until cutoff", () => {
    const r = seed().query({ until: 2500 });
    expect(r.map((e) => e.id)).toEqual(['2', '1']);
  });

  it("limit", () => {
    const r = seed().query({ limit: 2 });
    expect(r.length).toBe(2);
    expect(r[0].id).toBe('4');
  });

  it("excludeMuted respects mute() set", () => {
    const log = seed();
    log.mute('household', 'notification');
    const all     = log.query({ excludeMuted: false });
    const visible = log.query({ excludeMuted: true });
    expect(all.length).toBe(4);
    expect(visible.map((e) => e.id)).toEqual(['4', '2', '1']);
  });
});

describe('EventLog — mute set', () => {
  it("mute / unmute / isMuted", () => {
    const log = new EventLog();
    expect(log.isMuted('h', 't')).toBe(false);
    expect(log.mute('h', 't')).toBe(true);
    expect(log.isMuted('h', 't')).toBe(true);
    expect(log.mute('h', 't')).toBe(false);   // idempotent
    expect(log.unmute('h', 't')).toBe(true);
    expect(log.isMuted('h', 't')).toBe(false);
  });

  it("mutedList returns sorted snapshot", () => {
    const log = new EventLog();
    log.mute('z', 'b'); log.mute('a', 'a'); log.mute('m', 'c');
    expect(log.mutedList()).toEqual(['a:a', 'm:c', 'z:b']);
  });

  it("setMutedPersistor fires on mute/unmute", async () => {
    const log = new EventLog(noPrune());
    const saves = [];
    log.setMutedPersistor((m) => { saves.push(m.slice()); });
    log.mute('h', 't');
    log.mute('s', 'n');
    log.unmute('h', 't');
    expect(saves.length).toBe(3);
    expect(saves[2]).toEqual(['s:n']);
  });

  it("initial muted set hydrates from constructor", () => {
    const log = new EventLog({ muted: ['a:a', 'b:b'] });
    expect(log.isMuted('a', 'a')).toBe(true);
    expect(log.isMuted('b', 'b')).toBe(true);
  });
});

describe('EventLog — subscribe', () => {
  it("fires on every append", () => {
    const log = new EventLog();
    const seen = [];
    const off = log.subscribe((e) => seen.push(e.id));
    log.append(ev({ id: '1' }));
    log.append(ev({ id: '2' }));
    off();
    log.append(ev({ id: '3' }));
    expect(seen).toEqual(['1', '2']);
  });
});

describe('EventLog — initial hydration + persist', () => {
  it("hydrates from initial array", () => {
    const log = new EventLog({
      initial: [ev({ id: 'a', ts: 1 }), ev({ id: 'b', ts: 2 })],
    });
    expect(log.size).toBe(2);
  });

  it("persists on append (async; doesn't await)", async () => {
    const saves = [];
    const log = new EventLog({
      persist: async (events) => { saves.push(events.length); },
    });
    log.append(ev({ id: '1' }));
    log.append(ev({ id: '2' }));
    await new Promise((r) => setTimeout(r, 10));
    expect(saves.length).toBe(2);
    expect(saves[1]).toBe(2);
  });
});

describe('EventLog.attachToRouter', () => {
  it("logs every event the EventRouter delivers", () => {
    const store = new ThreadStore();
    store.createThread({ id: 'main', name: 'Main' });
    const router = new EventRouter({ threadStore: store });
    const log = new EventLog();
    log.attachToRouter(router);
    router.deliver({ id: 'e1', app: 'household', type: 'item-changed', payload: {} });
    router.deliver({ id: 'e2', app: 'stoop',     type: 'notification', payload: {} });
    expect(log.query().map((e) => e.id)).toEqual(['e2', 'e1']);
  });

  it("logs even events that no thread filter matches", () => {
    const store = new ThreadStore();
    store.createThread({ id: 'main', name: 'Main', filter: { apps: ['ONLY-this'] } });
    const router = new EventRouter({ threadStore: store });
    const log = new EventLog();
    log.attachToRouter(router);
    const matched = router.deliver({
      id: 'unrouted', app: 'household', type: 'foo', payload: {},
    });
    expect(matched).toEqual([]);   // no thread matched
    expect(log.size).toBe(1);      // still logged
  });

  it("attachToRouter returns an unsubscribe handle", () => {
    const store = new ThreadStore();
    store.createThread({ id: 'main', name: 'Main' });
    const router = new EventRouter({ threadStore: store });
    const log = new EventLog();
    const off = log.attachToRouter(router);
    router.deliver({ id: 'e1', app: 'h', type: 'x', payload: {} });
    off();
    router.deliver({ id: 'e2', app: 'h', type: 'x', payload: {} });
    expect(log.size).toBe(1);
  });

  it("rejects non-router input", () => {
    expect(() => new EventLog().attachToRouter(null)).toThrow();
    expect(() => new EventLog().attachToRouter({})).toThrow();
  });
});

describe('EventLog — C15 silent system-entry lane', () => {
  it('appendSilentEntry logs a typed entry with a first-class circleId + silent marker', () => {
    const log = new EventLog(noPrune());
    const entry = log.appendSilentEntry({ circleId: 'circle-1', kind: 'membership-changed', payload: { who: 'ann' }, ts: 1000 });
    expect(entry.app).toBe(SYSTEM_APP);
    expect(entry.type).toBe('membership-changed');
    expect(entry.circleId).toBe('circle-1');   // first-class scope
    expect(entry.silent).toBe(true);
    expect(typeof entry.id).toBe('string');
    // It IS logged (the Stream firehose reads it) — appendSilentEntry rides append().
    expect(log.query().map((e) => e.id)).toEqual([entry.id]);
    expect(log.query()[0].payload).toEqual({ who: 'ann' });
  });

  it('makeSilentEntry is pure + generates an id/ts when omitted', () => {
    const a = makeSilentEntry({ circleId: 'c', kind: 'k' });
    expect(a.silent).toBe(true);
    expect(a.app).toBe(SYSTEM_APP);
    expect(typeof a.id).toBe('string');
    expect(typeof a.ts).toBe('number');
  });

  it('isSilentEntry discriminates silent entries from chat messages', () => {
    const silent = makeSilentEntry({ circleId: 'c', kind: 'k' });
    const chat = { id: 'm1', ts: 1, app: 'circle', type: 'chat-message', payload: { circleId: 'c', text: 'hi' } };
    expect(isSilentEntry(silent)).toBe(true);
    expect(isSilentEntry(chat)).toBe(false);
    expect(isSilentEntry(null)).toBe(false);
    expect(isSilentEntry({})).toBe(false);
  });

  it('shouldWakeForEntry: silent → false, a chat message → true', () => {
    const silent = makeSilentEntry({ circleId: 'c', kind: 'k' });
    const chat = { id: 'm1', ts: 1, app: 'circle', type: 'chat-message', payload: { circleId: 'c', text: 'hi' } };
    expect(shouldWakeForEntry(silent)).toBe(false);
    expect(shouldWakeForEntry(chat)).toBe(true);
    expect(shouldWakeForEntry(null)).toBe(false);
  });
});

/* ── One-log step D — per-kind retention + audit compaction (J-L10) ─────────────────────────────────── */

describe('EventLog — per-kind retention', () => {
  // `ask` is chat-CLASS (windowed content whose durable head lives elsewhere); `chat-message` itself is
  // RECORD class since the chat-lane sitting — the conversation never drops (asserted below).
  const mk = (over) => ev({ app: 'circle', type: 'ask', ...over });

  it('J-L10 — audit outlives chat-class content: past the window it is gone and governance still answers', () => {
    let clock = 0;
    const log = new EventLog({ now: () => clock, retention: { short: 500, chat: 1000, audit: 5000 } });
    log.append(mk({ id: 'chat-old', ts: 0 }));
    log.append(ev({ id: 'gov-old', ts: 0, app: 'system', type: 'governance', circleId: 'c1', payload: { event: 'propose' } }));
    log.append(ev({ id: 'ping-old', ts: 0, app: 'system', type: 'roster-updated', circleId: 'c1' }));
    clock = 2000;   // past chat(1000) + short(500), inside audit(5000)
    log.prune();
    const ids = log.query().map((e) => e.id);
    expect(ids).not.toContain('chat-old');
    expect(ids).not.toContain('ping-old');
    expect(ids).toContain('gov-old');       // the trail did not silently forget
  });

  it('purgeConversation is the explicit act: deletes ONLY old chat messages, never the roster or trail', () => {
    let clock = 0;
    const log = new EventLog({ now: () => clock });
    log.append(ev({ id: 'old-msg', ts: 0, app: 'circle', type: 'chat-message', circleId: 'c1', payload: { text: 'oud' } }));
    log.append(ev({ id: 'new-msg', ts: 900, app: 'circle', type: 'chat-message', circleId: 'c1', payload: { text: 'nieuw' } }));
    log.append(ev({ id: 'mem', ts: 0, app: 'system', type: 'membership', circleId: 'c1', payload: {} }));
    log.append(ev({ id: 'gov', ts: 0, app: 'system', type: 'governance', circleId: 'c1', payload: { event: 'propose' } }));
    clock = 1000;
    const deleted = log.purgeConversation({ olderThanMs: 500 });   // everything older than clock-500
    expect(deleted).toBe(1);
    const ids = log.query().map((e) => e.id);
    expect(ids).not.toContain('old-msg');                          // the user's deletion, applied
    expect(ids).toContain('new-msg');                              // younger than the chosen age
    expect(ids).toContain('mem');                                  // the roster's record is untouchable here
    expect(ids).toContain('gov');                                  // so is the trail
  });

  it('purgeConversation scoped to one circle leaves the other circles alone', () => {
    let clock = 1000;
    const log = new EventLog({ now: () => clock });
    log.append(ev({ id: 'a1', ts: 0, app: 'circle', type: 'chat-message', circleId: 'cA', payload: {} }));
    log.append(ev({ id: 'b1', ts: 0, app: 'circle', type: 'chat-message', circleId: 'cB', payload: {} }));
    expect(log.purgeConversation({ olderThanMs: 100, circleId: 'cA' })).toBe(1);
    const ids = log.query().map((e) => e.id);
    expect(ids).not.toContain('a1');
    expect(ids).toContain('b1');
  });

  it('chat messages are the RECORD — no window, however small, ever drops them', () => {
    let clock = 0;
    const log = new EventLog({ now: () => clock, retention: { short: 1, chat: 1, audit: 1 } });
    log.append(ev({ id: 'msg', ts: 0, app: 'circle', type: 'chat-message', circleId: 'c1', payload: { text: 'hoi' } }));
    clock = 10_000_000;
    log.prune();
    expect(log.query().map((e) => e.id)).toContain('msg');
  });

  it('past the AUDIT window an entry compacts — and the summary says how many it folded', () => {
    let clock = 0;
    const log = new EventLog({ now: () => clock, retention: { short: 500, chat: 1000, audit: 2000 } });
    log.append(ev({ id: 'g1', ts: 0, app: 'system', type: 'governance', circleId: 'c1', actor: 'anna', payload: { event: 'propose' } }));
    log.append(ev({ id: 'g2', ts: 10, app: 'system', type: 'governance', circleId: 'c1', actor: 'bram', payload: { event: 'vote' } }));
    log.append(ev({ id: 'a1', ts: 20, app: 'system', type: 'agent-action', circleId: 'c1', actor: 'bot-x', payload: { op: 'addItems', via: 'grant:g9' } }));
    clock = 3000;
    log.prune();
    const rows = log.query();
    expect(rows.map((e) => e.id)).not.toContain('g1');
    const summary = rows.find((e) => e.type === 'audit-summary' && e.circleId === 'c1');
    expect(summary).toBeTruthy();
    expect(summary.payload.foldedCount).toBe(3);
    expect(summary.payload.counts).toEqual({ 'governance:propose': 1, 'governance:vote': 1, 'agent-action:addItems': 1 });
    expect(summary.payload.actors.sort()).toEqual(['anna', 'bot-x', 'bram']);
    expect(summary.payload.from).toBe(0);
    expect(summary.payload.to).toBe(20);
  });

  it('later folds MERGE into the same summary; the summary itself never expires', () => {
    let clock = 0;
    const log = new EventLog({ now: () => clock, retention: { short: 100, chat: 100, audit: 1000 } });
    log.append(ev({ id: 'g1', ts: 0, app: 'system', type: 'governance', circleId: 'c1', payload: { event: 'vote' } }));
    clock = 1500; log.prune();
    log.append(ev({ id: 'g2', ts: 1500, app: 'system', type: 'governance', circleId: 'c1', payload: { event: 'vote' } }));
    clock = 3000; log.prune();
    clock = 999999; log.prune();   // far future: everything else would be gone — the fold stays
    const summaries = log.query().filter((e) => e.type === 'audit-summary');
    expect(summaries).toHaveLength(1);
    expect(summaries[0].payload.foldedCount).toBe(2);
    expect(summaries[0].payload.counts['governance:vote']).toBe(2);
  });

  it('an EXTERNAL append cannot rewrite the fold (first-write-wins holds for audit-summary)', () => {
    let clock = 0;
    const log = new EventLog({ now: () => clock, retention: { short: 100, chat: 100, audit: 100 } });
    log.append(ev({ id: 'g1', ts: 0, app: 'system', type: 'governance', circleId: 'c1', payload: { event: 'vote' } }));
    clock = 500; log.prune();
    const before = log.query().find((e) => e.type === 'audit-summary');
    expect(before.payload.foldedCount).toBe(1);
    // a bot that knows the id tries to blank the history
    log.append({ id: before.id, ts: 600, app: 'system', type: 'audit-summary', circleId: 'c1', payload: { foldedCount: 0, counts: {} } });
    const after = log.query().find((e) => e.type === 'audit-summary');
    expect(after.payload.foldedCount).toBe(1);
  });

  it('legacy retentionMs still shrinks the whole log (back-compat for hosts/tests that pass it)', () => {
    let clock = 0;
    const log = new EventLog({ now: () => clock, retentionMs: 1000 });
    log.append(mk({ id: 'old', ts: 0 }));
    clock = 2000;
    log.append(mk({ id: 'new', ts: 2000 }));
    expect(log.query().map((e) => e.id)).toEqual(['new']);
  });

  it('defaults: short < chat, audit window equals chat, and chat stays the decided 14 days', () => {
    expect(RETENTION_DEFAULTS.chat).toBe(RETENTION_MS);
    expect(RETENTION_DEFAULTS.short).toBeLessThan(RETENTION_DEFAULTS.chat);
    expect(RETENTION_DEFAULTS.audit).toBe(RETENTION_MS);
  });
});

/* ── One-log step E — the agent-trail entry shape ───────────────────────────────────────────────────── */

describe('makeAgentTrailEntry', () => {
  it('shapes a whitelisted, attributed, silent audit entry', () => {
    const e = makeAgentTrailEntry({
      actor: 'bot-x', op: 'addItems', target: { kind: 'list', ref: 'boodschappen' },
      outcome: 'ok', via: 'grant:g9', circleId: 'c1',
    });
    expect(e.type).toBe('agent-action');
    expect(e.actor).toBe('bot-x');
    expect(e.circleId).toBe('c1');
    expect(e.silent).toBe(true);
    expect(e.payload).toEqual({ op: 'addItems', target: { kind: 'list', ref: 'boodschappen' }, outcome: 'ok', via: 'grant:g9' });
  });

  it('the whitelist holds — arguments/bodies passed in are NOT carried', () => {
    const e = makeAgentTrailEntry({ actor: 'bot-x', op: 'chat.send', args: { text: 'geheim' }, body: 'geheim', via: 'owner' });
    expect(JSON.stringify(e)).not.toContain('geheim');
  });

  it('unattributed or op-less rows are refused (null), and kind is constrained', () => {
    expect(makeAgentTrailEntry({ op: 'x' })).toBeNull();
    expect(makeAgentTrailEntry({ actor: 'a' })).toBeNull();
    expect(makeAgentTrailEntry({ actor: 'a', op: 'x', kind: 'chat-message' }).type).toBe('agent-action');
    expect(makeAgentTrailEntry({ actor: 'a', op: 'x', kind: 'settings-change' }).type).toBe('settings-change');
  });
});
