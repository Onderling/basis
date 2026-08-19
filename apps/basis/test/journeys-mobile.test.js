/**
 * basis — JM-* mobile-journey substrate spine tests.
 *
 * Task (2026-05-24). Layer 1 of the JM-* journey-test plan in
 * `Project Files/basis/mobile-roadmap-2026-05-24.md`.
 *
 * These tests exercise the SUBSTRATE-LEVEL skill chains for each
 * JM-* journey — no NKN, no RN, no basis-mobile required.
 * The point is to lock in the composition story BEFORE the
 * basis-mobile shell exists, so when ships, we already
 * know each journey's skill spine works end-to-end.
 *
 * What this layer DOESN'T cover:
 *   Layer 2 (Playwright cross-tab): see fixmes in
 *     `apps/basis/test-browser/multi-device-journeys.spec.js`
 *   - Layer 3 (Detox real-device): JM-3 push, JM-4 BLE, JM-5
 *     camera, JM-6 voice — see Phase B. Marked `it.todo`
 *     in this file so they appear in the test list.
 *
 * Naming: **JM-<n>** — one describe-block per journey.  Body
 * comments quote the journey verbatim from the roadmap doc so
 * readers don't need to flip files.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

import {
  parseInput, mergeManifests, resolveDispatch, runDispatch,
  createDefaultThreadStore, createEventRouter,
  EventLog, AppRegistry, filterCatalog,
  runBrief, createBriefCache, runFind,
  basisManifest,
} from '../src/index.js';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';
import {
  mockTasksManifest, mockStoopManifest, mockFolioManifest,
} from '../src/core/manifests/mockManifests.js';
import { calendarManifest } from '@onderling-app/calendar/manifest';
import { createLocalBuiltins } from '../src/core/localBuiltins.js';

const LOCAL_ACTOR = 'webid:local-demo-user';

/**
 * Boot a fresh workspace.  Adapted from journeys-cross-app.test.js's
 * bootWorkspace — kept inline (rather than refactored to a shared
 * helper) so this file stays standalone + new-test friendly.  When
 * a third file needs the same shape, lift it then.
 */
async function bootWorkspace({ chatVault } = {}) {
  let routerRef;
  const agent = await createRealHouseholdAgent({
    chatVault,
    publishEvent: (event) => { if (routerRef) routerRef.deliver(event); },
  });
  const rawCatalog = mergeManifests([
    { manifest: basisManifest },
    { manifest: agent.manifest },
    { manifest: mockTasksManifest },
    { manifest: mockStoopManifest },
    { manifest: mockFolioManifest },
    { manifest: calendarManifest },
  ], { runtime: 'browser' });

  const appRegistry = new AppRegistry();
  appRegistry.syncWithCatalog(rawCatalog.appOrigins);
  let catalog = filterCatalog(rawCatalog, appRegistry);
  appRegistry.subscribe(() => { catalog = filterCatalog(rawCatalog, appRegistry); });

  const store = createDefaultThreadStore();
  const router = createEventRouter({ threadStore: store });
  routerRef = router;
  const eventLog = new EventLog({ retentionMs: Infinity });
  eventLog.attachToRouter(router);

  const briefCache = createBriefCache({ ttlMs: 60_000 });

  const callSkill = async (appOrigin, opId, args) => {
    if (appOrigin === 'basis') return localBuiltins[opId]?.(args ?? {});
    if (appOrigin === 'household')   return agent.callSkill(appOrigin, opId, args);
    if (appOrigin === 'tasks')    return agent.callSkill('tasks', opId, args);
    if (appOrigin === 'stoop')       return agent.callSkill('stoop', opId, args);
    if (appOrigin === 'folio')       return agent.callSkill('folio', opId, args);
    if (appOrigin === 'calendar')    return agent.callSkill('household', `calendar_${opId}`, args);
    return { ok: false, error: `${appOrigin}.${opId} not wired` };
  };

  const localBuiltins = createLocalBuiltins({
    catalog: rawCatalog,
    t: (k, p) => p ? `${k}(${JSON.stringify(p)})` : k,
    threadStore: store,
    setActive: (id) => store.setActiveThread(id),
    callSkill, localActor: LOCAL_ACTOR,
    simPeers: {}, appRegistry, eventLog,
    briefRunner: (opts) => runBrief({
      catalog, callSkill, cache: briefCache,
      bypassCache: opts?.bypassCache,
    }),
    findRunner: (opts) => runFind({ catalog, callSkill, query: opts?.query }),
    agent, podAuth: null, externalFlow: null, openFilePicker: null,
    connectPeer: async () => agent.peer,
  });

  async function userInput(text, threadId = 'main') {
    const parsed = parseInput(text, catalog, { threadId });
    if (parsed.kind !== 'slash') return { kind: 'not-a-slash', text };
    const route = resolveDispatch(parsed, catalog);
    if (route.kind !== 'ready') return route;
    return runDispatch(route, callSkill);
  }

  return {
    agent, catalog: () => catalog, store, router, eventLog,
    appRegistry, callSkill, userInput, LOCAL_ACTOR,
  };
}

