/**
 * basis — user-journey integration tests.
 *
 * One describe-block per J1–J10 from `DESIGN-basis-journeys.md`.
 * Boots the same catalogue + agent that `web/main.js` does (sans
 * DOM) — `bootTestWorkspace()` mirrors the real wiring so a test
 * failure here is a real demo failure.
 *
 * What's covered headlessly:
 *   ✅ Slash parse → router → dispatch → reply (all journeys)
 *   ✅ Multi-user via sim-peers (Anne's thread; calendar invite
 *      round-trip — organiser dispatches → attendee thread
 *      receives → RSVP records → organiser's view stale-refreshes
 *      via EventRouter)
 *   ✅ EventLog + EventRouter routing (J8 thread filters,
 *      reactive panel-stale per v0.6.3)
 *
 * What's NOT covered headlessly (would need browser / pod):
 *   🟡 Real cross-PEER transport between two pods — sim only
 *   🟡 Real OIDC browser handoff — framework tested but not
 *      against real Inrupt
 *   🟡 DOM rendering specifics — domAdapter has its own happy-dom
 *      tests; this file asserts the platform-neutral RenderedReply
 *      shapes
 */
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

import {
  parseInput, mergeManifests, resolveDispatch, runDispatch,
  renderReply, ThreadStore, createDefaultThreadStore, createEventRouter,
  basisManifest,
  AppRegistry, filterCatalogue,
  runBrief, createBriefCache,
  runFind,
  EventLog,
  collectFollowUps,
  buildEmbed,
} from '../src/index.js';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';
import {
  mockTasksManifest, mockStoopManifest, mockFolioManifest,
} from '../src/core/manifests/mockManifests.js';
import { calendarManifest } from '@onderling-app/calendar/manifest';
import { createLocalBuiltins } from '../src/core/localBuiltins.js';

const LOCAL_ACTOR = 'webid:local-demo-user';

/**
 * Boot a workspace shape that mirrors web/main.js (minus DOM).
 * Returns the live pipes used by the tests.
 */
