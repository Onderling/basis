/**
 * canopy-chat — v0.2 web demo entry.
 *
 * Multi-thread workspace.  Sidebar lists every thread; user can
 * create new threads with filter + permissions; clicking switches
 * the active thread.  Events from skill dispatches fan out through
 * the EventRouter to every thread whose filter matches (per OQ-4).
 *
 * Pipeline:
 *   user input → parseInput → resolveDispatch → runDispatch
 *              → renderReply → ACTIVE thread state → DOM render
 *   mutation reply → EventRouter.deliver(item-changed event)
 *                  → matching threads receive notifications
 *
 * Phase v0.2 sub-slice 2.3.
 */

import {
  parseInput, mergeManifests, resolveDispatch, runDispatch, scopeReadyDispatch,
  getActiveCircle, setActiveCircle,
  renderReply, ThreadStore, createDefaultThreadStore, createEventRouter,
  REFRESHABLE_VERBS, executeBulkDispatch,
  initLocalisation, t, setLang, detectDeviceLang, currentLang,
  describeFilter, canopyChatManifest,
  IndexedDBStore, attachPersistence,
  collectFollowUps, claimEmbed,
  AppRegistry, filterCatalog,
  openExternalFlow, parseCallbackUrl, resumeInFlightFlows,
  runBrief, createBriefCache,
  runFind,
  EventLog, RETENTION_MS,
  // P6.4 #343 — chat-off consumer-side notice + save-for-later queue.
  isRecipientUnavailable, buildUnavailableNotice, createMessageQueue,
  // P6.6 #344 — auto-hop-prompt after empty in-circle skill search.
  shouldAutoSuggestHop, buildHopPromptCard,
  rememberDismissed, hasDismissed,
  // P6.7 #345 — inline skill-match list under posted skill questions.
  findSkillMatches,
  normalizeCircleMembers,
} from '../src/index.js';
import { buildFormSpec, validateAndCoerce } from '../src/forms/buildFormSpec.js';
import { renderStream, renderToDom } from '../src/web/domAdapter.js';
import { renderForm }                from '../src/web/domForm.js';
import { renderSidebar }             from '../src/web/threadSidebar.js';
import { renderLogsPanel }           from '../src/web/logsPanel.js';
import { openPagePanel, openContentPanel } from '../src/web/pagePanel.js';
import { renderJoinGroupWizard }     from '../src/web/wizards/joinGroupWizard.js';
import { makePropagateMeshIntros, makeHandleBuurtPeerIntro }
                                     from '../src/core/handlers/meshIntros.js';
import { makeRequestCatchUpFromKnownPeers, makeHandleCatchUpRequest }
                                     from '../src/core/handlers/catchUp.js';
// Bundle H Phase 2 (#269, 2026-05-27) — portable peer-router + lifted handler factories.
import { makePeerRouter }            from '../src/core/handlers/peerRouter.js';
import { makeHandleChatMessage }    from '../src/core/handlers/chatMessage.js';
import { makeHandleCalendarInvite } from '../src/core/handlers/calendarInvite.js';
import { makeHandleCalendarRsvp }   from '../src/core/handlers/calendarRsvp.js';
import { makeHandleFileShare }     from '../src/core/handlers/fileShare.js';
import { makeHandleBuurtPost }     from '../src/core/handlers/buurtPost.js';
import { makeHandleGroupRedeemRequest, makeHandleGroupRedeemResponse }
                                     from '../src/core/handlers/groupRedeem.js';
import { makeHandleHelpWithAccepted } from '../src/core/handlers/helpWith.js';
import { makeCalendarOutboundHook } from '../src/core/handlers/calendarOutbound.js';
import { renderSettingsWizard }      from '../src/web/wizards/settingsWizard.js';
import { renderCreateGroupWizard }   from '../src/web/wizards/createGroupWizard.js';
import { renderRestoreFromMnemonicWizard } from '../src/web/wizards/restoreFromMnemonicWizard.js';
import { renderConflictDisputeWizard }     from '../src/web/wizards/conflictDisputeWizard.js';
import { renderPostAudienceWizard }        from '../src/web/wizards/postAudienceWizard.js';
import { renderEncryptedBackupWizard }     from '../src/web/wizards/encryptedBackupWizard.js';
import { createRealHouseholdAgent }  from '../src/web/realAgent.js';
import { mockTasksManifest,
         mockStoopManifest,
         mockFolioManifest }         from '../src/core/manifests/mockManifests.js';
import { calendarManifest }          from '@canopy-app/calendar/manifest';
import { createLocalBuiltins }       from '../src/core/localBuiltins.js';
import { createFeedbackSurface, parseFeedbackInvite, feedbackContactItem } from '../src/feedback/feedbackSurface.js';
import { createCircleTurn } from '../src/v2/circleTurn.js';
import { createUserLlmDefaultStore, localStorageUserLlmIo } from '../src/v2/userLlmDefault.js';
import { localStoragePolicyIo } from '../src/v2/circlePolicyStore.js';
import { buildCircleLlmProviders } from '../src/v2/circleLlmProviders.js';
import { createClarifyingDispatch } from '../src/v2/clarifyingDispatch.js';
import * as podAuth                  from '../src/web/podAuth.js';
import {
  createPodWriter, discoverPodRoot,
  publishNknAddr, discoverPeerNknAddr,
} from '../src/web/podStorage.js';
// N5 — real-pod source for the folio Drive browser.  PodClient reads the
// user's signed-in pod via session.fetch (no provisioned creds / #167).
import { PodClient } from '@canopy/pod-client';

/* ── DOM refs ──────────────────────────────────────────── */

const sidebarEl  = document.getElementById('sidebar');
const messagesEl = document.getElementById('messages');
const logsPanelEl = document.getElementById('logs-panel');
const pagePanelEl = document.getElementById('page-panel');
const formEl     = document.getElementById('input-form');
const inputEl    = document.getElementById('chat-input');
const langEnBtn  = document.getElementById('lang-en');
const langNlBtn  = document.getElementById('lang-nl');
const headerNameEl   = document.getElementById('active-thread-name');
const headerFilterEl = document.getElementById('active-thread-filter');

/* ── state ─────────────────────────────────────────────── */

// F1 (5.3) — the v2 circle launcher (index.html / circleApp.js) is a
// separate page, so it persists the open circle to sessionStorage.
// classic.html loads fresh on navigation; hydrate the in-memory
// active-circle singleton from that bridge so item-creating dispatches
// here scope to the circle the user last opened.  (Mobile is one
// module instance, so it needs no bridge.)
try {
  const storedCircle = sessionStorage.getItem('cc.activeCircle');
  if (storedCircle) setActiveCircle(storedCircle);
} catch { /* sessionStorage unavailable — leave unscoped */ }

// v0.7.7 — pass a publishEvent callback that defers to the router
// (created further down).  Forward-ref pattern: skill mutations
// fire publishEvent which dispatches into the router; the router
// fans out to matching threads + appends to the EventLog.
let publishEventRef = () => {};   // overwritten right after router is constructed
const agent = await createRealHouseholdAgent({
  publishEvent: (event) => publishEventRef(event),
  // 2026-05-24 — wire stoop's IndexedDB persistence adapter (slice
  // 2a's IndexedDBPersist).  Without this, every page reload wipes
  // stoop's substrate state — including membership-redemption items,
  // which means cross-instance /post fan-out can't find any peers
  // after a reload (listGroupRoster returns []).  V0 single-actor:
  // one DB per browser origin is enough; multi-actor refinement
  // would derive the DB name from the active webid.
  stoopPersistDb: { dbName: 'cc-stoop-state', storeName: 'items' },
});
// v0.4 cross-app surface: stoop + folio manifests join the merged
// catalog so users see their commands in /help.  Q32 runtime filter
// drops folio's sync/watch (node-only) ops in the browser build.
const rawCatalog = mergeManifests([
  { manifest: canopyChatManifest },
  { manifest: agent.manifest },
  { manifest: mockTasksManifest },    // v0.7.2 — slash decls (skills already on host)
  { manifest: mockStoopManifest },
  { manifest: mockFolioManifest },
  { manifest: calendarManifest },     // v0.7.10 — calendar app
], { runtime: 'browser' });

// v0.6 OQ-4.B — app-toggle registry.  Filters disabled apps out of
// the catalog seen by parser/router/dispatch/renderer.  Persistence
// rides on the same IndexedDB store as threads in a future slice;
// today the registry is in-memory + survives the session.
const appRegistry = new AppRegistry();
appRegistry.syncWithCatalog(rawCatalog.appOrigins);
let catalog = filterCatalog(rawCatalog, appRegistry);
appRegistry.subscribe(() => { catalog = filterCatalog(rawCatalog, appRegistry); });

const manifestsByOrigin = {
  'canopy-chat': canopyChatManifest,
  'household':   agent.manifest,
  'tasks-v0':    mockTasksManifest,
  'stoop':       mockStoopManifest,
  'folio':       mockFolioManifest,
  'calendar':    calendarManifest,
};

// v0.2.4 — IndexedDB persistence.  Load existing threads on boot;
// seed defaults on fresh install; subscribe so future changes
// persist automatically.
/**
 * v0.7.P1-followup — was Main's persisted filter the OLD wildcard?
 * matchesKey treats `[]` and absent allow-lists as wildcard, so
 * `{}` matches every event.  We check via deep-equal to the empty
 * object (treating null/undefined/empty as the same condition).
 */
function isPermissiveWildcard(filter) {
  if (filter == null) return true;
  if (typeof filter !== 'object' || Array.isArray(filter)) return false;
  return Object.keys(filter).length === 0;
}

const idb = new IndexedDBStore();
let store;
const persisted = await idb.loadAll();
if (persisted.length > 0) {
  // Hydrate from disk.
  store = new ThreadStore();
  for (const t0 of persisted) {
    // v0.7.P1-followup 2026-05-23 — filter migration.  Threads
    // persisted before the {not:{}} fix have filter `{}` (the old
    // wildcard, which actually matches ALL events).  On hydration
    // we upgrade Main's filter to the new strict default so
    // routed events no longer flood Main as duplicate bubbles.
    // v0.7.P1-followup, 2nd pass: ALWAYS force Main's filter to the
    // strict {not:{}} regardless of the persisted value.  The earlier
    // version only ran when the filter was an empty object, but
    // some persisted threads have variations the wildcard check
    // missed (e.g. {apps: [], eventTypes: []} from older versions).
    // Main is the typed-input thread; it should NEVER receive
    // auto-routed events.  This is the right default for the
    // canonical 'main' thread.
    let migratedFilter = (t0.id === 'main') ? { not: {} } : t0.filter;
    const created = store.createThread({
      id:          t0.id,
      name:        t0.name,
      filter:      migratedFilter,
      permissions: t0.permissions,
    });
    created.createdAt = t0.createdAt;
    // v0.7.P1-followup — strip auto-routed event bubbles that
    // polluted Main when its filter was permissive.  We keep
    // user-typed messages + dispatch replies; drop shell-text
    // notifications that came from the EventRouter delivery path
    // (these are still in /logs).  Heuristic: shell-rendered
    // text messages whose messageId starts with 'notif-' came
    // from the EventRouter (per events.js #appendNotificationTo).
    created.messages = (t0.messages ?? []).filter((m) =>
      !(m.origin === 'shell'
        && typeof m.messageId === 'string'
        && m.messageId.startsWith('notif-'))
    );
    for (const [opId, listing] of t0._listings) {
      created._listings.set(opId, listing);
    }
  }
} else {
  store = createDefaultThreadStore();
  // Seed an extra "Household alerts" thread for the J8 demo (only
  // on fresh install — existing users keep their layout).
  store.createThread({
    id:     'household-alerts',
    name:   'Household alerts',
    filter: { apps: ['household'], eventTypes: ['item-changed', 'notification'] },
    permissions: { allowCommands: true },
  });
}

// Persist future changes asynchronously.
attachPersistence({ threadStore: store, idb });

const router = createEventRouter({
  threadStore: store,
  // E3 (§B#10) — auto-refresh a record/mini-page/embed panel the moment
  // an item-changed event marks it stale: re-run its sourceOp + swap the
  // rendered content in place (the same path the row-action refresh
  // uses).  Fire-and-forget; on a no-op/failure the static stale badge
  // that markPanelStale already set remains as the fallback.
  onPanelStale: (thread, panel) => {
    const opId = panel?.sourceOp?.opId;
    if (!opId) return;                                  // no source → badge
    const verb = catalog.opsById.get(opId)?.op?.verb;
    if (!REFRESHABLE_VERBS.has(verb)) return;           // mutation/unknown → badge
    refreshListMessageInPlace(thread, panel.messageId);
  },
});

// #176 — chat-shell double-render fix.  Tracks the thread currently
// running dispatchAndRender so the agent's publishEvent (called
// INSIDE the skill handler) can exclude it from notification routing.
// Without this, mutation slash commands appeared TWICE in the
// dispatching thread: once via the skill's publishEvent → notification
// render, once via dispatchAndRender's shellMessage reply render.
let activeDispatchThreadId = null;