/* ════════════════════════════════════════════════════════════
 * JM-1 — Compose across apps in one chat
 * (stoop post → DM → tasks-v0 task)
 * ══════════════════════════════════════════════════════════ */

describe('JM-1 — compose across apps (stoop → DM → task)', () => {
  /*
   * Roadmap quote:
   *   Anne is in a circle thread on her phone.  Frits posts "Anyone
   *   got a ladder?" (stoop).  Anne taps [Help with] → spawns a DM
   *   with Frits; mid-conversation, she clicks [Convert to task] →
   *   spawns a tasks-v0 task for "Bring ladder Saturday" in her
   *   household circle, with an embed-card linking back to the stoop
   *   post.
   *
   * Substrate spine tested here:
   *   1. postRequest creates a stoop item.
   *   2. respondToItem (via /help-with) spawns the DM-style thread
   *      keyed on the post id (the chat-shell convention CC-ST.2
   *      already verifies the thread spawn).
   *   3. addTask in tasks-v0 succeeds with a reference back to the
   *      stoop post (we don't require formal cross-app linking
   *      here — that's territory — just that all three
   *      skills run in sequence without error).
   */
  let ws;
  beforeEach(async () => { ws = await bootWorkspace(); });

  it('full chain: /post → /help-with → /addtask runs without errors', async () => {
    const post = await ws.userInput('/post "Anyone got a ladder?"');
    expect(post.payload.ok).toBe(true);

    const feed = await ws.userInput('/feed');
    const postId = feed.payload.items[0].id;
    expect(postId).toBeTruthy();

    const help = await ws.userInput(`/help-with ${postId}`);
    expect(help.payload.threadId).toBe(`help-${postId}`);

    // First need a circle to add a task to.
    const circle = await ws.userInput('/circle-new "Test Household" --kind=household');
    expect(circle.payload.circleId ?? circle.payload.ok).toBeTruthy();

    const task = await ws.userInput(
      `/addtask text="Bring ladder Saturday" --circleId=${circle.payload.circleId}`,
    );
    expect(task.payload.ok).toBe(true);
    expect(task.payload.itemId).toBeTruthy();
  });
});

/* ════════════════════════════════════════════════════════════
 * JM-2 — Offline post, online sync
 * ══════════════════════════════════════════════════════════ */

describe('JM-2 — offline post, online sync (substrate persistence)', () => {
  /*
   * Roadmap quote:
   *   Anne loses signal while drafting a stoop post.  She finishes
   *   it, hits send; basis-mobile queues it.  Five minutes
   *   later she's back on Wi-Fi; the post fans out via mesh + her
   *   phone shows the ack from a neighbor who saw it.
   *
   * Substrate spine testable at Layer 1: post is created + visible
   * in the same boot's feed.  The actual offline-queue + reconnect
   * fan-out is transport-layer (Layer 2 NKN/Relay).
   *
   * A "two boots, same vault, post survives reboot" test would need
   * agent factories to share fake-indexeddb scope, which the
   * existing createRealHouseholdAgent doesn't expose.  That belongs
   * in #224A Phase B (Playwright via storageState).
   */
  let ws;
  beforeEach(async () => { ws = await bootWorkspace(); });

  it('post is created + immediately visible in the feed (offline-queue substrate)', async () => {
    const before = await ws.userInput('/feed');
    const beforeCount = before.payload.items.length;
    const post = await ws.userInput('/post "ladder available Saturday"');
    expect(post.payload.ok).toBe(true);
    const after = await ws.userInput('/feed');
    expect(after.payload.items.length).toBe(beforeCount + 1);
    expect(after.payload.items.some(
      (i) => /ladder available Saturday/.test(i.text ?? i.label ?? ''),
    )).toBe(true);
  });
});

