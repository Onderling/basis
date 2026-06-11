/**
 * canopy-chat-mobile v2 — circle launcher + detail screen (boards 1B / F1).
 *
 * Mobile counterpart of web's circleLauncher + circleDetail + circleApp,
 * over the same shared model ('@canopy-app/canopy-chat'). The launcher is
 * the app's default screen; the classic ChatScreen stays reachable via
 * "← chat". Opening a circle sets the active circle (F1) and shows an
 * inline scoped detail; "+ new circle" creates one via the existing
 * createGroupV2 path and refreshes.
 *
 * Data: with a `bundle` (callSkill) real circles + items + create work via
 * the shared helpers; otherwise the empty states show + create is a no-op.
 * Flagged for device verification.
 */
import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, StyleSheet, BackHandler, Modal, Alert } from 'react-native';
import { theme } from './theme.js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  loadCircles, circleSourcesFromAgent, makeResolvingCallSkill,
  loadCircleItems, quickCreateCircle, setActiveCircle, normalizeCircleMembers,
  circleFilesFromListFiles,
  // 5.9d — Proof-of-Location placeholder seam (real attestation deferred).
  getCirclePolStatus, formatPolStatus,
  // P6.1 — per-kring feature-flag consumption.
  isFeatureEnabled,
  // §4 — admin's policy.view → default Chat/Scherm landing surface.
  defaultViewModeFromPolicy,
  // P6.3 — per-circle activity preview + unread badge.
  buildTilePreviews, bumpSeenAt,
  // P6.5 #342 — claim-router hook (mirror claimed tasks to my own crew).
  makeAfterClaimHook,
  // P6.8 #346 — Nearby/HIER model + label helpers (board 8C).
  buildNearbyModel,
  // P6.M7 #349 — "My things" private notes-list (board 10A).
  myThingsFromListFiles,
  // SP-13.2 — kring-scoped event stream + per-row action chips.
  buildKringStream, actionsForStreamRow,
  // SP-13.3 — per-kring bottom tabs from policy.features (v2 §1).
  buildKringTabs, DEFAULT_KRING_TAB,
  // D1 (§5A) — quickActions row: feature↔tab mapping + frequency counter.
  featureTabId, featureForTabId, createActionFrequencyStore,
  // α.1a/b — scherm recipe model + per-block materializer.
  getActiveRecipe, materializeRecipe,
  // α.1d.3 — recipe-editor mutation helpers.
  addRecipe, renameRecipe, removeRecipe, setActiveRecipe,
  addBlock, removeBlock, moveBlock, updateBlock, updateRecipe,
  // α.2 — user-owned cross-kring screens + α.3 picker.
  createUserScreenStore, addScreen as addUserScreen,
  renameScreen as renameUserScreen, removeScreen as removeUserScreen,
  setActiveScreen, updateScreen, materializeScreen,
  // δ.2 — per-message delivery state for optimistic kring chat sends.
  createDeliveryStateMap,
  // B (circle bot) — dispatch primitives to run an interpreted command in the kring.
  parseInput, resolveDispatch, runDispatch, scopeReadyDispatch,
} from '@canopy-app/canopy-chat';
// B (circle bot) — v2 free-text→LLM→command surface (shared with web). Deep-imported like the other
// v2 modules (kringChatReceiver etc.) since they're not on the canopy-chat barrel.
import { createCircleDispatch } from '../../../../canopy-chat/src/v2/circleDispatch.js';
import { createTokenGate } from '../../../../canopy-chat/src/v2/tokenGate.js';
import { defaultCircleGateRules } from '../../../../canopy-chat/src/v2/circleGateRules.js';
import { interpretToCommand } from '../../../../canopy-chat/src/v2/interpretCommand.js';
import { buildCircleLlmProviders } from '../../../../canopy-chat/src/v2/circleLlmProviders.js';
import { createClarifyingDispatch } from '../../../../canopy-chat/src/v2/clarifyingDispatch.js';
import { createUserLlmDefaultStore, asyncStorageUserLlmIo } from '../../../../canopy-chat/src/v2/userLlmDefault.js';
import { formatNearbyLabel } from '../../core/nearbyLabel.js';
import { t } from '../../core/localisation.js';
import {
  makeCirclePolicyStoreRN, makeMemberOverrideStoreRN, makeAvailabilityStoreRN,
  // P6.2 — persisted multi-admin proposals.
  makeProposalStoreRN,
  // α.1e — scherm recipe book persistence.
  makeKringRecipeStoreRN,
  // α.3 — per-user screens persistence.
  makeUserScreenStoreRN,
  // β.5 — per-user pin-to-top persistence.
  makeCirclePinStoreRN,
  // γ.2 — per-circle rules persistence + version capture (was inline
  // AsyncStorage at the rules entry points up to β).
  makeCircleRulesStoreRN,
} from '../../core/circleStoresRN.js';
// δ.1 — per-screen materialized-blocks cache (cache-first render).
import { makeScreenBlocksCacheRN } from '../../core/screenBlocksCacheStorageRN.js';
import CircleSettingsScreen from './CircleSettingsScreen.js';
import CircleOverrideScreen from './CircleOverrideScreen.js';
import CircleAvailabilityScreen from './CircleAvailabilityScreen.js';
import CircleStreamScreen from './CircleStreamScreen.js';
import CircleViewAsScreen from './CircleViewAsScreen.js';
import CircleAdvisorScreen from './CircleAdvisorScreen.js';
import CircleHopScreen from './CircleHopScreen.js';
import CircleSkillEditorScreen from './CircleSkillEditorScreen.js';
import CircleFolioScreen from './CircleFolioScreen.js';
import CircleRulesScreen from './CircleRulesScreen.js';
import CircleRulesConsentScreen from './CircleRulesConsentScreen.js';
import CircleTabBar from './CircleTabBar.js';
import CircleScreenView from './CircleScreenView.js';
import CircleRecipeEditorScreen from './CircleRecipeEditorScreen.js';
import CircleScreensPickerScreen from './CircleScreensPickerScreen.js';

// B (circle bot) — host LLM route for NL→command in the kring. Mirrors web's VITE_CIRCLE_LLM_BASEURL
// + the feedback mobile EXPO_PUBLIC_FEEDBACK_LLM_BASEURL pattern. Unset → no provider → the LLM branch
// stays inert (slash commands + plain kring chat still work).
const CIRCLE_LLM_BASEURL = process.env.EXPO_PUBLIC_CIRCLE_LLM_BASEURL || null;
const CIRCLE_LLM_MODEL   = process.env.EXPO_PUBLIC_CIRCLE_LLM_MODEL || undefined;
const CIRCLE_BOT_NAME    = process.env.EXPO_PUBLIC_CIRCLE_BOT_NAME || 'assistant';
// Default circle posture (off|local|cloud|user); 'user' = each member's personal default decides.
const CIRCLE_LLM_POLICY  = process.env.EXPO_PUBLIC_CIRCLE_LLM_POLICY || 'user';

// D1 (§5A) — per-circle action-frequency counter behind the quickActions
// row.  Module singleton (shared across kring opens), hydrated once from
// AsyncStorage and persisting its snapshot on every bump.  In-memory reads
// work before hydration completes (just yield the default feature order).
const ACTION_FREQ_KEY = 'cc.actionFrequency';
const actionFrequency = createActionFrequencyStore({}, {
  onChange: (snap) => { AsyncStorage.setItem(ACTION_FREQ_KEY, JSON.stringify(snap)).catch(() => {}); },
});
AsyncStorage.getItem(ACTION_FREQ_KEY).then((raw) => {
  if (!raw) return;
  try {
    const snap = JSON.parse(raw);
    for (const [cid, counts] of Object.entries(snap ?? {})) {
      for (const [k, v] of Object.entries(counts ?? {})) {
        if (typeof v === 'number' && v > 0) actionFrequency.bump(cid, k, v);
      }
    }
  } catch { /* corrupt snapshot — ignore */ }
}).catch(() => {});

// D1 (§5A) — in-memory fallback recipe (just the Veel-gebruikt row) for a
// kring with no authored scherm.  Never persisted.
const DEFAULT_SCHERM_RECIPE = Object.freeze({
  id: '__default__', name: '', blocks: [{ id: 'qa-default', type: 'quickActions', config: { limit: 4 } }],
});

// Wrap a top-level surface (Kringen / Stroom / Mij) with the bottom tab bar.
function WithTabBar({ active, onSelect, children }) {
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>{children}</View>
      <CircleTabBar active={active} onSelect={onSelect} />
    </View>
  );
}