// v0.7.7 — wire the agent's publishEvent so real mutations route
// through the EventRouter.  Each event gets a fresh id; ts auto-set
// by the router's normaliseEvent.  #176 — auto-injects
// excludeThreadIds for the currently-dispatching thread so the
// dispatching thread doesn't see a notification copy of the reply
// it's about to render as a shellMessage.
publishEventRef = (event) => {
  const enriched = {
    id: `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    ts: Date.now(),
    ...event,
  };
  const opts = activeDispatchThreadId
    ? { excludeThreadIds: [activeDispatchThreadId] }
    : {};
  router.deliver(enriched, opts);
};

// v0.6.2 — external-flow callback handler.  When the deep-link
// receiver fires (or the EventRouter wakes us via a delivered event),
// resume the thread with a confirmation message.  Real OIDC binding
// would also exchange the code for a session here; the mock returns
// a deterministic fake webid.
async function onSigninCallback(flow, params) {
  const t0 = store.getThread(flow.threadId);
  if (!t0) return;
  await dropFlow(flow.sessionId);
  const errored = params?.error ?? params?.code === undefined;
  const text = errored
    ? t('signin.failed',    { reason: params?.error ?? 'no code returned' })
    : t('signin.completed', { webid:  `webid:mock-${flow.sessionId.slice(-6)}` });
  t0.addShellMessage({
    kind:           'text',
    messageId:      `signin-cb-${flow.sessionId}`,
    threadId:       flow.threadId,
    lifecycleState: 'live',
    text,
  });
  if (typeof renderActiveStream === 'function') renderActiveStream();
}

await initLocalisation({ lng: detectDeviceLang() });
updateLangButtons();

// v0.5.1 — local actor identity for embed issuance.  Real
// identity wiring lands in v0.6 with the OIDC sign-in flow (J6);
// v0.5.x uses a stable demo webid so the [Claim] button correctly
// hides when the local user is the issuer.
const LOCAL_ACTOR = 'webid:local-demo-user';

// v0.5.6 — simulated cross-peer demo.  A second thread + identity
// representing "Anne" — lets /send-to anne route an embed to Anne's
// thread without real network.  Real cross-peer delivery rides on
// each hosting app's chat surface (per v0.5.3 audit).
const SIM_ANNE_THREAD_ID = 'sim-anne';
const SIM_ANNE_WEBID     = 'webid:anne';

if (!store.getThread(SIM_ANNE_THREAD_ID)) {
  store.createThread({
    id:          SIM_ANNE_THREAD_ID,
    name:        "Anne's view (simulated)",
    filter:      { actors: [SIM_ANNE_WEBID] },
    permissions: { allowCommands: false },   // read-only thread — represents Anne's chat
  });
}

const SIM_PEERS = {
  anne: { threadId: SIM_ANNE_THREAD_ID, webid: SIM_ANNE_WEBID },
};

// v0.7.12 — multi-pod RSVP coordination (simulated for the demo).
// When calendar.addEvent has attendees, the calendar app calls this
// to dispatch an invite-card to each attendee's thread.  Receivers
// RSVP via the embed's [Accept]/[Decline]/[Tentative] buttons
// (manifest-driven since v0.7.13).  Responses broadcast back via
// the calendar's rsvp* skills (which publishEvent → the organiser's
// open record panels reactively refresh per v0.6.3).
//
// In real cross-pod work this becomes:
//   - lookup attendee's chat surface (stoop's chat-p2p or notifier
//     push to their webid)
//   - send the invite envelope across the wire
//   - the attendee's calendar receives, persists their copy + opens
//     a chat thread with the invite-card
//
// Demo: attendee=webid → simPeer thread lookup; append embed-card
// directly to their thread.
async function inviteAttendee(webid, snapshot) {
  // Map webid → simPeer entry.  webid:anne → anne, etc.
  const peerName = webid.replace(/^webid:/, '');
  const peer     = SIM_PEERS[peerName];
  if (!peer) return;     // unknown attendee; demo can't reach them
  const dest = store.getThread(peer.threadId);
  if (!dest) return;
  dest.addShellMessage({
    kind:           'embed-card',
    messageId:      `invite-${snapshot.id}-${peerName}`,
    threadId:       peer.threadId,
    lifecycleState: 'live',
    embed: {
      kind:      'time-card',
      appOrigin: 'calendar',
      itemRef:   { app: 'calendar', type: 'calendar-event', id: snapshot.id },
      snapshot,
      issuedBy:  LOCAL_ACTOR,   // sender is the organiser (us)
    },
  });
}
// Wire it once the agent exists.  Done immediately below (the agent
// is already constructed above this block).
if (typeof agent.setInviteAttendee === 'function') {
  agent.setInviteAttendee(inviteAttendee);
}

// v0.7.P3b — connect NKN cross-peer transport.  Triggers async,
// non-blocking; takes 5-90s on first connect.  On success the user
// can /me to see their NKN address + /test-peer <addr> [text] to
// send a ping.  Inbound messages render as text bubbles in Main.
async function connectPeerImpl() {
  // v0.7.P3b — try to detect what's happening if the CDN didn't
  // load.  nkn-sdk sets window.nkn (UMD default).  Some builds set
  // it as 'nknSdk' or similar — try a few candidates before failing.
  const nknLib =
       (typeof window !== 'undefined' && window.nkn)
    ?? (typeof globalThis !== 'undefined' && globalThis.nkn)
    ?? null;
  if (!nknLib) {
    const loadError = (typeof window !== 'undefined') ? window.__cc_nkn_load_error : null;
    const loaded    = (typeof window !== 'undefined') ? window.__cc_nkn_loaded     : null;
    const hint = loadError
      ? `CDN load failed (${loadError}).  Check network + CSP.`
      : loaded
        ? 'CDN script loaded but did not set window.nkn — check the version pinned in index.html.'
        : 'CDN script not loaded yet.  Wait a moment + retry /peer-connect, or check network.';
    throw new Error(`nkn-sdk not available.  ${hint}`);
  }
  if (typeof agent.connectPeerTransport !== 'function') {
    throw new Error('Peer transport not supported by this agent build.');
  }
  // Bundle H Phase 2 (#269, 2026-05-27) — inline subtype dispatch
  // replaced by `peerMessageRouter` (built from portable
  // `makePeerRouter`).  Same subtype guards + handlers; the
  // dispatch shape now matches canopy-chat-mobile.
  return agent.connectPeerTransport({
    nknLib,
    onPeerMessage: peerMessageRouter,
  });
}

/**
 * v0.7.P3c — handle incoming 'calendar-invite' envelope.
 *
 * Adds the event to the LOCAL calendar (same id as organiser; stores
 * organiser's NKN address in _organiserNkn so a later RSVP knows
 * where to reply).  Then synthesises a time-card embed in Main so
 * the user sees [Accept]/[Decline]/[Tentative] buttons.
 */
async function handleCalendarInvite(fromNknAddr, payload) {
  const event = payload.event;
  if (!event?.id || !event?.title || !event?.startsAt) {
    console.warn('[peer] calendar-invite missing fields', payload);
    return;
  }
  // Persist locally via calendar.addEvent.  Pass the explicit id +
  // _organiserNkn so the receiver's calendar stays in sync with the
  // organiser's view + the RSVP knows where to dispatch.
  try {
    await callSkill('calendar', 'addEvent', {
      id:           event.id,
      title:        event.title,
      when:         event.startsAt,
      until:        event.endsAt,
      location:     event.location,
      attendees:    event.attendees ?? [],
      organiser:    event.organiser ?? fromNknAddr,
      _organiserNkn: fromNknAddr,
    });
  } catch (err) {
    console.error('[peer] failed to ingest invite locally', err);
    return;
  }
  // Render time-card embed in Main so the user sees the invitation.
  const main = store.getThread('main');
  if (!main) return;
  main.addShellMessage({
    kind:           'embed-card',
    messageId:      `invite-${event.id}`,
    threadId:       main.id,
    lifecycleState: 'live',
    embed: {
      kind:      'time-card',
      appOrigin: 'calendar',
      itemRef:   { app: 'calendar', type: 'calendar-event', id: event.id },
      snapshot: {
        id:       event.id,
        type:     'calendar-event',
        title:    event.title,
        startAt:  event.startsAt,
        endAt:    event.endsAt,
        ...(event.location ? { location: event.location } : {}),
        state:    'open',
        fields:   {
          state:     'open',
          organiser: event.organiser ?? fromNknAddr,
          ...(event.attendees?.length ? { attendees: event.attendees.join(', ') } : {}),
        },
      },
      issuedBy:  fromNknAddr,
    },
  });
  if (store.getActiveThread()?.id === main.id) renderActiveStream();
  publishEventRef({
    app:     'calendar',
    type:    'notification',
    actor:   fromNknAddr,
    payload: { message: `📅 calendar invite: ${event.title}` },
  });
}

/**
 * v0.7.P3f — handle incoming 'file-share' envelope.
 *
 * Renders a file-card embed in Main with the file's metadata
 * (name, mime, size).  Bytes (base64) stay in the embed payload
 * so [Download] can produce a Blob.  [Save to my pod] dispatches
 * the existing folio.saveToMyPod skill.
 */
async function handleFileShare(fromNkn, payload) {
  const f = payload.file;
  if (!f?.id || !f?.name || !f?.dataB64) {
    console.warn('[peer] file-share missing fields', payload);
    return;
  }
  const main = store.getThread('main');
  if (!main) return;
  main.addShellMessage({
    kind:           'embed-card',
    messageId:      `file-share-${f.id}`,
    threadId:       main.id,
    lifecycleState: 'live',
    embed: {
      kind:      'file-card',
      appOrigin: 'folio',
      itemRef:   { app: 'folio', type: 'file', id: f.id },
      snapshot:  {
        id:      f.id,
        type:    'file',
        name:    f.name,
        mime:    f.mime ?? 'application/octet-stream',
        bytes:   f.size,
        dataB64: f.dataB64,
        local:   false,
      },
      issuedBy:  fromNkn,
    },
  });
  if (store.getActiveThread()?.id === main.id) renderActiveStream();
  publishEventRef({
    app:     'folio',
    type:    'notification',
    actor:   fromNkn,
    payload: { message: `📎 file shared: ${f.name} (${formatBytes(f.size)})` },
  });
}

function formatBytes(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '?';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * v0.7.cc — turn an inline base64 file body (carried in a file-share
 * embed's snapshot.dataB64) into a real browser download.  Without
 * this, clicking [Download] on a received file-card would dispatch
 * folio.downloadFile — a demo stub that returns text, not bytes.
 *
 * Reported by Frits 2026-05-23 (manual runbook H-1): "Tab B's card
 * is missing the file body".  The card metadata renders fine; the
 * fix is making the [Download] action consume the inline bytes.
 *
 * @param {string} dataB64  base64-encoded file bytes
 * @param {string} name     filename (used as the download attribute)
 * @param {string} mime     MIME type (defaults to octet-stream)
 */
function triggerBlobDownloadFromBase64(dataB64, name, mime) {
  const bin = atob(dataB64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime || 'application/octet-stream' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = name || 'file';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Free the blob URL after the click; some browsers need a tick.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/* ─── 2026-05-24 — group-redeem peer-bridge (cross-instance join) ── */

// Joiner-side: outstanding redeem-requests keyed by requestId.  Each
// entry is {resolve, reject, timer}; the response handler looks up by
// requestId, fires resolve, clears the timeout.
const pendingPeerRedeems = new Map();

/**
 * Joiner-side helper called by /join-group's wizard finalSubmit when
 * local redeemMembershipCode returns invalid-or-expired-code AND the
 * invite carries an adminNkn.  Sends a peer-message to the admin's
 * NKN address + awaits the matching response with a 30s timeout.
 */
async function sendGroupRedeemRequest({ adminNkn, groupId, code, shareCard, peerDisplay }) {
  if (!agent?.peer || agent.peer.status !== 'connected') {
    throw new Error('Peer transport not connected. Try /peer-connect first.');
  }
  if (typeof agent.sendPeerMessage !== 'function') {
    throw new Error('Peer message API unavailable on this agent build.');
  }
  const requestId = `gr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const promise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingPeerRedeems.delete(requestId);
      reject(new Error('Admin did not respond within 30 s. They may be offline — try again later.'));
    }, 30_000);
    pendingPeerRedeems.set(requestId, { resolve, reject, timer });
  });
  try {
    await sendPeerWithRetry(adminNkn, {
      type:      'p2p-chat',
      subtype:   'group-redeem-request',
      requestId,
      groupId,
      code,
      // Slice 4 (2026-05-24) — mesh-consent token + display name
      // travel with the redeem request so admin can store them in
      // the membership-redemption + propagate.
      ...(shareCard ? { shareCard: true } : {}),
      ...(peerDisplay ? { peerDisplay } : {}),
      sentAt: Date.now(),
    });
  } catch (err) {
    const entry = pendingPeerRedeems.get(requestId);
    if (entry) { clearTimeout(entry.timer); pendingPeerRedeems.delete(requestId); }
    throw new Error(`Failed to reach admin over NKN: ${err?.message ?? err}`);
  }
  return promise;
}

/**
 * Admin-side: incoming group-redeem-request from a joiner.  Validate
 * the code in our local stoop substrate + reply over the same NKN
 * channel with either an ok-payload (codeId + validUntil) or an
 * error string.
 */
async function handleGroupRedeemRequest(fromNknAddr, payload) {
  const { requestId, groupId, code, shareCard, peerDisplay } = payload ?? {};
  if (!requestId || !groupId || !code) {
    console.warn('[peer] group-redeem-request missing fields', payload);
    return;
  }
  let reply;
  try {
    const result = await callSkill('stoop', 'verifyMembershipCodeForPeer', {
      groupId, code,
      // The substrate logs `requesterWebid` against the redemption so
      // the admin's roster sees who joined.  NKN address is our best
      // available joiner-identifier at this layer.
      requesterWebid: fromNknAddr,
      // Slice 4 — store joiner's mesh-consent + display name on the
      // redemption so propagation logic + listConsentingPeers can read.
      ...(shareCard ? { shareCard: true } : {}),
      ...(peerDisplay ? { peerDisplay } : {}),
    });
    if (result?.error) {
      reply = { error: result.error };
    } else {
      reply = {
        ok:         true,
        codeId:     result.codeId,
        validUntil: result.validUntil,
      };
    }
  } catch (err) {
    reply = { error: err?.message ?? String(err) };
  }
  try {
    await agent.sendPeerMessage(fromNknAddr, {
      type:    'p2p-chat',
      subtype: 'group-redeem-response',
      requestId,
      ...reply,
      sentAt: Date.now(),
    });
    publishEventRef({
      app: 'stoop', type: 'notification',
      payload: {
        message: reply.ok
          ? `📥 ${fromNknAddr.slice(0, 16)}… joined ${groupId} (peer-confirmed)`
          : `⚠ rejected join attempt for ${groupId}: ${reply.error}`,
      },
    });
    // Slice 4 — after a successful redeem, propagate addresses
    // among consenting members.  Fire-and-forget; failures don't
    // affect the redeem itself.
    if (reply.ok) {
      propagateMeshIntros({
        groupId, newPeerAddr: fromNknAddr, newPeerDisplay: peerDisplay,
        newPeerShared: !!shareCard,
      }).catch((err) => console.warn('[mesh-intro] propagation failed', err));
    }
  } catch (err) {
    console.error('[peer] group-redeem-response send failed', err);
  }
}

// #217 (2026-05-24) — Slice 4 + 5 handlers extracted to portable
// factories.  Lifted to src/core/handlers/ in #221.5 (2026-05-24) so
// canopy-chat-mobile can reuse them unchanged — they're zero-DOM,
// zero-Node, dependency-injected via ({callSkill, sendPeer, logger}).
// See test/handlers/*.test.js for fast unit coverage.

// 2026-05-24 — retry-on-HI-race now lives in secure-agent's
// sendToPeer (task #215). agent.sendPeerMessage handles it
// transparently.  sendPeerWithRetry kept as a thin alias for
// existing callsites; new callers should just use agent.sendPeerMessage.
const sendPeerWithRetry = (addr, payload) => agent.sendPeerMessage(addr, payload);

// 2026-05-24 fix — the handler factories below are called at MODULE
// load, but `callSkill` is `const`-declared later in this file → TDZ
// crash on browser load.  Wrap with lazy thunks so the inner ref
// resolves at CALL time (by which point callSkill is initialised).
const callSkillLazy = (...args) => callSkill(...args);
const sendPeerLazy  = (...args) => sendPeerWithRetry(...args);

const _propagateMeshIntros = makePropagateMeshIntros({
  callSkill: callSkillLazy,
  sendPeer:  sendPeerLazy,
});
async function propagateMeshIntros(args) {
  if (!agent?.peer || agent.peer.status !== 'connected') return;
  return _propagateMeshIntros(args);
}

const handleBuurtPeerIntro = makeHandleBuurtPeerIntro({ callSkill: callSkillLazy });

// ε.3 (2026-06-01) — the factory now routes each kring's catch-up via
// scheduleCatchUp(policy.pod).  Without an inbox + getCirclePolicy
// here, every kring defaults to `{pod: 'personal'}` ⇒ 'peer' strategy
// ⇒ today's behaviour exactly.  The kring-chat inbox lives in
// circleApp.js (the v2 launcher page), not in classic.html; pod
// range-query catch-up wakes up there once policy gets wired in (or
// the launcher inherits this same dispatch from a shared boot path).
const _requestCatchUpFromKnownPeers = makeRequestCatchUpFromKnownPeers({
  callSkill: callSkillLazy,
  sendPeer:  sendPeerLazy,
});
async function requestCatchUpFromKnownPeers() {
  if (!agent?.peer || agent.peer.status !== 'connected') return;
  return _requestCatchUpFromKnownPeers();
}

const handleCatchUpRequest = makeHandleCatchUpRequest({
  callSkill: callSkillLazy,
  sendPeer:  sendPeerLazy,
  getMyPubKey: () => agent?.identity?.chat?.pubKey ?? null,
});

// Bundle H Phase 2 (#269, 2026-05-27) — peer-message router via
// portable makePeerRouter.  Keeps web's existing inline handler
// bodies (they close over DOM state — store, renderActiveStream,
// dm.addShellMessage, …) but routes through the same dispatch
// shape canopy-chat-mobile uses.  The portable factory bodies live
// alongside (apps/canopy-chat/src/core/handlers/*.js) — mobile
// consumes them; web could migrate when convenient.
//
// Note on function-vs-arrow indirection: `handleCalendarInvite` etc.
// are `async function` declarations (hoisted) defined later in this
// module; passing the bare reference is safe.  Subtypes with extra
// inline guards (help-with-*, group-redeem-*) keep the guards as
// thin wrappers so the router stays declarative.
const peerMessageRouter = makePeerRouter({
  handlers: {
    'calendar-invite':       handleCalendarInvite,
    'calendar-rsvp':         handleCalendarRsvp,
    'file-share':            handleFileShare,
    'group-redeem-request':  handleGroupRedeemRequest,
    'group-redeem-response': handleGroupRedeemResponse,
    'buurt-post':            handleBuurtPost,
    'help-with-response':    (from, payload) => {
      // Web's pre-router guard preserved verbatim.
      if (!payload?.itemId || !payload?.body) return;
      if (payload.senderDisplay) updateDmPeerDisplay(from, payload.senderDisplay);
      return handleHelpWithResponse(from, payload);
    },
    'help-with-accepted':    (from, payload) => {
      if (!payload?.itemId) return;
      if (payload.senderDisplay) updateDmPeerDisplay(from, payload.senderDisplay);
      return handleHelpWithAccepted(from, payload);
    },
    'buurt-peer-intro':      (from, payload) => {
      // Pre-router guard: require both peerAddr + groupId.
      if (!payload?.peerAddr || !payload?.groupId) return;
      return handleBuurtPeerIntro(from, payload);
    },
    'catch-up-request':      (from, payload) => {
      if (!payload?.groupId) return;
      return handleCatchUpRequest(from, payload);
    },
  },
  // Slice 6a — default chat-message → DM bubble.  Lifted to portable
  // chatMessage.js; web wires it with its own ensureDmThread/
  // appendBubble/updatePeerDisplay closures.
  defaultHandler: makeHandleChatMessage({
    ensureDmThread,
    appendBubble: (threadId, rendered) => {
      const thread = store.getThread(threadId) ?? store.getThread('main') ?? store.getActiveThread();
      if (!thread) return;
      thread.addShellMessage(rendered);
      renderSidebarHere();
      if (store.getActiveThread()?.id === thread.id) renderActiveStream();
    },
    updatePeerDisplay: updateDmPeerDisplay,
    t,
  }),
});