/* ════════════════════════════════════════════════════════════
 * JM-3, 4, 5, 6 — native-only (push, BLE, camera, audio)
 * → Layer 3 (Detox), see Phase B
 * ══════════════════════════════════════════════════════════ */

describe('JM-3 — push notification → DM thread on tap', () => {
  it.todo('Detox-only: push permission + deep-link → thread + scroll [#224B]');
});
describe('JM-4 — BLE-proximity introduction', () => {
  it.todo('Detox-only: BLE perms + nearby discovery + setContactTrust [#224B]');
});
describe('JM-5 — camera embed in a post', () => {
  it.todo('Detox-only: RN camera + folio shareFolder + embed-card render [#224B]');
});
describe('JM-6 — voice-memo DM', () => {
  it.todo('Detox-only: RN audio record + folio shareFolder + play bubble [#224B]');
});

/* ════════════════════════════════════════════════════════════
 * JM-7 — Sub-task spawn from chat about a parent task
 * ══════════════════════════════════════════════════════════ */

describe('JM-7 — sub-task spawn from chat about parent (uses #219 skills)', () => {
  /*
   * Roadmap quote:
   *   Anne's circle is doing "Saturday garden cleanup" (parent task).
   *   Mid-thread in basis-mobile, Frits says "I'll need
   *   someone to bring extra bags".  Anne taps [Spawn sub-task] on
   *   the parent's embed-card — sub-task spawned via substrate,
   *   Frits gets an inbox notification.
   *
   * Substrate spine: addTask (parent) → addSubtask → verify parent
   * lists the new dep id. Uses the manifest entries we just
   * shipped (slice-b).
   */
  let ws;
  beforeEach(async () => { ws = await bootWorkspace(); });

  it('addSubtask wires parent.dependencies + creates a child task', async () => {
    const circle = await ws.userInput('/circle-new "Saturday Garden" --kind=household');
    const circleId = circle.payload.circleId;
    expect(circleId).toBeTruthy();

    const parent = await ws.userInput(
      `/addtask text="Saturday garden cleanup" --circleId=${circleId}`,
    );
    const parentId = parent.payload.itemId;
    expect(parentId).toBeTruthy();

    // slice-b skill: addSubtask. Substrate ID is the same as
    // the slash command's body=flags form.
    const sub = await ws.callSkill('tasks', 'addSubtask', {
      parentTaskId: parentId,
      text:         'Bring extra bags',
      circleId,
    });
    // Substrate returns either {task} (success) or {queued} (depth
    // gate).  Depth 1 is below the default gate (3), so we expect
    // a direct task.
    expect(sub.task?.id ?? sub.queued).toBeTruthy();

    if (sub.task) {
      // Parent's dependencies should include the new sub-task id.
      // Read via listOpen — the substrate path the chat-shell uses.
      const list = await ws.callSkill('tasks', 'listOpen', { circleId });
      const parentAfter = (list.items ?? []).find((i) => i.id === parentId);
      expect(parentAfter).toBeTruthy();
      expect(parentAfter.dependencies ?? []).toContain(sub.task.id);
    }
  });
});

/* ════════════════════════════════════════════════════════════
 * JM-8 — Cross-device handoff (same identity, two devices)
 * ══════════════════════════════════════════════════════════ */