async function bootTestWorkspace() {
  // These journeys exercise the demo experience (seeded members/tasks/posts), so
  // opt into the demo scaffolding explicitly — it is OFF by default now that a
  // real circle must show only real members + no phantom tasks.
  const agent = await createRealHouseholdAgent({ seedDemoData: true });
  const rawCatalogue = mergeManifests([
    { manifest: basisManifest },
    { manifest: agent.manifest },
    { manifest: mockTasksManifest },
    { manifest: mockStoopManifest },
    { manifest: mockFolioManifest },
    { manifest: calendarManifest },
  ], { runtime: 'browser' });

  const appRegistry = new AppRegistry();
  appRegistry.syncWithCatalogue(rawCatalogue.appOrigins);
  let catalogue = filterCatalogue(rawCatalogue, appRegistry);
  appRegistry.subscribe(() => { catalogue = filterCatalogue(rawCatalogue, appRegistry); });

  const store = createDefaultThreadStore();   // creates Main + Inbox
  const SIM_PEERS = {
    anne: { threadId: 'sim-anne', webid: 'webid:anne' },
  };
  if (!store.getThread('sim-anne')) {
    store.createThread({
      id: 'sim-anne', name: "Anne's view",
      filter: { actors: ['webid:anne'] },
      permissions: { allowCommands: false },
    });
  }

  const router = createEventRouter({ threadStore: store });
  const eventLog = new EventLog({ retentionMs: Infinity });
  eventLog.attachToRouter(router);

  const briefCache = createBriefCache({ ttlMs: 60_000 });
  let callSkillRef;

  const callSkill = async (appOrigin, opId, args) => {
    if (appOrigin === 'basis') return localBuiltins[opId]?.(args ?? {});
    if (appOrigin === 'household') return agent.callSkill(appOrigin, opId, args);
    if (appOrigin === 'tasks') {
      // Post-slice-1 (integration-plan 2026-05-23): tasks-v0 is the
      // real circle agent composed in realAgent.js.
      return agent.callSkill('tasks', opId, args);
    }
    if (appOrigin === 'stoop') {
      // Post-slice-2b (integration-plan 2026-05-23): stoop is the
      // real NeighbourhoodAgent.  realAgent.callSkill knows the
      // listFeed→listOpen alias + getStoopProfile/revealPeer adapters.
      return agent.callSkill('stoop', opId, args);
    }
    if (appOrigin === 'folio') {
      // Post-slice-4: folio is the dedicated browser folio agent
      // composed in realAgent.js.  realAgent.callSkill knows the
      // briefSummary → folio_briefSummary alias.
      return agent.callSkill('folio', opId, args);
    }
    if (appOrigin === 'calendar') {
      return agent.callSkill('household', `calendar_${opId}`, args);
    }
    return { ok: false, error: `${appOrigin}.${opId} not wired in test` };
  };
  callSkillRef = callSkill;

  // Wire publishEvent → router (so mutations broadcast).
  agent.setInviteAttendee?.(async (webid, snapshot) => {
    const peerName = webid.replace(/^webid:/, '');
    const peer     = SIM_PEERS[peerName];
    if (!peer) return;
    const dest = store.getThread(peer.threadId);
    if (!dest) return;
    dest.addShellMessage({
      kind:           'embed-card',
      messageId:      `invite-${snapshot.id}-${peerName}-${Date.now()}`,
      threadId:       peer.threadId,
      lifecycleState: 'live',
      embed: {
        kind:      'time-card',
        appOrigin: 'calendar',
        itemRef:   { app: 'calendar', type: 'calendar-event', id: snapshot.id },
        snapshot,
        issuedBy:  LOCAL_ACTOR,
      },
    });
  });

  const localBuiltins = createLocalBuiltins({
    catalogue: rawCatalogue, t: (k, p) => p ? `${k}(${JSON.stringify(p)})` : k,
    threadStore: store,
    setActive: (id) => store.setActiveThread(id),
    callSkill, localActor: LOCAL_ACTOR, simPeers: SIM_PEERS,
    appRegistry, eventLog,
    briefRunner: (opts) => runBrief({ catalogue, callSkill, cache: briefCache, bypassCache: opts?.bypassCache }),
    findRunner:  (opts) => runFind({ catalogue, callSkill, query: opts?.query }),
  });

  // Drive a user message through the pipeline.  Returns the reply.
  async function userInput(text, threadId = 'main') {
    const parsed = parseInput(text, catalogue, { threadId });
    if (parsed.kind !== 'slash') return { kind: 'not-a-slash', text };
    const route = resolveDispatch(parsed, catalogue);
    if (route.kind !== 'ready') return route;
    return runDispatch(route, callSkill);
  }

  return {
    agent, catalogue: () => catalogue, store, router, eventLog,
    appRegistry, callSkill, userInput, LOCAL_ACTOR, SIM_PEERS,
  };
}

/* ─────────────── J1 — Mark a household item done ─────────────── */
// Part G — backed by the REAL `apps/household` agent.  The real manifest's
// list op is `/list <type>` (type-only body); `/done <match>` resolves by
// keyword.  Seed items: Milk (shopping), Post a parcel (errand), Vacuum
// living room (task).

describe('J1 — Mark a household item done', () => {
  let ws;
  beforeEach(async () => { ws = await bootTestWorkspace(); });

  it("/list shopping lists the seeded shopping item", async () => {
    const reply = await ws.userInput('/list shopping');
    expect(reply.shape).toBe('list');
    expect(reply.payload.items.map((i) => i.label)).toEqual(['Milk']);
  });

  it("/done Milk marks the item complete", async () => {
    const reply = await ws.userInput('/done Milk');
    expect(reply.payload?.ok).toBe(true);
    expect(reply.payload.message).toBe('✓ marked complete: Milk');
  });

  it("post-completion /list shopping drops the item", async () => {
    await ws.userInput('/done Milk');
    const reply = await ws.userInput('/list shopping');
    expect(reply.payload.items.find((i) => i.label === 'Milk')).toBeUndefined();
  });
});

/* ─────────────── J2 — Add task with details ─────────────── */