/**
 * Joiner-side: incoming group-redeem-response from the admin.  Look
 * up the pending request by id + resolve its promise.
 */
function handleGroupRedeemResponse(fromNknAddr, payload) {
  const entry = pendingPeerRedeems.get(payload?.requestId);
  if (!entry) {
    console.warn('[peer] group-redeem-response with no pending entry', payload?.requestId);
    return;
  }
  clearTimeout(entry.timer);
  pendingPeerRedeems.delete(payload.requestId);
  entry.resolve(payload);
}

/**
 * Slice 1 (2026-05-24) — incoming buurt-post envelope from a peer.
 * Hands the broadcast payload to stoop.ingestRemotePost which mirrors
 * the substrate-mirror's write logic (dedup, eviction-filter, item
 * draft).  After ingest, publish a notification so the matching
 * thread + /logs see the inbound post.
 */
async function handleBuurtPost(fromNknAddr, envelope) {
  const { groupId, fromPubKey, payload } = envelope ?? {};
  console.info('[peer] buurt-post received: groupId=' + groupId
    + ' from=' + fromNknAddr?.slice(0, 16) + '… requestId=' + payload?.requestId);
  if (!payload?.requestId) {
    console.warn('[peer] buurt-post missing payload.requestId', envelope);
    return;
  }
  try {
    const result = await callSkill('stoop', 'ingestRemotePost', {
      payload,
      fromPubKey: fromPubKey ?? fromNknAddr,
      // 2026-05-24 — record the NKN address separately so [Help with]
      // can route over the wire later.  fromPubKey is the substrate
      // chat-agent identity (not routable on NKN); fromNknAddr is
      // what sa.peer.sendTo needs.
      fromNknAddr,
    });
    if (result?.error) {
      console.warn('[peer] ingestRemotePost rejected', result.error, payload.requestId);
      return;
    }
    if (result?.deduped) {
      // Idempotent — duplicate envelope or echo of own post.
      console.info('[peer] buurt-post deduped (already have requestId=' + payload.requestId + ')');
      return;
    }
    if (result?.evicted) {
      console.info('[peer] buurt-post from evicted member dropped', payload.from);
      return;
    }
    console.info('[peer] buurt-post ingested: new itemId=' + result?.itemId);
    publishEventRef({
      app:   'stoop',
      type:  'notification',
      actor: payload.from ?? fromNknAddr,
      payload: {
        message: `📥 ${payload.kind ?? payload.type ?? 'post'} in ${groupId ?? 'buurt'}: ${payload.text ?? '(no text)'}`,
        ...(payload.requestId ? { postId: payload.requestId } : {}),
        ...(groupId ? { groupId } : {}),
      },
    });
  } catch (err) {
    console.error('[peer] handleBuurtPost failed', err);
  }
}

/**
 * v0.7.P3c — handle incoming 'calendar-rsvp' envelope.
 *
 * Looks up the local event by id; applies the response via the
 * existing rsvp* skills.  Publishes a notification so /logs +
 * matching threads see the RSVP.
 */
async function handleCalendarRsvp(fromNknAddr, payload) {
  const { eventId, response } = payload;
  if (!eventId || !['accepted', 'declined', 'tentative'].includes(response)) {
    console.warn('[peer] calendar-rsvp invalid', payload);
    return;
  }
  const skillName = {
    accepted:  'rsvpAccept',
    declined:  'rsvpDecline',
    tentative: 'rsvpTentative',
  }[response];
  // Use the peer's NKN address as the actor key so the rsvp map
  // distinguishes attendees.
  try {
    await callSkill('calendar', skillName, { id: eventId, actor: fromNknAddr });
  } catch (err) {
    console.error('[peer] failed to apply RSVP locally', err);
    return;
  }
  publishEventRef({
    app:     'calendar',
    type:    'notification',
    actor:   fromNknAddr,
    payload: { message: `📅 RSVP ${response} from ${fromNknAddr.slice(0, 16)}…` },
  });
}

// v0.7.P3b-followup 2026-05-23: NKN auto-connect moved to AFTER the
// eventLog is attached (below) so the '🔗 NKN connected' event is
// captured in /logs.  Previously this block fired here + the
// async then() ran BEFORE eventLog.attachToRouter — events were
// published but eventLog hadn't subscribed yet → lost from /logs.
// Search for the deferred call near the eventLog wiring.

// v0.7.P1 — real Solid OIDC boot.  After the user returns from the
// pod issuer's auth page, the URL carries `?code=...&state=...&iss=...`
// and the issuer expects us to call handleIncomingRedirect() so the
// Inrupt lib completes the round-trip.  Result: an authenticated
// session that subsequent skills (and the future pod-attach in
// v0.7.P2) can read.
//
// Fire-and-forget — boot continues whether or not a session restores.
// v0.7.P3c diagnostic — log the redirect outcome to console so we
// can see what's happening when /whoami stays 'not signed in' even
// after a successful trip to the issuer (esp. for solidcommunity).
podAuth.handleRedirect({ restorePreviousSession: true })
  .then((session) => {
    if (typeof podAuth.getRawSessionInfo === 'function') {
      const raw = podAuth.getRawSessionInfo();
      console.info('[podAuth] handleRedirect resolved.  Raw session:', raw);
    }
    if (!session) {
      console.info('[podAuth] no logged-in session restored (use /whoami for state).');
      return;
    }
    // Strip the OIDC redirect params from the URL so a refresh
    // doesn't try to handle the same redirect again.
    if (typeof window !== 'undefined' && window.history?.replaceState) {
      const url = new URL(window.location.href);
      ['code', 'state', 'iss'].forEach((k) => url.searchParams.delete(k));
      window.history.replaceState({}, document.title, url.toString());
    }
    // v0.7.P2 + P2.2 — wire the pod writer into calendar so the .ics
    // feed write-throughs to <pod>/canopy/calendar/feed.ics.
    //
    // P2.2: discover the user's REAL pod root via the pim:storage
    // triple in their WebID document (Inrupt-style providers serve
    // the WebID on id.inrupt.com but the actual storage lives at
    // storage.inrupt.com/<uuid>/; the URL-only heuristic returned
    // the wrong path → all writes 404'd).  Discovery is async +
    // best-effort; if it fails we fall back to the URL heuristic.
    if (typeof agent.setCalendarPodWriter === 'function') {
      (async () => {
        try {
          let podRoot;
          try {
            podRoot = await discoverPodRoot(session);
          } catch (err) {
            console.warn('[podAuth] discoverPodRoot failed; falling back to URL heuristic', err);
          }
          const writer = createPodWriter(session, podRoot ? { podRoot } : {});
          agent.setCalendarPodWriter(writer);

          // N5 — light up the folio Drive's "My pod" source.  A PodClient
          // over the session's authenticated fetch lets `listFiles({source:
          // 'pod'})` walk the real pod container.  Best-effort; the in-app
          // index source is unaffected if this fails.
          if (typeof agent.setFolioPodSource === 'function' && writer.podRoot) {
            try {
              const podClient = new PodClient({
                podRoot: writer.podRoot,
                auth: { getAuthenticatedFetch: () => session.fetch },
              });
              agent.setFolioPodSource({ podClient, containerUri: writer.podRoot });
            } catch (err) {
              console.warn('[podAuth] folio pod-source wiring failed', err);
            }
          }
          // Surface the discovered pod root in the chat so the user
          // immediately knows where their data lives.
          publishEventRef({
            app:     'canopy-chat',
            type:    'notification',
            actor:   session.webid,
            payload: { message: `Pod root: ${writer.podRoot}` },
          });

          // v0.7.P3d — publish our NKN address to the pod so peers
          // can discover it from our WebID.  Fire-and-forget; the
          // user can manually re-publish via /publish-nkn if needed.
          const nknAddr = agent.peer?.address;
          if (nknAddr) {
            try {
              const r = await publishNknAddr(writer, nknAddr);
              if (r.ok) {
                publishEventRef({
                  app: 'canopy-chat', type: 'notification', actor: session.webid,
                  payload: { message: `🔗 Published NKN address to pod: ${r.url}` },
                });
              } else {
                publishEventRef({
                  app: 'canopy-chat', type: 'notification', actor: session.webid,
                  payload: { message: `⚠️ NKN address publish: HTTP ${r.status}` },
                });
              }
            } catch (err) {
              console.warn('[podAuth] failed to publish NKN address', err);
            }
          }
        } catch (err) {
          console.warn('[podAuth] failed to wire calendar pod writer', err);
        }
      })();
    }
    // Surface the welcome in the Main thread.
    const main = store.getThread('main');
    if (main) {
      const rendered = renderReply({
        payload: t('signin.welcome', { webid: session.webid }),
        shape:   'text', threadId: main.id,
      }, { t });
      main.addShellMessage(rendered);
      if (store.getActiveThread()?.id === main.id) renderActiveStream();
    }
    // Also publish into the EventRouter so /logs records it.
    publishEventRef({
      app:     'canopy-chat',
      type:    'notification',
      actor:   session.webid,
      payload: { message: `Signed in as ${session.webid}` },
    });
    // Refresh the sidebar so the new identity chip can render.
    renderSidebarHere?.();
  })
  .catch((err) => {
    console.error('[podAuth] handleRedirect failed', err);
  });

// v0.6.2 — external-flow wiring.  In-flight state persists to IDB's
// 'cc-in-flight-flows' object store.  The mock sign-in URL is
// canopy-chat's own page with a query param that auto-triggers the
// callback after a short delay (so the demo round-trip works
// without a real OIDC provider).
const IN_FLIGHT_IDB_KEY = 'cc-in-flight-flows';
async function persistFlow(flow) {
  // Read-modify-write the in-flight list in IDB.
  const all = await idb.loadInFlight().catch(() => []);
  const next = [...all.filter((f) => f.sessionId !== flow.sessionId), flow];
  await idb.saveInFlight(next);
}
async function dropFlow(sessionId) {
  const all = await idb.loadInFlight().catch(() => []);
  await idb.saveInFlight(all.filter((f) => f.sessionId !== sessionId));
}

// Mock sign-in URL — reuses canopy-chat's own page with ?mock-oidc=1
// + the session id; the deep-link receiver fires the callback when
// the URL has cc-callback=<sessionId>.  In real OIDC, this becomes
// the issuer's authorization endpoint.
function mockSigninUrl(sessionId) {
  const here = globalThis.location?.origin ?? 'http://localhost:5173';
  return `${here}/?mock-oidc=1&cc-callback=${encodeURIComponent(sessionId)}`;
}

// v0.7 — /brief aggregator cache (60s TTL per OQ-7.A).
const briefCache = createBriefCache();

// v0.7.1c — log-panel toggle.  /logs opens the side-panel; clicking
// [×] closes it.  EventLog subscribers re-render on every appended
// event so the panel stays live.
function openLogsPanel() {
  logsPanelEl.hidden = false;
  logsPanelEl.classList.remove('cc-logs-closed');
  logsPanelEl.classList.add('cc-logs-open');
  // E4 — remember the thread we opened from so "← back to chat"
  // restores it even after [Open in chat] switched the active thread.
  const originThreadId = store.getActiveThread()?.id ?? null;
  renderLogsPanel(logsPanelEl, {
    doc: document,
    eventLog,
    backTo: originThreadId ? {
      returnTo:   originThreadId,
      label:      t('chat.nav.backToChat'),
      onNavigate: () => {
        if (store.getThread(originThreadId)) store.setActiveThread(originThreadId);
        renderActiveStream();
      },
    } : undefined,
    onClose: () => {
      logsPanelEl.hidden = true;
      logsPanelEl.classList.remove('cc-logs-open');
      logsPanelEl.classList.add('cc-logs-closed');
    },
    onViewContext: (itemRef) => {
      const t0 = activeThread();
      if (!t0) return;
      // Demo only: append a text bubble describing the item ref.
      // Future: navigate to the item's mini-page via /embed-like
      // lookup if a Q29 cardSnapshotSkill is declared.
      const rendered = renderReply({
        payload: `→ ${itemRef.app}.${itemRef.type}.${itemRef.id} (context navigation lands when item-pages exist)`,
        shape:   'text', threadId: t0.id,
      }, { t });
      t0.addShellMessage(rendered);
      renderActiveStream();
    },
    onMute: () => { /* eventLog handles + re-renders via the panel itself */ },
    onOpenInChat: (event) => {
      // Find a thread whose filter matches the event's app+type;
      // if one exists, switch to it.  Otherwise create one.
      const threads = store.listThreads();
      const match = threads.find((th) => {
        const apps  = th.filter?.apps      ?? [];
        const types = th.filter?.eventTypes ?? [];
        return (apps.includes(event.app)  || apps.includes('*')  || apps.length === 0)
            && (types.includes(event.type) || types.includes('*') || types.length === 0);
      });
      if (match) {
        store.setActiveThread(match.id);
      } else {
        const created = store.createThread({
          name:        `${event.app} alerts`,
          filter:      { apps: [event.app], eventTypes: [event.type] },
          permissions: { allowCommands: true },
        });
        store.setActiveThread(created.id);
      }
      logsPanelEl.hidden = true;
      logsPanelEl.classList.remove('cc-logs-open');
      logsPanelEl.classList.add('cc-logs-closed');
    },
  });
}

// #180 (2026-05-24) — open the generic page panel for an op whose
// manifest declares surfaces.page.  Caller: dispatchAndRender's
// interception; the panel handles dispatch on form submit.
//
// Per-op wizard renderers register here.  Each Cluster C wizard
// (#196 joinGroup, #197 createGroup, …) exports a custom renderer
// + this map dispatches to the right one.  Ops with no entry use
// the V0 generic-form path in pagePanel.js.
const WIZARD_RENDERERS = {
  settings:                   renderSettingsWizard,
  joinGroupWizard:            renderJoinGroupWizard,
  createGroupWizard:          renderCreateGroupWizard,
  restoreFromMnemonicWizard:  renderRestoreFromMnemonicWizard,
  conflictDisputeWizard:      renderConflictDisputeWizard,
  postAudienceWizard:         renderPostAudienceWizard,
  encryptedBackupWizard:      renderEncryptedBackupWizard,
};

/**
 * Slice 6a (2026-05-24) — ensure a DM-scoped thread exists for the
 * given peer (NKN address OR webid; we use whatever the caller
 * passes).  Pairs the two parties via `filter.actors`.  The `dm:
 * true` flag is informational (sidebar can style DMs distinctly).
 *
 * @param {string}   peerId            NKN address or webid of the other party
 * @param {object}   [opts]
 * @param {string}   [opts.label]      display name; defaults to a short hash
 * @param {{threadId: string, label?: string}} [opts.origin]
 *   When the DM was spawned from another thread (e.g. [Help with] on a
 *   buurt post), record the originating thread so #181's "← back" link
 *   shows up.
 * @returns {import('../src/thread.js').Thread}
 */
function ensureDmThread(peerId, opts = {}) {
  if (typeof peerId !== 'string' || peerId === '') return null;
  const existing = [...store.listThreads()].find(t =>
    t.filter?.dm === true
      && Array.isArray(t.filter?.actors)
      && t.filter.actors.includes(peerId),
  );
  if (existing) return existing;
  // 2026-05-24 — pre-HI placeholder via locale: "DM: Unknown peer".
  // Real name is filled in by updateDmPeerDisplay() once the peer
  // sends us their displayName (in any inbound envelope).
  const dmPrefix  = t('sidebar.dm_prefix',  { defaultValue: 'DM' });
  const fallback  = t('sidebar.dm_unknown', { defaultValue: 'Unknown peer' });
  const label = opts.label ?? fallback;
  const dm = store.createThread({
    name:   `${dmPrefix}: ${label}`,
    filter: { actors: [peerId], dm: true },
    permissions: { allowCommands: true },
    ...(opts.origin ? { origin: opts.origin } : {}),
  });
  // Capture the peer's address on the thread itself so renames + the
  // (future) /test-peer-from-dm slash can read it without re-parsing
  // the filter.
  dm.peerAddr = peerId;
  return dm;
}