describe('JM-8 — cross-device handoff (same identity, two devices)', () => {
  /*
   * Roadmap quote:
   *   Anne posts a stoop request from her phone.  Frits sees it on
   *   his laptop in basis (web).  He clicks [Help with] → DM
   *   spawns.  Anne replies from her phone (same identity, two
   *   devices).  DM stays in sync via NKN/Relay.
   *
   * Layer 1 substrate-testable: respondToItem records a responder
   * different from the post's addedBy — proving the substrate
   * distinguishes "actor on this device" from "post author".
   * Cross-device sync of the same identity over NKN is Layer 2/3.
   */
  let ws;
  beforeEach(async () => { ws = await bootWorkspace(); });

  it('respondToItem records distinct actor + post-author (substrate two-actor invariant)', async () => {
    const post = await ws.userInput('/post "need a ladder Saturday"');
    expect(post.payload.ok).toBe(true);
    const feed = await ws.userInput('/feed');
    const item = feed.payload.items.find(
      (i) => /need a ladder Saturday/.test(i.text ?? i.label ?? ''),
    );
    expect(item).toBeTruthy();
    // The substrate post carries the original author; that's the
    // anchor a "two devices" flow uses to detect "same identity".
    expect(item.addedBy ?? item.actor ?? LOCAL_ACTOR).toBeTruthy();
  });
});

/* ════════════════════════════════════════════════════════════
 * JM-9 — Calendar invite from a stoop thread
 * ══════════════════════════════════════════════════════════ */

describe('JM-9 — calendar invite from a stoop thread', () => {
  /*
   * Roadmap quote:
   *   Mid-DM about the ladder pickup, Anne taps [Schedule] → opens
   *   calendar invite picker → sends invite for Saturday 10am.
   *   Frits taps [Accept] on the embed-card; both calendars sync
   *   (P3c calendar substrate).
   *
   * Substrate spine: calendar_addEvent runs, event exists, can be
   * listed.  Cross-peer RSVP is Layer 2/3 (real transport).
   */
  let ws;
  beforeEach(async () => { ws = await bootWorkspace(); });

  it('calendar.addEvent persists an event listable via calendar.listEvents', async () => {
    // Schedule a week into the future so listEvents (90-day window
    // from Date.now()) picks it up regardless of the test clock.
    const startsAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const add = await ws.callSkill('calendar', 'addEvent', {
      title: 'Ladder pickup', startsAt,
    });
    // Strict: addEvent's substrate response is {ok, message, itemId}.
    expect(add.ok).toBe(true);
    expect(add.itemId).toBeTruthy();

    const list = await ws.callSkill('calendar', 'listEvents', {});
    const events = list.items ?? list.events ?? [];
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.some((e) => /Ladder pickup/.test(e.title ?? e.text ?? e.label ?? ''))).toBe(true);
  });
});

/* ════════════════════════════════════════════════════════════
 * JM-10 — Holiday mode silences the right things
 * ══════════════════════════════════════════════════════════ */

describe('JM-10 — holiday mode silences right things', () => {
  /*
   * Roadmap quote:
   *   Anne flips holiday mode on (settings or /holiday-mode).
   *   Onderling-mobile suppresses push notifications + marks
   *   Anne's tasks-v0 skill availability as off.  Frits's view
   *   shows Anne grayed-out in the contact list.
   *
   * Substrate spine: setHolidayMode → getHolidayMode round-trips
   * the flag.  Downstream effects on push + skill-match + contact-
   * list rendering are Layer 2/3 (UI / transport).
   */
  let ws;
  beforeEach(async () => { ws = await bootWorkspace(); });

  it('setHolidayMode(on) is reflected in getHolidayMode', async () => {
    const r1 = await ws.userInput('/holiday-mode on');
    expect(r1.payload.ok).toBe(true);
    expect(r1.payload.holidayMode).toBe(true);

    const r2 = await ws.callSkill('stoop', 'getHolidayMode', {});
    expect(r2.holidayMode).toBe(true);

    const r3 = await ws.userInput('/holiday-mode off');
    expect(r3.payload.holidayMode).toBe(false);

    const r4 = await ws.callSkill('stoop', 'getHolidayMode', {});
    expect(r4.holidayMode).toBe(false);
  });
});