describe('J2 — Add task with details', () => {
  let ws;
  beforeEach(async () => { ws = await bootTestWorkspace(); });

  it("/addtask one-liner via positional", async () => {
    const reply = await ws.userInput('/addtask Fix the leaky tap');
    expect(reply.payload?.ok).toBe(true);
    expect(reply.payload.message).toMatch(/Fix the leaky tap/);
  });

  it("/addtask with --assignee + --requiredSkill", async () => {
    const reply = await ws.userInput(
      '/addtask "Set up bedroom" --assignee=webid:anne --requiredSkill=household',
    );
    expect(reply.payload?.ok).toBe(true);
    // tasks have a `text` field (canonical task schema); the renderer
    // maps it to `label` at render time but the raw payload exposes
    // the schema name.
    const list = await ws.userInput('/mytasks');
    const added = list.payload.items.find((i) => i.text === 'Set up bedroom');
    expect(added).toBeTruthy();
    // Post-integration: real tasks-v0's addTask doesn't set assignee
    // at creation (the lifecycle is /addtask → unassigned, then
    // /claim sets assignee=caller).  Likewise requiredSkill on the
    // task record requires a separate skill-vocabulary mapping that
    // basis doesn't wire today.  Verify the task was added.
    expect(added.text).toBe('Set up bedroom');
  });

  it("/mytasks shows the seed open + claimed tasks", async () => {
    const reply = await ws.userInput('/mytasks');
    expect(reply.shape).toBe('list');
    expect(reply.payload.items.length).toBeGreaterThanOrEqual(3);
  });
});

/* ─────────────── J3 — Anne is moving in (cross-app) ─────────────── */

describe('J3 — Anne is moving in (cross-app follow-ups)', () => {
  let ws;
  beforeEach(async () => { ws = await bootTestWorkspace(); });

  it("addMember Anne returns success", async () => {
    // Part G — addMember is a membership shim (no `/addmember` slash in the
    // real manifest); dispatch the op directly.
    const reply = await ws.callSkill('household', 'addMember', { name: 'Anne' });
    expect(reply.ok).toBe(true);
    expect(reply.memberName).toBe('Anne');
  });

  it("collectFollowUps suggests folio.shareFolder + stoop.postRequest after addMember", () => {
    const followUps = collectFollowUps('addMember', 'household', { ok: true }, ws.catalogue());
    const apps = followUps.map((f) => f.appOrigin);
    expect(apps).toContain('folio');
    expect(apps).toContain('stoop');
  });

  it("resolveContact finds Anne by exact handle", async () => {
    const r = await ws.callSkill('household', 'resolveContact', { query: 'anne' });
    expect(r.confidence).toBe('exact');
    expect(r.webid).toBe('webid:anne');
  });

  it("resolveContact does fuzzy match on partial input", async () => {
    const r = await ws.callSkill('household', 'resolveContact', { query: 'ann' });
    expect(r.confidence).toBe('fuzzy');
    expect(r.webid).toBe('webid:anne');
  });
});

/* ─────────────── J4 — Browse tasks + snapshot ─────────────── */

describe('J4 — Browse tasks + drill-down', () => {
  let ws;
  beforeEach(async () => { ws = await bootTestWorkspace(); });

  it("/mytasks returns a list with stable ids", async () => {
    const reply = await ws.userInput('/mytasks');
    expect(reply.shape).toBe('list');
    // Post-integration: real tasks-v0 uses ULIDs (26-char base32-ish),
    // not the mock's `t-<random>` shape.  Just check non-empty.
    for (const item of reply.payload.items) {
      expect(typeof item.id).toBe('string');
      expect(item.id.length).toBeGreaterThan(8);
    }
  });

  it("getTaskSnapshot returns embed-shape data", async () => {
    const list = await ws.userInput('/mytasks');
    const first = list.payload.items[0];
    const snap = await ws.callSkill('tasks', 'getTaskSnapshot', { id: first.id });
    expect(snap.type).toBe('task');
    expect(snap.title).toBeTruthy();
    expect(snap.fields).toBeTruthy();
  });
});

/* ─────────────── J5 — Toggle settings (record) ─────────────── */

describe('J5 — Profile / settings record panel', () => {
  let ws;
  beforeEach(async () => { ws = await bootTestWorkspace(); });

  it("a record-shape reply renders with a title (/stoop-profile)", async () => {
    // Part G — the household `/profile` record demo was retired with the
    // chore mock (the real household manifest has no profile op).  The
    // record-reply journey is still covered by stoop's profile record.
    const reply = await ws.userInput('/stoop-profile');
    expect(reply.shape).toBe('record');
    expect(reply.payload.title).toBeTruthy();
  });
});

/* ─────────────── J6 — Pod sign-in framework ─────────────── */