export default function CircleLauncherScreen({
  bundle,
  eventLog,
  kringRecipePendingStore = null,
  // γ-next.rules — per-kring pending-rules cache (AsyncStorage-backed,
  // owned by App.js).  Receiver writes; rules editor reads on mount +
  // clears after the γ.4 resolver applies / discards.
  kringRulesPendingStore = null,
  // γ-next.policy — per-kring pending-policy cache (AsyncStorage-backed,
  // owned by App.js).  Receiver writes; settings editor reads on mount +
  // clears after the γ.4 resolver applies / discards.  Completes the
  // γ-next trio (recipe / rules / policy).
  kringPolicyPendingStore = null,
}) {
  const [circles, setCircles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  // M3 — sub-view within the launcher: 'list' | 'availability' | 'detail'
  // | 'settings' | 'override'.  `selected` carries the active circle for
  // detail/settings/override.
  // α.3 — boot lands on the Schermen tab (Q6 primary).  Was 'list' (= Kringen).
  const [view, setView] = useState('screens');
  const [viewAsPolicy, setViewAsPolicy] = useState('pairwise');
  const [viewAsMembers, setViewAsMembers] = useState([]);
  const [folioFiles, setFolioFiles] = useState([]);
  const [skillDraft, setSkillDraft] = useState(null);
  const [rulesDoc, setRulesDoc] = useState(null);
  const [rulesPreview, setRulesPreview] = useState(null);
  // γ-next.rules — pending incoming rules doc (from peer broadcast).
  // Loaded when the rules screen opens; cleared after the γ.4 resolver
  // applies or discards.
  const [incomingRules, setIncomingRules] = useState(null);
  // γ-next.policy — pending incoming policy doc (from peer broadcast).
  // Loaded when the settings screen opens; cleared after the γ.4
  // resolver applies or discards.
  const [incomingPolicy, setIncomingPolicy] = useState(null);
  // α.1d.3 — recipe editor state (lives in the parent so book + mode
  // survive the BOOK ↔ RECIPE round-trip).  Callbacks land below
  // after recipeStore is declared.
  const [recipeBook, setRecipeBook] = useState({ recipes: [], activeId: null });
  const [recipeEditorMode, setRecipeEditorMode] = useState('book');
  const [recipeEditingId, setRecipeEditingId] = useState(null);
  // γ-next.recipe — pending incoming recipe (from peer broadcast).
  // Loaded when the recipe screen opens; cleared after γ.3 resolver
  // applies or discards.
  const [incomingRecipe, setIncomingRecipe] = useState(null);
  // α.3 — Screens-tab state.  Two sub-modes: 'picker' (CRUD list) +
  // 'view' (render the materialized active screen).  Book + blocks
  // live here so they survive sub-mode switches without refetching.
  const [screensBook, setScreensBook] = useState({ screens: [], activeId: null });
  const [screensSubMode, setScreensSubMode] = useState('picker');
  const [viewingScreenId, setViewingScreenId] = useState(null);
  const [screenViewBlocks, setScreenViewBlocks] = useState(null);
  // δ.1 — true while a fresh materialize runs after a cache-hit render.
  // Drives the subtle refresh pip in CircleScreenView.
  const [screenViewRefreshing, setScreenViewRefreshing] = useState(false);
  const [items, setItems] = useState([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  // P6.1 — selected circle's policy (loaded when `selected` changes); used
  // to gate detail action buttons on the Functies axis (board 4A).
  const [selectedPolicy, setSelectedPolicy] = useState(null);
  // P6.3 — kring tile activity preview ({subtitle, ts, unread} per circle)
  // + seenAt persistence (the per-circle "last-open" marker that drives the
  // unread badge).  Loaded on mount; bumped on openCircle.
  const [seenAt,   setSeenAt]   = useState({});
  const [previews, setPreviews] = useState({});
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('cc.circleSeenAt');
        if (alive && raw) setSeenAt(JSON.parse(raw) || {});
      } catch { /* fresh */ }
    })();
    return () => { alive = false; };
  }, []);
  // Recompute the previews map whenever events / circles / seenAt change.
  useEffect(() => {
    const events = eventLog?.query ? eventLog.query({ excludeMuted: true }) : [];
    setPreviews(buildTilePreviews({ events, circles, seenAt }));
  }, [eventLog, circles, seenAt]);
  // P6.2 #341 — per-circle voorstellen badge.  Populated lazily after
  // circles load; refresh after a settings save (CircleSettingsScreen
  // calls back through onPoll once it persists a new proposal).
  const [proposalCounts, setProposalCounts] = useState({});
  // P6.M7 #349 — Mijn dingen state lives here so the screen can render
  // synchronously when entered; `myThingsFiles` is loaded via listFiles.
  const [myThingsFiles, setMyThingsFiles] = useState([]);
  // P6.M8 #350 — raw Folio list result for share-toggle re-projection.
  const [rawFolioFiles, setRawFolioFiles] = useState(null);

  // P6.1 — refresh the selected circle's policy whenever `selected` changes,
  // so CircleDetail can gate its feature-bound buttons (houseRules,
  // memberDirectory).  Falls back to null on read failure → the helper
  // applies feature defaults.
  useEffect(() => {
    if (!selected?.id) { setSelectedPolicy(null); return; }
    let alive = true;
    (async () => {
      let p = null;
      try { p = await policyStore.get(selected.id); } catch { /* defaults */ }
      if (alive) setSelectedPolicy(p);
    })();
    return () => { alive = false; };
  }, [selected, policyStore]);

  // 5.9c — passive "Nearby N device(s)" signal from MdnsTransport.  When the
  // bundle exposes mdns we mirror its connectionCount into state, subscribed
  // to peer-discovered + peer-disconnected so the row updates as peers come
  // and go.  When bundle.mdns is null (vitest, iOS, Expo Go, Wi-Fi off) the
  // row hides via the `bundle?.mdns` gate at render time.
  const [nearbyCount, setNearbyCount] = useState(0);
  useEffect(() => {
    const mdns = bundle?.mdns;
    if (!mdns) return;
    const sync = () => {
      const n = mdns.connectionCount;
      setNearbyCount(typeof n === 'number' ? n : 0);
    };
    sync();
    mdns.on?.('peer-discovered',   sync);
    mdns.on?.('peer-disconnected', sync);
    return () => {
      mdns.off?.('peer-discovered',   sync);
      mdns.off?.('peer-disconnected', sync);
    };
  }, [bundle]);

  // M3 — AsyncStorage-backed circle stores (keys match web's localStorage
  // convention).  Created once; the sub-screens load/save through them.
  const policyStore       = useMemo(() => makeCirclePolicyStoreRN(AsyncStorage), []);
  const overrideStore     = useMemo(() => makeMemberOverrideStoreRN(AsyncStorage), []);
  const availabilityStore = useMemo(() => makeAvailabilityStoreRN(AsyncStorage), []);
  // P6.2 — multi-admin proposal store.  Settings consults this to persist
  // pending consensus proposals + commit on unanimous approval.
  const proposalStore     = useMemo(() => makeProposalStoreRN(AsyncStorage), []);
  // α.1e — per-kring scherm recipe book (multi-recipe; one marked active).
  const recipeStore       = useMemo(() => makeKringRecipeStoreRN(AsyncStorage), []);
  // α.3 — per-user screens store.  One book per user.
  const userScreenStore   = useMemo(() => makeUserScreenStoreRN(AsyncStorage), []);
  // δ.1 — per-screen materialized-blocks cache (cache-first render +
  // background refresh).  Instantiated inline rather than threaded
  // through App.js as a ref because this cache is purely a UI optimisation
  // owned by the Schermen tab; no peer-receiver writes to it from outside.
  const screenBlocksCache = useMemo(() => makeScreenBlocksCacheRN(AsyncStorage), []);
  // β.5 — per-user "pin to top" store + cached maps.  Pin = float a tile
  // to the top of its kind section; mute = per-kring `chatOff` override
  // already exposed via the override store (no new substrate).  Menu =
  // `menuCircle` is the circle whose context menu is open (null when
  // closed).
  const pinStore          = useMemo(() => makeCirclePinStoreRN(AsyncStorage), []);
  // γ.2 — per-circle rules store (replaces inline AsyncStorage in the
  // rules screen handlers).  Snapshots every save into a versions slot.
  const rulesStore        = useMemo(() => makeCircleRulesStoreRN(AsyncStorage), []);
  const [pinnedMap, setPinnedMap] = useState({});
  const [mutedMap,  setMutedMap]  = useState({});
  const [menuCircle, setMenuCircle] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try { const m = await pinStore.get(); if (alive) setPinnedMap(m); }
      catch { /* keep {} */ }
    })();
    return () => { alive = false; };
  }, [pinStore]);
  // Refresh the muted-map whenever the circle list changes; reads
  // each circle's override and surfaces chatOff===true as "muted".
  const refreshMutedMap = useCallback(async () => {
    const next = {};
    for (const c of circles) {
      try {
        const o = await overrideStore.get(c.id);
        if (o?.chatOff) next[c.id] = true;
      } catch { /* skip */ }
    }
    setMutedMap(next);
  }, [circles, overrideStore]);
  useEffect(() => { refreshMutedMap(); }, [refreshMutedMap]);
  // α.1d.3 — recipe-editor helpers (defined here so recipeStore is in scope).
  const refreshRecipeBook = useCallback(async (cid) => {
    if (!cid) return;
    try { setRecipeBook(await recipeStore.get(cid)); }
    catch { setRecipeBook({ recipes: [], activeId: null }); }
  }, [recipeStore]);
  const applyRecipeMutation = useCallback(async (cid, mutator) => {
    if (!cid) return;
    let nextBook = null;
    try {
      nextBook = await recipeStore.update(cid, mutator);
      setRecipeBook(nextBook);
    } catch (err) { console.warn('[recipe] mutation failed:', err?.message ?? err); }
    // γ-next.recipe — fan the just-updated active recipe out to peers.
    // Fire-and-forget; per-peer errors land in result.errors which we
    // log.  No-op when callSkill / no agent / no active recipe.
    if (!nextBook || typeof bundle?.callSkill !== 'function') return;
    const active = nextBook.recipes?.find?.((r) => r.id === nextBook.activeId);
    if (!active) return;
    const msgId = `kring-recipe-${cid}-${Date.now()}`;
    const ts    = Date.now();
    bundle.callSkill('stoop', 'broadcastKringRecipe', {
      groupId: cid, recipe: active, msgId, ts,
    }).then((r) => {
      if (r?.error) console.warn('[kring-recipe] fan-out skipped:', r.error);
    }).catch((err) => {
      console.warn('[kring-recipe] fan-out failed:', err?.message ?? err);
    });
  }, [recipeStore, bundle]);

  // γ-next.recipe — pull cached pending recipe whenever the recipe
  // editor view opens for a selected circle.  γ.3's resolver runs
  // automatically from inside the editor when incomingRecipe is
  // non-null + diverges from local.
  useEffect(() => {
    if (view !== 'recipes' || !selected?.id || !kringRecipePendingStore) {
      setIncomingRecipe(null);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const cached = await kringRecipePendingStore.get(selected.id);
        if (alive) setIncomingRecipe(cached ?? null);
      } catch { if (alive) setIncomingRecipe(null); }
    })();
    return () => { alive = false; };
  }, [view, selected, kringRecipePendingStore]);

  // γ-next.recipe — clear the cached pending recipe after the γ.3
  // resolver applies or discards.  Both paths route through here so
  // a fresh broadcast can land in the slot again.
  const clearIncomingRecipe = useCallback(async () => {
    setIncomingRecipe(null);
    if (selected?.id && kringRecipePendingStore) {
      try { await kringRecipePendingStore.clear(selected.id); } catch { /* ignore */ }
    }
  }, [selected, kringRecipePendingStore]);

  // γ-next.rules — pull cached pending rules doc whenever the rules
  // screen opens for a selected circle.  γ.4's resolver runs
  // automatically from inside the screen when incomingRules is
  // non-null + diverges from local.
  useEffect(() => {
    if (view !== 'rules' || !selected?.id || !kringRulesPendingStore) {
      setIncomingRules(null);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const cached = await kringRulesPendingStore.get(selected.id);
        if (alive) setIncomingRules(cached ?? null);
      } catch { if (alive) setIncomingRules(null); }
    })();
    return () => { alive = false; };
  }, [view, selected, kringRulesPendingStore]);

  // γ-next.rules — clear the cached pending rules after the γ.4
  // resolver applies or discards.  Both paths route through here so
  // a fresh broadcast can land in the slot again.
  const clearIncomingRules = useCallback(async () => {
    setIncomingRules(null);
    if (selected?.id && kringRulesPendingStore) {
      try { await kringRulesPendingStore.clear(selected.id); } catch { /* ignore */ }
    }
  }, [selected, kringRulesPendingStore]);

  // γ-next.policy — pull cached pending policy doc whenever the settings
  // screen opens for a selected circle.  γ.4's resolver runs
  // automatically from inside the screen when incomingPolicy is
  // non-null + diverges from local.
  useEffect(() => {
    if (view !== 'settings' || !selected?.id || !kringPolicyPendingStore) {
      setIncomingPolicy(null);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const cached = await kringPolicyPendingStore.get(selected.id);
        if (alive) setIncomingPolicy(cached ?? null);
      } catch { if (alive) setIncomingPolicy(null); }
    })();
    return () => { alive = false; };
  }, [view, selected, kringPolicyPendingStore]);

  // γ-next.policy — clear the cached pending policy after the γ.4
  // resolver applies or discards.  Both paths route through here so
  // a fresh broadcast can land in the slot again.
  const clearIncomingPolicy = useCallback(async () => {
    setIncomingPolicy(null);
    if (selected?.id && kringPolicyPendingStore) {
      try { await kringPolicyPendingStore.clear(selected.id); } catch { /* ignore */ }
    }
  }, [selected, kringPolicyPendingStore]);

  // α.3 — Screens helpers.
  const refreshScreensBook = useCallback(async () => {
    let book;
    try { book = await userScreenStore.get(); }
    catch { book = { screens: [], activeId: null }; }
    // First-run seed: three default screens (Stream, My things,
    // My calendar) so the Schermen tab is immediately useful.  Once
    // any screen exists we never re-seed.
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
    setScreensBook(book);
  }, [userScreenStore]);
  const applyScreenMutation = useCallback(async (mutator) => {
    try { setScreensBook(await userScreenStore.update(mutator)); }
    catch (err) { console.warn('[screens] mutation failed:', err?.message ?? err); }
  }, [userScreenStore]);
  // Refresh + materialize whenever we land on the screens view.
  useEffect(() => {
    if (view !== 'screens') return;
    refreshScreensBook();
  }, [view, refreshScreensBook]);
  useEffect(() => {
    if (view !== 'screens' || screensSubMode !== 'view' || !viewingScreenId) {
      setScreenViewBlocks(null);
      setScreenViewRefreshing(false);
      return;
    }
    const screen = screensBook.screens.find((s) => s.id === viewingScreenId);
    if (!screen) { setScreenViewBlocks([]); setScreenViewRefreshing(false); return; }
    // δ.1 — cache-first render: paint the last materialized payload
    // immediately so the press feels instant, then materialize fresh
    // in the background.  On a cache miss we keep the existing null →
    // Loading… → fresh flow.  `alive` doubles as the race-token: if
    // the user navigates away while materialize is in flight, drop
    // the result.
    let alive = true;
    (async () => {
      // Cache-first read.  Any failure → fall through to the cold path.
      let cached = null;
      try { cached = await screenBlocksCache.get(viewingScreenId); }
      catch { /* ignore */ }
      if (!alive) return;
      if (Array.isArray(cached)) {
        setScreenViewBlocks(cached);
        setScreenViewRefreshing(true);
      } else {
        setScreenViewBlocks(null);
        setScreenViewRefreshing(false);
      }
      try {
        const blocks = await materializeScreen({
          screen,
          hostOps: { callSkill, eventLog, circles },
        });
        if (!alive) return;
        setScreenViewBlocks(blocks);
        setScreenViewRefreshing(false);
        // Best-effort: write the fresh blocks back so the next open is
        // also instant.  Quota / serialisation failures are silent.
        screenBlocksCache.set(viewingScreenId, blocks).catch(() => { /* ignore */ });
      } catch (err) {
        console.warn('[screens] materialize failed:', err?.message ?? err);
        if (!alive) return;
        // Keep the cached payload visible on materialize failure rather
        // than blanking the screen; just stop the pip.  If there was no
        // cache to begin with, fall back to the empty array.
        setScreenViewRefreshing(false);
        if (!Array.isArray(cached)) setScreenViewBlocks([]);
      }
    })();
    return () => { alive = false; };
  }, [view, screensSubMode, viewingScreenId, screensBook, callSkill, eventLog, circles, screenBlocksCache]);

  const callSkill = useMemo(
    () => (bundle?.callSkill ? makeResolvingCallSkill(bundle.callSkill) : null),
    [bundle],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sources = callSkill
        ? circleSourcesFromAgent({ callSkill, circlesStore: bundle?.agent?.circlesStore })
        : {};
      setCircles(await loadCircles(sources));
    } catch {
      setCircles([]);
    } finally {
      setLoading(false);
    }
  }, [callSkill, bundle]);

  useEffect(() => { load(); }, [load]);

  // P6.2 #341 — refresh per-circle pending proposal counts whenever the
  // circle list changes.  countPending is async per circle; we tolerate
  // partial failures (a single bad circle just shows no badge).
  const refreshProposals = useCallback(async () => {
    const next = {};
    for (const c of circles) {
      try {
        const n = await proposalStore.countPending(c.id);
        if (n > 0) next[c.id] = n;
      } catch { /* skip this circle */ }
    }
    setProposalCounts(next);
  }, [circles, proposalStore]);
  useEffect(() => { refreshProposals(); }, [refreshProposals]);

  // P6.5 #342 — wire the claim-router hook once the bundle is ready.
  // On claimTask, the host hook reads the per-circle override; when
  // `flowThrough.tasksToPersonal` is true the claimed task is mirrored
  // into the user's primary crew ('cc-default') tagged `via:<circleId>`
  // so the "ON YOUR LIST" section below can surface it.  Web wires the
  // same hook from circleApp.js — keep this parallel.
  useEffect(() => {
    if (typeof bundle?.agent?.setAfterClaimHook !== 'function') return;
    bundle.agent.setAfterClaimHook(makeAfterClaimHook({
      getOverride:       (id) => overrideStore.get(id),
      resolveCircleName: async (id) => circles.find((c) => c.id === id)?.name ?? null,
      addToPersonalCrew: async ({ text, originCircleId, originCircleName, originTaskId, tag }) => {
        if (typeof bundle.callSkill !== 'function') return null;
        try {
          return await bundle.callSkill('tasks-v0', 'addTask', {
            text,
            crewId:           'cc-default',
            originCircleId,
            originCircleName,
            originTaskId,
            tags:             [tag],
          });
        } catch { return null; }
      },
    }));
    // Cleanup: clear the hook on unmount so a hot-reload doesn't
    // leave a stale closure pointing at the previous circles array.
    return () => {
      try { bundle.agent.setAfterClaimHook(null); } catch { /* tolerate */ }
    };
  }, [bundle, overrideStore, circles]);

  // P6.5 #342 — "ON YOUR LIST" tasks scoped to the selected circle.
  // Read from tasks-v0 `getMyTasks` and filter to the rows tagged with
  // `via:<circleId>` (set by the claim-router); falls back to empty on
  // any read failure.  Refreshed when `selected` changes.
  const [myListTasks, setMyListTasks] = useState([]);
  useEffect(() => {
    if (!selected?.id || !callSkill) { setMyListTasks([]); return; }
    let alive = true;
    (async () => {
      try {
        const res = await callSkill('getMyTasks', {});
        const items = Array.isArray(res?.items) ? res.items
          : Array.isArray(res?.tasks) ? res.tasks
          : Array.isArray(res) ? res : [];
        const wanted = `via:${selected.id}`;
        const filtered = items.filter((t) => Array.isArray(t?.tags) && t.tags.includes(wanted));
        if (alive) setMyListTasks(filtered);
      } catch {
        if (alive) setMyListTasks([]);
      }
    })();
    return () => { alive = false; };
  }, [selected, callSkill]);

  const openCircle = useCallback(async (c) => {
    setActiveCircle(c.id);
    // P6.3 — bump the seenAt marker so the unread badge clears on the
    // next launcher render; persist to AsyncStorage for next boot.
    setSeenAt((prev) => {
      const next = bumpSeenAt(prev, c.id);
      AsyncStorage.setItem('cc.circleSeenAt', JSON.stringify(next)).catch(() => {});
      return next;
    });
    // SP-13.1 — no chat-route fallback anymore.  Every tap-on-kring
    // opens the kring view (which will host the GESPREK tab in SP-13.2).
    setSelected(c);
    setView('detail');
    setItems([]);
    if (!callSkill) return;
    try {
      const got = await loadCircleItems({ callSkill, circleId: c.id });
      setSelected((cur) => { if (cur && cur.id === c.id) setItems(got); return cur; });
    } catch { /* keep empty */ }
  }, [callSkill]);

  const closeCircle = () => { setActiveCircle(null); setSelected(null); setItems([]); setView('list'); };

  // β.5 — context-menu handlers (long-press a tile to open).  Pin / Mute
  // are local toggles; Settings reuses the existing per-circle Settings
  // sub-screen; Leave fires /leave-group (via stoop.leaveGroup) after a
  // native Alert confirmation.
  const onPinCircle = useCallback(async (cid) => {
    try { setPinnedMap(await pinStore.toggle(cid)); }
    catch { /* tolerate */ }
  }, [pinStore]);

  const onMuteCircle = useCallback(async (cid) => {
    try {
      const cur = await overrideStore.get(cid);
      await overrideStore.update(cid, { chatOff: !cur.chatOff });
    } catch { /* tolerate */ }
    refreshMutedMap();
  }, [overrideStore, refreshMutedMap]);

  const onLeaveCircle = useCallback((cid, circle) => {
    const name = circle?.name ?? cid;
    Alert.alert(
      t('circle.tile.menu.leave'),
      t('circle.tile.menu.leave_confirm', { name }),
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: t('circle.tile.menu.leave'),
          style: 'destructive',
          onPress: async () => {
            if (typeof bundle?.callSkill === 'function') {
              try {
                await bundle.callSkill('stoop', 'leaveGroup', { groupId: cid });
              } catch (err) {
                console.warn('[circleLauncher] leaveGroup failed:', err?.message ?? err);
              }
            }
            // Reload circles + drop any pin entry.
            try {
              const cur = await pinStore.get();
              if (cur[cid]) setPinnedMap(await pinStore.toggle(cid));
            } catch { /* tolerate */ }
            load();
          },
        },
      ],
    );
  }, [bundle, pinStore, load]);

  // β.5 — long-press on a tile opens the modal menu.
  const openTileMenu = useCallback((circle) => {
    setMenuCircle(circle);
  }, []);
  const closeTileMenu = useCallback(() => setMenuCircle(null), []);

  // Android back-gesture / hardware back button — pop the current sub-view
  // instead of exiting the app.  Mirrors each screen's existing onBack
  // semantics (the in-screen back button still works the same way).
  // Returning `true` consumes the event; `false` lets the system handle
  // it (exits the app — only when we're at the launcher root + nothing
  // inline to cancel).
  useEffect(() => {
    const handler = () => {
      // β.5 — tile context menu open → close it.  Highest priority since
      // any subsequent state-based pop would feel wrong while the modal
      // is on top.
      if (menuCircle) { setMenuCircle(null); return true; }
      // Inline cancel: creating-circle input row.
      if (creating) { setCreating(false); setNewName(''); return true; }
      // α.3 — viewing a screen (Schermen tab "view" sub-mode) → back to
      // the picker (the screens-tab equivalent of returning from a
      // sub-view to the list).
      if (view === 'screens' && screensSubMode === 'view') {
        setScreensSubMode('picker'); setViewingScreenId(null); return true;
      }
      // Sub-views under a selected circle → back to detail.
      if (selected && (
        view === 'settings' || view === 'override' || view === 'viewas'
        || view === 'advisor' || view === 'skills' || view === 'folio'
        || view === 'rules'
      )) { setView('detail'); return true; }
      // Rules consent preview → back to rules editor.
      if (selected && view === 'rulesconsent') { setView('rules'); return true; }
      // Hop screen lives under the Mij tab.
      if (view === 'hop') { setView('availability'); return true; }
      // Top-level tab screens → back to launcher list.
      if (view === 'availability' || view === 'stream'
          || view === 'nearby' || view === 'mythings') {
        setView('list'); return true;
      }
      // Circle detail → close the circle (back to launcher list).
      if (selected) { closeCircle(); return true; }
      // SP-13.1 — no onBack fallback (no chat shell to fall back to);
      // at the launcher root, let the system handle (exit).
      return false;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', handler);
    return () => sub.remove();
  }, [view, selected, creating, menuCircle, screensSubMode]);

  // Bottom tab bar (Screens / Kringen / Mij).  α.3 — Schermen is the
  // new primary; Stroom is retired (now lives as the seeded "Stream"
  // screen on the Screens tab).
  const onTab = (id) => {
    if (id === 'screens') setView('screens');
    else if (id === 'kringen') { setActiveCircle(null); setSelected(null); setView('list'); }
    else if (id === 'mij') setView('availability');
  };

  const submitCreate = useCallback(async () => {
    const name = newName.trim();
    if (!name || !bundle?.callSkill) { setCreating(false); setNewName(''); return; }
    try {
      await quickCreateCircle({ callSkill: bundle.callSkill, name });
    } catch { /* surfaced by reload showing no new circle */ }
    setCreating(false);
    setNewName('');
    load();
  }, [newName, bundle, load]);

  if (view === 'screens') {
    // α.3 — Screens primary tab.  Two sub-modes: 'picker' (CRUD list)
    // and 'view' (render the active screen's materialized blocks).
    if (screensSubMode === 'view') {
      const screen = screensBook.screens.find((s) => s.id === viewingScreenId);
      return (
        <WithTabBar active="screens" onSelect={onTab}>
          <View style={{ flex: 1, padding: 16, backgroundColor: theme.color.paper }}>
            <Pressable
              onPress={() => { setScreensSubMode('picker'); setViewingScreenId(null); }}
              accessibilityRole="button"
              testID="screens-view-back"
            >
              <Text style={{ color: theme.color.inkSoft, fontSize: 13, marginBottom: 8 }}>
                ← {t('circle.screens.picker_title')}
              </Text>
            </Pressable>
            <Text style={{ fontFamily: theme.font.serif, fontSize: 22, fontWeight: '600', color: theme.color.ink, marginBottom: 12 }}>
              {screen?.name || t('circle.screens.untitled')}
            </Text>
            <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
              <CircleScreenView blocks={screenViewBlocks} refreshing={screenViewRefreshing} />
            </ScrollView>
          </View>
        </WithTabBar>
      );
    }
    return (
      <WithTabBar active="screens" onSelect={onTab}>
        <CircleScreensPickerScreen
          book={screensBook}
          onOpenScreen={(sid) => { setViewingScreenId(sid); setScreensSubMode('view'); }}
          onAddScreen={(name) => applyScreenMutation((cur) => {
            const next = addUserScreen(cur, name);
            const newId = next.screens[next.screens.length - 1].id;
            return updateScreen(next, newId, (s) => addBlock(s, 'noticeboard'));
          })}
          onRenameScreen={(sid, name) => applyScreenMutation((cur) => renameUserScreen(cur, sid, name))}
          onRemoveScreen={(sid) => applyScreenMutation((cur) => removeUserScreen(cur, sid))}
          onSetActive={(sid) => applyScreenMutation((cur) => setActiveScreen(cur, sid))}
        />
      </WithTabBar>
    );
  }
  if (view === 'availability') {
    return (
      <WithTabBar active="mij" onSelect={onTab}>
        <CircleAvailabilityScreen
          store={availabilityStore}
          onHop={() => setView('hop')}
        />
      </WithTabBar>
    );
  }
  if (view === 'stream') {
    return (
      <WithTabBar active="stroom" onSelect={onTab}>
        <CircleStreamScreen
          eventLog={eventLog}
          circles={circles}
          onOpenCircle={(id) => openCircle(circles.find((c) => c.id === id) || { id })}
        />
      </WithTabBar>
    );
  }
  if (selected && view === 'settings') {
    // γ-next.policy — broadcast cache → editor → γ.4 resolver.  The
    // resolver is opt-in; when `incomingPolicy` is null the editor
    // renders untouched.  Applied / discarded both clear the cache.
    //
    // Send-side: the settings editor owns the `store.update` call (so
    // proposal + commit paths route through one place); we wrap the
    // store here so a fresh update fans the post-save policy out to
    // peers via stoop's `broadcastKringPolicy`.  Fire-and-forget;
    // per-peer errors land in result.errors which we log.  No-op when
    // callSkill / no agent.
    const broadcastingStore = {
      ...policyStore,
      update: async (cid, next) => {
        const r = await policyStore.update(cid, next);
        if (next && typeof next === 'object' && typeof bundle?.callSkill === 'function') {
          const msgId = `kring-policy-${cid}-${Date.now()}`;
          const ts    = Date.now();
          bundle.callSkill('stoop', 'broadcastKringPolicy', {
            groupId: cid, policy: next, msgId, ts,
          }).then((res) => {
            if (res?.error) console.warn('[kring-policy] fan-out skipped:', res.error);
          }).catch((err) => {
            console.warn('[kring-policy] fan-out failed:', err?.message ?? err);
          });
        }
        return r;
      },
    };
    return (
      <CircleSettingsScreen
        store={broadcastingStore}
        proposalStore={proposalStore}
        circleId={selected.id}
        incomingPolicy={incomingPolicy}
        onIncomingApplied={clearIncomingPolicy}
        onIncomingDiscarded={clearIncomingPolicy}
        onBack={() => { refreshProposals(); setView('detail'); }}
      />
    );
  }
  if (selected && view === 'override') {
    return <CircleOverrideScreen store={overrideStore} circleId={selected.id} onBack={() => setView('detail')} />;
  }
  if (selected && view === 'viewas') {
    // F-5.1 — real member directory loaded in onViewAs via listGroupMembers.
    return <CircleViewAsScreen members={viewAsMembers} policy={viewAsPolicy} onBack={() => setView('detail')} />;
  }
  if (view === 'hop') {
    // Hopping lives under the Mij tab (personal settings).
    return <CircleHopScreen callSkill={callSkill} onBack={() => setView('availability')} />;
  }
  if (view === 'nearby') {
    // P6.8 #346 — Nearby/HIER screen.  Pulls peers from bundle.mdns when
    // wired; otherwise renders the empty-state copy from the substrate.
    const peers = bundle?.mdns?.peers ?? [];
    const model = buildNearbyModel({ peers, mySkills: [], t });
    return <NearbyScreen model={model} onBack={() => setView('list')} />;
  }
  if (view === 'mythings') {
    // P6.M7 #349 — Mijn dingen (private kring as notes-list, board 10A).
    return (
      <MyThingsScreen files={myThingsFiles} onBack={() => setView('list')} />
    );
  }
  if (selected && view === 'advisor') {
    return <CircleAdvisorScreen eventLog={eventLog} circleId={selected.id} onBack={() => setView('detail')} />;
  }
  if (selected && view === 'skills') {
    return (
      <CircleSkillEditorScreen
        skill={skillDraft}
        onSave={async (s) => {
          try { await AsyncStorage.setItem(`cc.circleSkill.${selected.id}`, JSON.stringify(s)); } catch { /* ignore */ }
          setSkillDraft(s);
          setView('detail');
        }}
        onBack={() => setView('detail')}
      />
    );
  }
  if (selected && view === 'folio') {
    // F-5.2 — real files loaded in onFiles via listFiles, scoped to the circle.
    return (
      <CircleFolioScreen
        files={folioFiles}
        rawFiles={rawFolioFiles}
        circleId={selected.id}
        myCircles={circles}
        onBack={() => setView('detail')}
      />
    );
  }
  if (selected && view === 'rules') {
    // γ-next.rules — broadcast cache → editor → γ.4 resolver.  The
    // resolver is opt-in; when `incomingRules` is null the screen
    // renders untouched.  Applied / discarded both clear the cache.
    return (
      <CircleRulesScreen
        doc={rulesDoc}
        incomingRules={incomingRules}
        rulesStore={rulesStore}
        circleId={selected.id}
        onIncomingApplied={clearIncomingRules}
        onIncomingDiscarded={clearIncomingRules}
        onBack={() => setView('detail')}
        onPreview={(working) => { setRulesPreview(working); setView('rulesconsent'); }}
        onSave={async (doc) => {
          // γ.2 — saves go through rulesStore so the versions adapter
          // snapshots the doc into cc.versions.rules.<id> before the
          // canonical write lands.
          try { await rulesStore.set(selected.id, doc); } catch { /* ignore */ }
          setRulesDoc(doc);
          // γ-next.rules — fan the just-saved rules doc out to peers.
          // Fire-and-forget; per-peer errors land in result.errors which
          // we log.  No-op when callSkill / no agent / no doc.
          if (doc && typeof bundle?.callSkill === 'function') {
            const msgId = `kring-rules-${selected.id}-${Date.now()}`;
            const ts    = Date.now();
            bundle.callSkill('stoop', 'broadcastKringRules', {
              groupId: selected.id, rulesDoc: doc, msgId, ts,
            }).then((r) => {
              if (r?.error) console.warn('[kring-rules] fan-out skipped:', r.error);
            }).catch((err) => {
              console.warn('[kring-rules] fan-out failed:', err?.message ?? err);
            });
          }
          setView('detail');
        }}
      />
    );
  }
  if (selected && view === 'rulesconsent') {
    // Preview from the editor: Agree/Decline just return (real join-flow consent is the follow-on).
    return (
      <CircleRulesConsentScreen
        doc={rulesPreview}
        onBack={() => setView('rules')}
        onAgree={() => setView('rules')}
        onDecline={() => setView('rules')}
      />
    );
  }
  if (selected && view === 'recipes') {
    // α.1d.3 — recipe editor (book ↔ recipe modes; persistence flows
    // through recipeStore via applyRecipeMutation).
    return (
      <CircleRecipeEditorScreen
        book={recipeBook}
        mode={recipeEditorMode}
        editingRecipeId={recipeEditingId}
        // γ-next.recipe — broadcast cache → editor → γ.3 resolver.
        incomingRecipe={incomingRecipe}
        recipeStore={recipeStore}
        circleId={selected.id}
        onIncomingApplied={clearIncomingRecipe}
        onIncomingDiscarded={clearIncomingRecipe}
        onBack={() => setView('detail')}
        onOpenRecipe={(rid) => { setRecipeEditingId(rid); setRecipeEditorMode('recipe'); }}
        onBackToBook={() => { setRecipeEditorMode('book'); setRecipeEditingId(null); }}
        onAddRecipe={(name) => applyRecipeMutation(selected.id, (cur) => addRecipe(cur, name))}
        onRenameRecipe={(rid, name) => applyRecipeMutation(selected.id, (cur) => renameRecipe(cur, rid, name))}
        onRemoveRecipe={(rid) => applyRecipeMutation(selected.id, (cur) => removeRecipe(cur, rid))}
        onSetActive={(rid) => applyRecipeMutation(selected.id, (cur) => setActiveRecipe(cur, rid))}
        onAddBlock={(rid, type) => applyRecipeMutation(selected.id, (cur) => updateRecipe(cur, rid, (r) => addBlock(r, type)))}
        onRemoveBlock={(rid, bid) => applyRecipeMutation(selected.id, (cur) => updateRecipe(cur, rid, (r) => removeBlock(r, bid)))}
        onMoveBlock={(rid, bid, idx) => applyRecipeMutation(selected.id, (cur) => updateRecipe(cur, rid, (r) => moveBlock(r, bid, idx)))}
        onUpdateBlock={(rid, bid, patch) => applyRecipeMutation(selected.id, (cur) => updateRecipe(cur, rid, (r) => updateBlock(r, bid, patch)))}
      />
    );
  }
  if (selected) {
    return (
      <CircleDetail
        circle={selected}
        items={items}
        callSkill={callSkill}
        catalog={bundle?.catalog}
        policy={selectedPolicy}
        myListTasks={myListTasks}
        eventLog={eventLog}
        circles={circles}
        recipeStore={recipeStore}
        onBack={closeCircle}
        onSettings={() => setView('settings')}
        onMine={() => setView('override')}
        onViewAs={async () => {
          const p = await policyStore.get(selected.id);
          setViewAsPolicy(p?.revealPolicy ?? 'pairwise');
          let mem = [];
          if (callSkill) {
            try { mem = normalizeCircleMembers(await callSkill('listGroupMembers', { groupId: selected.id })); } catch { /* keep empty */ }
          }
          setViewAsMembers(mem);
          setView('viewas');
        }}
        onAdvisor={() => setView('advisor')}
        onSkills={async () => {
          let raw = null;
          try { const s = await AsyncStorage.getItem(`cc.circleSkill.${selected.id}`); if (s) raw = JSON.parse(s); } catch { /* fresh */ }
          setSkillDraft(raw);
          setView('skills');
        }}
        onFiles={async () => {
          let fs = [];
          let raw = null;
          if (callSkill) {
            try {
              raw = await callSkill('listFiles', {});
              fs = circleFilesFromListFiles(raw, selected.id);
            } catch { /* keep empty */ }
          }
          setFolioFiles(fs);
          // P6.M8 #350 — keep the raw list so the share-toggle pills can
          // re-project without a refetch.  Unwrap to a plain array if the
          // result is wrapped (`{items}` / `{files}`).
          const rawArr = !raw ? null
            : Array.isArray(raw.items) ? raw.items
            : Array.isArray(raw.files) ? raw.files
            : Array.isArray(raw) ? raw : null;
          setRawFolioFiles(rawArr);
          setView('folio');
        }}
        onRules={async () => {
          // γ.2 — load via rulesStore (same on-disk key as before:
          // `cc.circleRules.<id>`).
          let doc = null;
          try { doc = await rulesStore.get(selected.id); } catch { /* fresh */ }
          setRulesDoc(doc);
          setView('rules');
        }}
        onRecipes={async () => {
          await refreshRecipeBook(selected.id);
          setRecipeEditorMode('book');
          setRecipeEditingId(null);
          setView('recipes');
        }}
      />
    );
  }

  return (
    <WithTabBar active="kringen" onSelect={onTab}>
      <View style={styles.page} testID="circle-launcher">
        {/* SP-13.1 — no "← chat" button (no chat shell to navigate to). */}
        <Text style={styles.title}>{t('circle.title')}</Text>

        {loading ? (
          <Text style={styles.muted}>{t('circle.loading')}</Text>
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            {bundle?.mdns ? (
              <View style={styles.nearbyRow} testID="circle-nearby">
                <Text style={styles.nearbyText}>
                  {formatNearbyLabel(nearbyCount, t)}
                </Text>
              </View>
            ) : null}

            {/* β.1 — Nearby + Mijn dingen launcher shortcuts removed.
                Nearby lives under the Mij tab; My-things is a seeded screen
                under the Schermen tab. */}
            {circles.length === 0 ? (
              <Text style={styles.muted}>{t('circle.empty')}</Text>
            ) : (
              renderLauncherGroups(circles, {
                previews, proposalCounts, openCircle,
                // β.5 — pin partition + long-press menu wiring.
                pinnedMap, mutedMap, onOpenMenu: openTileMenu,
              })
            )}

            {creating ? (
              <View style={styles.createRow}>
                <TextInput
                  style={styles.input}
                  value={newName}
                  onChangeText={setNewName}
                  placeholder={t('circle.new')}
                  autoFocus
                  onSubmitEditing={submitCreate}
                  returnKeyType="done"
                />
                <Pressable style={styles.createBtn} accessibilityRole="button" onPress={submitCreate}>
                  <Text style={styles.createBtnText}>✓</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                style={styles.newBtn}
                accessibilityRole="button"
                onPress={() => setCreating(true)}
              >
                <Text style={styles.newText}>{t('circle.new')}</Text>
              </Pressable>
            )}
          </ScrollView>
        )}
        {/* β.5 — per-tile context menu, rendered as a transparent modal
            so a tap outside the sheet dismisses it.  The four actions
            mirror web: pin (toggle), mute (toggle), settings, leave. */}
        <Modal
          transparent
          visible={!!menuCircle}
          animationType="fade"
          onRequestClose={closeTileMenu}
        >
          <Pressable
            style={styles.tileMenuBackdrop}
            onPress={closeTileMenu}
            testID="circle-launcher-tile-menu-backdrop"
          >
            <View style={styles.tileMenuSheet} testID="circle-launcher-tile-menu">
              {(() => {
                if (!menuCircle) return null;
                const cid = menuCircle.id;
                const isPinned = !!pinnedMap[cid];
                const isMuted  = !!mutedMap[cid];
                const items = [
                  {
                    key: 'pin',
                    label: t(isPinned ? 'circle.tile.menu.unpin' : 'circle.tile.menu.pin'),
                    onPress: () => { closeTileMenu(); onPinCircle(cid); },
                  },
                  {
                    key: 'mute',
                    label: t(isMuted ? 'circle.tile.menu.unmute' : 'circle.tile.menu.mute'),
                    onPress: () => { closeTileMenu(); onMuteCircle(cid); },
                  },
                  {
                    key: 'settings',
                    label: t('circle.tile.menu.settings'),
                    onPress: () => {
                      closeTileMenu();
                      setSelected(menuCircle);
                      setView('settings');
                    },
                  },
                  {
                    key: 'leave',
                    label: t('circle.tile.menu.leave'),
                    onPress: () => {
                      closeTileMenu();
                      onLeaveCircle(cid, menuCircle);
                    },
                  },
                ];
                return items.map((it) => (
                  <Pressable
                    key={it.key}
                    style={styles.tileMenuItem}
                    onPress={it.onPress}
                    accessibilityRole="button"
                    testID={`circle-launcher-tile-menu-${it.key}`}
                  >
                    <Text style={styles.tileMenuItemText}>{it.label}</Text>
                  </Pressable>
                ));
              })()}
            </View>
          </Pressable>
        </Modal>
      </View>
    </WithTabBar>
  );
}