/**
 * Slice 6a follow-up (2026-05-24) — when a peer's display name
 * becomes known (e.g. via any inbound envelope's senderDisplay
 * field), rename every DM thread paired with that peer.  Idempotent;
 * skips when the new name matches the current.
 */
function updateDmPeerDisplay(peerAddr, displayName) {
  if (typeof peerAddr !== 'string' || !peerAddr) return;
  if (typeof displayName !== 'string' || !displayName.trim()) return;
  const dmPrefix = t('sidebar.dm_prefix', { defaultValue: 'DM' });
  const newName  = `${dmPrefix}: ${displayName.trim()}`;
  let changed = false;
  for (const thread of store.listThreads()) {
    if (thread.filter?.dm !== true) continue;
    if (!Array.isArray(thread.filter?.actors) || !thread.filter.actors.includes(peerAddr)) continue;
    if (thread.name === newName) continue;
    store.updateThread(thread.id, { name: newName });
    changed = true;
  }
  if (changed) {
    renderSidebarHere();
    if (store.getActiveThread()?.filter?.dm === true) renderActiveHeader();
  }
}

/**
 * 2026-05-24 — read our local display name from stoop profile so we
 * can stamp it on outbound peer envelopes (the receiver uses it to
 * rename their DM-with-us thread).  Cached for the session; falls
 * back to the local actor's pubKey when no handle is set yet.
 */
let _cachedDisplay = null;
async function getMyDisplayName() {
  if (_cachedDisplay) return _cachedDisplay;
  try {
    const reply = await callSkill('stoop', 'getStoopProfile', {});
    const name = reply?.displayName ?? reply?.handle ?? null;
    if (typeof name === 'string' && name.trim()) {
      _cachedDisplay = name.trim();
      return _cachedDisplay;
    }
  } catch { /* swallow */ }
  return null;
}

/**
 * Slice 2 (2026-05-24) — ensure a buurt-scoped thread exists for the
 * given groupId, creating it on first call.  Subsequent calls return
 * the same thread.  Thread filter routes any event whose
 * `payload.groupId === buurtId` here (matches handleBuurtPost
 * notifications + the local-post echo).
 */
function ensureBuurtThread(buurtId, hint) {
  const existing = [...store.listThreads()].find(t =>
    Array.isArray(t.filter?.buurtId) && t.filter.buurtId.includes(buurtId),
  );
  if (existing) return existing;
  const name = hint?.handle
    ? `Buurt: ${buurtId} (${hint.handle})`
    : `Buurt: ${buurtId}`;
  // #181 — record the originating thread so the new buurt thread
  // can offer a "← Back to <origin>" affordance.  When called from
  // pageSurfaceOpen's onDispatched the active thread IS the origin.
  const originThread = activeThread();
  const origin = originThread && originThread.id !== name
    ? { threadId: originThread.id, label: originThread.name }
    : undefined;
  return store.createThread({
    name,
    filter: { apps: ['stoop'], buurtId: [buurtId] },
    permissions: { allowCommands: true },
    ...(origin ? { origin } : {}),
  });
}

function pageSurfaceOpen({ op, appOrigin, args }) {
  const customRenderer = WIZARD_RENDERERS[op.id];
  // E4 — origin thread for the chat-nav "← back to chat" button.
  const originThreadId = store.getActiveThread()?.id ?? null;
  openPagePanel({
    container: pagePanelEl,
    doc:       document,
    op,
    appOrigin,
    args,
    callSkill: callSkillRef,
    t,
    backTo: originThreadId ? {
      returnTo:   originThreadId,
      label:      t('chat.nav.backToChat'),
      onNavigate: () => {
        if (store.getThread(originThreadId)) store.setActiveThread(originThreadId);
        renderActiveStream();
      },
    } : undefined,
    onClose:   () => {
      // Already cleared the DOM in pagePanel; this hook is for
      // any external bookkeeping (none today).
    },
    onDispatched: (reply) => {
      // Slice 2 — when a wizard dispatch carries a groupId (create-
      // or join-group success), auto-spawn (or activate) a buurt-
      // scoped thread + drop the reply there.  Falls back to the
      // active thread when no groupId in the reply.
      const buurtId = reply?.groupId ?? null;
      const target  = buurtId
        ? ensureBuurtThread(buurtId, reply)
        : activeThread();
      if (!target) return;
      // 2026-05-24 — wizards send `{ok, message, ...result}` directly
      // (no shape envelope).  Normalise to a {shape, payload} reply
      // so renderReply produces a readable text bubble instead of an
      // empty stub.  Pass-through when the wizard already returned a
      // shape (defensive: future-proof).
      const normalised = (reply && typeof reply === 'object' && reply.shape)
        ? reply
        : {
            shape:    'text',
            payload:  reply?.message ?? (reply?.ok === true ? '✓ done' : JSON.stringify(reply)),
            threadId: target.id,
          };
      const rendered = renderReply(normalised, {
        t,
        appOrigin,
        manifestsByOrigin,
      });
      target.addShellMessage(rendered, { opId: op.id });
      if (buurtId) {
        // Activate the freshly-opened buurt thread so the user lands
        // in the right conversation immediately.
        store.setActiveThread(target.id);
        renderSidebarHere();
      }
      renderActiveStream();
    },
    ...(customRenderer ? { customRenderer: ({ container, onClose, onDispatched }) =>
      customRenderer({
        container, doc: document, args, callSkill: callSkillRef,
        onClose, onDispatched,
        // /create-group success step uses this to stamp the admin's
        // NKN address into the invite URL.  /join-group uses
        // sendPeerRedeem to route a redeem-request to that address
        // when the joiner's local store has no copy of the code.
        getMyNkn:       () => agent?.peer?.address ?? null,
        sendPeerRedeem: sendGroupRedeemRequest,
        // #212 — /settings wizard needs locale + transport-mode hooks.
        getLang: currentLang,
        setLang: async (lng) => { await setLang(lng); updateLangButtons(); renderAll(); },
        getTransportMode: () => agent?.transportMode ?? null,
        setTransportMode: (m) => { try { agent?.setTransportMode?.(m); } catch { /* swallow */ } },
      }) } : {}),
  });
}

// Re-render the logs panel when new events arrive (so the live
// stream updates without needing to re-type /logs).
let logsPanelDirty = null;
function scheduleLogsPanelRerender() {
  if (logsPanelEl.hidden) return;
  if (logsPanelDirty) return;
  logsPanelDirty = setTimeout(() => {
    logsPanelDirty = null;
    if (!logsPanelEl.hidden) openLogsPanel();   // rerender
  }, 100);
}

// v0.7.1 — network-events log (D.1).  Hydrates from IndexedDB; prunes
// 14-day cutoff on boot (per OQ-7.B); attaches to the EventRouter so
// every delivered event flows in automatically.
const persistedEvents = await idb.loadEvents().catch(() => []);
const persistedMuted  = await idb.loadMutedEvents().catch(() => []);
// Prune on boot for speed (avoids scanning the whole log in JS).
await idb.pruneEventsBefore(Date.now() - RETENTION_MS).catch(() => {});
const eventLog = new EventLog({
  initial: persistedEvents,
  muted:   persistedMuted,
  persist: (events) => idb.saveEvents(events),
});
eventLog.setMutedPersistor((muted) => idb.saveMutedEvents(muted));
eventLog.attachToRouter(router);
// Live-rerender the logs panel when new events flow in.
eventLog.subscribe(() => scheduleLogsPanelRerender());

// v0.7.P3b-followup — NKN auto-connect, now AFTER eventLog is
// wired so the connect notification + every inbound peer message
// reliably hits /logs.
if (typeof window !== 'undefined' && window.nkn) {
  connectPeerImpl()
    .then((ctrl) => {
      console.info('[peer] connected, NKN address:', ctrl.address);
      publishEventRef({
        app: 'canopy-chat', type: 'notification',
        payload: { message: `🔗 NKN connected: ${ctrl.address}` },
      });
      // Slice 5 (2026-05-24) — catch up on posts we missed while
      // offline.  Single round-trip per known peer per buurt; the
      // receiver replies via the existing buurt-post envelope so
      // the standard ingest path handles dedup + render.  Small
      // delay so NKN's HI handshake settles first (otherwise the
      // first sendPeerMessage to each new peer trips "send HI first").
      //
      // ε.3 (2026-06-01) — `requestCatchUpFromKnownPeers` now routes
      // each kring through `scheduleCatchUp(policy.pod)`.  classic.html
      // doesn't wire policy/inbox here, so every kring falls back to
      // the 'peer' strategy (bit-for-bit identical to today's path).
      // When the launcher (circleApp.js) inherits this trigger it will
      // pass `getCirclePolicy` + `inbox`, lighting up the pod path for
      // shared-pod kringen automatically.  See
      // PLAN-canopy-chat-v2-circle.md Phase 9 / ε wave.
      setTimeout(() => {
        requestCatchUpFromKnownPeers().catch((err) =>
          console.warn('[catch-up] kick-off failed', err));
      }, 1500);
    })
    .catch((err) => {
      console.warn('[peer] NKN connect failed:', err.message);
    });
}

// A1 (2026-05-23) — auto-restore relay configuration from vault.
// /set-relay persists the URL under cc-relay-url; /transport-mode
// persists the choice under cc-transport-mode.  On boot we re-apply
// both so the user doesn't have to retype the URL every session.
(async function restoreRelayConfig() {
  if (!agent?.vault?.get) return;
  try {
    const savedMode = await agent.vault.get('cc-transport-mode');
    if (savedMode && typeof agent.setTransportMode === 'function') {
      agent.setTransportMode(savedMode);
      console.info('[relay] restored transport mode:', savedMode);
    }
    const savedUrl = await agent.vault.get('cc-relay-url');
    if (savedUrl && agent.relay?.connect) {
      await agent.relay.connect({ relayUrl: savedUrl });
      console.info('[relay] reconnected:', savedUrl, '→', agent.relay.address);
      publishEventRef({
        app: 'canopy-chat', type: 'notification',
        payload: { message: `🔗 Relay connected: ${savedUrl}` },
      });
    }
  } catch (err) {
    console.warn('[relay] restore failed:', err.message ?? err);
  }
})();

// callSkill is declared further down; createLocalBuiltins needs it
// for the /embed factory.  Forward-declared variable + helper.
let callSkillRef;
// Pass `catalog` as a getter so /apps and /help always see the
// CURRENT filtered catalog (re-derived when appRegistry changes).
const localBuiltins = createLocalBuiltins({
  // Builtins receive the current rawCatalog for app listing; opsById
  // / commandMenu are read at call time on the filtered catalog via
  // the dispatch path.  /apps surfaces both enabled AND disabled
  // apps (so the user can re-enable).
  catalog: rawCatalog,
  t,
  threadStore: store,
  setActive:   (id) => store.setActiveThread(id),
  callSkill:   (appOrigin, opId, args) => callSkillRef(appOrigin, opId, args),
  localActor:  LOCAL_ACTOR,
  simPeers:    SIM_PEERS,
  appRegistry,
  eventLog,
  briefRunner: (opts) => runBrief({ catalog, callSkill, cache: briefCache, bypassCache: opts?.bypassCache }),
  findRunner:  (opts) => runFind({ catalog, callSkill, query: opts?.query }),
  openLogsPanel: () => openLogsPanel(),
  // v0.7.13 — browser File API picker.  Opens a hidden
  // <input type="file"> programmatically + resolves with the selected
  // File (or null if the user cancels).
  //
  // 2026-05-23 bugfix — Frits hit "File picker cancelled" AFTER picking
  // a file (Linux / large file).  Root cause: the focus fallback (used
  // to detect "user dismissed dialog without picking") raced with the
  // real `change` event on slow filesystems — 300ms wasn't long enough
  // for change to win.
  //
  // Fix:
  //   1. Prefer the modern `cancel` event (Chrome 113+, Safari 16.4+,
  //      Firefox 91+) — fires ONLY on dismiss, never on success.
  //   2. Keep the focus fallback for older browsers but extend the
  //      wait + recheck `inp.files.length` so a slow-arriving change
  //      doesn't lose the race.
  openFilePicker: () => new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.style.display = 'none';
    document.body.appendChild(inp);
    let settled = false;
    const cleanup = (result) => {
      if (settled) return;
      settled = true;
      if (inp.parentNode) document.body.removeChild(inp);
      resolve(result);
    };
    inp.addEventListener('change', () => cleanup(inp.files?.[0] ?? null));
    // Modern signal — only fires on actual dismiss.
    inp.addEventListener('cancel', () => cleanup(null));
    // Legacy fallback — focus returns when the dialog closes (either
    // way).  Wait 1500ms (vs. 300ms before) AND re-check inp.files
    // so a slow-firing change event still wins.
    setTimeout(() => {
      window.addEventListener('focus', () => {
        setTimeout(() => {
          if (settled) return;
          if ((inp.files?.length ?? 0) > 0) {
            cleanup(inp.files[0]);
          } else {
            cleanup(null);
          }
        }, 1500);
      }, { once: true });
    }, 0);
    inp.click();
  }),
  // v0.7.P1 — real Inrupt browser OIDC for /signin + /whoami + /signout.
  // podAuth.* delegates to @inrupt/solid-client-authn-browser; the
  // signinFlow handler in localBuiltins prefers podAuth.startSignIn
  // over the mock externalFlow when both are available.
  podAuth,
  // v0.7.P2 — when the user signs out, unwire the calendar pod
  // writer so subsequent mutations no longer hit the now-stale
  // session.fetch + go local-only.
  onSignOut: () => {
    if (typeof agent.setCalendarPodWriter === 'function') {
      agent.setCalendarPodWriter(null);
    }
    // N5 — detach the folio Drive's real-pod source; "My pod" falls back
    // to the connect-pod prompt until the next sign-in.
    if (typeof agent.setFolioPodSource === 'function') {
      agent.setFolioPodSource(null);
    }
  },
  // v0.7.P3a — expose the persistent agent identity (chat-side
  // pubKey + stableId) to handlers like /me.
  agent,
  // v0.7.P3b — connect the NKN peer transport.  Called by /peer-
  // connect builtin or auto-fired on sign-in (below).  When
  // window.nkn is missing (CDN not loaded yet), returns rejected
  // promise.
  connectPeer: () => connectPeerImpl(),
  // v0.7.P3d — WebID-based peer discovery.  /lookup-peer <webid>
  // hits the peer's pod identity.ttl + extracts canopy:nknAddr.
  lookupPeerNknByWebid: async (webid) => {
    const session = podAuth.getCurrentSession();
    if (!session) throw new Error('Sign in first: /signin');
    return discoverPeerNknAddr(session, webid);
  },
  // v0.7.P3d — re-publish own NKN address to pod.
  publishNknAddrToPod: async () => {
    const session = podAuth.getCurrentSession();
    if (!session) throw new Error('Sign in first: /signin');
    const podRoot = await discoverPodRoot(session).catch(() => null);
    const writer  = createPodWriter(session, podRoot ? { podRoot } : {});
    const addr    = agent.peer?.address;
    if (!addr) throw new Error('NKN not connected yet.  /peer-connect first.');
    return publishNknAddr(writer, addr);
  },
  externalFlow: {
    /**
     * Open a sign-in flow.  Persists in-flight state + navigates to
     * the (mock) external page.  When the user returns via the
     * callback URL, the deep-link receiver below fires `onCallback`
     * which resumes the chat thread.
     */
    async open({ issuer }) {
      const active = store.activeThread;
      if (!active) throw new Error('no active thread');
      await openExternalFlow({
        url:        mockSigninUrl('{sessionId}'),
        threadId:   active.id,
        opId:       'signin',
        prefilledArgs: issuer ? { issuer } : undefined,
        purpose:    'oidc-signin',
        eventRouter: router,
        onCallback: onSigninCallback,
        persistFlow,
      });
    },
  },
});

// Bundle calendar cross-peer (#238) — late-bound so callSkill can
// reference the hook without TDZ.  Assigned just below after callSkill
// itself is initialised, since the hook closes over callSkill.
let _calendarOutboundHook = async () => {};