describe('J6 — External-flow primitive (mock OIDC)', () => {
  let ws;
  beforeEach(async () => { ws = await bootTestWorkspace(); });

  it("/whoami with no podAuth wired returns 'unavailable'", async () => {
    const reply = await ws.userInput('/whoami');
    expect(reply.shape).toBe('text');
    expect(reply.payload.message).toMatch(/whoami\.unavailable|not available/i);
  });

  it("/signout with no podAuth wired returns 'unavailable'", async () => {
    const reply = await ws.userInput('/signout');
    expect(reply.payload).toBeNull();
    expect(reply.error?.message).toMatch(/signout\.unavailable|not available/i);
  });

  it("/signin (no externalFlow wired) returns a friendly error", async () => {
    // bootTestWorkspace doesn't wire externalFlow.open (no real
    // OIDC consumer in node).  /signin returns {ok:false, error}
    // from the defensive 'no_flow' path; the runDispatch defensive
    // guard then elevates that to reply.error + payload:null +
    // shape:'text'.  Test asserts the framework-level path; real
    // OIDC binding is a manual browser check.
    const reply = await ws.userInput('/signin');
    expect(reply.payload).toBeNull();
    expect(reply.error?.code).toBe('skill-error');
    // bootTestWorkspace stubs `t(k) => k`, so the error string is
    // the locale key (real builds resolve to "External sign-in is
    // not available in this build").  Match either form.
    expect(reply.error?.message).toMatch(/signin\.no_flow|not available/i);
  });
});

/* ─────────────── J7 — Embed task + multi-user RSVP ─────────────── */

describe('J7 — Embed + multi-user RSVP round-trip', () => {
  let ws;
  beforeEach(async () => { ws = await bootTestWorkspace(); });

  it("getChoreSnapshot + buildEmbed produce a real embed envelope", async () => {
    // Part G — the real household manifest declares no `/embed` factory (the
    // mock's markComplete.embed decl was retired), so the slash-driven
    // /embed path no longer resolves a household snapshot.  The embed
    // PRIMITIVE is still exercised: getChoreSnapshot (kept on the host agent)
    // reads a real household item, and buildEmbed wraps it into the card
    // envelope the renderer ships.
    const list = await ws.userInput('/list shopping');
    const itemId = list.payload.items[0].id;   // a real ULID
    const snapshot = await ws.callSkill('household', 'getChoreSnapshot', { choreId: itemId });
    expect(snapshot.title).toBe('Milk');
    const embed = buildEmbed({
      appOrigin: 'household', snapshot, issuedBy: ws.LOCAL_ACTOR,
    });
    expect(embed.kind).toBe('item-card');
    expect(embed.snapshot.title).toBe('Milk');
    expect(embed.issuedBy).toBe(ws.LOCAL_ACTOR);
  });

  it("calendar invite dispatches an embed-card to Anne's sim-peer thread", async () => {
    // Organiser creates event with Anne as attendee.  Use callSkill
    // directly (skips slash parsing) so the args land cleanly.
    const reply = await ws.callSkill('calendar', 'addEvent', {
      title:     'Drinks',
      startsAt:  '2026-06-15T18:00:00Z',
      attendees: ['webid:anne'],
    });
    expect(reply.ok).toBe(true);

    const anne = ws.store.getThread('sim-anne');
    expect(anne).toBeTruthy();
    const invite = anne.messages.find((m) =>
      m.rendered?.kind === 'embed-card'
      && m.rendered.embed?.itemRef?.app === 'calendar',
    );
    expect(invite).toBeTruthy();
    expect(invite.rendered.embed.snapshot.title).toBe('Drinks');
  });

  it("Anne's RSVP records on the event + broadcasts back via EventRouter", async () => {
    const add = await ws.callSkill('calendar', 'addEvent', {
      title:     'Coffee',
      startsAt:  '2026-06-10T10:00:00Z',
      attendees: ['webid:anne'],
    });
    expect(add.ok).toBe(true);
    const eventId = add.itemId;

    // Anne accepts (as if she clicked [Accept] in her thread).
    const ack = await ws.callSkill('calendar', 'rsvpAccept', {
      id: eventId, actor: 'webid:anne',
    });
    expect(ack.ok).toBe(true);

    // Organiser's view via getEventSnapshot reflects Anne's response.
    const snap = await ws.callSkill('calendar', 'getEventSnapshot', { id: eventId });
    expect(snap.fields.rsvp).toMatch(/webid:anne: accepted/);
  });
});

/* ─────────────── J8 — Focused alerts thread ─────────────── */