// β.3 — fixed display order for kring-kind section headers; anything not in
// this list is bucketed under 'other' (last).  Mirrors web circleLauncher.js
// and the values produced by the create wizard + circleModel.normalizeCircle.
const KIND_ORDER = ['household', 'buurt', 'vriendenkring'];

/**
 * β.1+β.2+β.3+β.5 — render the kringen list:
 *   - β.2 sort by recent activity (preview.ts desc; stable name tiebreak)
 *   - β.5 partition into pinned + unpinned within each section (pins
 *     float to the top of their kind section without escaping it)
 *   - β.3 group by `kind` with section headers (KIND_ORDER then 'other');
 *     when all kringen share one kind, headers are skipped (flat list).
 */
function renderLauncherGroups(circles, {
  previews, proposalCounts, openCircle,
  pinnedMap = {}, mutedMap = {}, onOpenMenu,
}) {
  const sorted = [...circles].sort((a, b) => {
    const ta = previews?.[a.id]?.ts ?? 0;
    const tb = previews?.[b.id]?.ts ?? 0;
    if (tb !== ta) return tb - ta;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
  // β.5 — partition by pin BEFORE grouping so pinned tiles float to the
  // top of their kind section without escaping it.
  const pinned = sorted.filter((c) => pinnedMap[c.id]);
  const unpinned = sorted.filter((c) => !pinnedMap[c.id]);
  const ordered = [...pinned, ...unpinned];

  const groups = new Map();
  for (const c of ordered) {
    const k = KIND_ORDER.includes(c.kind) ? c.kind : 'other';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  const orderedKinds = [...KIND_ORDER, 'other'].filter((k) => groups.has(k));
  const showHeaders = orderedKinds.length > 1;
  if (!showHeaders) {
    return ordered.map((c) => (
      <LauncherTile
        key={c.id}
        circle={c}
        preview={previews?.[c.id]}
        pending={Number(proposalCounts?.[c.id]) || 0}
        isPinned={!!pinnedMap[c.id]}
        isMuted={!!mutedMap[c.id]}
        onOpen={openCircle}
        onLongPress={onOpenMenu}
      />
    ));
  }
  return orderedKinds.map((kind) => (
    <View key={`section-${kind}`} style={styles.section} testID={`circle-launcher-section-${kind}`}>
      <Text style={styles.sectionTitle}>{t(`circle.kind.${kind}`)}</Text>
      {groups.get(kind).map((c) => (
        <LauncherTile
          key={c.id}
          circle={c}
          preview={previews?.[c.id]}
          pending={Number(proposalCounts?.[c.id]) || 0}
          isPinned={!!pinnedMap[c.id]}
          isMuted={!!mutedMap[c.id]}
          onOpen={openCircle}
          onLongPress={onOpenMenu}
        />
      ))}
    </View>
  ));
}

/** Single kring tile (extracted in β.3 so grouped + flat paths share it). */
function LauncherTile({ circle: c, preview, pending, isPinned = false, isMuted = false, onOpen, onLongPress }) {
  const subtitle = (preview && preview.subtitle)
    ? preview.subtitle
    : (c.memberCount != null ? t('circle.members', { count: c.memberCount }) : null);
  const unread = preview?.unread ?? 0;
  return (
    <Pressable
      style={[styles.tile, isPinned && styles.tilePinned]}
      accessibilityRole="button"
      onPress={() => onOpen(c)}
      onLongPress={typeof onLongPress === 'function' ? () => onLongPress(c) : undefined}
      testID={`circle-tile-${c.id}`}
    >
      <View style={styles.tileBody}>
        <Text style={styles.tileName}>{c.name}</Text>
        {subtitle ? (
          <Text style={styles.tileMeta} numberOfLines={1}>{subtitle}</Text>
        ) : null}
      </View>
      {unread > 0 ? (
        <View
          style={styles.tileUnread}
          accessibilityLabel={t('circle.tile_unread', { count: unread })}
        >
          <Text style={styles.tileUnreadText}>{unread}</Text>
        </View>
      ) : null}
      {pending > 0 ? (
        <View
          style={styles.tileProposals}
          accessibilityLabel={t('circle.tile_proposals', { count: pending })}
          testID={`circle-tile-proposals-${c.id}`}
        >
          <Text style={styles.tileProposalsText}>{pending}</Text>
        </View>
      ) : null}
      {isPinned ? (
        <Text
          style={styles.tilePinIndicator}
          accessibilityElementsHidden
          testID={`circle-tile-pin-${c.id}`}
        >
          {'\u{1F4CC}'}
        </Text>
      ) : null}
      {/* Defensively reference `isMuted` so the tile component reads the
          prop (consumers visualize muted state via the menu's Unmute
          label; a tile-level dim is a follow-up polish). */}
      {isMuted ? null : null}
    </Pressable>
  );
}

// SP-13 — kring content view (board 2B / 8C).  Replaces the action-grid
// scaffolding as the per-circle landing surface.  Admin actions
// (Settings, Mine, ViewAs, …) collapse into a `⋯` overflow menu in the
// header, gated on the Functies axis (same gates the old grid used).
// B (circle bot) — a short kring-bubble text from a runDispatch reply. The kring stream renders plain
// chat bubbles (no rich cards), so commands surface as a one-line confirmation; the command's real
// effect (task added, etc.) propagates through the substrate to all members.
function circleReplyText(reply) {
  if (reply?.error) return t('circle.bot.failed', { msg: reply.error.message || '' });
  const p = reply?.payload;
  if (typeof p === 'string' && p.trim()) return p;
  if (p && typeof p.text === 'string' && p.text.trim()) return p.text;
  if (p && Array.isArray(p.items)) return t('circle.bot.listed', { n: p.items.length });
  return t('circle.bot.done');
}

function CircleDetail({
  circle, items, callSkill, catalog, policy, myListTasks = [],
  eventLog, circles = [],
  recipeStore = null,
  onBack, onSettings, onMine, onViewAs, onAdvisor, onSkills, onFiles, onRules, onRecipes,
}) {
  // P6.1 — Functies-axis gating for the overflow menu items.
  const showRules    = isFeatureEnabled(policy, 'houseRules');
  const showViewAs   = isFeatureEnabled(policy, 'memberDirectory');
  const showFiles    = isFeatureEnabled(policy, 'lists') || isFeatureEnabled(policy, 'notes');

  // SP-13.2 — kring stream rows scoped to this circle (chat-style).
  // EventLog has no subscribe seam yet; bumping `streamTick` after
  // local appends forces the memo to re-pull.
  const [streamTick, setStreamTick] = useState(0);
  const rows = useMemo(() => buildKringStream({
    events:    eventLog?.query ? eventLog.query({ excludeMuted: true }) : [],
    circles,
    circleId:  circle?.id ?? null,
  }), [eventLog, circles, circle?.id, streamTick]);

  // δ.2 — per-message delivery state.  Lives in a ref so the map is
  // stable across renders; we bump `deliveryTick` (a state value the
  // bubble render reads through `deliveryStateFor`) to force re-renders
  // when state flips.  The map itself isn't deps-tracked.
  const deliveryStateMapRef = useRef(null);
  if (deliveryStateMapRef.current == null) deliveryStateMapRef.current = createDeliveryStateMap();
  const [deliveryTick, setDeliveryTick] = useState(0);
  const deliveryStateFor = useCallback((msgId) => {
    // eslint-disable-next-line no-unused-expressions
    deliveryTick; // read tick so memoised consumers re-evaluate on bumps
    return deliveryStateMapRef.current.get(msgId);
  }, [deliveryTick]);
  const [composerText, setComposerText] = useState('');
  // SP-13.3 — per-kring bottom tabs derived from policy.features.
  const tabs = useMemo(() => buildKringTabs(policy, t), [policy]);
  const [activeTab, setActiveTab] = useState(DEFAULT_KRING_TAB);
  // Reset to GESPREK whenever we switch kringen so a non-default tab
  // doesn't persist across opens.
  useEffect(() => { setActiveTab(DEFAULT_KRING_TAB); }, [circle?.id]);

  // α.1e — materialized scherm blocks for the active recipe.  null
  // until the load below resolves; [] when the book is empty.
  // D1 — `screenReloadTick` bumps after a quickActions tap to re-rank.
  const [screenBlocks, setScreenBlocks] = useState(null);
  const [screenReloadTick, setScreenReloadTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setScreenBlocks(null);  // reset on circle change
    if (!recipeStore || !circle?.id) { setScreenBlocks([]); return () => { alive = false; }; }
    (async () => {
      try {
        const book = await recipeStore.get(circle.id);
        // D1 (§5A) — fall back to the quickActions-only default recipe so
        // every scherm leads with the Veel-gebruikt row.
        const active = getActiveRecipe(book) ?? DEFAULT_SCHERM_RECIPE;
        const blocks = await materializeRecipe({
          recipe:   active,
          circleId: circle.id,
          // D1 — policy + actionFrequency feed the quickActions block.
          hostOps:  { callSkill, eventLog, circles, policy, actionFrequency },
        });
        if (alive) setScreenBlocks(blocks);
      } catch (err) {
        console.warn('[CircleDetail] recipe load failed:', err?.message ?? err);
        if (alive) setScreenBlocks([]);
      }
    })();
    return () => { alive = false; };
  }, [recipeStore, circle?.id, callSkill, eventLog, circles, policy, screenReloadTick]);

  // SP-13.4 — Chat ↔ Scherm pill state (v2 §4 "De Schakelaar").
  // Per-circle preference persists in AsyncStorage at cc.circleViewMode.
  // §4 — until the member has flipped the pill for this kring, the
  // landing surface is the admin's policy.view front door
  // (defaultViewModeFromPolicy): 'screen' → scherm, else → chat.
  const [viewMode, setViewModeState] = useState(() => defaultViewModeFromPolicy(policy));
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!circle?.id) return;
      const fallback = defaultViewModeFromPolicy(policy);
      try {
        const raw = await AsyncStorage.getItem('cc.circleViewMode');
        const map = raw ? JSON.parse(raw) : {};
        const saved = map?.[circle.id];
        if (alive) setViewModeState(saved === 'scherm' || saved === 'chat' ? saved : fallback);
      } catch { if (alive) setViewModeState(fallback); }
    })();
    return () => { alive = false; };
  }, [circle?.id, policy]);
  const setViewMode = useCallback(async (mode) => {
    if (mode !== 'chat' && mode !== 'scherm') return;
    setViewModeState(mode);
    if (!circle?.id) return;
    try {
      const raw = await AsyncStorage.getItem('cc.circleViewMode');
      const map = raw ? JSON.parse(raw) : {};
      map[circle.id] = mode;
      await AsyncStorage.setItem('cc.circleViewMode', JSON.stringify(map));
    } catch { /* quota / disabled */ }
  }, [circle?.id]);

  // D1 (§5A) — a "Veel-gebruikt" pill tap: bump the feature's count, route
  // it (tab feature → switch to it in chat view; houseRules → rules panel),
  // then re-rank the row.  Mirrors the web onScreenAction.
  const onScreenAction = useCallback((featureKey) => {
    if (!circle?.id) return;
    actionFrequency.bump(circle.id, featureKey);
    if (featureKey === 'houseRules') { onRules?.(); }
    else {
      const tabId = featureTabId(featureKey);
      if (tabId) { setActiveTab(tabId); setViewMode('chat'); }
    }
    setScreenReloadTick((n) => n + 1);
  }, [circle?.id, onRules, setViewMode]);

  // δ.2 — fan-out helper used by both the initial send and the
  // tap-to-retry handler for failed bubbles.  Re-fires with the
  // SAME msgId so receiver-side dedup suppresses duplicates.
  const broadcastFanOut = useCallback(({ msgId, text, ts }) => {
    if (typeof callSkill !== 'function') return;
    deliveryStateMapRef.current.set(msgId, 'pending');
    setDeliveryTick((n) => n + 1);
    Promise.resolve()
      .then(() => callSkill('stoop', 'broadcastKringMessage', {
        groupId: circle.id, text, msgId, ts,
      }))
      .then((r) => {
        if (r?.error) {
          console.warn('[kring-chat] fan-out skipped:', r.error);
          deliveryStateMapRef.current.set(msgId, 'failed');
        } else if ((r?.errors?.length ?? 0) > 0) {
          console.info('[kring-chat] fan-out partial:', r);
          deliveryStateMapRef.current.set(msgId, 'failed');
        } else {
          deliveryStateMapRef.current.set(msgId, 'sent');
        }
        setDeliveryTick((n) => n + 1);
      })
      .catch((err) => {
        console.warn('[kring-chat] fan-out failed:', err?.message ?? err);
        deliveryStateMapRef.current.set(msgId, 'failed');
        setDeliveryTick((n) => n + 1);
      });
  }, [callSkill, circle?.id]);

  // SP-13.2.1 — append a kring chat bubble to the local eventLog (optimistic). Returns {msgId, ts}
  // so the caller can fan out the same id (receiver-side dedup suppresses any mirrored echo).
  const appendKringMessage = useCallback(({ actor, text, buttons }) => {
    if (!eventLog?.append || !circle?.id) return null;
    const msgId = `kring-${circle.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const ts    = Date.now();
    eventLog.append({
      id: msgId, ts, app: 'kring', type: 'chat-message', actor,
      payload: { circleId: circle.id, text, kind: 'chat-message', ...(buttons?.length ? { buttons } : {}) },
    });
    setStreamTick((n) => n + 1);
    return { msgId, ts };
  }, [eventLog, circle?.id]);

  // B (circle bot) — run a FULLY-RESOLVED command ({opId, args}) against the circle's catalog, scoped
  // to THIS circle, and post a one-line bot reply. Local-only (the command's substrate effect reaches
  // members on its own). Target resolution / ambiguity is handled upstream by the clarifying dispatch.
  const runCircleCommandResolved = useCallback(async ({ opId, args }) => {
    if (!catalog) { appendKringMessage({ actor: 'bot', text: t('circle.bot.unknown') }); return; }
    let dispatch;
    try {
      dispatch = resolveDispatch({ kind: 'slash', opId, args: args || {}, command: '(bot)', body: '' }, catalog);
    } catch { appendKringMessage({ actor: 'bot', text: t('circle.bot.unknown') }); return; }
    if (dispatch.kind === 'needsForm') { appendKringMessage({ actor: 'bot', text: t('circle.bot.needsInfo') }); return; }
    if (dispatch.kind !== 'ready')     { appendKringMessage({ actor: 'bot', text: t('circle.bot.unknown') }); return; }
    const scoped = scopeReadyDispatch(dispatch, { id: circle?.id });
    let reply;
    try { reply = await runDispatch(scoped, callSkill); }
    catch (e) { appendKringMessage({ actor: 'bot', text: t('circle.bot.failed', { msg: e?.message ?? String(e) }) }); return; }
    appendKringMessage({ actor: 'bot', text: circleReplyText(reply) });
  }, [catalog, callSkill, circle?.id, appendKringMessage]);

  // B (clarification) — candidate source for id-like params: the circle's own items (already loaded +
  // circle-scoped), so resolution stays confined to this circle. clarifyCommandTargets filters by label.
  const circleLookup = useCallback(() => (Array.isArray(items)
    ? items.map((it) => ({ id: String(it?.id ?? ''), label: String(it?.label ?? it?.title ?? it?.text ?? it?.id ?? '') }))
    : []), [items]);

  // B (clarification) — wraps dispatch: a unique target dispatches; an ambiguous one posts a bot
  // message with candidate BUTTONS (tapping → pick → re-run bound to that id); a missing one asks.
  const clarify = useMemo(() => createClarifyingDispatch({
    catalog: () => catalog,
    lookup: circleLookup,
    dispatchReady: runCircleCommandResolved,
    ask: ({ query, candidates }) => appendKringMessage({
      actor: 'bot',
      text: t('circle.clarify.which', { query }),
      buttons: candidates.map((c) => ({ id: c.id, label: c.hint ? `${c.label} — ${c.hint}` : c.label })),
    }),
    askMissing: ({ query }) => appendKringMessage({ actor: 'bot', text: t('circle.clarify.notFound', { query }) }),
  }), [catalog, circleLookup, runCircleCommandResolved, appendKringMessage]);

  // B — a tapped candidate button → bind the id + re-run (may resolve, or clarify a further param).
  const onBubbleButton = useCallback((button) => {
    if (button?.id) clarify.pick(button.id, { id: circle?.id });
  }, [clarify, circle?.id]);

  // B (two-level LLM policy) — the member's PERSONAL default, consulted when the circle policy is
  // 'user'. Persisted via AsyncStorage; seeded from the configured route until a settings UI lands
  // (a stored preference always wins once set).
  const [userLlmDefault, setUserLlmDefault] = useState({ mode: CIRCLE_LLM_BASEURL ? 'local' : 'off' });
  useEffect(() => {
    let alive = true;
    createUserLlmDefaultStore(asyncStorageUserLlmIo(AsyncStorage)).get()
      .then((v) => { if (alive && v && v.mode !== 'off') setUserLlmDefault(v); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // B (per-circle policy) — THIS circle's llmTool is authoritative (same cc.circlePolicy.<id> store the
  // settings screen writes). Unset → the deployment default CIRCLE_LLM_POLICY. Reloads per circle.
  const [circleLlmPolicy, setCircleLlmPolicy] = useState(CIRCLE_LLM_POLICY);
  useEffect(() => {
    let alive = true;
    if (!circle?.id) { setCircleLlmPolicy(CIRCLE_LLM_POLICY); return undefined; }
    AsyncStorage.getItem(`cc.circlePolicy.${circle.id}`)
      .then((s) => {
        if (!alive) return;
        let raw = null;
        try { raw = s ? JSON.parse(s) : null; } catch { raw = null; }
        setCircleLlmPolicy(raw && typeof raw.llmTool === 'string' ? raw.llmTool : CIRCLE_LLM_POLICY);
      })
      .catch(() => { if (alive) setCircleLlmPolicy(CIRCLE_LLM_POLICY); });
    return () => { alive = false; };
  }, [circle?.id]);

  // B (circle bot) — the kring composer router: slash command → dispatch; free text addressed to the
  // bot (when the circle's LLM route is on) → interpret → dispatch; everything else → normal kring
  // post (fan-out the already-echoed message). Shared core with web (createCircleDispatch).
  const circleBot = useMemo(() => createCircleDispatch({
    catalog,
    // Circle policy is authoritative (this circle's own llmTool); 'user' delegates to the member default.
    policy: { llmTool: circleLlmPolicy },
    userDefault: userLlmDefault,
    llmProviders: buildCircleLlmProviders({ localBaseUrl: CIRCLE_LLM_BASEURL, model: CIRCLE_LLM_MODEL }),
    interpret: interpretToCommand,
    botName: CIRCLE_BOT_NAME,
    // Deterministic pre-LLM gate: "add X" / "done X" / "claim X" route to the task op WITHOUT the
    // (unreliable) small-model tool pick; everything else falls through to interpret.
    gate: createTokenGate({ rules: defaultCircleGateRules() }),
    // A slash command is parsed to {opId,args}; the LLM already yields {opId,args}. Both then flow
    // through the clarifying dispatch (unique → run; ambiguous → ask with buttons).
    dispatch: (input) => {
      let cmd = input;
      if (typeof input === 'string') {
        const parsed = catalog ? parseInput(input, catalog) : null;
        cmd = parsed && parsed.kind === 'slash' && parsed.opId ? { opId: parsed.opId, args: parsed.args || {} } : null;
      }
      if (!cmd || !cmd.opId) { appendKringMessage({ actor: 'bot', text: t('circle.bot.unknown') }); return; }
      return clarify.run(cmd, { id: circle?.id });
    },
    postToKring: (text, ctx) => { if (ctx?.msgId) broadcastFanOut({ msgId: ctx.msgId, text, ts: ctx.ts ?? Date.now() }); },
  }), [catalog, clarify, circle?.id, appendKringMessage, broadcastFanOut, userLlmDefault, circleLlmPolicy]);

  // SP-13.2.1 / B — kring chat send: echo the user's message locally, then route it (command vs chat).
  const sendKringChat = useCallback(() => {
    const text = composerText.trim();
    if (!text || !eventLog?.append || !circle?.id) return;
    const appended = appendKringMessage({ actor: 'me', text });
    setComposerText('');
    circleBot.handle(text, { id: circle.id, msgId: appended?.msgId, ts: appended?.ts });
  }, [composerText, eventLog, circle?.id, appendKringMessage, circleBot]);

  // δ.2 — tap-to-retry on the failed icon.  Looks up the original
  // text from the eventLog so we don't have to remember it elsewhere.
  const onRetryDelivery = useCallback((msgId) => {
    if (!eventLog?.query) return;
    const evt = eventLog.query({ excludeMuted: true }).find((e) => e.id === msgId);
    const text = evt?.payload?.text;
    const ts   = evt?.ts ?? Date.now();
    if (typeof text !== 'string' || !text) return;
    broadcastFanOut({ msgId, text, ts });
  }, [eventLog, broadcastFanOut]);

  // 5.9d — Proof-of-Location placeholder.  Kept under the kring view as
  // a passive status; real attestation lands in [[5.9d-followup]].
  const [pol, setPol] = useState(null);
  useEffect(() => {
    let alive = true;
    if (!callSkill || !circle?.id) { setPol(null); return () => { alive = false; }; }
    (async () => {
      const status = await getCirclePolStatus({ callSkill, circleId: circle.id });
      if (alive) setPol(status);
    })();
    return () => { alive = false; };
  }, [callSkill, circle?.id]);

  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <View style={styles.page} testID="circle-detail">
      <View style={styles.bar}>
        <Pressable onPress={onBack} accessibilityRole="button">
          <Text style={styles.back}>{t('circle.back')}</Text>
        </Pressable>
        {/* SP-13.4 — Chat ↔ Scherm pill (v2 §4).
            React Native's accessibilityRole vocabulary doesn't include
            'group' (that's a web-only ARIA role).  The buttons inside
            carry their own role + accessibilityState; the wrapper just
            needs a label for screen-reader context. */}
        <View
          style={styles.viewToggle}
          accessibilityLabel={t('circle.kring.view_toggle_label')}
          testID="circle-detail-view-toggle"
        >
          {['chat', 'scherm'].map((mode) => (
            <Pressable
              key={mode}
              accessibilityRole="button"
              accessibilityState={{ selected: mode === viewMode }}
              testID={`circle-detail-view-${mode}`}
              onPress={() => { if (mode !== viewMode) setViewMode(mode); }}
              style={[styles.viewToggleBtn, mode === viewMode && styles.viewToggleBtnActive]}
            >
              <Text style={[styles.viewToggleText, mode === viewMode && styles.viewToggleTextActive]}>
                {t(`circle.kring.view_${mode}`)}
              </Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('circle.kring.more')}
          testID="circle-detail-more"
          onPress={() => setMenuOpen((v) => !v)}
          style={styles.moreBtn}
        >
          <Text style={styles.moreBtnText}>⋯</Text>
        </Pressable>
      </View>
      <Text style={styles.title}>{circle.name || circle.id}</Text>
      {circle.memberCount != null ? (
        <Text style={styles.tileMeta}>{t('circle.members', { count: circle.memberCount })}</Text>
      ) : null}

      {menuOpen ? (
        <View style={styles.moreMenu} testID="circle-detail-more-menu">
          <Pressable onPress={() => { setMenuOpen(false); onSettings?.(); }} style={styles.moreItem} testID="circle-detail-settings">
            <Text style={styles.moreItemText}>{t('circle.settings.title')}</Text>
          </Pressable>
          <Pressable onPress={() => { setMenuOpen(false); onMine?.(); }} style={styles.moreItem} testID="circle-detail-mine">
            <Text style={styles.moreItemText}>{t('circle.override.title')}</Text>
          </Pressable>
          <Pressable onPress={() => { setMenuOpen(false); onAdvisor?.(); }} style={styles.moreItem} testID="circle-detail-advisor">
            <Text style={styles.moreItemText}>{t('circle.advisor.title')}</Text>
          </Pressable>
          <Pressable onPress={() => { setMenuOpen(false); onSkills?.(); }} style={styles.moreItem} testID="circle-detail-skills">
            <Text style={styles.moreItemText}>{t('circle.skills.editor_title')}</Text>
          </Pressable>
          {showViewAs ? (
            <Pressable onPress={() => { setMenuOpen(false); onViewAs?.(); }} style={styles.moreItem} testID="circle-detail-viewas">
              <Text style={styles.moreItemText}>{t('circle.viewAs.title')}</Text>
            </Pressable>
          ) : null}
          {showFiles ? (
            <Pressable onPress={() => { setMenuOpen(false); onFiles?.(); }} style={styles.moreItem} testID="circle-detail-files">
              <Text style={styles.moreItemText}>{t('circle.folio.title')}</Text>
            </Pressable>
          ) : null}
          {showRules ? (
            <Pressable onPress={() => { setMenuOpen(false); onRules?.(); }} style={styles.moreItem} testID="circle-detail-rules">
              <Text style={styles.moreItemText}>{t('circle.rules.title')}</Text>
            </Pressable>
          ) : null}
          {/* α.1d.3 — recipe editor entry (scherm-mode page composition). */}
          <Pressable onPress={() => { setMenuOpen(false); onRecipes?.(); }} style={styles.moreItem} testID="circle-detail-recipes">
            <Text style={styles.moreItemText}>{t('circle.recipe.editor.book_title')}</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.polRow} testID="circle-detail-pol">
        <Text style={styles.polLabel}>{t('circle.pol.title')}</Text>
        <Text style={styles.polValue}>{formatPolStatus(pol, t)}</Text>
      </View>
      {myListTasks.length > 0 ? (
        <View style={styles.onYourList} testID="circle-detail-on-your-list">
          <Text style={styles.onYourListTitle}>{t('circle.on_your_list')}</Text>
          {myListTasks.map((task) => (
            <View key={task.id} style={styles.onYourListRow}>
              <Text style={styles.onYourListText} numberOfLines={2}>
                {task.text || task.title || task.label || String(task.id ?? '')}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* SP-13.3 — body switches by active tab.  GESPREK = chat-style
          mixed stream; other tabs are placeholders until their content
          surfaces land in follow-up slices.
          SP-13.4 — scherm-mode wins over the tab body: the whole pane
          becomes the (placeholder) recept'd page. */}
      <ScrollView contentContainerStyle={styles.list} testID="circle-detail-stream">
        {viewMode === 'scherm' ? (
          // α.1e — render the materialized recipe blocks.  CircleScreenView
          // handles per-block status (ok / empty / error) + top-level
          // empty-state when no recipe is set up yet.
          <CircleScreenView blocks={screenBlocks} onAction={onScreenAction} />
        ) : activeTab !== 'gesprek' ? (
          <Text style={styles.placeholder}>
            {t('circle.kring.tab_coming', { tab: t(`circle.tabs.${activeTab}`) })}
          </Text>
        ) : rows.length === 0 ? (
          <Text style={styles.muted}>{t('circle.kring.empty')}</Text>
        ) : (
          renderBubblesWithDayDividers(rows, t, {
            deliveryStateFor,
            localActor: 'me',
            onRetryDelivery,
            onBubbleButton,
          })
        )}
      </ScrollView>

      {/* SP-13.2 — inline composer.  V0 appends a chat-message event to
          the local EventLog so the user sees their own write; peer
          broadcast lands in SP-13.2.1.  Slash commands stay as a
          deeper follow-up (would need the chat-shell composition).
          SP-13.4 — composer suppressed in scherm-mode (recept page is
          not a chat surface). */}
      {viewMode !== 'scherm' ? (
      <View style={styles.composer} testID="circle-detail-composer">
        <TextInput
          style={styles.composerInput}
          value={composerText}
          onChangeText={setComposerText}
          placeholder={t('circle.kring.composer_placeholder')}
          accessibilityLabel={t('circle.kring.composer_placeholder')}
          returnKeyType="send"
          onSubmitEditing={sendKringChat}
        />
        <Pressable
          style={styles.composerSend}
          accessibilityRole="button"
          accessibilityLabel={t('circle.kring.send')}
          testID="circle-detail-composer-send"
          onPress={sendKringChat}
        >
          <Text style={styles.composerSendText}>↑</Text>
        </Pressable>
      </View>
      ) : null}

      {/* SP-13.3 — per-kring bottom tab bar (derived from policy.features).
          Only renders when there are ≥ 2 tabs (a single-tab kring has
          nothing to switch between).
          SP-13.4 — also suppress in scherm-mode. */}
      {tabs.length >= 2 && viewMode !== 'scherm' ? (
        <View style={styles.kringTabs} testID="circle-detail-tabs">
          {tabs.map((tab) => (
            <Pressable
              key={tab.id}
              accessibilityRole="button"
              testID={`circle-detail-tab-${tab.id}`}
              onPress={() => {
                if (tab.id === activeTab) return;
                setActiveTab(tab.id);
                // D1 — count tab use so the Veel-gebruikt row reflects reality.
                const f = featureForTabId(tab.id);
                if (f && circle?.id) actionFrequency.bump(circle.id, f);
              }}
              style={[styles.kringTab, tab.id === activeTab && styles.kringTabActive]}
            >
              <Text style={[styles.kringTabText, tab.id === activeTab && styles.kringTabTextActive]}>
                {tab.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// SP-13.2 — render rows chronologically with day-dividers, mirroring
// the web circleKring renderer.  Keeps the mobile parity tight.
// δ.2 — `deliveryOpts` carries the per-message delivery-state hooks
// for locally-sent bubbles (clock / warning + tap-to-retry).
function renderBubblesWithDayDividers(rows, t, deliveryOpts = null) {
  const chronological = [...rows].reverse();
  const nodes = [];
  let lastKey = null;
  for (const row of chronological) {
    const key = dayKeyOf(row.ts);
    if (key !== lastKey) {
      nodes.push(
        <Text key={`d-${row.id}`} style={styles.dayDivider}>
          {formatDayLabel(row.ts, t)}
        </Text>,
      );
      lastKey = key;
    }
    nodes.push(renderBubble(row, t, deliveryOpts));
  }
  return nodes;
}

function renderBubble(row, t, deliveryOpts = null) {
  const payload = row.event?.payload ?? {};
  const text = payload.text || payload.title || payload.body || String(row.id ?? '');
  const sender = payload.senderDisplay || payload.authorName || row.actor || null;
  const kindRaw = payload.kind;
  const kind = (typeof kindRaw === 'string' && kindRaw && kindRaw !== 'message' && kindRaw !== 'chat-message')
    ? kindRaw.toUpperCase() : null;
  const actions = actionsForStreamRow(row);
  // B (clarification) — per-message candidate buttons carried in the payload (e.g. "which item?").
  const msgButtons = Array.isArray(payload.buttons) ? payload.buttons : [];
  const onBubbleButton = typeof deliveryOpts?.onBubbleButton === 'function' ? deliveryOpts.onBubbleButton : null;
  // δ.2 — delivery-state icon for locally-sent chat messages only.
  // Mirrors web circleKring renderer's gate.
  const deliveryStateFor = typeof deliveryOpts?.deliveryStateFor === 'function'
    ? deliveryOpts.deliveryStateFor : null;
  const localActor      = deliveryOpts?.localActor ?? null;
  const onRetryDelivery = typeof deliveryOpts?.onRetryDelivery === 'function'
    ? deliveryOpts.onRetryDelivery : null;
  const isLocalChat = deliveryStateFor != null
    && localActor != null
    && row?.actor === localActor
    && (row?.type === 'chat-message' || row?.event?.type === 'chat-message');
  const deliveryState = isLocalChat ? deliveryStateFor(row.id) : null;
  return (
    <View key={row.id} style={styles.bubble} testID={`kring-bubble-${row.id}`}>
      {sender ? <Text style={styles.bubbleSender}>{sender}</Text> : null}
      <Text style={styles.bubbleText} numberOfLines={4}>
        {kind ? (<Text style={styles.bubbleKind}>{kind}  </Text>) : null}
        {text}
      </Text>
      {actions.length > 0 ? (
        <View style={styles.rowActions}>
          {actions.map((a) => (
            <Pressable
              key={a.id}
              style={styles.rowActionBtn}
              onPress={() => console.info('[kring] action', a.action, row.id)}
            >
              <Text style={styles.rowActionText}>{t(a.label)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {msgButtons.length > 0 ? (
        <View style={styles.rowActions}>
          {msgButtons.map((b) => (
            <Pressable
              key={b.id}
              style={styles.rowActionBtn}
              accessibilityRole="button"
              testID={`kring-msgbtn-${b.id}`}
              onPress={() => { if (onBubbleButton) onBubbleButton(b); }}
            >
              <Text style={styles.rowActionText}>{b.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {deliveryState === 'pending' ? (
        <Text
          style={styles.deliveryPending}
          accessibilityLabel={t('circle.chat.delivery.pending')}
          accessibilityRole="text"
          testID={`kring-delivery-pending-${row.id}`}
        >
          ⏱ {t('circle.chat.delivery.pending')}
        </Text>
      ) : null}
      {deliveryState === 'failed' ? (
        <Pressable
          style={styles.deliveryFailed}
          accessibilityRole="button"
          accessibilityLabel={t('circle.chat.delivery.failed')}
          testID={`kring-delivery-failed-${row.id}`}
          onPress={() => { if (onRetryDelivery) onRetryDelivery(row.id); }}
        >
          <Text style={styles.deliveryFailedText}>
            ⚠ {t('circle.chat.delivery.failed')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function dayKeyOf(ts) {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return 'unknown';
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
function formatDayLabel(ts, t) {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return '';
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const yest = new Date(today); yest.setDate(today.getDate() - 1);
  const isYest = d.toDateString() === yest.toDateString();
  if (sameDay) return t('circle.kring.day_today');
  if (isYest)  return t('circle.kring.day_yesterday');
  return d.toLocaleDateString();
}

// P6.8 #346 — Nearby/HIER screen.  Renders the buildNearbyModel output:
// peer rows with shared-skills + proximity, header line, and an own-profile
// footer.  Self-contained so vitest can target it without RN test renderer.
function NearbyScreen({ model, onBack }) {
  const rows       = Array.isArray(model?.rows) ? model.rows : [];
  const own        = model?.ownProfile ?? {};
  const headerText = model?.headerLabel ?? '';
  return (
    <View style={styles.page} testID="circle-nearby-screen">
      <View style={styles.bar}>
        <Pressable onPress={onBack} accessibilityRole="button" testID="circle-nearby-back">
          <Text style={styles.back}>{t('circle.back')}</Text>
        </Pressable>
      </View>
      <Text style={styles.title}>{t('circle.nearbyScreen.title')}</Text>
      <Text style={styles.muted}>{headerText}</Text>
      {rows.length === 0 ? (
        <Text style={styles.muted}>{t('circle.nearbyScreen.header_empty')}</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {rows.map((row) => (
            <View
              key={row.id || row.pseudonym}
              style={styles.row}
              testID={`nearby-row-${row.id || row.pseudonym}`}
            >
              <Text style={styles.rowName}>{row.pseudonym}</Text>
              {row.sharedSkills.length ? (
                <Text style={styles.rowMeta}>{row.sharedSkills.join(', ')}</Text>
              ) : null}
              {row.proximity ? <Text style={styles.rowMeta}>{row.proximity}</Text> : null}
            </View>
          ))}
        </ScrollView>
      )}
      <View style={styles.ownProfile}>
        <Text style={styles.ownProfileTitle}>{t('circle.nearbyScreen.own_profile')}</Text>
        <Text style={styles.muted}>
          {Array.isArray(own.publishedSkills) && own.publishedSkills.length
            ? own.publishedSkills.join(', ')
            : t('circle.nearbyScreen.own_profile_empty')}
        </Text>
      </View>
    </View>
  );
}

// P6.M7 #349 — Mijn dingen notes-list (board 10A): the Folio screen
// scoped to the private kring.  Empty state by default; rows fill in
// when callSkill('listFiles') returns mine-and-circle-less items.
function MyThingsScreen({ files = [], onBack }) {
  return (
    <View style={styles.page} testID="circle-mythings">
      <View style={styles.bar}>
        <Pressable onPress={onBack} accessibilityRole="button" testID="circle-mythings-back">
          <Text style={styles.back}>{t('circle.back')}</Text>
        </Pressable>
      </View>
      <Text style={styles.title}>{t('circle.folio.my_things_title')}</Text>
      {files.length === 0 ? (
        <Text style={styles.muted}>{t('circle.folio.my_things_empty')}</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {files.map((file) => (
            <View key={file.id} style={styles.row} testID={`mythings-row-${file.id}`}>
              <Text style={styles.rowName}>{file.name}</Text>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page:       { flex: 1, paddingHorizontal: 16, paddingTop: 12, backgroundColor: theme.color.paper },
  bar:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 22 },
  back:       { fontSize: 13, color: theme.color.inkSoft },
  barActions: { flexDirection: 'row', gap: 14, marginLeft: 'auto' },
  availText:  { fontSize: 13, color: theme.color.inkSoft, fontWeight: '600' },
  detailActions:   { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8, marginBottom: 6 },
  // 5.9c — passive Nearby row at the top of the kringen list.
  nearbyRow:       { paddingHorizontal: 2, paddingVertical: 6, marginBottom: 2 },
  nearbyText:      { fontSize: 12, color: theme.color.inkSoft, fontStyle: 'italic' },
  // 5.9d — passive Proof-of-Location row (placeholder; not tappable).
  polRow:          { flexDirection: 'row', gap: 6, alignItems: 'baseline', marginTop: 4, marginBottom: 8, paddingHorizontal: 2 },
  polLabel:        { fontSize: 12, color: theme.color.inkSoft, fontWeight: '600' },
  polValue:        { fontSize: 12, color: theme.color.inkSoft, fontStyle: 'italic' },
  detailAction:    { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1, borderColor: theme.color.line, backgroundColor: theme.color.card },
  detailActionText: { fontSize: 12, color: theme.color.inkSoft },
  title:      { fontSize: 24, fontWeight: '600', fontFamily: theme.font.serif, color: theme.color.ink, marginVertical: 10 },
  list:       { gap: 6, paddingBottom: 32 },
  // β.3 — per-kind grouping in the launcher (small-caps muted header,
  // matches the web `.circle-launcher__section-title` look).
  section:        { marginTop: 10, gap: 6 },
  sectionTitle:   { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.2, color: theme.color.inkSoft, marginBottom: 4, paddingHorizontal: 2 },
  tile:       { padding: 13, borderWidth: 1, borderColor: theme.color.line, borderRadius: 8, backgroundColor: theme.color.card, flexDirection: 'row', alignItems: 'center', gap: 10, position: 'relative' },
  // β.5 — pinned tile gets the accent border + the 📌 indicator in the
  // top-right corner so users see "this floated to the top on purpose".
  tilePinned:        { borderColor: theme.color.accent },
  tilePinIndicator:  { position: 'absolute', top: 4, right: 8, fontSize: 11, opacity: 0.7 },
  tileBody:   { flex: 1, minWidth: 0 },
  tileName:   { fontSize: 14, fontWeight: '600', color: theme.color.ink },
  tileMeta:   { fontSize: 11, color: theme.color.inkSoft, marginTop: 2 },
  // P6.3 — unread badge on the tile (board 5A).
  tileUnread: {
    minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11,
    backgroundColor: theme.color.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  tileUnreadText: { color: theme.color.white, fontSize: 12, fontWeight: '700' },
  // P6.2 #341 — pending voorstellen badge (uses a yellow-ish hint to
  // separate it visually from the unread-red).
  tileProposals: {
    minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11,
    backgroundColor: '#d8a64a',
    alignItems: 'center', justifyContent: 'center',
  },
  tileProposalsText: { color: theme.color.white, fontSize: 12, fontWeight: '700' },
  // Launcher shortcut button row (Nearby, Mijn dingen).
  shortcut:     { paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1, borderColor: theme.color.line, borderRadius: 16, backgroundColor: theme.color.card, marginBottom: 6, alignSelf: 'flex-start' },
  shortcutText: { fontSize: 13, color: theme.color.ink },
  muted:      { color: theme.color.inkSoft, fontStyle: 'italic', paddingVertical: 10 },
  newBtn:     { marginTop: 12, padding: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: theme.color.line, borderRadius: 8, alignItems: 'center' },
  newText:    { color: theme.color.inkSoft },
  createRow:  { marginTop: 12, flexDirection: 'row', gap: 8, alignItems: 'center' },
  input:      { flex: 1, padding: 11, borderWidth: 1, borderColor: theme.color.accent, borderRadius: 8, backgroundColor: theme.color.white, fontSize: 14 },
  createBtn:  { width: 42, paddingVertical: 11, borderRadius: 8, backgroundColor: theme.color.accent, alignItems: 'center' },
  createBtnText: { color: theme.color.white, fontSize: 16, fontWeight: '700' },
  // Shared row styles used by NearbyScreen + MyThingsScreen + SP-13 kring stream.
  row:        { padding: 12, borderWidth: 1, borderColor: theme.color.line, borderRadius: 8, backgroundColor: theme.color.card, marginBottom: 6 },
  rowName:    { fontSize: 14, fontWeight: '600', color: theme.color.ink },
  rowMeta:    { fontSize: 12, color: theme.color.inkSoft, marginTop: 2 },
  // SP-13 — header overflow `⋯` trigger + collapsible menu.
  moreBtn:        { paddingHorizontal: 10, paddingVertical: 4 },
  moreBtnText:    { fontSize: 22, color: theme.color.inkSoft, lineHeight: 24 },
  moreMenu:       { borderWidth: 1, borderColor: theme.color.line, borderRadius: 8, backgroundColor: theme.color.card, padding: 4, marginTop: 4, marginBottom: 4 },
  moreItem:       { paddingVertical: 9, paddingHorizontal: 12 },
  moreItemText:   { fontSize: 13, color: theme.color.ink },
  // SP-13.2 — chat bubbles + composer (v2 §1+§5).
  bubble:           { padding: 10, borderWidth: 1, borderColor: theme.color.line, borderRadius: 10, backgroundColor: theme.color.card, marginBottom: 6, maxWidth: '85%', alignSelf: 'flex-start' },
  bubbleSender:     { fontSize: 11, color: theme.color.inkSoft, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 2 },
  bubbleText:       { fontSize: 14, color: theme.color.ink },
  bubbleKind:       { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, color: theme.color.accent },
  dayDivider:       { alignSelf: 'center', fontSize: 11, color: theme.color.inkSoft, fontStyle: 'italic', paddingVertical: 8 },
  composer:         { flexDirection: 'row', gap: 8, alignItems: 'center', paddingTop: 8, paddingBottom: 4, borderTopWidth: 1, borderTopColor: theme.color.line, marginTop: 4 },
  composerInput:    { flex: 1, paddingHorizontal: 14, paddingVertical: 9, borderWidth: 1, borderColor: theme.color.line, borderRadius: 22, backgroundColor: theme.color.white, fontSize: 14, color: theme.color.ink },
  composerSend:     { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.color.accent, alignItems: 'center', justifyContent: 'center' },
  composerSendText: { color: theme.color.white, fontSize: 18, fontWeight: '700' },
  // SP-13.3 — per-kring bottom tab bar + tab-coming placeholder.
  kringTabs:        { flexDirection: 'row', borderTopWidth: 1, borderTopColor: theme.color.line, marginTop: 4 },
  kringTab:         { flex: 1, paddingVertical: 12, alignItems: 'center', borderTopWidth: 2, borderTopColor: 'transparent', marginTop: -1 },
  kringTabActive:   { borderTopColor: theme.color.accent },
  kringTabText:     { fontSize: 11, color: theme.color.inkSoft, textTransform: 'uppercase', letterSpacing: 1.4 },
  kringTabTextActive:{ color: theme.color.accentInk, fontWeight: '600' },
  // SP-13.4 — Chat ↔ Scherm header pill.
  viewToggle:          { flexDirection: 'row', borderWidth: 1, borderColor: theme.color.line, borderRadius: 999, overflow: 'hidden', backgroundColor: theme.color.paper, marginLeft: 'auto', marginRight: 8 },
  viewToggleBtn:       { paddingHorizontal: 12, paddingVertical: 5 },
  viewToggleBtnActive: { backgroundColor: theme.color.accent },
  viewToggleText:      { fontSize: 12, color: theme.color.inkSoft },
  viewToggleTextActive:{ color: theme.color.white, fontWeight: '600' },
  placeholder:      { color: theme.color.inkSoft, fontStyle: 'italic', textAlign: 'center', paddingVertical: 24, paddingHorizontal: 12 },
  // Per-row action buttons (Ik help / Negeer …) — used by chat bubbles.
  rowActions:     { flexDirection: 'row', gap: 6, marginTop: 8 },
  rowActionBtn:   { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, borderWidth: 1, borderColor: theme.color.line, backgroundColor: theme.color.paper },
  rowActionText:  { fontSize: 12, color: theme.color.ink },
  // δ.2 — per-message delivery state.  Pending = subtle clock-line,
  // Failed = warning pill (tap-to-retry).  Sent renders nothing.
  deliveryPending:    { marginTop: 4, fontSize: 11, color: theme.color.inkSoft },
  deliveryFailed:     { marginTop: 4, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, borderWidth: 1, borderColor: '#f2c8b8', backgroundColor: '#fbe9e3' },
  deliveryFailedText: { fontSize: 11, color: '#b8290f' },
  ownProfile: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: theme.color.line },
  ownProfileTitle: { fontSize: 13, fontWeight: '600', color: theme.color.ink, marginBottom: 4 },
  // P6.5 #342 — "ON YOUR LIST" section on CircleDetail.
  onYourList:       { marginTop: 8, paddingHorizontal: 2, paddingVertical: 8 },
  onYourListTitle:  { fontSize: 11, letterSpacing: 1.0, color: theme.color.inkSoft, textTransform: 'uppercase', marginBottom: 6 },
  onYourListRow:    { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: theme.color.line },
  onYourListText:   { fontSize: 13, color: theme.color.ink },
  // β.5 — per-tile context menu (Modal-backed sheet).  Backdrop catches
  // outside-tap to dismiss; sheet hugs the bottom for thumb reach.
  tileMenuBackdrop:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.32)', justifyContent: 'flex-end' },
  tileMenuSheet:     { backgroundColor: theme.color.card, borderTopLeftRadius: 14, borderTopRightRadius: 14, padding: 8, paddingBottom: 20 },
  tileMenuItem:      { paddingVertical: 14, paddingHorizontal: 16, borderRadius: 8 },
  tileMenuItemText:  { fontSize: 15, color: theme.color.ink },
});