const callSkill = async (appOrigin, opId, args) => {
  if (appOrigin === 'canopy-chat') {
    const handler = localBuiltins[opId];
    if (!handler) throw new Error(`No local handler for canopy-chat.${opId}`);
    return handler(args ?? {});
  }
  // v0.7.2/3/4 — all 4 apps now run as real skills on the same
  // host agent.  Skill ids are flat (no collisions in the v0.7 demo);
  // briefSummary ids are app-scoped (tasks_briefSummary etc) to
  // avoid the Q30 fan-out hitting the wrong one.
  if (appOrigin === 'household') {
    return agent.callSkill(appOrigin, opId, args);
  }
  if (appOrigin === 'tasks-v0') {
    // Post-slice-1 (integration-plan 2026-05-23): tasks-v0 is the
    // real crew agent composed in realAgent.js (110 real skills).
    // realAgent.callSkill knows the bus address + the briefSummary
    // / searchTasks / myInbox alias mappings.
    return agent.callSkill('tasks-v0', opId, args);
  }
  if (appOrigin === 'stoop') {
    // Post-slice-2b (integration-plan 2026-05-23): stoop is the
    // real NeighborhoodAgent composed in realAgent.js.
    return agent.callSkill('stoop', opId, args);
  }
  if (appOrigin === 'folio') {
    // Post-slice-4 (integration-plan 2026-05-23): folio is the
    // dedicated browser folio agent composed in realAgent.js.
    // realAgent.callSkill knows the briefSummary→folio_briefSummary
    // alias.
    return agent.callSkill('folio', opId, args);
  }
  if (appOrigin === 'calendar') {
    // Calendar skills are registered with the 'calendar_' prefix on
    // the host agent (per v0.7.10 multi-app collision-avoidance).
    const result = await agent.callSkill('household', `calendar_${opId}`, args);

    // Bundle calendar cross-peer (#238, 2026-05-27) — inline fan-out
    // logic replaced by portable `calendarOutboundHook`.  Same envelope
    // shapes (calendar-invite / calendar-rsvp + cancelEvent stub) +
    // same guards; mobile uses the same factory now.  See
    // src/core/handlers/calendarOutbound.js.
    try { await _calendarOutboundHook(appOrigin, opId, args ?? {}, result); }
    catch (err) { console.warn('[peer] calendar cross-peer side-effect failed', err); }

    return result;
  }
  return { ok: false, error: `${appOrigin}.${opId} not wired in this demo build` };
};
callSkillRef = callSkill;

// Bundle calendar cross-peer (#238, 2026-05-27) — populate the late-
// bound hook now that `callSkill` is initialised.  The hook closes
// over the outer callSkill so its `getEventSnapshot` lookups go
// through the same calendar→household routing.
_calendarOutboundHook = makeCalendarOutboundHook({
  callSkill,
  sendPeer:        (addr, payload) => agent.sendPeerMessage(addr, payload),
  isPeerConnected: () => agent.peer?.status === 'connected',
  publishEvent:    (event) => publishEventRef(event),
});

/* ── render orchestration ──────────────────────────────── */

function activeThread() { return store.getActiveThread(); }

function renderAll() {
  renderSidebarHere();
  renderActiveHeader();
  renderActiveStream();
}

function renderSidebarHere() {
  renderSidebar(sidebarEl, {
    doc:      document,
    store,
    onSelect: (id) => { store.setActiveThread(id); },
    // Catalog drives the chip-toggle suggestions in the new/edit
    // thread form.  Getter (not snapshot) so chips always reflect
    // the CURRENT filtered catalog when appRegistry toggles fire.
    knownApps: () => (catalog?.appOrigins ?? []).slice().sort(),
    t,
  });
}

function renderActiveHeader() {
  const t0 = activeThread();
  if (!t0) {
    headerNameEl.textContent = '';
    headerFilterEl.textContent = '';
    renderBackToOriginLink(null);
    return;
  }
  headerNameEl.textContent = t0.name;
  const filterText = describeFilter(t0.filter);
  headerFilterEl.textContent = filterText === '*' ? '' : `(${filterText})`;
  // #181 — surface a "← Back to <origin>" affordance when the active
  // thread was spawned from another thread (buurt threads from
  // /create-group or /join-group; future: DM threads from [Help
  // with]).  Returns to the origin without removing the spawned
  // thread (user can come back via sidebar).
  renderBackToOriginLink(t0);
}

/**
 * #181 — render or clear the "← Back to <origin>" link next to the
 * active thread header.  Idempotent — call on every active-thread
 * change.
 */
function renderBackToOriginLink(thread) {
  let el = document.getElementById('active-thread-back');
  if (!thread?.origin?.threadId || !store.getThread(thread.origin.threadId)) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement('button');
    el.id = 'active-thread-back';
    el.type = 'button';
    el.className = 'cc-back-to-origin';
    // Place it right before the thread name in the header.
    headerNameEl.parentNode?.insertBefore(el, headerNameEl);
  }
  el.textContent = `← ${thread.origin.label ?? 'Back'}`;
  el.title = `Back to ${thread.origin.label ?? thread.origin.threadId}`;
  el.onclick = () => {
    if (store.getThread(thread.origin.threadId)) {
      store.setActiveThread(thread.origin.threadId);
      renderSidebarHere();
      renderActiveHeader();
      renderActiveStream();
    }
  };
}

function renderActiveStream() {
  const t0 = activeThread();
  if (!t0) {
    while (messagesEl.firstChild) messagesEl.removeChild(messagesEl.firstChild);
    return;
  }
  renderStream(messagesEl, t0.messages, makeCtx());
}

function makeCtx() {
  return {
    doc: document,
    localActor: LOCAL_ACTOR,
    manifestsByOrigin,
    t,
    onButtonTap,
    // E5 — "⤢ Open in full": re-render the record/mini-page into the
    // wide side panel (pagePanelEl) so the user can pin it while they
    // keep scrolling chat.  The panel render omits onExpandPanel (no
    // nested expand) and onCloseMessage (the frame owns the [×]).
    onExpandPanel: (rendered) => {
      const originThreadId = store.getActiveThread()?.id ?? null;
      const node = renderToDom(rendered, {
        doc: document, localActor: LOCAL_ACTOR, manifestsByOrigin,
        onButtonTap, t,
      });
      openContentPanel({
        container: pagePanelEl,
        doc:       document,
        content:   node,
        title:     rendered.title,
        t,
        backTo: originThreadId ? {
          returnTo:   originThreadId,
          label:      t('chat.nav.backToChat'),
          onNavigate: () => {
            if (store.getThread(originThreadId)) store.setActiveThread(originThreadId);
            renderActiveStream();
          },
        } : undefined,
      });
    },
    onCloseMessage: (messageId) => {
      const t0 = activeThread();
      if (!t0) return;
      t0.closeMessage(messageId);
      renderActiveStream();
    },
    onClaimEmbed: (messageId) => {
      // v0.5.1 — receiver-claim path.  Find the message, claim its
      // embed in-place, re-render.  The claim is local-state only in
      // v0.5.x; real cross-peer claim propagation rides on the
      // hosting chat substrate (stoop's chat-p2p, etc.) and is
      // app-side work (deferred per v0.5.3 audit).
      const t0 = activeThread();
      if (!t0) return;
      const msg = t0.messages.find((m) => m.messageId === messageId);
      if (!msg?.rendered?.embed) return;
      msg.rendered.embed = claimEmbed(msg.rendered.embed, LOCAL_ACTOR);
      renderActiveStream();
    },
    onFollowUp: async (entry) => {
      // v0.4 — clicking a follow-up button dispatches it as if the
      // user had typed the slash with the prefilled args.
      const t0 = activeThread();
      if (!t0) return;
      const parse = {
        kind: 'slash', opId: entry.opId, args: entry.prefilledArgs ?? {},
        threadId: t0.id, command: '(followup)', body: '',
      };
      const route = resolveDispatch(parse, catalog);
      // If args are missing, the form gate kicks in — that's correct UX.
      if (route.kind === 'needsForm') {
        await handleUserText(`/${entry.opId}`, t0);
        return;
      }
      if (route.kind !== 'ready') return;
      await dispatchAndRender(route, t0);
    },
    onQuickReply: async (slash) => {
      // α.5a (audit #3) — clicking an inline-keuze pill dispatches
      // the carried slash through the SAME path Enter-submitted
      // text takes (no parser duplication; the user sees a user-
      // bubble in the stream just as if they had typed it).
      const t0 = activeThread();
      if (!t0) return;
      const text = String(slash ?? '').trim();
      if (!text.startsWith('/')) return;
      t0.addUserMessage(text);
      renderActiveStream();
      await handleUserText(text, t0);
    },
  };
}

/* ── greeting on the Main thread ───────────────────────── */

// v0.7 defensive — `store.getThread('main')` returns undefined when
// the user previously deleted the Main thread (the workspace can
// have any combination of threads now that /newthread + sidebar
// delete exist).  Show the greeting on Main when it exists AND
// is empty; otherwise skip silently — the user already has chat
// history and doesn't need the welcome message.
{
  const main = store.getThread('main');
  if (main && main.messages.length === 0) {
    const greeting = renderReply({
      payload: t('thread.welcome'),
      shape:   'text',
      threadId: main.id,
    }, { t });
    main.addShellMessage(greeting);
  }
}

renderAll();

/* ── subscriptions ─────────────────────────────────────── */

store.subscribe(() => {
  // ThreadStore changes (create/delete/update/active) → re-render
  // sidebar + the active thread's stream + header.
  renderAll();
});

router.onRouted(() => {
  // An event was delivered to ≥0 threads.  Cheapest correct move:
  // re-render the active thread (the matched threads' state is
  // already in store — just the visible one needs refresh).
  renderActiveStream();
});

/* ── input handler ─────────────────────────────────────── */

// v0.7 catch-up — terminal-style command history.  Up/down arrows
// cycle through previous user messages.  Stored in-memory only;
// each thread's full history is in t0.messages anyway.
const inputHistory = [];
let   inputHistoryIdx = -1;
let   inputPendingDraft = '';

inputEl.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  if (inputHistory.length === 0) return;
  // Only cycle when the caret is at start/end of input — preserves
  // multi-line editing if a future input ever uses textarea.
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (inputHistoryIdx === -1) {
      // First press — save the current draft so we can restore it.
      inputPendingDraft = inputEl.value;
      inputHistoryIdx = inputHistory.length - 1;
    } else if (inputHistoryIdx > 0) {
      inputHistoryIdx -= 1;
    }
    inputEl.value = inputHistory[inputHistoryIdx];
    // Move cursor to end for predictable edit behaviour.
    setTimeout(() => inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length), 0);
  } else if (e.key === 'ArrowDown') {
    if (inputHistoryIdx === -1) return;
    e.preventDefault();
    if (inputHistoryIdx < inputHistory.length - 1) {
      inputHistoryIdx += 1;
      inputEl.value = inputHistory[inputHistoryIdx];
    } else {
      // Past the newest — restore the draft.
      inputHistoryIdx = -1;
      inputEl.value = inputPendingDraft;
    }
  }
});

/* ── #199 (2026-05-24) — slash-command auto-suggest ──────── */

const cmdSuggestEl = document.getElementById('cmd-suggest');
let suggestActiveIdx = -1;
let suggestEntries   = [];

function commandPool() {
  // Pull every slash command from the merged catalog.  Filter by
  // prefix match against the current input.
  const out = [];
  for (const entry of catalog.opsById.values()) {
    const slash = entry?.op?.surfaces?.slash?.command;
    if (typeof slash !== 'string' || !slash) continue;
    out.push({
      command: slash,
      hint:    entry?.op?.surfaces?.chat?.hint ?? entry.op.id,
      opId:    entry.op.id,
    });
  }
  return out.sort((a, b) => a.command.localeCompare(b.command));
}

function renderSuggest(matches) {
  while (cmdSuggestEl.firstChild) cmdSuggestEl.removeChild(cmdSuggestEl.firstChild);
  if (matches.length === 0) {
    cmdSuggestEl.hidden = true;
    suggestEntries = [];
    suggestActiveIdx = -1;
    return;
  }
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const li = document.createElement('li');
    li.role = 'option';
    li.className = `cc-cmd-suggest-item${i === suggestActiveIdx ? ' cc-cmd-suggest-active' : ''}`;
    const cmd = document.createElement('span');
    cmd.className = 'cc-cmd-suggest-cmd';
    cmd.textContent = m.command;
    li.appendChild(cmd);
    if (m.hint) {
      const hint = document.createElement('span');
      hint.className = 'cc-cmd-suggest-hint';
      hint.textContent = m.hint;
      li.appendChild(hint);
    }
    li.addEventListener('mousedown', (ev) => {
      ev.preventDefault();   // keep focus on the input
      acceptSuggest(i);
    });
    cmdSuggestEl.appendChild(li);
  }
  cmdSuggestEl.hidden = false;
  suggestEntries = matches;
}

function refreshSuggest() {
  const v = inputEl.value;
  if (!v.startsWith('/')) { renderSuggest([]); return; }
  // Only suggest while typing the command word (no space yet).
  if (v.includes(' ')) { renderSuggest([]); return; }
  const needle = v.toLowerCase();
  const pool = commandPool();
  const matches = pool.filter(m => m.command.toLowerCase().startsWith(needle)).slice(0, 12);
  // Reset active selection to the first match when the list changes.
  if (matches.length > 0 && suggestActiveIdx >= matches.length) suggestActiveIdx = 0;
  if (suggestActiveIdx < 0 && matches.length > 0) suggestActiveIdx = 0;
  renderSuggest(matches);
}

function acceptSuggest(idx) {
  const m = suggestEntries[idx];
  if (!m) return;
  // Replace whatever's typed with the full command + trailing space
  // so the user can continue typing args.
  inputEl.value = m.command + ' ';
  renderSuggest([]);
  inputEl.focus();
}

inputEl.addEventListener('input', refreshSuggest);
inputEl.addEventListener('focus', refreshSuggest);
inputEl.addEventListener('blur', () => {
  // Defer so click-on-suggestion fires first.
  setTimeout(() => renderSuggest([]), 100);
});

inputEl.addEventListener('keydown', (e) => {
  if (cmdSuggestEl.hidden || suggestEntries.length === 0) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    suggestActiveIdx = (suggestActiveIdx + 1) % suggestEntries.length;
    renderSuggest(suggestEntries);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    suggestActiveIdx = (suggestActiveIdx - 1 + suggestEntries.length) % suggestEntries.length;
    renderSuggest(suggestEntries);
  } else if (e.key === 'Tab' || (e.key === 'Enter' && suggestActiveIdx >= 0)) {
    // Tab always accepts; Enter accepts ONLY when a suggestion is
    // actively highlighted (so plain text submit still works).
    e.preventDefault();
    acceptSuggest(suggestActiveIdx);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    renderSuggest([]);
  }
});

formEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = inputEl.value.trim();
  if (!text) return;
  // Append to history (de-dup against the last entry; same as bash).
  if (inputHistory[inputHistory.length - 1] !== text) inputHistory.push(text);
  // Cap history at 200 entries.
  if (inputHistory.length > 200) inputHistory.shift();
  inputHistoryIdx = -1;
  inputPendingDraft = '';

  inputEl.value = '';

  const t0 = activeThread();
  if (!t0) return;
  t0.addUserMessage(text);
  renderActiveStream();

  // Permission gate (v0.2: allowCommands)
  if (t0.permissions.allowCommands === false) {
    const rendered = renderReply({
      payload: t('thread.permission_no_commands'),
      shape:   'text', threadId: t0.id,
    }, { t });
    t0.addShellMessage(rendered);
    renderActiveStream();
    return;
  }

  // Slice 6b — first message in a [Help with]-spawned DM dispatches
  // respondToItem with this text as body, then clears the pending
  // marker.  Subsequent messages are regular DMs (handled by 6a's
  // NKN routing).  Skip when the user typed a slash command — let
  // it dispatch normally.
  if (t0.pendingResponse && !text.startsWith('/')) {
    await dispatchPendingResponse(t0, text);
    return;
  }

  // Slice 6e (2026-05-24) — regular DM messages.  Non-slash text in a
  // DM-scoped thread (filter.dm===true) gets sent to the paired peer
  // over NKN with subtype:'chat-message'.  Receiver's Slice 6a
  // handler renders it in their DM-with-us thread.
  if (t0.filter?.dm === true && !text.startsWith('/')) {
    await sendDmMessage(t0, text);
    return;
  }

  await handleUserText(text, t0);
});

/* ── language switch ───────────────────────────────────── */

langEnBtn.addEventListener('click', async () => { await setLang('en'); updateLangButtons(); renderAll(); });
langNlBtn.addEventListener('click', async () => { await setLang('nl'); updateLangButtons(); renderAll(); });

