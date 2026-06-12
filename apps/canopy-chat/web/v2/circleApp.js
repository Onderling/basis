/**
 * canopy-chat v2 — circle app boot (DEFAULT web entry, `index.html`).
 *
 * The v2 circle app is the landing page.  Per v2 §1 + §4 (and the
 * v2-design-is-canon decision), chat IS the kring view — there is NO
 * in-app route to the classic chat shell anymore (SP-13.1 removed the
 * header link; `classic.html` survives only as a static Playwright
 * fixture).  Reuses the same bundled agent factory + shared circle
 * model. Opening a circle sets the active circle (F1) and shows the
 * kring view; the admin's `policy.view` axis chooses whether that lands
 * on GESPREK (chat) or the recipe'd Scherm (§4).  "+ new circle" creates
 * one via the existing createGroupV2 path and refreshes.
 *
 * ⚠ Needs a browser check: agent boot, live circle data, and create are
 * not unit-verifiable here (renderer/model/scope/content/create logic
 * are covered by tests).
 */

import { initLocalisation, t, detectDeviceLang } from '../../src/index.js';
import { createRealHouseholdAgent } from '../../src/web/realAgent.js';
import { EventLog } from '../../src/eventLog.js';
// δ.2 — per-message delivery state for optimistic kring chat sends.
// Sibling of the EventLog (which stays append-only); read at render
// time by circleKring to surface pending/failed icons.
import { createDeliveryStateMap } from '../../src/v2/deliveryState.js';
// Phase 2 — shared kring chat send primitives (optimistic event + best-effort fan-out), web + mobile.
import { kringChatMessageEvent, broadcastKringFanOut } from '../../src/v2/kringBroadcast.js';
import {
  buildCircleStream, buildKringStream,
} from '../../src/v2/circleStream.js';
import { isFeatureEnabled, defaultViewModeFromPolicy } from '../../src/v2/circlePolicy.js';
import { buildKringTabs, DEFAULT_KRING_TAB, featureTabId, featureForTabId } from '../../src/v2/kringTabs.js';
// D1 (§5A) — per-circle action-frequency counter behind the quickActions block.
import { createActionFrequencyStore } from '../../src/v2/actionFrequency.js';
import { makePeerRouter } from '../../src/core/handlers/peerRouter.js';
import { makeKringChatPeerHandler } from '../../src/v2/kringChatReceiver.js';
import { rehydrateKringChatsFromStoop } from '../../src/v2/kringChatRehydrate.js';
import { createChatMessageInbox } from '../../src/v2/chatMessageInbox.js';
// ε.4 — negotiated catch-up protocol substrate.
import { makeCatchUpProviderHandler } from '../../src/v2/catchUpProvider.js';
import { makeCatchUpReceiver }        from '../../src/v2/catchUpReceiver.js';
import {
  makeRequestCatchUpFromKnownPeers, makeHandleCatchUpRequest,
} from '../../src/core/handlers/catchUp.js';
// γ-next.recipe — receiver + pending-cache substrate for the recipe broadcast.
import { makeKringRecipePeerHandler } from '../../src/v2/kringRecipeReceiver.js';
import { createKringRecipePendingStoreLocal } from '../../src/v2/kringRecipePendingStorage.js';
// γ-next.rules — receiver + pending-cache substrate for the rules broadcast.
import { makeKringRulesPeerHandler } from '../../src/v2/kringRulesReceiver.js';
import { createKringRulesPendingStoreLocal } from '../../src/v2/kringRulesPendingStorage.js';
// γ-next.policy — receiver + pending-cache substrate for the policy broadcast.
import { makeKringPolicyPeerHandler } from '../../src/v2/kringPolicyReceiver.js';
import { createKringPolicyPendingStoreLocal } from '../../src/v2/kringPolicyPendingStorage.js';
// δ.1 — per-screen materialized-blocks cache (cache-first render + bg refresh).
import { createScreenBlocksCacheLocal } from '../../src/v2/screenBlocksCacheStorage.js';
import {
  createKringRecipeStore, localStorageRecipeIo, getActiveRecipe,
  addRecipe, renameRecipe, removeRecipe, setActiveRecipe,
  addBlock, removeBlock, moveBlock, updateBlock, updateRecipe,
} from '../../src/v2/kringRecipe.js';
import { materializeRecipe } from '../../src/v2/kringRecipeBlocks.js';
// α.2 — user-owned cross-kring screens (the Schermen tab) + α.3 picker.
import {
  createUserScreenStore, localStorageScreenIo,
  addScreen as addUserScreen, renameScreen as renameUserScreen,
  removeScreen as removeUserScreen, setActiveScreen, getActiveScreen, updateScreen,
} from '../../src/v2/userScreens.js';
import { materializeScreen } from '../../src/v2/userScreenBlocks.js';
import { renderCircleKring } from './circleKring.js';
import { renderCircleScreen } from './circleScreen.js';
import { renderRecipeEditor } from './circleRecipeEditor.js';
// ε.6 — multi-offer catch-up chooser modal (opt-in via
// policy.catchUpChooserMode === 'prompt').
import { renderCatchUpChooser } from './catchUpChooserModal.js';
import { renderScreensPicker } from './circleScreensPicker.js';
import { computeAdvice, makeTooBusyEvent } from '../../src/v2/circleAdvisor.js';
import { normalizeHopMode } from '../../src/v2/circleHop.js';
import { mergeSkill, normalizeSkill } from '../../src/v2/circleSkills.js';
import { buildCircleFiles, circleFilesFromListFiles } from '../../src/v2/circleFolio.js';
import { myThingsFromListFiles } from '../../src/v2/folioMyThings.js';
import {
  sharedFilesFromListFiles, FOLIO_SHARE_FILTERS,
} from '../../src/v2/folioSharedFilters.js';
import { buildNearbyModel } from '../../src/v2/circleNearby.js';
import { renderCircleStream } from './circleStream.js';
import { renderCircleNearby } from './circleNearby.js';
import { renderCircleMyThings } from './circleMyThings.js';
import { renderCircleAdvisor } from './circleAdvisor.js';
import { renderCircleHop } from './circleHop.js';
import { renderSkillEditor } from './circleSkillEditor.js';
import { renderCircleFolioBrowser } from './circleFolio.js';
import {
  normalizeRulesDoc,
  // γ.2 — per-circle rules store factory + localStorage io (was inline
  // localStorage in showRules()).  Routes saves through a single hook
  // point that snapshots into the versions adapter.
  createCircleRulesStore, localStorageRulesIo,
} from '../../src/v2/circleRules.js';
import { renderRulesEditor } from './circleRulesEditor.js';
// γ.2 — concrete versions adapter (localStorage-backed).  Wired ONCE
// per kring store at construction time; snapshots every save into
// `cc.versions.<storeName>.<circleId>`.  Invisible to the UI in γ.2;
// γ.3 will surface the history.
import { localStorageObjectVersions } from '../../src/v2/objectVersionsStorage.js';
import { loadCircles } from '../../src/v2/circleModel.js';
import { circleSourcesFromAgent, makeResolvingCallSkill } from '../../src/v2/circleSources.js';
import { quickCreateCircle } from '../../src/v2/circleCreate.js';
import { setActiveCircle, getActiveCircle } from '../../src/v2/activeCircle.js';
import { normalizeCircleMembers } from '../../src/v2/circleMembers.js';
import { mergeCirclePolicy, mergeMemberOverride } from '../../src/v2/circlePolicy.js';
import { makeProposal, pendingApprovers } from '../../src/v2/circleConsensus.js';
import { createProposalStore, localStorageProposalIo } from '../../src/v2/circleProposalStore.js';
// P6.10 #348 — agent-add admin approval store (board 4B).
import { createAgentRequestStore } from '../../src/v2/agentRequest.js';
import { buildTilePreviews, bumpSeenAt } from '../../src/v2/circleTilePreviews.js';
import { makeAfterClaimHook } from '../../src/v2/claimRouter.js';
import { mergeAvailability } from '../../src/v2/memberAvailability.js';
import { createAvailabilityStore, localStorageAvailabilityIo } from '../../src/v2/memberAvailability.js';
import { renderCircleAvailability } from './circleAvailability.js';
import {
  createCirclePolicyStore, localStoragePolicyIo,
  createMemberOverrideStore, localStorageOverrideIo,
} from '../../src/v2/circlePolicyStore.js';
// β.5 — per-user "pin to top" store + adapter.
import { createCirclePinStore, localStoragePinIo } from '../../src/v2/circlePinStore.js';
import { renderCircleViewAs } from './circleViewAs.js';
import { renderCircleLauncher } from './circleLauncher.js';
import { renderCircleTabBar, hideCircleTabBar } from './circleTabBar.js';
import { renderCircleSettings } from './circleSettings.js';
import { renderCircleOverride } from './circleOverride.js';

// SP-13.2 — actor label stamped on local chat-message events.  Real WebID/
// peer-display wiring lands with peer broadcast (SP-13.2.1).
const LOCAL_ACTOR = 'me';

// SP-13.2.1 — best-effort NKN bootstrap.  Mirrors web/main.js's
// `connectPeerImpl` but doesn't throw if the CDN failed to load —
// the kring view still works locally (just no peer fan-out).
async function tryConnectPeerTransport(agent, peerMessageRouter) {
  const nknLib =
       (typeof window !== 'undefined' && window.nkn)
    ?? (typeof globalThis !== 'undefined' && globalThis.nkn)
    ?? null;
  if (!nknLib) {
    console.info('[circleApp] nkn-sdk not loaded — kring chat is local-only this session');
    return;
  }
  if (typeof agent?.connectPeerTransport !== 'function') {
    console.info('[circleApp] agent has no connectPeerTransport — kring chat is local-only');
    return;
  }
  try {
    await agent.connectPeerTransport({ nknLib, onPeerMessage: peerMessageRouter });
    console.info('[circleApp] NKN peer transport connected');
  } catch (err) {
    console.warn('[circleApp] NKN connect failed — kring chat is local-only:', err?.message ?? err);
  }
}