describe('J8 — Multi-thread filter + event routing', () => {
  let ws;
  beforeEach(async () => { ws = await bootTestWorkspace(); });

  it("Inbox default thread filters to notification + reminder", async () => {
    const inbox = ws.store.getThread('inbox');
    expect(inbox.filter.eventTypes).toEqual(expect.arrayContaining(['notification']));
  });

  it("a household-notification event lands in the inbox", () => {
    const matched = ws.router.deliver({
      id: 'e-1', ts: Date.now(),
      app: 'household', type: 'notification',
      payload: { message: 'Test event' },
    });
    expect(matched).toContain('inbox');
  });

  it("creating a household-alerts thread + delivering matches", () => {
    ws.store.createThread({
      id: 'house', name: 'Household alerts',
      filter: { apps: ['household'], eventTypes: ['notification', 'item-changed'] },
    });
    const matched = ws.router.deliver({
      id: 'e-2', ts: Date.now(),
      app: 'household', type: 'item-changed',
      itemRef: { app: 'household', type: 'chore', id: 'c-1' },
      payload: { message: 'Dishwasher done' },
    });
    expect(matched).toContain('house');
  });

  it("EventLog logs delivered events for /logs queries", () => {
    ws.router.deliver({
      id: 'e-3', ts: Date.now(),
      app: 'stoop', type: 'notification',
      payload: { message: 'new post' },
    });
    const logged = ws.eventLog.query({ filter: { apps: ['stoop'] } });
    expect(logged.length).toBeGreaterThan(0);
  });
});

/* ─────────────── J9 — Morning brief ─────────────── */

describe('J9 — /brief multi-app aggregator', () => {
  let ws;
  beforeEach(async () => { ws = await bootTestWorkspace(); });

  it("/brief returns sections from multiple apps", async () => {
    const reply = await ws.userInput('/brief');
    expect(reply.shape).toBe('brief');
    expect(reply.payload.sections.length).toBeGreaterThan(0);
    const apps = reply.payload.sections.map((s) => s.appOrigin);
    expect(apps).toContain('household');
  });

  it("/brief --refresh bypasses the 60s cache", async () => {
    const a = await ws.userInput('/brief');
    // Wait 5ms to ensure a different timestamp + a different
    // random cacheKey would emerge from a fresh fanout.
    await new Promise((r) => setTimeout(r, 5));
    const b = await ws.userInput('/brief --refresh');
    expect(b.payload.cacheKey).not.toBe(a.payload.cacheKey);
  });
});

/* ─────────────── J10 — Sync hints ─────────────── */

describe('J10 — _sync envelope per-style rendering', () => {
  let ws;
  beforeEach(async () => { ws = await bootTestWorkspace(); });

  it("household.markComplete reply carries _sync envelope", async () => {
    const reply = await ws.userInput('/done Milk');
    expect(reply.payload._sync).toBeTruthy();
    expect(reply.payload._sync.style).toBe('decentralized');
  });

  it("calendar.addEvent reply carries _sync envelope", async () => {
    const reply = await ws.callSkill('calendar', 'addEvent', {
      title: 'Test', startsAt: '2026-06-01T10:00:00Z',
    });
    expect(reply._sync).toBeTruthy();
    expect(['decentralized', 'central', 'pod-less']).toContain(reply._sync.style);
  });
});

/* ─────────────── /find search across apps ─────────────── */

describe('Bonus — /find across apps', () => {
  let ws;
  beforeEach(async () => { ws = await bootTestWorkspace(); });

  it("returns hits from the apps that declare a search surface (where matching)", async () => {
    // Part G — the real household manifest declares no `search` surface (the
    // mock's `searchChores` was retired), so household no longer participates
    // in /find.  Calendar (getEventSnapshot/search) still does — seed an event
    // with 'dishwasher' in the title and assert it surfaces.
    await ws.callSkill('calendar', 'addEvent', {
      title: 'dishwasher meeting',
      startsAt: '2026-06-01T10:00:00Z',
    });
    const reply = await ws.userInput('/find dishwasher');
    expect(reply.shape).toBe('find');
    const apps = reply.payload.groups.map((g) => g.appOrigin);
    expect(apps).toContain('calendar');
  });
});

/* ─────────────── /apps toggle ─────────────── */

describe('Bonus — /apps toggle (OQ-4.B)', () => {
  let ws;
  beforeEach(async () => { ws = await bootTestWorkspace(); });

  it("toggling stoop off removes its commands from the catalogue", async () => {
    ws.appRegistry.setEnabled('stoop', false);
    const cat = ws.catalogue();
    const stoopCmds = cat.commandMenu.filter((e) => e.appOrigin === 'stoop');
    expect(stoopCmds).toEqual([]);
  });
});