function updateLangButtons() {
  const cur = currentLang();
  langEnBtn.setAttribute('aria-current', cur === 'en' ? 'true' : 'false');
  langNlBtn.setAttribute('aria-current', cur === 'nl' ? 'true' : 'false');
}

/* ── core flow ─────────────────────────────────────────── */

/**
 * #177 (2026-05-24) — fuzzy text→id resolution.  For each param on
 * the dispatched op that declares `pickerSource.listOp`, look up
 * the most-recent cached listing for that op + try to match the
 * user-supplied text against item labels (case-insensitive
 * substring).  Unique match → swap arg in place.  Ambiguous or
 * no match → leave as-is.
 *
 * Skips values that already look like ulids (20+ uppercase
 * alphanumeric chars) — those are correctly-typed ids, no
 * resolution needed.
 */
function resolveTextArgsInPlace(parse, thread) {
  const entry = catalog?.opsById?.get(parse.opId);
  const params = entry?.op?.params ?? [];
  for (const p of params) {
    const listOp = p?.pickerSource?.listOp;
    if (!listOp) continue;
    const raw = parse.args[p.name];
    if (typeof raw !== 'string' || raw === '') continue;
    // Already a ulid-looking id?  Skip resolution.
    if (/^[0-9A-Z]{20,}$/.test(raw)) continue;
    const listing = thread.lastListingFor(listOp);
    const items = listing?.items ?? [];
    if (items.length === 0) continue;
    const needle = raw.toLowerCase();
    const hits = items.filter(it => {
      const label = String(it?.label ?? '').toLowerCase();
      return label.includes(needle);
    });
    if (hits.length === 1) {
      parse.args[p.name] = hits[0].id;
    }
    // Ambiguous (>1) or no match (0): leave as-is.  The substrate
    // surfaces a clearer "not-found" + the user retries.
  }
}

// --- feedback-pipeline surface ------------------------------------------------------
// Hosts the feedback CanopyChatBot. A thread enters feedback mode via /feedback; while
// active, free text (otherwise an "unknown command") is routed to the bot, which runs the
// on-device floor + the review/consent journey. Set FEEDBACK_LLM_BASEURL to the project's
// OpenAI-compatible route (e.g. the privatemode-proxy /v1) — review/clean need it; the
// control intents (klaar / verstuur alles) work without one.
// Deployment config via Vite env (set at build time, no source edits): with an activation
// URL + a logged-in pod session, `/feedback <code>` provisions the participant's ACP-locked
// container and writes there with their browser keys. Unset → an in-memory demo pod.
//   VITE_FEEDBACK_LLM_BASEURL   the browser-reachable LLM route (don't ship the key in the bundle)
//   VITE_FEEDBACK_ACTIVATION_URL the activation service URL
//   VITE_FEEDBACK_PROJECT_ID    which project a `/feedback <code>` activates
const FEEDBACK_LLM_BASEURL = import.meta.env?.VITE_FEEDBACK_LLM_BASEURL ?? null;
const FEEDBACK_ACTIVATION_URL = import.meta.env?.VITE_FEEDBACK_ACTIVATION_URL ?? null;
const FEEDBACK_PROJECT_ID = import.meta.env?.VITE_FEEDBACK_PROJECT_ID ?? 'canopy-chat';
let _feedbackSurface = null;
function feedback(podOverride) {
  if (podOverride || !_feedbackSurface) {
    _feedbackSurface = createFeedbackSurface({
      pod: podOverride,
      // route ownership → the bot (M1.4): the browser has no env, so point config.llm at the
      // (local/loopback) endpoint via llmBaseURL. No setLlmRoute here.
      llmBaseURL: FEEDBACK_LLM_BASEURL || undefined,
      emit: ({ chatId, text, buttons }) => {
        const thread = store.getThread(chatId) || store.getActiveThread();
        if (!thread) return;
        // show the reply + any quick-reply buttons (interactive button rendering + onButtonTap
        // → feedbackSurface.tapButton is the remaining M2 shell wiring).
        const body = buttons?.length ? `${text}\n${buttons.map((b) => `• ${b.label}`).join('\n')}` : text;
        thread.addShellMessage(renderReply({ payload: body, shape: 'text', threadId: chatId }, { t }));
        if (store.getActiveThread()?.id === thread.id) renderActiveStream();
      },
    });
  }
  return _feedbackSurface;
}
function feedbackNote(thread, msg) {
  thread.addShellMessage(renderReply({ payload: msg, shape: 'text', threadId: thread.id }, { t }));
  renderActiveStream();
}

// ── v2 circle bot: free text addressed to the bot → LLM → slash command (web wiring, "C") ──
// In a circle conversation, "@assistant add milk to the list" is interpreted as a command and
// dispatched — SCOPED to the active thread's circle, since dispatch runs against that thread's
// catalog/listing. Slash commands are unaffected (the shell still routes them). Inert until a route
// is configured: with no base URL the providers map is empty → selectLlmClient is null → fall through.
//   VITE_CIRCLE_LLM_BASEURL  browser-reachable LLM route for the circle bot (don't ship keys)
//   VITE_CIRCLE_LLM_MODEL    model id (optional)
//   VITE_CIRCLE_BOT_NAME     the bot's address for @-tag detection (default 'assistant')
//   VITE_CIRCLE_LLM_POLICY   default circle posture off|local|cloud|user (default 'user' = each member decides)
const CIRCLE_LLM_BASEURL = import.meta.env?.VITE_CIRCLE_LLM_BASEURL ?? null;
const CIRCLE_LLM_MODEL   = import.meta.env?.VITE_CIRCLE_LLM_MODEL ?? undefined;
const CIRCLE_BOT_NAME    = import.meta.env?.VITE_CIRCLE_BOT_NAME ?? 'assistant';
const CIRCLE_LLM_POLICY  = import.meta.env?.VITE_CIRCLE_LLM_POLICY ?? 'user';
const _circleLlmProviders = buildCircleLlmProviders({ localBaseUrl: CIRCLE_LLM_BASEURL, model: CIRCLE_LLM_MODEL });

// Two-level LLM policy (resolveCircleLlm): the CIRCLE policy is authoritative; when it's 'user' the
// member's PERSONAL default decides. The personal default persists in localStorage; until a settings
// UI lands, seed it from the configured route so a deployment that wires VITE_CIRCLE_LLM_BASEURL works
// out of the box (a stored preference always wins once set). Circle policy source is global for now
// (VITE_CIRCLE_LLM_POLICY); the per-circle policy store plugs in here once threads carry a circleId.
const _userLlmStore = createUserLlmDefaultStore(localStorageUserLlmIo());
let _userLlmDefault = { mode: CIRCLE_LLM_BASEURL ? 'local' : 'off' };
_userLlmStore.get().then((v) => { if (v && v.mode !== 'off') _userLlmDefault = v; }).catch(() => {});
// Dispatch a fully-resolved {opId,args} like a follow-up/button tap, scoped to the circle thread.
async function dispatchReadyCircleCommand({ opId, args }, thread) {
  const parse = { kind: 'slash', opId, args: args ?? {}, threadId: thread.id, command: '(bot)', body: '' };
  const route = resolveDispatch(parse, catalog);
  if (route.kind === 'needsForm') { renderFormElicitation(route, thread); return; }
  if (route.kind === 'ready')     { await dispatchAndRender(route, thread); return; }
  feedbackNote(thread, t('reply.unknown_command', { input: `@${CIRCLE_BOT_NAME} ${opId}` }));
}

// The clarification turn — when an interpreted command's id-like target matches MULTIPLE items in the
// circle (screens are filtered views, so a label can be ambiguous even inside one circle), the bot
// asks which one instead of guessing; a tapped candidate (`circlePick:<id>` → onButtonTap) re-runs the
// command bound to that id. Lookup is the circle-thread's own listing → resolution stays circle-scoped.
const _circleClarify = createClarifyingDispatch({
  catalog: () => catalog,
  lookup: (listOp, _query, thread) => thread?.lastListingFor?.(listOp)?.items ?? [],
  dispatchReady: dispatchReadyCircleCommand,
  ask: ({ query, candidates }, thread) => {
    feedbackNote(thread, t('circle.clarify.which', { query }));
    const items = candidates.map((c) => ({
      id: c.id,
      label: c.hint ? `${c.label} — ${c.hint}` : c.label,
      buttons: [{ label: t('circle.clarify.pick'), callbackData: `circlePick:${c.id}` }],
    }));
    thread.addShellMessage(renderReply({ payload: { items }, shape: 'list', threadId: thread.id },
      { t, manifests: catalog?.manifests }));
    renderActiveStream();
  },
  askMissing: ({ query }, thread) => { feedbackNote(thread, t('circle.clarify.notFound', { query })); },
});

// Per-circle policy source: the active circle's own llmTool (set via circle settings, same
// `cc.circlePolicy.<id>` store the settings UI writes) is authoritative. A circle with no explicit
// llmTool falls back to the deployment default CIRCLE_LLM_POLICY; non-circle threads use it too.
const _circlePolicyIo = localStoragePolicyIo();
async function circleLlmPolicyFor() {
  const id = getActiveCircle();
  if (!id) return { llmTool: CIRCLE_LLM_POLICY };
  let raw = null;
  try { raw = await _circlePolicyIo.load(id); } catch { /* defaults */ }
  return { llmTool: raw && typeof raw.llmTool === 'string' ? raw.llmTool : CIRCLE_LLM_POLICY };
}

const handleCircleTurn = createCircleTurn({
  // Circle policy is authoritative (loaded per active circle); 'user' delegates to the member default.
  policyFor: circleLlmPolicyFor,
  userDefault: () => _userLlmDefault,
  llmProviders: _circleLlmProviders,
  catalog: () => catalog,
  botName: CIRCLE_BOT_NAME,
  // Route the interpreted command through the clarification turn (unique → dispatch; ambiguous → ask).
  dispatchCommand: (cmd, thread) => _circleClarify.run(cmd, thread),
});

async function handleUserText(text, thread) {
  const trimmed = text.trim();
  const fb = trimmed.match(/^\/feedback(?:\s+(\S+))?$/);
  if (fb) {
    const code = fb[1];
    if (code && FEEDBACK_ACTIVATION_URL) {
      // real participant pod: activate (cohort code + the session WebID) → write with browser keys
      const session = podAuth.getCurrentSession();
      if (!session) { feedbackNote(thread, 'Log eerst in op je pod om mee te doen.'); return; }
      try {
        const { buildFeedbackPod, getOrCreateRecoveryHash } = await import('../src/feedback/feedbackPod.js');
        const pod = await buildFeedbackPod({ session, activationUrl: FEEDBACK_ACTIVATION_URL, projectId: FEEDBACK_PROJECT_ID, code, recoveryHash: await getOrCreateRecoveryHash() });
        await feedback(pod).start(thread.id);
      } catch (e) { feedbackNote(thread, `Activatie mislukt: ${e.message}`); }
      return;
    }
    await feedback().start(thread.id);   // in-memory demo (no code / not configured)
    return;
  }
  if (trimmed === '/feedback-stop') {
    feedback().stop(thread.id);
    feedbackNote(thread, 'Feedbackmodus uit.');
    return;
  }

  const parse = parseInput(text, catalog, { threadId: thread.id });
  // #177 (2026-05-24) — fuzzy text→id resolution.  When the user
  // typed a human label (e.g. `/done dishwasher` instead of
  // `/done c-1`) and the op's id-param declares a `pickerSource`,
  // look the label up in the most-recent cached listing and swap
  // the arg in place.  Ambiguity / no match → leave as-is and
  // let dispatch surface the error normally.
  if (parse?.kind === 'slash' && parse.opId && parse.args) {
    resolveTextArgsInPlace(parse, thread);
  }
  const route = resolveDispatch(parse, catalog);

  if (route.kind === 'unknown') {
    if (await feedback().handle(text, thread.id)) return;   // feedback-mode thread → the bot
    if (await handleCircleTurn(text, thread)) return;       // C — addressed free text → LLM → command
    const rendered = renderReply({
      payload:  t('reply.unknown_command', { input: text }),
      shape:    'text', threadId: thread.id,
    }, { t });
    thread.addShellMessage(rendered);
    renderActiveStream();
    return;
  }

  if (route.kind === 'error') {
    const rendered = renderReply({
      payload: null, shape: 'text', threadId: thread.id,
      error:   { code: route.code, message: route.message },
    }, { t });
    thread.addShellMessage(rendered);
    renderActiveStream();
    return;
  }

  if (route.kind === 'needsForm') {
    renderFormElicitation(route, thread);
    return;
  }

  if (route.kind === 'needsConfirm') {
    const note = `This op needs confirmation (${route.severity}): ${route.message ?? ''} — confirm UX lands in v0.3+`;
    const rendered = renderReply({
      payload: note, shape: 'text', threadId: thread.id,
    }, { t });
    thread.addShellMessage(rendered);
    renderActiveStream();
    return;
  }

  // E2 — bulk fan-out (`/done all`).  Resolve the candidate items from
  // the most-recent listing (prefer the same app), then fan-out via
  // runBulkOp; its item-changed events reach other threads through the
  // EventRouter.
  if (route.kind === 'bulk') {
    await handleBulkRoute(route, thread);
    return;
  }

  // ready → dispatch + render + (maybe) emit item-changed event.
  await dispatchAndRender(route, thread);
}

/**
 * E2 — handle a `bulk` route (`/done all`): resolve the candidate items
 * from the most-recent listing, fan-out via runBulkOp, render a summary.
 * The fan-out's item-changed events reach other threads via the
 * EventRouter (OQ-4), so open panels elsewhere refresh too.
 */
async function handleBulkRoute(route, thread) {
  const listing = thread.lastListing({ appOrigin: route.appOrigin }) ?? thread.lastListing();
  const itemIds = (listing?.items ?? []).map((it) => it.id).filter(Boolean);
  if (itemIds.length === 0) {
    const rendered = renderReply({
      payload: t('reply.bulk_no_list'), shape: 'text', threadId: thread.id,
    }, { t });
    thread.addShellMessage(rendered);
    renderActiveStream();
    return;
  }
  const { message } = await executeBulkDispatch({
    bulk:      route,
    itemIds,
    callSkill,
    emitEvent: (event) => { try { router.deliver(event); } catch { /* swallow */ } },
    opLabel:   route.opId,
  });
  const rendered = renderReply({ payload: message, shape: 'text', threadId: thread.id }, { t });
  thread.addShellMessage(rendered);
  renderActiveStream();
}

/**
 * Extracted from handleUserText so both the slash-input path AND the
 * row-button path (onButtonTap) can pop a form when the dispatch
 * needs more args (e.g. [Help with] needs `body`).
 */
function renderFormElicitation(route, thread) {
  const spec = buildFormSpec({
    opParams:      catalog.opsById.get(route.opId)?.op?.params ?? [],
    missing:       route.missing,
    prefilledArgs: route.prefilledArgs,
    opId:          route.opId,
    appOrigin:     route.appOrigin,
    threadId:      thread.id,
  });
  const formEl = renderForm(spec, {
    doc: document, t,
    pickerFetcher: async (decl) => {
      const appOrigin = decl.appOrigin ?? route.appOrigin;
      const reply = await callSkill(appOrigin, decl.listOp, decl.filter ?? {});
      const items = Array.isArray(reply?.items) ? reply.items : [];
      return items.map((it) => ({
        id:    String(it.id ?? ''),
        label: String(it.label ?? it.text ?? it.title ?? it.id ?? ''),
      }));
    },
    onSubmit: async (values) => {
      const v = validateAndCoerce(spec, values);
      if (!v.ok) {
        const errMsg = v.errors.map((e) => `${e.field}: ${e.message}`).join('; ');
        const errEl = renderReply({
          payload: null, shape: 'text', threadId: thread.id,
          error:   { code: 'form-invalid', message: errMsg },
        }, { t });
        thread.addShellMessage(errEl);
        renderActiveStream();
        return;
      }
      const parse = {
        kind: 'slash', opId: route.opId, args: v.args,
        threadId: thread.id, command: '(form)', body: '',
      };
      const route2 = resolveDispatch(parse, catalog);
      if (route2.kind !== 'ready') {
        const errEl = renderReply({
          payload: `Form submission failed: ${route2.kind}`,
          shape: 'text', threadId: thread.id,
        }, { t });
        thread.addShellMessage(errEl);
        renderActiveStream();
        return;
      }
      await dispatchAndRender(route2, thread);
    },
    onCancel: () => {
      const cancelMsg = renderReply({
        payload: t('form.cancelled', { defaultValue: 'Form cancelled.' }),
        shape: 'text', threadId: thread.id,
      }, { t });
      thread.addShellMessage(cancelMsg);
      renderActiveStream();
    },
  });
  thread.addShellMessage({
    kind:           'form',
    messageId:      `form-${Date.now()}`,
    threadId:       thread.id,
    lifecycleState: 'live',
    formElement:    formEl,
    text:           `Form: ${route.opId}`,
  });
  renderActiveStream();
}