// γ.2 — versions adapters per kring store.  Wired here at construction
// so capture happens ABOVE the (localStorage / pod) tier — γ.3 will
// read these slots for 3-way merge after a remote sync.  Each store
// keys into its own slot prefix to keep histories isolated.
const policyVersions = localStorageObjectVersions('policy');
const recipeVersions = localStorageObjectVersions('recipe');
const rulesVersions  = localStorageObjectVersions('rules');

const policyStore = createCirclePolicyStore({ ...localStoragePolicyIo(), versions: policyVersions });
// α.1c — per-kring recipe book store (multi-recipe per kring, one active).
// localStorage now; pod io can swap in later without touching callers.
const recipeStore = createKringRecipeStore({ io: localStorageRecipeIo(), versions: recipeVersions });
// D1 (§5A) — per-circle action-frequency counter (the quickActions row).
// Hydrated from localStorage at boot; persists its snapshot on every bump.
const ACTION_FREQ_KEY = 'cc.actionFrequency';
const actionFrequency = createActionFrequencyStore(readActionFreqSnapshot(), {
  onChange: (snap) => {
    try { window.localStorage.setItem(ACTION_FREQ_KEY, JSON.stringify(snap)); }
    catch { /* quota / disabled */ }
  },
});
function readActionFreqSnapshot() {
  try {
    const raw = window.localStorage.getItem(ACTION_FREQ_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
// D1 (§5A) — in-memory fallback recipe for a kring with no authored scherm:
// just the "Veel-gebruikt" row.  Never persisted.
const DEFAULT_SCHERM_RECIPE = Object.freeze({
  id: '__default__', name: '', blocks: [{ id: 'qa-default', type: 'quickActions', config: { limit: 4 } }],
});
// γ.2 — per-circle rules store (replaces inline localStorage in showRules()).
const rulesStore  = createCircleRulesStore({ ...localStorageRulesIo(), versions: rulesVersions });
// γ-next.recipe — per-kring "incoming recipe" cache.  Receiver writes
// here on every valid kring-recipe-broadcast envelope; the recipe
// editor reads on mount + passes the cached recipe via γ.3's
// `incomingRecipe` opt.  localStorage now; pod-sync swap is the
// same shape as the other stores.
const kringRecipePendingStore = createKringRecipePendingStoreLocal();
// γ-next.rules — per-kring "incoming rules" cache.  Receiver writes
// here on every valid kring-rules-broadcast envelope; the rules
// editor reads on mount + passes the cached doc via γ.4's
// `incomingRules` opt.  Same shape as the recipe store.
const kringRulesPendingStore = createKringRulesPendingStoreLocal();
// γ-next.policy — per-kring "incoming policy" cache.  Receiver writes
// here on every valid kring-policy-broadcast envelope; the settings
// editor reads on mount + passes the cached doc via γ.4's
// `incomingPolicy` opt.  Same shape as the rules + recipe stores.
const kringPolicyPendingStore = createKringPolicyPendingStoreLocal();
// δ.1 — per-screen materialized-blocks cache.  The Schermen view-mode
// reads this on open to render instantly while the fresh materialize
// runs in the background; on result the view swaps + the cache
// re-saves.  Survives reboots so cold-boot users see the previous
// state immediately instead of a Loading… flash.
const screenBlocksCache = createScreenBlocksCacheLocal();
// α.3 — per-user screens store.  One book per user (not per-kring); the
// active screen drives the new Schermen tab.
const userScreenStore = createUserScreenStore({ io: localStorageScreenIo() });
const overrideStore = createMemberOverrideStore(localStorageOverrideIo());
// β.5 — pin store (single keyless map at `cc.circlePinned`).
const pinStore = createCirclePinStore(localStoragePinIo());
const availabilityStore = createAvailabilityStore(localStorageAvailabilityIo());
// P6.2 — persisted pending proposals (multi-admin consensus).
const proposalStore = createProposalStore({ io: localStorageProposalIo() });
// P6.10 #348 — persisted pending agent-add requests (board 4B).  Reuses
// the same {load, save} adapter shape as the proposal store.
const AGENT_REQ_STORE_KEY = 'cc.agentRequestQueue';
const agentRequestStore = createAgentRequestStore({
  io: {
    load: async (key) => {
      try { const raw = window.localStorage.getItem(key); return raw ? JSON.parse(raw) : null; }
      catch { return null; }
    },
    save: async (key, value) => {
      try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota / disabled */ }
    },
  },
  storeKey: AGENT_REQ_STORE_KEY,
});
// Cross-circle Stream (board 5B) reads this firehose; the agent's
// publishEvent appends to it during boot.
const eventLog = new EventLog({ initial: [], muted: [] });
// δ.2 — one delivery-state map per agent boot (lifetime matches the
// in-memory EventLog).  showKring's onSend marks each locally-sent
// msgId 'pending' → 'sent' | 'failed' as broadcastKringMessage
// resolves; the kring renderer reads it at render time.
const deliveryStateMap = createDeliveryStateMap();

// ε.5 — "Catching up…" indicator state + notification banner.
// Status is the latest snapshot fed by the negotiated catch-up
// receiver's `emitStatus` hook.  Notifications surface inbound
// `catch-up-request` envelopes for kringen with
// `policy.catchUpAutoApprove === false` so the host (= provider)
// gets a [Send all / Last 50 / Last 7 days / Decline] card.
let _catchUpStatus = null;          // null | {phase, circleId, count?, total?}
let _catchUpNotifications = [];     // array of pending provider-side cards
let _catchUpHideTimer = null;

function emitCatchUpStatus(status) {
  _catchUpStatus = status;
  if (_catchUpHideTimer) { clearTimeout(_catchUpHideTimer); _catchUpHideTimer = null; }
  if (status?.phase === 'done' || status?.phase === 'no-offers' || status?.phase === 'timed-out') {
    _catchUpHideTimer = setTimeout(() => { _catchUpStatus = null; renderCatchUpIndicator(); }, 1500);
  }
  // Mirror to /logs so users can debug.
  try {
    eventLog.append({
      id: `catchup-status-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      ts: Date.now(),
      app: 'canopy-chat',
      type: 'notification',
      payload: { message: `[catch-up] ${status?.phase ?? '?'}` },
    });
  } catch { /* defensive */ }
  renderCatchUpIndicator();
}

function renderCatchUpIndicator() {
  if (typeof document === 'undefined') return;
  let el = document.getElementById('catch-up-indicator');
  if (!_catchUpStatus) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement('div');
    el.id = 'catch-up-indicator';
    el.setAttribute('role', 'status');
    el.style.cssText = [
      'position:fixed', 'top:8px', 'right:8px', 'z-index:1000',
      'background:rgba(0,0,0,0.78)', 'color:#fff', 'padding:6px 10px',
      'border-radius:12px', 'font-size:12px', 'font-family:system-ui,sans-serif',
      'box-shadow:0 2px 6px rgba(0,0,0,0.2)',
    ].join(';');
    document.body.appendChild(el);
  }
  const s = _catchUpStatus;
  let label;
  if (s.phase === 'streaming' && Number.isFinite(s.total) && s.total > 0) {
    label = t('circle.chat.catch_up.streaming_progress', { count: s.count ?? 0, total: s.total });
  } else if (s.phase === 'done') {
    label = t('circle.chat.catch_up.done');
  } else if (s.phase === 'no-offers') {
    label = t('circle.chat.catch_up.no_offers');
  } else {
    label = t('circle.chat.catch_up.requesting');
  }
  el.textContent = label;
}

function emitCatchUpNotification(n, providerHandle) {
  _catchUpNotifications.push({ n, provider: providerHandle });
  try {
    eventLog.append({
      id: `catchup-req-${n.requestId}`,
      ts: Date.now(),
      app: 'canopy-chat',
      type: 'notification',
      payload: {
        message: t('circle.chat.catch_up.provider_request_title', {
          name: n.fromNknAddr.slice(0, 12), kring: n.groupId,
        }) + ' · ' + t('circle.chat.catch_up.provider_request_size', {
          count: n.count, kb: Math.round(n.sizeBytes / 1024) || 1,
        }),
      },
    });
  } catch { /* defensive */ }
  renderCatchUpNotifications();
}

function renderCatchUpNotifications() {
  if (typeof document === 'undefined') return;
  let host = document.getElementById('catch-up-notifications');
  if (_catchUpNotifications.length === 0) {
    if (host) host.remove();
    return;
  }
  if (!host) {
    host = document.createElement('div');
    host.id = 'catch-up-notifications';
    host.style.cssText = [
      'position:fixed', 'bottom:8px', 'right:8px', 'z-index:1001',
      'display:flex', 'flex-direction:column', 'gap:6px',
      'max-width:340px', 'font-family:system-ui,sans-serif',
    ].join(';');
    document.body.appendChild(host);
  }
  host.innerHTML = '';
  for (const { n, provider } of _catchUpNotifications) {
    const card = document.createElement('div');
    card.style.cssText = [
      'background:#fff', 'border:1px solid #ccc', 'border-radius:8px',
      'padding:10px', 'box-shadow:0 2px 6px rgba(0,0,0,0.18)', 'font-size:13px',
    ].join(';');
    const title = document.createElement('div');
    title.style.fontWeight = '600';
    title.textContent = t('circle.chat.catch_up.provider_request_title', {
      name: n.fromNknAddr.slice(0, 12), kring: n.groupId,
    });
    const size = document.createElement('div');
    size.style.color = '#555';
    size.style.margin = '4px 0 8px';
    size.textContent = t('circle.chat.catch_up.provider_request_size', {
      count: n.count, kb: Math.round(n.sizeBytes / 1024) || 1,
    });
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;';
    const mkBtn = (label, mode) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = 'padding:4px 10px;border-radius:6px;border:1px solid #888;background:#f4f4f4;cursor:pointer;font-size:12px;';
      b.addEventListener('click', () => {
        provider.resolveCatchUpRequest({ requestId: n.requestId, mode }).catch(() => {});
        _catchUpNotifications = _catchUpNotifications.filter((x) => x.n.requestId !== n.requestId);
        renderCatchUpNotifications();
      });
      return b;
    };
    btnRow.appendChild(mkBtn(t('circle.chat.catch_up.provider_send_all'),       'all'));
    btnRow.appendChild(mkBtn(t('circle.chat.catch_up.provider_send_last_50'),   'last-50'));
    btnRow.appendChild(mkBtn(t('circle.chat.catch_up.provider_send_last_7d'),   'last-7-days'));
    btnRow.appendChild(mkBtn(t('circle.chat.catch_up.provider_decline'),         null));
    card.appendChild(title);
    card.appendChild(size);
    card.appendChild(btnRow);
    host.appendChild(card);
  }
}

let rootEl = null;
let tabBarEl = null;
let circlesCache = [];
let sources = {};
let resolveCallSkill = null; // (opId, args) => Promise<object|null>
let rawCallSkill = null;     // (appOrigin, opId, args) — for createGroupV2

// Top-level tab bar (Kringen / Stroom / Mij). Shown on the three top-level
// surfaces; hidden inside a circle + its sub-screens.
function showTabBar(active) {
  renderCircleTabBar(tabBarEl, {
    active, t,
    onScreens: showScreens,
    onKringen: showLauncher,
    onMij: showMij,
  });
}

// P6.3 — seenAt persistence: bumped on showDetail(id) so unread counts
// reset after the user opens a circle.  One key holds {circleId → ts}.
const SEEN_AT_KEY = 'cc.circleSeenAt';
function readSeenAt() {
  try { const raw = window.localStorage.getItem(SEEN_AT_KEY); return raw ? JSON.parse(raw) : {}; }
  catch { return {}; }
}
function writeSeenAt(map) {
  try { window.localStorage.setItem(SEEN_AT_KEY, JSON.stringify(map)); }
  catch { /* quota / disabled */ }
}

// SP-13.4 — Chat ↔ Scherm pill: per-circle preference persists in
// localStorage so the user lands back in whichever mode they last used
// for that kring.
//
// §4 — when the member has NO saved override for this kring yet, the
// landing surface is the admin's `policy.view` front door
// (defaultViewModeFromPolicy): 'screen' → scherm, 'chat'/'cross-stream'
// → chat.  Once the user flips the pill, their choice persists and wins.
const VIEW_MODE_KEY = 'cc.circleViewMode';
function readViewMode(id, policy = null) {
  try {
    const raw = window.localStorage.getItem(VIEW_MODE_KEY);
    const map = raw ? JSON.parse(raw) : {};
    const saved = map?.[id];
    if (saved === 'scherm' || saved === 'chat') return saved;
    return defaultViewModeFromPolicy(policy);
  } catch { return defaultViewModeFromPolicy(policy); }
}
function writeViewMode(id, mode) {
  try {
    const raw = window.localStorage.getItem(VIEW_MODE_KEY);
    const map = raw ? JSON.parse(raw) : {};
    map[id] = mode;
    window.localStorage.setItem(VIEW_MODE_KEY, JSON.stringify(map));
  } catch { /* quota / disabled */ }
}

// β.5 — pinned + muted maps cached at the launcher level so the host
// can re-render without an async round-trip when the user toggles a
// pin/mute from the per-tile menu.  Refreshed in `refreshLauncherPins`
// and `refreshLauncherMutes` (both fire-and-forget on launcher entry).
let launcherPinnedMap = {};
let launcherMutedMap  = {};

async function refreshLauncherPins() {
  try { launcherPinnedMap = await pinStore.get(); }
  catch { launcherPinnedMap = {}; }
}
async function refreshLauncherMutes() {
  const next = {};
  for (const c of circlesCache) {
    try {
      const o = await overrideStore.get(c.id);
      if (o?.chatOff) next[c.id] = true;
    } catch { /* skip */ }
  }
  launcherMutedMap = next;
}

// β.5 — paint the launcher tiles (previews + pin/mute/proposal state). PURE render, no async
// re-scheduling — so it's safe to call from the pins/mutes refresh `.then` WITHOUT re-entering
// showLauncher (which would re-schedule that refresh and loop forever; that infinite re-render
// starved the main thread and hung the headless e2e, 2026-06-11).
function paintLauncher() {
  // P6.3 — project the EventLog into per-circle previews; tiles show a
  // chat-style subtitle + unread badge when there's recent activity.
  const previews = buildTilePreviews({
    events:  eventLog.query({ excludeMuted: true }),
    circles: circlesCache,
    seenAt:  readSeenAt(),
  });
  // β.5 — per-tile context menu handlers (pin / mute / settings / leave).
  renderCircleLauncher(rootEl, {
    circles: circlesCache,
    previews,
    proposals: launcherProposals,
    pinnedMap: launcherPinnedMap,
    mutedMap:  launcherMutedMap,
    t,
    onOpenCircle: showDetail,
    onNewCircle:  createCircle,
    onPin:        onPinCircle,
    onMute:       onMuteCircle,
    onSettings:   (id) => showSettings(id),
    onLeave:      onLeaveCircle,
  });
}

function showLauncher() {
  setActiveCircle(null);
  try { sessionStorage.removeItem('cc.activeCircle'); } catch { /* ignore */ }
  // β.1 — Stream/Availability/Hop/Nearby/My-things buttons are gone from the launcher; those surfaces
  // are reachable via the Schermen + Mij tabs. The `show*` functions stay defined below.
  paintLauncher();
  showTabBar('kringen');
  // Refresh proposal counts in the background so the next launcher render shows yellow badges where
  // consensus is waiting. Async so the first paint isn't blocked.
  refreshLauncherProposals().catch(() => { /* ignore */ });
  // β.5 — pull fresh pin + mute state, then RE-PAINT (not re-enter showLauncher — see paintLauncher)
  // so a just-toggled state shows immediately, without looping.
  Promise.all([refreshLauncherPins(), refreshLauncherMutes()])
    .then(() => { if (getActiveCircle() == null) paintLauncher(); })
    .catch(() => { /* tolerate */ });
}

// β.5 — toggle pin state + refresh the launcher so the tile reflows
// (pins float to the top of their section).
async function onPinCircle(id) {
  try { launcherPinnedMap = await pinStore.toggle(id); }
  catch { /* keep cache; stale UI is fine */ }
  if (getActiveCircle() == null) showLauncher();
}

// β.5 — toggle the per-kring chatOff override (the mute field already
// exists in DEFAULT_MEMBER_OVERRIDE / mergeMemberOverride).  No new
// substrate added; mute is *exposed* here, not invented.
async function onMuteCircle(id) {
  try {
    const cur = await overrideStore.get(id);
    await overrideStore.update(id, { chatOff: !cur.chatOff });
  } catch { /* tolerate */ }
  await refreshLauncherMutes();
  if (getActiveCircle() == null) showLauncher();
}

// β.5 — Leave kring: confirm, then dispatch `/leave-group` via the
// raw callSkill seam (the stoop op `leaveGroup` already exists in the
// substrate; the slash-command name maps to that op in the chat shell).
async function onLeaveCircle(id, circle) {
  const name = circle?.name ?? id;
  const ok = (typeof globalThis.confirm === 'function')
    ? globalThis.confirm(t('circle.tile.menu.leave_confirm', { name }))
    : true;
  if (!ok) return;
  const dispatch = resolveCallSkill ?? rawCallSkill;
  if (typeof dispatch === 'function') {
    try {
      // The stoop substrate exposes `leaveGroup`; the slash router
      // resolves /leave-group to this op.  Calling the resolved op
      // directly here keeps β.5 standalone (no chat-shell dependency).
      await dispatch('leaveGroup', { groupId: id });
    } catch (err) {
      console.warn('[circleApp] leaveGroup failed:', err?.message ?? err);
    }
  }
  try { circlesCache = await loadCircles(sources); }
  catch { /* keep cache */ }
  // Drop the pin if the circle is gone — the map otherwise keeps a
  // dangling key that the partition would happily filter out anyway,
  // but cleanup keeps storage tidy.
  try {
    const cur = await pinStore.get();
    if (cur[id]) { await pinStore.toggle(id); launcherPinnedMap = await pinStore.get(); }
  } catch { /* tolerate */ }
  if (getActiveCircle() == null) showLauncher();
}

// P6.2 #341 + P6.10 #348 — per-circle pending-admin-action counts.  The
// launcher's voorstellen badge surfaces the SUM of pending proposals
// (multi-admin consensus) + pending agent-add requests (board 4B):
// both shapes wait for the same admins, so collapsing them into one
// "needs your attention" badge keeps the launcher legible.
let launcherProposals = {};
async function refreshLauncherProposals() {
  const next = {};
  for (const c of circlesCache) {
    let n = 0;
    try { n += await proposalStore.countPending(c.id); } catch { /* ignore */ }
    try { n += await agentRequestStore.countPending(c.id); } catch { /* ignore */ }
    if (n > 0) next[c.id] = n;
  }
  const sameKeys = Object.keys(next).length === Object.keys(launcherProposals).length
    && Object.keys(next).every((k) => next[k] === launcherProposals[k]);
  launcherProposals = next;
  if (!sameKeys && getActiveCircle() == null) showLauncher();
}

// P6.8 #346 — Nearby screen on web.  mDNS isn't live in the browser
// (substrate path is mobile-only today), so peers stay [] and the
// screen renders an honest empty state + the user's own published
// skills footer so they can see what others would see.
function showNearby() {
  hideCircleTabBar(tabBarEl);
  const model = buildNearbyModel({ peers: [], mySkills: [], t });
  renderCircleNearby(rootEl, { model, t, onBack: showLauncher });
}

// P6.M7 #349 — Mijn dingen notes-list (private kring, board 10A).  Files
// come from the Folio listFiles op filtered for mine + circle-less.  The
// active user webid stays null on web today; the substrate falls back to
// "anything without an owner" which matches the V0 single-user state.
async function showMyThings() {
  hideCircleTabBar(tabBarEl);
  let files = [];
  const rerender = () => renderCircleMyThings(rootEl, {
    files, t, onBack: showLauncher,
  });
  rerender();
  if (resolveCallSkill) {
    try {
      const res = await resolveCallSkill('listFiles', {});
      files = myThingsFromListFiles(res, null);
      rerender();
    } catch { /* keep empty */ }
  }
}

// Hopping is a DEVICE-global stance (Stoop getHopMode/setHopMode); it lives
// under the Mij tab (personal settings). Chain-card data lands later.
async function showHop() {
  hideCircleTabBar(tabBarEl);
  let hopMode = { global: false };
  if (resolveCallSkill) {
    try { hopMode = normalizeHopMode(await resolveCallSkill('getHopMode', {})); } catch { /* default */ }
  }
  const rerender = () => renderCircleHop(rootEl, {
    hopMode,
    t,
    onToggleGlobal: async (v) => {
      hopMode = { global: v };
      rerender();
      if (resolveCallSkill) {
        try {
          const r = await resolveCallSkill('setHopMode', { global: v });
          if (r && !r.error) { hopMode = normalizeHopMode(r); rerender(); }
        } catch { /* keep optimistic */ }
      }
    },
    onBack: showMij,
  });
  rerender();
}

// α.3 — Schermen tab.  Two sub-modes:
//   - 'picker' (default): list of the user's screens with CRUD affordances
//   - 'view':              render the materialized active screen as blocks
// First-run seed: when the book is empty, auto-create a "Stream" screen
// (kringFilter=null + noticeboard block) so the tab is useful right away.
//
// Q5 (mute) honoured: materializeScreen drops muted kringen entirely.
let _screenSubMode = 'picker';
let _viewingScreenId = null;
let _screensBook = null;
let _screenViewBlocks = null;
// δ.1 — monotonically-increasing token for each `_showActiveScreen` call.
// The async materialize compares its captured token against the latest
// before mutating the DOM, so a slow materialize from screen-A can't
// stomp the body once the user has navigated to screen-B (or back to
// the picker).
let _showActiveScreenToken = 0;

async function showScreens() {
  showTabBar('screens');
  let book;
  try { book = await userScreenStore.get(); }
  catch { book = { screens: [], activeId: null }; }
  // First-run seed: three default screens so the Schermen tab is
  // immediately useful — Stream (noticeboard across all kringen),
  // My things (tasks assigned to me, α.4), My calendar (agenda
  // events, α.4).  Once at least one screen exists we never
  // re-seed; the user can delete or rename any of them freely.
  if (book.screens.length === 0) {
    book = await userScreenStore.update((cur) => {
      let next = addUserScreen(cur, t('circle.screens.seed_name'));
      let id   = next.screens[next.screens.length - 1].id;
      next = updateScreen(next, id, (s) => addBlock(s, 'noticeboard'));
      next = addUserScreen(next, t('circle.screens.seed_my_things'));
      id   = next.screens[next.screens.length - 1].id;
      next = updateScreen(next, id, (s) => addBlock(s, 'tasks'));
      next = addUserScreen(next, t('circle.screens.seed_my_calendar'));
      id   = next.screens[next.screens.length - 1].id;
      next = updateScreen(next, id, (s) => addBlock(s, 'agenda'));
      return next;
    });
  }
  _screensBook = book;
  _screensRerender();
}

function _screensRerender() {
  if (_screenSubMode === 'view') {
    _showActiveScreen();
    return;
  }
  // Picker mode: list of screens with CRUD.
  renderScreensPicker(rootEl, {
    book: _screensBook,
    t,
    onOpenScreen:   (sid) => {
      _viewingScreenId = sid;
      _screenSubMode = 'view';
      _showActiveScreen();
    },
    onAddScreen: async (name) => {
      _screensBook = await userScreenStore.update((cur) => {
        const next = addUserScreen(cur, name);
        const newId = next.screens[next.screens.length - 1].id;
        // Seed every new screen with a default noticeboard block so
        // it's not empty on first open.
        return updateScreen(next, newId, (s) => addBlock(s, 'noticeboard'));
      });
      _screensRerender();
    },
    onRenameScreen: async (sid, name) => {
      _screensBook = await userScreenStore.update((cur) => renameUserScreen(cur, sid, name));
      _screensRerender();
    },
    onRemoveScreen: async (sid) => {
      _screensBook = await userScreenStore.update((cur) => removeUserScreen(cur, sid));
      _screensRerender();
    },
    onSetActive: async (sid) => {
      _screensBook = await userScreenStore.update((cur) => setActiveScreen(cur, sid));
      _screensRerender();
    },
  });
}

async function _showActiveScreen() {
  // View-mode: render the materialized screen + a back link to picker.
  const screen = _screensBook?.screens?.find((s) => s.id === _viewingScreenId)
              ?? getActiveScreen(_screensBook);
  if (!screen) {
    _screenSubMode = 'picker'; _viewingScreenId = null;
    _screensRerender();
    return;
  }
  rootEl.innerHTML = '';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'circle-screens-view__back';
  back.textContent = `← ${t('circle.screens.picker_title')}`;
  back.addEventListener('click', () => {
    _screenSubMode = 'picker';
    _viewingScreenId = null;
    _screensRerender();
  });
  rootEl.appendChild(back);
  const title = document.createElement('h2');
  title.className = 'circle-screens-view__title';
  title.textContent = screen.name || t('circle.screens.untitled');
  rootEl.appendChild(title);

  // δ.1 — cache-first render: read the LAST materialized payload for this
  // screen and paint immediately so the press feels instant.  On a cache
  // miss we fall through to the existing Loading→fresh flow (null sentinel
  // → renderCircleScreen shows the loading hint).  Either way the fresh
  // materialize runs in the background; on result we swap in the result
  // and re-save the cache.  Race-token guards against a stale materialize
  // from a previously-open screen stomping the body once the user has
  // navigated away.
  const body = document.createElement('div');
  rootEl.appendChild(body);
  const token = ++_showActiveScreenToken;
  let cached = null;
  try { cached = await screenBlocksCache.get(screen.id); } catch { /* ignore */ }
  if (token !== _showActiveScreenToken || _viewingScreenId !== screen.id) return;
  if (Array.isArray(cached)) {
    _screenViewBlocks = cached;
    renderCircleScreen(body, { blocks: cached, t, refreshing: true });
  } else {
    renderCircleScreen(body, { blocks: null, t });
  }

  // Materialize blocks (with muted-kring filter when available later).
  let blocks = [];
  try {
    blocks = await materializeScreen({
      screen,
      hostOps: {
        callSkill: resolveCallSkill ?? rawCallSkill,
        eventLog, circles: circlesCache,
      },
      // mutedCircleIds wires in α.5 (per-user mute UI).
    });
  } catch (err) {
    console.warn('[showScreens] materializeScreen failed', err);
  }
  // Drop the result if the user navigated away (or to a different screen)
  // while materialize was in flight — otherwise the body could be
  // overwritten with stale content from a previously-open screen.
  if (token !== _showActiveScreenToken || _viewingScreenId !== screen.id) return;
  _screenViewBlocks = blocks;
  renderCircleScreen(body, { blocks, t, refreshing: false });
  // Save the fresh blocks back to the cache so the next open is also
  // instant.  Best-effort: a quota / serialization failure is silent.
  screenBlocksCache.set(screen.id, blocks).catch(() => { /* ignore */ });
}

function showStream() {
  const rows = buildCircleStream({
    events: eventLog.query({ excludeMuted: true }),
    circles: circlesCache,
  });
  // Top-level tab screen — no back link (the Kringen tab is the way back).
  renderCircleStream(rootEl, { rows, t, onOpenCircle: showDetail });
  showTabBar('screens');   // α.3 — stroom retired in favour of screens
}

// "Mij" tab — personal availability (holiday + quiet hours, board 6C) plus
// the device-global Hopping stance.
async function showMij() {
  let working = await availabilityStore.get();
  // Top-level tab screen — no back link (the Kringen tab is the way back);
  // Save still returns to the launcher.
  const rerender = () => renderCircleAvailability(rootEl, {
    availability: working,
    t,
    onChange: (patch) => { working = mergeAvailability(working, patch); rerender(); },
    onSave: async () => { await availabilityStore.update(working); showLauncher(); },
    onHop: showHop,
  });
  rerender();
  showTabBar('mij');
}

async function createCircle() {
  if (!rawCallSkill) {
    // SP-13.1 — no chat-shell fallback.  Without an agent the bundle
    // hasn't booted yet; surface that as an error and bail.
    globalThis.alert?.(t('circle.create_unavailable'));
    return;
  }
  const name = (globalThis.prompt?.(t('circle.new')) || '').trim();
  if (!name) return;
  try {
    await quickCreateCircle({ callSkill: rawCallSkill, name });
    circlesCache = await loadCircles(sources);
  } catch (err) {
    console.warn('[circleApp] create failed', err);
    globalThis.alert?.(String(err?.message ?? err));
  }
  showLauncher();
}

async function showDetail(id) {
  hideCircleTabBar(tabBarEl);
  setActiveCircle(id);
  try { sessionStorage.setItem('cc.activeCircle', id); } catch { /* ignore */ }
  // P6.3 — bump the seenAt marker so the next launcher render clears
  // this circle's unread badge.
  writeSeenAt(bumpSeenAt(readSeenAt(), id));
  const circle = circlesCache.find((c) => c.id === id) || { id };
  // SP-13.1 — no chat-shell auto-route anymore.  Every kring opens the
  // kring view; v2 §1 says chat IS the kring view (GESPREK tab).  The
  // GESPREK render lands in SP-13.2.
  let detailPolicy = null;
  try { detailPolicy = await policyStore.get(id); }
  catch { /* fresh circle / read failure → fall through */ }
  showKring(id, circle, detailPolicy);
}

// SP-13 — kring content view (board 2B/8C).  Replaces the action-grid
// CircleDetail as the per-circle landing surface.  Admin actions
// (Settings, Mine, ViewAs, …) move into the header `⋯` overflow menu,
// gated on the Functies axis (same gates the old detail used).
//
// SP-13.2 — GESPREK as chat-style: drop the filter-chip row, render
// rows as chat bubbles, wire an inline composer that publishes a
// chat-message event scoped to this circle.  Inbound peer broadcast
// + slash-command parsing land in SP-13.2.1.
function showKring(id, circle, policy) {
  const allowRules   = isFeatureEnabled(policy, 'houseRules');
  const allowViewAs  = isFeatureEnabled(policy, 'memberDirectory');
  const allowFiles   = isFeatureEnabled(policy, 'lists') || isFeatureEnabled(policy, 'notes');
  const more = {
    settings: () => showSettings(id),
    mine:     () => showOverride(id),
    advisor:  () => showAdvisor(id),
    skills:   () => showSkills(id),
    // α.1d — recipe editor (scherm-mode page composition).  Available
    // to everyone for V0; admin-gating + multi-admin consensus are
    // follow-up slices.
    recipes:  () => showRecipeEditor(id),
    ...(allowViewAs ? { viewAs: () => showViewAs(id) } : {}),
    ...(allowFiles  ? { files:  () => showFolio(id) } : {}),
    ...(allowRules  ? { rules:  () => showRules(id) } : {}),
  };
  // SP-13.3 — per-kring bottom tabs derived from policy.features.
  const tabs = buildKringTabs(policy, t);
  let activeTab = DEFAULT_KRING_TAB;
  // SP-13.4 — Chat ↔ Scherm pill state, persisted per circle.  §4 — the
  // admin's policy.view sets the landing surface until the user overrides.
  let viewMode = readViewMode(id, policy);
  // α.1c — materialized scherm blocks (recipe book → blocks).  Null
  // until the async load below resolves; replaces SP-13.4's
  // "scherm_coming" placeholder when present.
  let screenBlocks = null;
  let seq = 0;

  // δ.2 — fan-out helper.  Used by both the initial send AND the
  // tap-to-retry path from the 'failed' icon.  Re-uses the SAME
  // msgId on retry so receiver-side dedup suppresses any duplicate
  // delivery (the EventLog already idempotents on id).
  function broadcastFanOut({ msgId, text, ts }) {
    // Shared fan-out (Phase 2); onChange = web's rerender.
    broadcastKringFanOut({ rawCallSkill, circleId: id, msgId, text, ts, deliveryStateMap, onChange: rerender });
  }

  const rerender = () => {
    const rows = buildKringStream({
      events:    eventLog.query({ excludeMuted: true }),
      circles:   circlesCache,
      circleId:  id,
    });
    renderCircleKring(rootEl, {
      circle, rows, t,
      tabs, activeTab,
      viewMode,
      screenBlocks,
      // δ.2 — read function so the renderer can look up state per row
      // without us having to pass a fresh snapshot through every prop.
      // Locally-sent bubbles read this to decide which icon to render.
      deliveryStateFor: (msgId) => deliveryStateMap.get(msgId),
      localActor: LOCAL_ACTOR,
      // δ.2 — retry on the failed icon tap.  Re-fires the SAME msgId
      // (idempotent receiver-side dedup).  Looks up the original text
      // from the eventLog so we don't have to remember it elsewhere.
      onRetryDelivery: (msgId) => {
        const evt = eventLog.query({ excludeMuted: true })
          .find((e) => e.id === msgId);
        const text = evt?.payload?.text;
        const ts   = evt?.ts ?? Date.now();
        if (typeof text !== 'string' || !text) return;
        broadcastFanOut({ msgId, text, ts });
      },
      onViewMode: (mode) => {
        if (mode !== 'chat' && mode !== 'scherm') return;
        viewMode = mode;
        writeViewMode(id, mode);
        rerender();
      },
      onTab: (tabId) => {
        activeTab = tabId;
        // D1 — count the tab use so the quickActions row reflects reality.
        const f = featureForTabId(tabId);
        if (f) actionFrequency.bump(id, f);
        rerender();
      },
      // D1 (§5A) — a "Veel-gebruikt" pill tap.  Bump the feature's count,
      // then route it: a feature with a tab switches to it (in chat view);
      // houseRules opens the rules panel; anything else falls back to the
      // members tab if present.
      onScreenAction: (featureKey) => {
        actionFrequency.bump(id, featureKey);
        if (featureKey === 'houseRules') { more.rules?.(); return; }
        const tabId = featureTabId(featureKey);
        if (tabId) {
          activeTab = tabId;
          viewMode = 'chat';
          writeViewMode(id, 'chat');
        }
        rerender();
        // Re-materialize so the row's own ordering reflects the new count.
        loadScherm();
      },
      onBack:   showLauncher,
      onSend:   (text) => {
        // SP-13.2 / SP-13.2.1 — optimistic local append + best-effort
        // peer fan-out.  The msgId is shared so receiver-side dedup
        // suppresses any echo if a peer's pseudo-pod re-mirrors.
        // δ.2 — also tracks delivery state (pending → sent | failed)
        // so the bubble surfaces a clock / warning icon.
        const msgId = `kring-${id}-${Date.now()}-${(seq += 1).toString(36)}`;
        const ts    = Date.now();
        eventLog.append(kringChatMessageEvent({ msgId, ts, circleId: id, actor: LOCAL_ACTOR, text }));
        broadcastFanOut({ msgId, text, ts });
      },
      onAction: (action /*, row */) => {
        // V0: per-row actions just log.  Wiring each (Ik help / Ik doe ze /
        // Negeer) to its dispatch lands in SP-13.2.1.
        console.info('[kring] action', action.action, 'on row', action.payload?.rowId);
      },
      more,
    });
  };
  rerender();
  // EventLog has no subscribe seam yet; SP-13.2.1 will poll-on-event so
  // inbound peer messages appear without manual re-render.

  // α.1c — load + materialize the active recipe.  Until this resolves,
  // scherm-mode shows the empty-state.  Failure (e.g. corrupt store)
  // falls through to the empty-state too.  D1 re-runs this after a
  // quickActions tap so the row's own ordering reflects the new count.
  async function loadScherm() {
    try {
      const book = await recipeStore.get(id);
      // D1 (§5A) — every scherm leads with the "Veel-gebruikt" row.  When
      // the admin hasn't authored a recipe yet, fall back to an in-memory
      // default that's just the quickActions block (not persisted, so the
      // admin can still start from a clean recipe in the editor).
      const active = getActiveRecipe(book) ?? DEFAULT_SCHERM_RECIPE;
      const blocks = await materializeRecipe({
        recipe:   active,
        circleId: id,
        // D1 — policy + actionFrequency feed the quickActions block.
        hostOps:  { callSkill: resolveCallSkill ?? rawCallSkill, eventLog, circles: circlesCache, policy, actionFrequency },
      });
      screenBlocks = blocks;
      if (getActiveCircle() === id) rerender();
    } catch (err) {
      console.warn('[circleApp] recipe load failed:', err?.message ?? err);
      screenBlocks = [];
      if (getActiveCircle() === id) rerender();
    }
  }
  loadScherm();
}


// Skill editor (board 8) — draft persists locally per circle (cc.circleSkill.<id>);
// "extend the Stoop skill item" is the later real-persistence path.
const skillKey = (id) => `cc.circleSkill.${id}`;
function showSkills(id) {
  let skill = normalizeSkill(null);
  try { const s = localStorage.getItem(skillKey(id)); if (s) skill = normalizeSkill(JSON.parse(s)); } catch { /* default */ }
  const rerender = () => renderSkillEditor(rootEl, {
    skill,
    t,
    onChange: (patch) => { skill = mergeSkill(skill, patch); rerender(); },
    onBack: () => showDetail(id),
    onSave: () => {
      try { localStorage.setItem(skillKey(id), JSON.stringify(skill)); } catch { /* ignore */ }
      showDetail(id);
    },
  });
  rerender();
}

// α.1d — recipe editor surface.  Two modes: 'book' (list recipes) and
// 'recipe' (edit one recipe's blocks).  Host owns book + editing-recipe
// id; each mutation persists via recipeStore.update then refreshes the
// in-memory copy + the scherm screenBlocks for whatever circle is open.
function showRecipeEditor(circleId) {
  hideCircleTabBar(tabBarEl);
  let book = { recipes: [], activeId: null };
  let mode = 'book';
  let editingRecipeId = null;
  // γ-next.recipe — pending incoming recipe (set by peer broadcast).
  // Loaded once on mount; cleared after the resolver applies or
  // discards.  When null the editor renders untouched; when set, γ.3
  // wires the per-block modal automatically.
  let incomingRecipe = null;

  const refresh = async () => {
    try { book = await recipeStore.get(circleId); }
    catch { book = { recipes: [], activeId: null }; }
    if (mode === 'recipe' && !book.recipes.some((r) => r.id === editingRecipeId)) {
      mode = 'book'; editingRecipeId = null;
    }
    // γ-next.recipe — pull the cached broadcast (if any).  Editor's
    // resolver decides whether anything actually conflicts; if not,
    // applies straight through.
    try { incomingRecipe = await kringRecipePendingStore.get(circleId); }
    catch { incomingRecipe = null; }
    rerender();
  };

  const apply = async (mutator) => {
    try { book = await recipeStore.update(circleId, mutator); }
    catch (err) { console.warn('[recipe] mutation failed:', err?.message ?? err); }
    // γ-next.recipe — fan the fresh local recipe out to peers.  Read
    // the just-updated active recipe back so we send the post-mutation
    // shape.  Fire-and-forget; per-peer errors are logged inside.
    try { broadcastActiveRecipe({ circleId, book }); }
    catch (err) { console.warn('[kring-recipe] broadcast scheduling failed:', err?.message ?? err); }
    rerender();
  };

  const clearPending = () => {
    incomingRecipe = null;
    kringRecipePendingStore.clear(circleId).catch(() => { /* ignore */ });
  };

  const rerender = () => {
    renderRecipeEditor(rootEl, {
      book, mode, editingRecipeId, t,
      // γ-next.recipe — broadcast cache → editor → γ.3 resolver.  The
      // resolver is opt-in; when `incomingRecipe` is null the editor
      // renders untouched.  Applied / discarded both clear the cache.
      incomingRecipe,
      recipeStore,
      circleId,
      onIncomingApplied: () => clearPending(),
      onIncomingDiscarded: () => clearPending(),
      onBack:         () => showDetail(circleId),
      onOpenRecipe:   (rid) => { mode = 'recipe'; editingRecipeId = rid; rerender(); },
      onBackToBook:   () => { mode = 'book'; editingRecipeId = null; rerender(); },
      onAddRecipe:    (name) => apply((cur) => addRecipe(cur, name)),
      onRenameRecipe: (rid, name) => apply((cur) => renameRecipe(cur, rid, name)),
      onRemoveRecipe: (rid) => apply((cur) => removeRecipe(cur, rid)),
      onSetActive:    (rid) => apply((cur) => setActiveRecipe(cur, rid)),
      onAddBlock:     (rid, type) => apply((cur) => updateRecipe(cur, rid, (r) => addBlock(r, type))),
      onRemoveBlock:  (rid, bid) => apply((cur) => updateRecipe(cur, rid, (r) => removeBlock(r, bid))),
      onMoveBlock:    (rid, bid, idx) => apply((cur) => updateRecipe(cur, rid, (r) => moveBlock(r, bid, idx))),
      onUpdateBlock:  (rid, bid, patch) => apply((cur) => updateRecipe(cur, rid, (r) => updateBlock(r, bid, patch))),
    });
  };

  refresh();   // initial load + render
}

/**
 * γ-next.recipe — fan the active recipe out to every other kring
 * member via stoop's `broadcastKringRecipe` skill.  Fire-and-forget:
 * per-peer failures land in the result.errors array; we just log.
 * No-op when rawCallSkill isn't bound yet (pre-agent-boot edits).
 */
function broadcastActiveRecipe({ circleId, book }) {
  if (typeof rawCallSkill !== 'function') return;
  const active = book?.recipes?.find?.((r) => r.id === book.activeId);
  if (!active) return;
  const msgId = `kring-recipe-${circleId}-${Date.now()}`;
  const ts    = Date.now();
  rawCallSkill('stoop', 'broadcastKringRecipe', {
    groupId: circleId,
    recipe:  active,
    msgId,
    ts,
  }).then((r) => {
    if (r?.error) console.warn('[kring-recipe] fan-out skipped:', r.error);
  }).catch((err) => {
    console.warn('[kring-recipe] fan-out failed:', err?.message ?? err);
  });
}

// Circle-scoped Folio browser (board 10B) — files come from a circle pod's
// listFiles once wired; empty until then (the scope/normalize is tested).
//
// P6.M8 #350 — share-toggle row (Shared-by-me / Shared-with-me).  Picking
// a toggle re-projects the cached raw `listFiles` result through the
// share-filter substrate; clearing it restores the circle-scoped view.
function showFolio(id) {
  let filter = 'all';
  let shareFilter = null;          // null | 'shared-by-me' | 'shared-with-me'
  let currentPath = '';            // N5 — folder being viewed ('' = root)
  let sourceMode = 'index';        // N5 — 'index' (in-app) | 'pod' (real pod)
  let needsPod = false;            // pod selected but no pod connected yet
  let lastListResult = null;       // raw `listFiles` result for re-projection
  let files = buildCircleFiles({ files: [], circleId: id });

  function project() {
    // Pod source — rows ARE the user's pod; no circle-scoping / share lens.
    if (sourceMode === 'pod') {
      files = Array.isArray(lastListResult?.items) ? lastListResult.items : [];
      return;
    }
    if (shareFilter && lastListResult != null) {
      files = sharedFilesFromListFiles(lastListResult, {
        myId:      null,
        myCircles: circlesCache,
        filter:    shareFilter,
      });
    } else if (lastListResult != null) {
      files = circleFilesFromListFiles(lastListResult, id);
    } else {
      files = buildCircleFiles({ files: [], circleId: id });
    }
  }

  function load() {
    if (!resolveCallSkill) return;
    const args = sourceMode === 'pod' ? { source: 'pod' } : {};
    resolveCallSkill('listFiles', args)
      .then((res) => {
        lastListResult = res;
        needsPod = sourceMode === 'pod' && !!res?.needsPod;
        project();
        if (getActiveCircle() === id) rerender();
      })
      .catch(() => { needsPod = sourceMode === 'pod'; if (getActiveCircle() === id) rerender(); });
  }

  const rerender = () => renderCircleFolioBrowser(rootEl, {
    files,
    filter,
    shareFilter,
    currentPath,
    sourceMode,
    needsPod,
    t,
    // Changing the row set (filter / share toggle) resets folder depth.
    onFilter: (f) => { filter = f; currentPath = ''; rerender(); },
    onShareFilter: (next) => {
      if (next && !FOLIO_SHARE_FILTERS.includes(next)) return;
      shareFilter = next;
      currentPath = '';
      project();
      rerender();
    },
    // N5 — switch the file SOURCE: in-app index ↔ the user's real pod.
    onSourceMode: (mode) => {
      if (mode === sourceMode || (mode !== 'index' && mode !== 'pod')) return;
      sourceMode = mode;
      currentPath = '';
      shareFilter = null;            // share lens is index-only
      lastListResult = null;
      needsPod = false;
      files = sourceMode === 'pod' ? [] : buildCircleFiles({ files: [], circleId: id });
      rerender();
      load();
    },
    // N5 — descend into / climb out of folders derived from file paths.
    onNavigate: (path) => { currentPath = path; rerender(); },
    onBack: () => showDetail(id),
  });
  rerender();
  load();
}

// Circle rules document (boards 3B/3C) — editor persists per circle
// (cc.circleRules.<id>); "preview" shows the Agree/Decline consent screen.
// Threading the consent into the real join flow is the follow-on.
// γ.2 — routes load/save through rulesStore so the versions adapter
// snapshots every save.  Key shape on disk is unchanged.
async function showRules(id) {
  let doc = await rulesStore.get(id);
  // γ-next.rules — pull the cached broadcast (if any).  Editor's γ.4
  // resolver decides whether anything actually conflicts; if not, it
  // applies straight through.  When the slot is empty `incomingRules`
  // stays null and the editor renders untouched.
  let incomingRules = null;
  try { incomingRules = await kringRulesPendingStore.get(id); }
  catch { incomingRules = null; }

  const clearPending = () => {
    incomingRules = null;
    kringRulesPendingStore.clear(id).catch(() => { /* ignore */ });
  };

  const rerender = () => renderRulesEditor(rootEl, {
    doc,
    t,
    // γ-next.rules — broadcast cache → editor → γ.4 resolver.  The
    // resolver is opt-in; when `incomingRules` is null the editor
    // renders untouched.  Applied / discarded both clear the cache.
    incomingRules,
    rulesStore,
    circleId: id,
    onIncomingApplied:   () => clearPending(),
    onIncomingDiscarded: () => clearPending(),
    onChange: (patch) => { doc = normalizeRulesDoc({ ...doc, ...patch }); rerender(); },
    onBack: () => showDetail(id),
    // The standalone Agree/Decline preview screen was retired in 5.5d —
    // consent now happens in the create/join wizard.  No `onPreview`.
    onSave: async () => {
      try { await rulesStore.set(id, doc); } catch { /* ignore */ }
      // γ-next.rules — fan the just-saved rules doc out to peers.
      // Fire-and-forget; per-peer errors are logged inside.
      try { broadcastRules({ circleId: id, doc }); }
      catch (err) { console.warn('[kring-rules] broadcast scheduling failed:', err?.message ?? err); }
      showDetail(id);
    },
  });
  rerender();
}

/**
 * γ-next.rules — fan the rules document out to every other kring
 * member via stoop's `broadcastKringRules` skill.  Fire-and-forget:
 * per-peer failures land in the result.errors array; we just log.
 * No-op when rawCallSkill isn't bound yet (pre-agent-boot edits).
 */
function broadcastRules({ circleId, doc }) {
  if (typeof rawCallSkill !== 'function') return;
  if (!doc || typeof doc !== 'object') return;
  const msgId = `kring-rules-${circleId}-${Date.now()}`;
  const ts    = Date.now();
  rawCallSkill('stoop', 'broadcastKringRules', {
    groupId:  circleId,
    rulesDoc: doc,
    msgId,
    ts,
  }).then((r) => {
    if (r?.error) console.warn('[kring-rules] fan-out skipped:', r.error);
  }).catch((err) => {
    console.warn('[kring-rules] fan-out failed:', err?.message ?? err);
  });
}

// Advisor cooldown (≤1 card/month) persists per-circle in localStorage.
const advisorSeenKey = (id) => `cc.advisorShown.${id}`;
function showAdvisor(id) {
  const rerender = () => {
    let lastShownAt = null;
    try { const s = localStorage.getItem(advisorSeenKey(id)); if (s) lastShownAt = Number(s); } catch { /* ignore */ }
    const advice = computeAdvice({
      events: eventLog.query({ excludeMuted: true }),
      circleId: id,
      lastShownAt,
    });
    renderCircleAdvisor(rootEl, {
      advice,
      t,
      onTooBusy: () => { eventLog.append(makeTooBusyEvent({ circleId: id })); rerender(); },
      onDismiss: () => {
        try { localStorage.setItem(advisorSeenKey(id), String(Date.now())); } catch { /* ignore */ }
        rerender();
      },
      onBack: () => showDetail(id),
    });
  };
  rerender();
}

async function showViewAs(id) {
  // F-5.1 — real member directory via the listGroupMembers op (MemberMap);
  // re-running the reveal/openness rules over it is the shared projection.
  let members = [];
  const policy = (await policyStore.get(id))?.revealPolicy ?? 'pairwise';
  let viewer = { kind: 'stranger' };
  const rerender = () => renderCircleViewAs(rootEl, {
    members, policy, viewer, t,
    onPickViewer: (v) => { viewer = v; rerender(); },
    onBack: () => showDetail(id),
  });
  rerender();
  if (resolveCallSkill) {
    try {
      members = normalizeCircleMembers(await resolveCallSkill('listGroupMembers', { groupId: id }));
      if (getActiveCircle() === id) rerender();
    } catch { /* keep empty */ }
  }
}

async function showOverride(id) {
  let working = await overrideStore.get(id);
  const rerender = () => renderCircleOverride(rootEl, {
    override: working,
    t,
    onChange: (patch) => { working = mergeMemberOverride(working, patch); rerender(); },
    onBack: () => showDetail(id),
    onSave: async () => { await overrideStore.update(id, working); showDetail(id); },
  });
  rerender();
}

async function showSettings(id) {
  let working = await policyStore.get(id);
  const consensusActive = () => !!working.consensusRequired && (working.admins?.length ?? 0) >= 2;
  // P6.2 — load pending proposals so the banner can surface the count of
  // outstanding "waiting on N admins" approvals on settings entry.
  let pending = await proposalStore.listForCircle(id);
  const pendingCount = () => pending.filter((p) => p.status !== 'ready').length;
  const pendingNote = () => {
    if (pendingCount() === 0) return consensusActive() ? t('circle.settings.pending') : undefined;
    // Build a "waiting on Pieter, Sara" string from the first pending proposal.
    const first = pending.find((p) => p.status !== 'ready');
    const waiting = first ? pendingApprovers(first) : [];
    return waiting.length
      ? t('circle.settings.pending_waiting', { who: waiting.join(', ') })
      : t('circle.settings.pending');
  };
  // γ-next.policy — pull the cached broadcast (if any).  Editor's γ.4
  // resolver decides whether anything actually conflicts; if not, it
  // applies straight through.  When the slot is empty `incomingPolicy`
  // stays null and the editor renders untouched.
  let incomingPolicy = null;
  try { incomingPolicy = await kringPolicyPendingStore.get(id); }
  catch { incomingPolicy = null; }

  const clearPending = () => {
    incomingPolicy = null;
    kringPolicyPendingStore.clear(id).catch(() => { /* ignore */ });
  };

  const rerender = () => renderCircleSettings(rootEl, {
    policy: working,
    t,
    saveLabel: consensusActive() ? t('circle.settings.send_proposal') : undefined,
    note: pendingNote(),
    // γ-next.policy — broadcast cache → editor → γ.4 resolver.  The
    // resolver is opt-in; when `incomingPolicy` is null the editor
    // renders untouched.  Applied / discarded both clear the cache.
    incomingPolicy,
    policyStore,
    circleId: id,
    onIncomingApplied:   () => clearPending(),
    onIncomingDiscarded: () => clearPending(),
    onChange: (patch) => { working = mergeCirclePolicy(working, patch); rerender(); },
    onBack: () => showDetail(id),
    onSave: async () => {
      if (!consensusActive()) {
        await policyStore.update(id, working);
        // γ-next.policy — fan the just-saved policy doc out to peers.
        // Fire-and-forget; per-peer errors are logged inside.
        try { broadcastPolicy({ circleId: id, policy: working }); }
        catch (err) { console.warn('[kring-policy] broadcast scheduling failed:', err?.message ?? err); }
        showDetail(id);
        return;
      }
      // P6.2 — record + persist the pending proposal.  Cross-admin
      // delivery (NKN fan-out + receive handler) is the V1 follow-up;
      // single-device approval works on-device today via approveProposal +
      // proposalStore.updateOne, and unanimous-approve commits via
      // policyStore.update + proposalStore.remove.
      const proposal = makeProposal({
        circleId: id, patch: working, proposedBy: null, policy: working,
      });
      await proposalStore.save(proposal);
      if (proposal.status === 'ready') {
        // Single admin / self-only consensus → commit immediately.
        await policyStore.update(id, working);
        await proposalStore.remove(proposal.id);
        // γ-next.policy — fan the just-committed policy doc out to peers.
        // Only fires when consensus actually resolves on-device (i.e. the
        // proposal landed as `ready`); for outstanding multi-admin
        // proposals the broadcast follows the unanimous-approve commit
        // path (cross-admin proposal-delivery is a V1 follow-up).
        try { broadcastPolicy({ circleId: id, policy: working }); }
        catch (err) { console.warn('[kring-policy] broadcast scheduling failed:', err?.message ?? err); }
      } else {
        pending = await proposalStore.listForCircle(id);
      }
      // P6.2 #341 — refresh the launcher's voorstellen badge map so the
      // tile reflects the new pending count on the next launcher visit.
      refreshLauncherProposals().catch(() => { /* ignore */ });
      showDetail(id);
    },
  });
  rerender();
}

/**
 * γ-next.policy — fan the policy document out to every other kring
 * member via stoop's `broadcastKringPolicy` skill.  Fire-and-forget:
 * per-peer failures land in the result.errors array; we just log.
 * No-op when rawCallSkill isn't bound yet (pre-agent-boot edits).
 */
function broadcastPolicy({ circleId, policy }) {
  if (typeof rawCallSkill !== 'function') return;
  if (!policy || typeof policy !== 'object') return;
  const msgId = `kring-policy-${circleId}-${Date.now()}`;
  const ts    = Date.now();
  rawCallSkill('stoop', 'broadcastKringPolicy', {
    groupId: circleId,
    policy,
    msgId,
    ts,
  }).then((r) => {
    if (r?.error) console.warn('[kring-policy] fan-out skipped:', r.error);
  }).catch((err) => {
    console.warn('[kring-policy] fan-out failed:', err?.message ?? err);
  });
}

async function boot() {
  rootEl = document.getElementById('circle-root');
  tabBarEl = document.getElementById('circle-tabbar');
  await initLocalisation({ lng: detectDeviceLang() });
  renderCircleLauncher(rootEl, { loading: true, t });

  try {
    let eventSeq = 0;
    const agent = await createRealHouseholdAgent({
      publishEvent: (e) => {
        if (!e || typeof e !== 'object') return;
        eventLog.append({
          ...e,
          id: e.id ?? `cc-${Date.now()}-${(eventSeq += 1).toString(36)}`,
          ts: e.ts ?? Date.now(),
        });
      },
      stoopPersistDb: { dbName: 'cc-stoop-state', storeName: 'items' },
    });
    if (typeof agent?.callSkill === 'function') {
      rawCallSkill = agent.callSkill;
      resolveCallSkill = makeResolvingCallSkill(agent.callSkill);
      sources = circleSourcesFromAgent({ callSkill: resolveCallSkill, circlesStore: agent.circlesStore });
      // SP-13.2.1 — register a peer-router with the kring-chat-message
      // handler + connect the NKN transport (best-effort; no-op when
      // nkn-sdk failed to load).  The ingest hook mirrors the envelope
      // into stoop's itemStore so kring chat history is durable,
      // searchable, and mute/eviction-filtered (parity with /post
      // delivery via `ingestRemotePost`).  EventLog append still drives
      // the live bubble render.
      const ingestKringMessage = async (payload, fromNknAddr) => {
        try {
          return await agent.callSkill('stoop', 'ingestKringMessage', {
            payload, fromNknAddr,
          });
        } catch (err) {
          console.warn('[circleApp] ingestKringMessage failed:', err?.message ?? err);
          return { error: String(err?.message ?? err) };
        }
      };
      // ε.1 — single normalization gate.  Every kring-chat insert
      // path (receiver / rehydrator / future catch-up / pod) routes
      // through this inbox so envelope validation + msgId dedup +
      // ingest mirror + eventLog append happen in ONE place with
      // shared state.  Sibling of `eventLog` so the rehydrator's
      // backfill + the live NKN handler dedupe through the same LRU.
      const kringChatInbox = createChatMessageInbox({
        eventLog,
        ingest: ingestKringMessage,
        logger: console,
      });
      const kringChatHandler = makeKringChatPeerHandler({ inbox: kringChatInbox });
      // SP-13.2.2 — boot rehydrator: read stoop's stored chats back
      // into the in-memory eventLog so the GESPREK tab shows history
      // after a reload (eventLog is in-memory; itemStore persists).
      rehydrateKringChatsFromStoop({
        callSkill: agent.callSkill,
        inbox:     kringChatInbox,
      }).catch(() => { /* logged inside */ });
      // γ-next.recipe — recipe-broadcast receiver.  Stashes inbound
      // recipes per-kring; the editor pulls on mount + passes via
      // γ.3's `incomingRecipe` opt.
      const kringRecipeDedup   = new Set();
      const kringRecipeHandler = makeKringRecipePeerHandler({
        pendingStore: kringRecipePendingStore,
        dedup:        kringRecipeDedup,
        logger:       console,
      });
      // γ-next.rules — rules-broadcast receiver.  Stashes inbound rules
      // docs per-kring; the rules editor pulls on mount + passes via
      // γ.4's `incomingRules` opt.
      const kringRulesDedup    = new Set();
      const kringRulesHandler  = makeKringRulesPeerHandler({
        pendingStore: kringRulesPendingStore,
        dedup:        kringRulesDedup,
        logger:       console,
      });
      // γ-next.policy — policy-broadcast receiver.  Stashes inbound policy
      // docs per-kring; the settings editor pulls on mount + passes via
      // γ.4's `incomingPolicy` opt.  Completes the γ-next trio
      // (recipe / rules / policy).
      const kringPolicyDedup   = new Set();
      const kringPolicyHandler = makeKringPolicyPeerHandler({
        pendingStore: kringPolicyPendingStore,
        dedup:        kringPolicyDedup,
        logger:       console,
      });
      // ε.4 — negotiated catch-up protocol.  The receiver coordinator
      // fires `catch-up-request` to known peers, collects offers in a
      // 3s window, auto-accepts the first, and ingests chunks through
      // the SAME kringChatInbox the receiver/rehydrator use (shared
      // LRU + ingest mirror = no double bubbles).  The provider
      // handler answers inbound requests: fetches via getMessagesSince,
      // sends an offer, then streams chunks on accept.
      //
      // Status emitter is wired to the chat-shell indicator below
      // (ε.5).  Provider notification is V1 auto-approve (no UI yet);
      // policy.catchUpAutoApprove=false opt-out path surfaces a
      // banner through emitCatchUpNotification (also ε.5).
      const sendToPeerForCU = (addr, env) =>
        (typeof agent?.sendPeerMessage === 'function')
          ? agent.sendPeerMessage(addr, env)
          : Promise.reject(new Error('agent.sendPeerMessage unavailable'));

      const catchUpReceiver = makeCatchUpReceiver({
        sendToPeer: sendToPeerForCU,
        inbox:      kringChatInbox,
        emitStatus: (status) => emitCatchUpStatus(status),
        // ε.6 — opt-in multi-offer chooser.  Reads
        // `policy.catchUpChooserMode` synchronously from localStorage
        // (where `localStoragePolicyIo` writes its JSON).  The async
        // policyStore.get() would need to be awaited inside a non-async
        // hook signature; reading localStorage directly is cheap and
        // matches the same source-of-truth the store reads.
        getChooserMode: (groupId) => {
          try {
            const raw = (typeof window !== 'undefined' && window.localStorage)
              ? window.localStorage.getItem(`cc.circlePolicy.${groupId}`)
              : null;
            if (!raw) return 'auto';
            const parsed = JSON.parse(raw);
            return parsed?.catchUpChooserMode === 'prompt' ? 'prompt' : 'auto';
          } catch { return 'auto'; }
        },
        chooseOffer: (offers, { circleId }) => new Promise((resolve) => {
          const circle = circlesCache.find((c) => c.id === circleId);
          const overlay = document.createElement('div');
          document.body.appendChild(overlay);
          renderCatchUpChooser(overlay, {
            offers,
            circleId,
            circleName: circle?.name ?? circleId,
            // V1 contact-resolver: short-addr fallback is fine here —
            // member-directory resolution lands in a follow-up slice.
            resolveContact: null,
            t,
            onResolve: (decision) => {
              try { overlay.remove(); } catch { /* defensive */ }
              resolve(decision);
            },
          });
        }),
        logger:     console,
      });
      const catchUpProvider = makeCatchUpProviderHandler({
        callSkill:        agent.callSkill,
        sendToPeer:       sendToPeerForCU,
        getCirclePolicy:  async (groupId) => policyStore.get(groupId).catch(() => null),
        // V1: every member of a kring is "known"; provider notification
        // surfaces only when policy.catchUpAutoApprove === false.
        isKnownContact:   () => true,
        emitNotification: (n) => emitCatchUpNotification(n, catchUpProvider),
        logger:           console,
      });

      const peerMessageRouter = makePeerRouter({
        handlers: {
          'kring-chat-message':      kringChatHandler,
          'kring-recipe-broadcast':  kringRecipeHandler,
          'kring-rules-broadcast':   kringRulesHandler,
          'kring-policy-broadcast':  kringPolicyHandler,
          // ε.4 — negotiated catch-up subtypes.
          'catch-up-request':        catchUpProvider.handler,
          'catch-up-accept':         catchUpProvider.onAccept,
          'catch-up-offer':          catchUpReceiver.onPeerMessage,
          'catch-up-chunk':          catchUpReceiver.onPeerMessage,
          'catch-up-end':            catchUpReceiver.onPeerMessage,
        },
      });
      tryConnectPeerTransport(agent, peerMessageRouter).catch(() => { /* logged inside */ });

      // ε.4 — auto-fire negotiated catch-up on (re)connect, ONCE per
      // boot.  For each kring we know about, schedule via the strategy
      // router: pod-shared kringen route through the pod range-query;
      // personal/none kringen route through `catchUpReceiver` (the
      // negotiated path).  knownPeers come from stoop's roster.
      const peerCatchUpNegotiated = async ({ circleId, sinceTs }) => {
        let roster = [];
        try {
          const r = await agent.callSkill('stoop', 'listGroupRoster', { groupId: circleId });
          roster = Array.isArray(r?.members) ? r.members : [];
        } catch { /* roster empty */ }
        const knownPeers = roster.map((m) => m?.addr).filter(Boolean);
        return catchUpReceiver.requestCatchUp({
          circleId,
          sinceTs:    Number.isFinite(sinceTs) ? sinceTs : 0,
          knownPeers,
          fromNknAddr: agent?.peer?.address ?? '',
        });
      };
      // The kick-off itself is scheduled once peer transport reports
      // 'connected'.  We don't await — failures log + the next boot
      // re-tries.  Reuse the existing makeRequestCatchUpFromKnownPeers
      // dispatcher so the per-kring scheduleCatchUp routing stays in
      // one place.
      const requestCatchUpAll = makeRequestCatchUpFromKnownPeers({
        callSkill:             agent.callSkill,
        sendPeer:              sendToPeerForCU,
        inbox:                 kringChatInbox,
        getCirclePolicy:       (id) => policyStore.get(id).catch(() => null),
        peerCatchUpNegotiated,
        logger:                console,
      });
      // Fire after a short delay so the NKN HI handshake settles.
      // 1.5s mirrors web/main.js's existing kick-off timing.
      setTimeout(() => {
        requestCatchUpAll().catch((err) =>
          console.warn('[catch-up] kick-off failed', err?.message ?? err));
      }, 1500);
      // P6.5 — wire the claim-router hook now that callSkill + override
      // store are both available.  On claim with `tasksToPersonal` on,
      // mirror the claimed task into the primary crew so it shows up in
      // "Mijn dingen".  Uses the existing primary crew (`cc-default`);
      // future slice (P6.5-followup) will surface the resulting mirror
      // tasks in an "ON YOUR LIST" section on the circle detail.
      if (typeof agent.setAfterClaimHook === 'function') {
        agent.setAfterClaimHook(makeAfterClaimHook({
          getOverride:       (id) => overrideStore.get(id),
          resolveCircleName: async (id) => circlesCache.find((c) => c.id === id)?.name ?? null,
          addToPersonalCrew: async ({ text, originCircleId, originCircleName, originTaskId, tag }) => {
            try {
              return await agent.callSkill('tasks-v0', 'addTask', {
                text,
                crewId:           'cc-default',
                originCircleId,
                originCircleName,
                originTaskId,
                tags:             [tag],
              });
            } catch (err) {
              console.warn('[circleApp] mirror addTask failed:', err?.message ?? err);
              return null;
            }
          },
        }));
      }
    }
  } catch (err) {
    console.warn('[circleApp] agent boot failed — showing empty launcher', err);
  }

  try {
    circlesCache = await loadCircles(sources);
  } catch (err) {
    console.warn('[circleApp] loadCircles failed', err);
    circlesCache = [];
  }
  // α.3 — Schermen is the primary landing tab.  First-run seeds the
  // default Stream screen inside showScreens.
  showScreens().catch((err) => {
    console.warn('[circleApp] showScreens failed; falling back to launcher', err);
    showLauncher();
  });
}

boot();