// P6.6 #344 — per-session dismissed-skill set for the auto-hop prompt
// so back-to-back identical /find queries don't re-prompt.  Lives in
// memory only; resets on reload (matches "skip" UX of board 7A).
let hopPromptDismissed = new Set();

// P6.4 #343 — save-for-later queue (one local store across DMs).  The
// queue is wired today as a write-only sink; surfacing the queued
// messages back to the sender + flushing on Bob's chat-on is the
// deeper #343 follow-up.
const wederkerigheidQueue = createMessageQueue({
  io: {
    load: async (key) => {
      try { const raw = window.localStorage.getItem(key); return raw ? JSON.parse(raw) : null; }
      catch { return null; }
    },
    save: async (key, value) => {
      try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota / disabled */ }
    },
  },
});

// P6.4 #343 — host-provided seam for reading the recipient's chat-off
// for a given circle.  Today this returns null (no signal) → the
// substrate collapses to "available", so the existing flow is intact.
// When peer-availability sync lands (future slice), wire this to a
// remote read (NKN ping, pod presence doc, …).
async function defaultGetRecipientChatOff(/* { recipientId, circleId } */) { return null; }
let getRecipientChatOff = defaultGetRecipientChatOff;

// P6.6 #344 / P6.7 #345 — fetch hop info + circle members for /find
// enrichment.  Both are best-effort: any failure collapses to "empty".
async function fetchHopInfoForFind() {
  try {
    const hopMode = await callSkill('stoop', 'getHopMode', {});
    const contacts = await callSkill('stoop', 'listContacts', {});
    const list = Array.isArray(contacts?.items) ? contacts.items
               : Array.isArray(contacts?.contacts) ? contacts.contacts
               : Array.isArray(contacts) ? contacts : [];
    const eligible = list.filter((c) => c?.hopThrough === true || c?.hopThrough === 'always' || c?.hopThrough === 'with-ok').length;
    return {
      hopGloballyOn:            hopMode?.global === true,
      hopEligibleContactsCount: eligible,
    };
  } catch {
    return { hopGloballyOn: false, hopEligibleContactsCount: 0 };
  }
}

async function fetchMembersForFind(circleId) {
  if (!circleId) return [];
  try {
    const raw = await callSkill('household', 'listGroupMembers', { groupId: circleId });
    return normalizeCircleMembers(raw);
  } catch {
    return [];
  }
}

/**
 * P6.6 #344 + P6.7 #345 — after /find returns, append two extra shell
 * bubbles when the underlying substrates say something useful:
 *
 *   1. Skill matches (P6.7): if the active circle has members whose
 *      declared skills overlap the query, list the top 5 inline.
 *   2. Hop prompt (P6.6): if /find returned zero items AND the user
 *      has hop-eligible contacts AND hop is globally on AND we haven't
 *      already dismissed this skill, surface the "Want me to search
 *      one step further?" card body.
 *
 * Both are informational text bubbles today — the action wiring
 * ([Ask Anne] / [Yes, hop]) is the deeper follow-up that touches
 * skill dispatch + hop-relay-over-NKN.
 */
async function appendFindExtras(thread, payload) {
  if (!payload || typeof payload.query !== 'string') return;
  const query = payload.query.trim();
  if (!query) return;
  const itemCount = Array.isArray(payload.groups)
    ? payload.groups.reduce((n, g) => n + (Array.isArray(g.items) ? g.items.length : 0), 0)
    : 0;

  const circleId = getActiveCircle();
  const members  = await fetchMembersForFind(circleId);
  const matches  = findSkillMatches({ query, members });
  if (matches.length > 0) {
    const lines = matches.slice(0, 5).map((m) => `• ${m.label} — ${m.skill}`).join('\n');
    thread.addShellMessage(renderReply({
      payload: `${t('circle.skillMatches.title')}\n${lines}`,
      shape:   'text', threadId: thread.id,
    }, { t }));
  }

  if (hasDismissed(hopPromptDismissed, query)) return;
  if (itemCount > 0 && matches.length > 0) return; // we already showed something useful
  const hopInfo = await fetchHopInfoForFind();
  const decision = shouldAutoSuggestHop({
    inCircleMatchCount:       matches.length,
    hopEligibleContactsCount: hopInfo.hopEligibleContactsCount,
    hopGloballyOn:            hopInfo.hopGloballyOn,
    dismissedForSkill:        false,
  });
  if (!decision.prompt) return;
  const card = buildHopPromptCard({
    skillQuery:               query,
    hopEligibleContactsCount: hopInfo.hopEligibleContactsCount,
    t,
  });
  thread.addShellMessage(renderReply({
    payload: `${card.title}\n${card.body}`,
    shape:   'text', threadId: thread.id,
  }, { t }));
  // Record dismissal up-front so a back-to-back identical /find
  // doesn't double up the prompt.  Real Skip CTA is the v1 wire.
  hopPromptDismissed = rememberDismissed(hopPromptDismissed, query);
}

async function dispatchAndRender(route, thread) {
  // Slice 3 (2026-05-24) — /post audience inheritance.  When the
  // dispatching thread is buurt-scoped (filter.buurtId), inject the
  // buurt target into postRequest args so /post inside the thread
  // implicitly targets that buurt (skips the audience picker).
  // postAudienceWizard (/post-audience) is the explicit path for
  // posts that need finer-grained targeting.
  if (route.opId === 'postRequest') {
    const buurtIds = thread.filter?.buurtId;
    if (Array.isArray(buurtIds) && buurtIds.length === 1) {
      const args = route.args ?? {};
      const existingTargets = Array.isArray(args.targets) ? args.targets : [];
      if (!existingTargets.some(t => t?.kind === 'group')) {
        route = {
          ...route,
          args: {
            ...args,
            targets: [...existingTargets, { kind: 'group', groupId: buurtIds[0] }],
          },
        };
      }
    }
  }
  // #180 — if the op declares surfaces.page, open it in the side-panel
  // instead of running the normal dispatch + render path.  The panel
  // handles dispatch on submit and closes itself on success.  Posts a
  // one-line shellMessage acknowledging the open so the chat thread
  // has a trail of what the user opened.
  const opEntry = catalog.opsById.get(route.opId);
  const pageSurface = opEntry?.op?.surfaces?.page;
  if (pageSurface && pageSurfaceOpen) {
    pageSurfaceOpen({
      op:        opEntry.op,
      appOrigin: route.appOrigin,
      args:      route.args ?? {},
    });
    thread.addShellMessage({
      kind:           'text',
      messageId:      `page-open-${route.opId}-${Date.now()}`,
      threadId:       thread.id,
      lifecycleState: 'live',
      text:           `📂 Opened "${pageSurface.title ?? route.opId}" in the side panel.`,
    }, { opId: route.opId });
    renderActiveStream();
    return;
  }

  // #176 — set the dispatching-thread context so any publishEvent
  // calls inside the skill handler exclude this thread from
  // notification routing (the reply is rendered as a shellMessage
  // below; we don't also want a notification copy).
  activeDispatchThreadId = thread.id;
  let reply;
  try {
    // F1 (5.3) — bind item-creating dispatches to the open circle so a
    // task / post created while a circle is active lands in that circle.
    reply = await runDispatch(scopeReadyDispatch(route, getActiveCircle()), callSkill);
  } finally {
    activeDispatchThreadId = null;
  }
  // v0.4 — when dispatch succeeded, look up follow-up suggestions
  // (per-op Q31 hints from the catalog + cross-app chains from the
  // static registry) and attach them to the reply so the renderer
  // surfaces them as buttons under the text.
  if (!reply.error) {
    const followUps = collectFollowUps(route.opId, route.appOrigin, reply.payload, catalog);
    if (followUps.length > 0) reply.followUps = followUps;
  }
  // M2 — surface the feedback assistant as a distinct 'agent' contact at the top of /contacts.
  // Not a stoop mesh peer (it's a local co-hosted bot); rendered with its own icon + kind, and
  // its button enters feedback mode (handled in onButtonTap).  Shape-tolerant injection.
  if (route.opId === 'listContacts' && !reply.error) {
    const fbItem = feedbackContactItem({
      label:     t('feedback.contactLabel', { defaultValue: 'Feedback assistant' }),
      openLabel: t('feedback.openChat',     { defaultValue: 'Open chat' }),
    });
    if (Array.isArray(reply.items)) {
      reply = { ...reply, items: [fbItem, ...reply.items] };
    } else if (Array.isArray(reply.payload?.items)) {
      reply = { ...reply, payload: { ...reply.payload, items: [fbItem, ...reply.payload.items] } };
    }
  }
  const rendered = renderReply(reply, {
    t,
    appOrigin:         route.appOrigin,
    manifestsByOrigin,
  });
  thread.addShellMessage(rendered, {
    opId:      route.opId,
    appOrigin: route.appOrigin,
    args:      route.args ?? {},
  });

  // P6.6 #344 + P6.7 #345 — after /find dispatch, surface inline skill
  // matches + auto-hop-prompt when the substrates say something useful.
  // Best-effort: any failure inside is swallowed by appendFindExtras.
  if (route.opId === 'find' && !reply.error) {
    try { await appendFindExtras(thread, reply.payload); } catch { /* keep flow */ }
  }

  // #176 — dispatchAndRender used to fire its own router.deliver
  // here for the OQ-4 cross-thread routing.  Removed because every
  // real household skill in realAgent.js ALSO calls publishEvent,
  // which doubles every mutation notification (once in the
  // dispatching thread + once in every filtered thread like
  // household-alerts).  With the activeDispatchThreadId context
  // above, the skill's publishEvent now excludes the dispatching
  // thread correctly, so the single skill-side publish is the
  // canonical cross-thread routing source.
  //
  // TODO: tasks-v0 / stoop / folio agents don't currently call
  // publishEvent for their mutations (their browser factories
  // don't accept a publishEvent callback yet).  Their mutations
  // therefore don't route to filtered threads.  Wire that through
  // in a future slice — the substrate-injection pattern already
  // used by realAgent.js for household is the template.

  renderActiveStream();
}

/* ── button tap handler ─────────────────────────────────── */

async function onButtonTap(opId, itemId, extra) {
  const t0 = activeThread();
  if (!t0) return;

  // Slice 6b (2026-05-24) — [Help with] (respondToItem) intercept.
  // Instead of popping an inline form for body, spawn a DM thread
  // with the post's author + pin the post as a context card.  The
  // user's first message in that DM dispatches respondToItem with
  // their text as the body (Slice 6c wires the send path).
  if (opId === 'respondToItem' && extra?.originMessageId) {
    const handled = await openHelpWithDm(t0, itemId, extra.originMessageId);
    if (handled) return;
    // Fall through to generic dispatch if we couldn't resolve the
    // post (defensive — should be rare).
  }

  // Circle clarification turn — a tapped candidate re-runs the pending command bound to that id
  // (within the active circle thread). See _circleClarify.
  if (opId === 'circlePick') {
    await _circleClarify.pick(itemId, t0);
    return;
  }

  // M2 — the feedback 'agent' contact's action: open its own thread and enter feedback mode
  // (not a peer DM).  The thread is keyed by the co-hosted bot address ('fp-bot').
  if (opId === 'openFeedback') {
    const dm = ensureDmThread('fp-bot', {
      label: t('feedback.contactLabel', { defaultValue: 'Feedback assistant' }),
    });
    if (dm) {
      store.setActiveThread(dm.id);
      await feedback().start(dm.id);
      renderSidebarHere();
      renderActiveHeader();
      renderActiveStream();
    }
    return;
  }

  // Slice 6d (2026-05-24) — [DM] button on contact / member rows.
  // Chat-shell-internal: spawn a DM thread, no substrate dispatch.
  if (opId === 'startDm') {
    const dm = ensureDmThread(itemId, {
      origin: { threadId: t0.id, label: t0.name },
    });
    if (dm) {
      store.setActiveThread(dm.id);
      renderSidebarHere();
      renderActiveHeader();
      renderActiveStream();
    }
    return;
  }

  // v0.7 catch-up — demo-* stub ops fire from receiver-action buttons
  // on file/time cards (no backing app yet; tasks #111/#112).  Reply
  // is a placeholder text so the user sees the click registered.
  if (typeof opId === 'string' && opId.startsWith('demo-')) {
    const rendered = renderReply({
      payload: t('demo.stub', { op: opId, item: itemId }),
      shape:   'text', threadId: t0.id,
    }, { t });
    t0.addShellMessage(rendered);
    renderActiveStream();
    return;
  }

  // v0.7.cc — when [Download] is clicked on a file-card whose
  // snapshot already carries the inline file bytes (file-share
  // embeds always do — the sender embedded them), trigger a REAL
  // browser download.  Without this short-circuit, folio.downloadFile
  // returns a demo-text placeholder + the user sees no file.
  if (opId === 'downloadFile') {
    const snap = extra?.embed?.snapshot;
    if (snap?.dataB64) {
      try {
        triggerBlobDownloadFromBase64(
          snap.dataB64,
          snap.name ?? snap.id ?? 'file',
          snap.mime ?? 'application/octet-stream',
        );
        const rendered = renderReply({
          payload: t('fileShare.downloaded', {
            name: snap.name ?? snap.id ?? 'file',
          }),
          shape:   'text', threadId: t0.id,
        }, { t });
        t0.addShellMessage(rendered);
        renderActiveStream();
        return;
      } catch (err) {
        console.error('[file-share download] failed', err);
        // Fall through to skill dispatch so the user sees an error
        // path rather than a silent no-op.
      }
    }
  }

  const entry = catalog.opsById.get(opId);
  if (!entry) return;
  const firstReq = (entry.op.params ?? []).find(
    // 2026-05-27 — bind row itemId to webid-kind too, so [Remove]
    // on a contact row dispatches with webid=<itemId> instead of
    // falling into a followup that asks for the user's webid.
    (p) => p?.required && (p.kind === 'string' || p.kind === 'enum' || p.kind === 'webid'),
  );
  const args = firstReq ? { [firstReq.name]: itemId } : { id: itemId };
  const parse = {
    kind: 'slash', opId, args, threadId: t0.id,
    command: '(button)', body: itemId,
  };
  const route = resolveDispatch(parse, catalog);
  // 2026-05-24 — row buttons with additional required args (e.g.
  // [Help with] needs `body`) trip needsForm.  Pop the inline form
  // so the user can fill them in instead of silently bailing.
  if (route.kind === 'needsForm') {
    renderFormElicitation(route, t0);
    return;
  }
  if (route.kind !== 'ready') return;
  await dispatchAndRender(route, t0);

  // #178 (2026-05-24) — state-morphing row buttons.  After a
  // successful row-action dispatch, refresh the ORIGINATING list
  // message in place so the row's appliesTo-gated buttons re-match
  // against the post-dispatch item state (e.g. [Claim] → [Mark
  // complete]).  Skip when the originating message is gone or had
  // no sourceOp (e.g. a fresh-spawned-on-demand list).
  const originId = extra?.originMessageId;
  if (originId) {
    await refreshListMessageInPlace(t0, originId);
  }
}

/**
 * Slice 6b (2026-05-24) — [Help with] handler.  Resolves the post
 * + its author, spawns a DM thread paired with that author, pins
 * the post as a context card at the top, and stashes pending-
 * response metadata so the next user message in that DM dispatches
 * respondToItem with body=their-text.
 *
 * Returns true when the DM was opened (caller should skip the
 * generic dispatch path), false when we couldn't resolve the post.
 */
async function openHelpWithDm(originThread, itemId, originMessageId) {
  // Find the post text + author from the originating list message.
  // We have to look up by id since the row already rendered.
  const sourceMsg = originThread.messages.find(m => m.messageId === originMessageId);
  const rawItems = sourceMsg?.rendered?.items ?? [];
  // The rendered items only have {id, label, buttons, ...}; we need
  // raw substrate fields (author, source.from) → refetch via the
  // source op or via getPostSnapshot.  For V0 we re-call listFeed
  // and find by id.  Cheap + matches what stoop's adapter returns.
  let post = null;
  try {
    const reply = await callSkill('stoop', 'listFeed', {});
    const items = reply?.items ?? [];
    post = items.find(p =>
      p?.id === itemId
        || p?.source?.requestId === itemId,
    ) ?? null;
  } catch { /* swallow — falls through to label-only */ }

  const labelHit = rawItems.find(it => it.id === itemId);
  const postText = post?.text ?? labelHit?.label ?? itemId;
  // 2026-05-24 — NKN address has to be the wire-level transport
  // identifier (fromNknAddr, recorded by ingestRemotePost) so DM
  // delivery can route.  fromPubKey is a substrate-internal identity
  // that the browser InternalTransport doesn't know about.  Fall back
  // to legacy fields for items written before fromNknAddr existed.
  const authorAddr = post?.source?.fromNknAddr
    ?? post?.source?.fromPubKey
    ?? post?.source?.from
    ?? post?.addedBy
    ?? null;
  if (!authorAddr) {
    // No-one to DM — fall back to the inline form path (caller dispatches).
    return false;
  }
  // 2026-05-24 — canonical itemId is the ORIGINAL post id (the one
  // Alice's substrate assigned at /post time).  Bob's substrate
  // gave the mirrored item a fresh ulid + stored Alice's id under
  // source.requestId.  We need Alice's id everywhere downstream
  // (substrate-side respondToItem lookup, NKN envelope, and
  // especially the [Accept] handler on Alice's side, which calls
  // acceptResponder({requestId}) against HER substrate where only
  // Alice's id is registered).
  const canonicalId = post?.source?.requestId ?? itemId;

  // Spawn (or activate) the DM thread.
  const dm = ensureDmThread(authorAddr, {
    label:  authorAddr.slice(0, 16) + '…',
    origin: { threadId: originThread.id, label: originThread.name },
  });
  if (!dm) return false;
  // Stash the pending response context so the first user message
  // in this DM dispatches respondToItem.  Slice 6c reads this.
  dm.pendingResponse = {
    itemId: canonicalId,
    authorAddr,
    postText,
  };
  // Pin the post as a context card at the top of the DM thread (only
  // when it's the first message in the thread, so we don't duplicate).
  if (dm.messages.length === 0) {
    dm.addShellMessage(renderReply({
      payload: `📌 Responding to:\n\n${postText}\n\nType your offer of help below — first message becomes your response.`,
      shape: 'text',
      threadId: dm.id,
    }, { t }));
  }
  store.setActiveThread(dm.id);
  renderSidebarHere();
  renderActiveHeader();
  renderActiveStream();
  return true;
}

/**
 * Slice 6b — fire the pending respondToItem when the user types
 * their first message in a [Help with]-spawned DM.  Clears the
 * marker on success so subsequent messages are regular DMs.
 */
/**
 * Slice 6e (2026-05-24) — send a regular DM message to the paired
 * peer.  The user's typed text already landed in the DM thread via
 * addUserMessage; we just need to put it on the wire so the
 * receiver's Slice 6a handler can render it on their side.
 *
 * Failure modes:
 *   - peer.status !== 'connected' → render a small "✗ not delivered"
 *     hint underneath the user message.  No queue/retry in V0; user
 *     can /peer-connect + retype.
 *   - sendPeerMessage throws → same failure hint with the error.
 *
 * Doesn't dispatch into stoop's chat-substrate (its InternalTransport
 * is local-only in the browser — same gap that affects respondToItem).
 */
async function sendDmMessage(dm, body) {
  const peerAddr = dm.peerAddr ?? dm.filter?.actors?.[0] ?? null;
  if (!peerAddr) {
    dm.addShellMessage(renderReply({
      payload: null, shape: 'text', threadId: dm.id,
      error: { code: 'dm-no-peer', message: t('dm.no_peer') },
    }, { t }));
    renderActiveStream();
    return;
  }
  // P6.4 #343 — wederkerigheid consumer-side gate.  Look up whether
  // the recipient has chat-off for the active circle context.  When
  // they do, render an inline notice (no "tried-to-reach-you" leak by
  // design) + queue the typed body for later flush, and abort send.
  // V0 default predicate returns null → seam collapses to "available"
  // so the existing flow is intact until peer-availability sync lands.
  const circleId = getActiveCircle();
  if (circleId) {
    const unavail = await isRecipientUnavailable({
      recipientId: peerAddr, circleId, getRecipientChatOff,
    });
    if (!unavail.available) {
      const recipientName = dm.peerDisplay ?? null;
      // Circle name isn't readily available in the chat shell today;
      // fall back to the anon notice when missing (buildUnavailableNotice
      // handles the missing-name path).
      dm.addShellMessage(renderReply({
        payload: buildUnavailableNotice({ recipientName, circleName: null, t }),
        shape:   'text', threadId: dm.id,
      }, { t }));
      // Best-effort enqueue — failure shouldn't block the notice.
      try { await wederkerigheidQueue.add({ recipientId: peerAddr, circleId, text: body }); }
      catch { /* tolerate quota / encoding issues */ }
      renderActiveStream();
      return;
    }
  }
  if (agent?.peer?.status !== 'connected') {
    dm.addShellMessage(renderReply({
      payload: null, shape: 'text', threadId: dm.id,
      error: { code: 'peer-offline', message: t('dm.peer_offline') },
    }, { t }));
    renderActiveStream();
    return;
  }
  try {
    const senderDisplay = await getMyDisplayName();
    await sendPeerWithRetry(peerAddr, {
      type:    'p2p-chat',
      subtype: 'chat-message',
      body,
      ...(senderDisplay ? { senderDisplay } : {}),
      sentAt:  Date.now(),
    });
  } catch (err) {
    dm.addShellMessage(renderReply({
      payload: null, shape: 'text', threadId: dm.id,
      error: { code: 'dm-send-failed', message: err?.message ?? String(err) },
    }, { t }));
    renderActiveStream();
  }
}

async function dispatchPendingResponse(dm, body) {
  const pending = dm.pendingResponse;
  if (!pending?.itemId) return;
  // 1. Substrate respondToItem (local audit + soft-claim).  In the
  //    browser bundle stoop's chat.send is local-only (InternalTransport)
  //    so it errors with "No pubKey registered" — that's expected for
  //    cross-instance.  Soft-claim happens BEFORE chat.send so the
  //    local record is in place regardless.  We log + continue.
  let substrateOk = false;
  try {
    const reply = await callSkill('stoop', 'respondToItem', {
      itemId: pending.itemId,
      body,
    });
    if (reply?.error) {
      const msg = String(reply.error);
      const isTransportFail = /transport:|No pubKey|chat-not-wired/i.test(msg);
      if (!isTransportFail) throw new Error(msg);
      console.info('[dispatchPendingResponse] substrate chat.send unavailable in browser bundle (expected) — proceeding with NKN bridge');
    } else {
      substrateOk = true;
    }
  } catch (err) {
    // Network/IO errors from the local substrate call — surface as
    // hard failure since they indicate the substrate itself broke.
    dm.addShellMessage(renderReply({
      payload: null, shape: 'text', threadId: dm.id,
      error: { code: 'respond-failed', message: err?.message ?? String(err) },
    }, { t }));
    renderActiveStream();
    return;
  }

  // 2. NKN bridge — the actual cross-instance delivery.  Slice 6c.
  let nknOk = false;
  if (agent?.peer?.status === 'connected' && pending.authorAddr) {
    try {
      const senderDisplay = await getMyDisplayName();
      await sendPeerWithRetry(pending.authorAddr, {
        type:    'p2p-chat',
        subtype: 'help-with-response',
        itemId:  pending.itemId,
        body,
        postText: pending.postText ?? '',
        ...(senderDisplay ? { senderDisplay } : {}),
        sentAt:  Date.now(),
      });
      nknOk = true;
    } catch (err) {
      console.warn('[help-with-response] NKN send failed', err);
    }
  }

  if (!substrateOk && !nknOk) {
    dm.addShellMessage(renderReply({
      payload: null, shape: 'text', threadId: dm.id,
      error: { code: 'respond-failed', message: t('dm.respond_neither_ok') },
    }, { t }));
  } else {
    dm.addShellMessage(renderReply({
      payload: nknOk
        ? `✓ Sent your offer to the post author.`
        : `✓ Recorded locally (peer unreachable — will retry on reconnect).`,
      shape: 'text', threadId: dm.id,
    }, { t }));
    delete dm.pendingResponse;
  }
  renderActiveStream();
}

/**
 * Slice 6c — render Bob's response as an interactive card in Alice's
 * DM thread.  Spawns the DM if first contact.  Three buttons:
 *
 *   [Accept]  → acceptResponder({requestId, responderWebid}) substrate
 *               skill + sends 'help-with-accepted' envelope back to
 *               Bob so his side surfaces "✓ Accepted".
 *   [Decline] → sends 'help-with-declined' (no substrate side-effect
 *               in V0 — acceptResponder just picks ONE).
 *   [Counter] → posts a placeholder message; full counter-offer
 *               compose lands in a future slice.
 */
async function handleHelpWithResponse(fromAddr, payload) {
  const dm = ensureDmThread(fromAddr);
  if (!dm) return;
  const card = document.createElement('div');
  card.className = 'cc-responder-card';
  const header = document.createElement('div');
  header.className = 'cc-responder-card-header';
  header.textContent = `📩 Offer of help on your post`;
  card.appendChild(header);
  if (payload.postText) {
    const ctx = document.createElement('div');
    ctx.className = 'cc-responder-card-context';
    ctx.textContent = payload.postText;
    card.appendChild(ctx);
  }
  const body = document.createElement('blockquote');
  body.className = 'cc-responder-card-body';
  body.textContent = payload.body;
  card.appendChild(body);

  const actions = document.createElement('div');
  actions.className = 'cc-responder-card-actions';
  const accept = document.createElement('button');
  accept.type = 'button';
  accept.className = 'cc-wizard-btn cc-wizard-btn-primary';
  accept.textContent = 'Accept';
  accept.addEventListener('click', async () => {
    try {
      const result = await callSkill('stoop', 'acceptResponder', {
        requestId: payload.itemId,
        responderWebid: fromAddr,
      });
      if (result?.error) throw new Error(result.error);
      accept.disabled = true;
      decline.disabled = true;
      counter.disabled = true;
      accept.textContent = '✓ Accepted';
      if (agent?.peer?.status === 'connected') {
        try {
          const senderDisplay = await getMyDisplayName();
          await sendPeerWithRetry(fromAddr, {
            type: 'p2p-chat', subtype: 'help-with-accepted',
            itemId: payload.itemId,
            ...(senderDisplay ? { senderDisplay } : {}),
            sentAt: Date.now(),
          });
        } catch { /* swallow */ }
      }
    } catch (err) {
      const errMsg = document.createElement('div');
      errMsg.className = 'cc-wizard-error';
      errMsg.textContent = `Failed: ${err?.message ?? err}`;
      actions.appendChild(errMsg);
    }
  });
  const decline = document.createElement('button');
  decline.type = 'button';
  decline.className = 'cc-wizard-btn cc-wizard-btn-secondary';
  decline.textContent = 'Decline';
  decline.addEventListener('click', async () => {
    decline.disabled = true; accept.disabled = true; counter.disabled = true;
    decline.textContent = '✗ Declined';
    if (agent?.peer?.status === 'connected') {
      try {
        await agent.sendPeerMessage(fromAddr, {
          type: 'p2p-chat', subtype: 'help-with-declined',
          itemId: payload.itemId, sentAt: Date.now(),
        });
      } catch { /* swallow */ }
    }
  });
  const counter = document.createElement('button');
  counter.type = 'button';
  counter.className = 'cc-wizard-btn cc-wizard-btn-secondary';
  counter.textContent = 'Counter';
  counter.title = 'Reply with a counter-offer in this DM';
  counter.addEventListener('click', () => {
    dm.addShellMessage(renderReply({
      payload: t('dm.counter_prompt'),
      shape: 'text', threadId: dm.id,
    }, { t }));
    renderActiveStream();
  });
  actions.appendChild(accept);
  actions.appendChild(decline);
  actions.appendChild(counter);
  card.appendChild(actions);

  dm.addShellMessage({
    kind: 'form',
    messageId: `helpresp-${Date.now()}`,
    threadId: dm.id,
    lifecycleState: 'live',
    formElement: card,
    text: 'Help-with response card',
  });
  publishEventRef({
    app: 'stoop', type: 'notification', actor: fromAddr,
    payload: { message: `📩 ${fromAddr.slice(0, 16)}… offered help` },
  });
  renderSidebarHere();
  if (store.getActiveThread()?.id === dm.id) renderActiveStream();
}

/**
 * Slice 6c — Bob (responder side) receives confirmation that Alice
 * accepted his offer.  Surface a small notice in his DM with Alice.
 */
function handleHelpWithAccepted(fromAddr, payload) {
  const dm = ensureDmThread(fromAddr);
  if (!dm) return;
  dm.addShellMessage(renderReply({
    payload: `✓ Your offer was accepted. Coordinate next steps in this DM.`,
    shape: 'text', threadId: dm.id,
  }, { t }));
  renderSidebarHere();
  if (store.getActiveThread()?.id === dm.id) renderActiveStream();
}

/**
 * #178 — re-fetch the source list-op for a specific message and swap
 * the message's rendered content in place.  Idempotent; silent on
 * failure (the user sees the dispatch reply regardless).  Uses
 * runDispatch so the chat-shell's reply-shape inference (list vs
 * record vs text, per manifest surfaces.chat.reply) applies the
 * same way it did for the original message.
 */
async function refreshListMessageInPlace(thread, messageId) {
  const msg = thread.messages.find((m) => m.messageId === messageId);
  if (!msg?.sourceOp?.opId || !msg.sourceOp.appOrigin) return;
  try {
    const parse = {
      kind: 'slash', opId: msg.sourceOp.opId, args: msg.sourceOp.args ?? {},
      threadId: thread.id, command: '(refresh)', body: '',
    };
    const route = resolveDispatch(parse, catalog);
    if (route.kind !== 'ready') return;
    const reply = await runDispatch(route, callSkill);
    if (reply?.error) return;
    const fresh = renderReply(reply, {
      t, appOrigin: route.appOrigin, manifestsByOrigin,
    });
    if (fresh) fresh.messageId = messageId;
    thread.replaceRendered(messageId, fresh);
    renderActiveStream();
  } catch (err) {
    if (typeof console !== 'undefined') {
      console.warn('[refreshListMessageInPlace] failed for', messageId, err);
    }
  }
}

/* ── v0.6.2 deep-link receiver — boot-time ──────────────── */

// On boot, check the URL for a callback fragment + load persisted
// in-flight flows.  resumeInFlightFlows fires the matching callback
// (if any) and re-registers the rest on the EventRouter so events
// arriving later still wake the right thread.
//
// For the demo: when the URL has ?mock-oidc=1, simulate the OIDC
// provider by setting cc-callback=<sessionId> in a separate tick
// so the receiver picks it up.  Real OIDC would have its own
// redirect machinery here.

(async function bootDeepLinkReceiver() {
  try {
    const persisted = await idb.loadInFlight().catch(() => []);
    const callback  = parseCallbackUrl(globalThis.location?.href ?? '');
    resumeInFlightFlows({
      persisted,
      eventRouter: router,
      onCallback:  onSigninCallback,
      callback,
    });
    if (callback) {
      // Clean up the URL so a future reload doesn't re-fire the
      // callback.  Use replaceState — no extra history entry.
      try {
        globalThis.history?.replaceState?.({}, '', globalThis.location.pathname);
      } catch { /* swallow */ }
      renderActiveStream();
    }
  } catch (err) {
    console.warn('canopy-chat: deep-link receiver failed', err);
  }
})();

// M2 — project-invite auto-activation. If the app was opened on an invite / QR link
// (?projectId=…&code=…, the shape inviteLink() produces), drop the active thread straight into
// feedback mode by running `/feedback <code>`, then clean the URL so a reload doesn't re-fire.
(async function bootFeedbackInvite() {
  try {
    const invite = parseFeedbackInvite(globalThis.location?.search ?? '');
    if (!invite) return;
    const thread = store.getActiveThread() || store.getThread('main');
    if (!thread) return;
    await handleUserText(`/feedback ${invite.code}`, thread);
    try { globalThis.history?.replaceState?.({}, '', globalThis.location.pathname); } catch { /* swallow */ }
  } catch (err) {
    console.warn('canopy-chat: feedback invite auto-activation failed', err);
  }
})();
