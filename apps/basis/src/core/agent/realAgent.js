/**
 * basis — portable real-Agent factory.
 *
 * Lifted from `src/web/realAgent.js` in so both the web entry
 * (`src/web/realAgent.js` → thin re-export) and the basis-mobile
 * bundle (`@onderling-app/basis/core-realAgent`) share one source.
 *
 * Topology (composes four real app agents on a shared InternalBus):
 *   - hostAgent   — household skills + calendar
 *   - chatAgent   — user-facing surface (via @onderling/secure-agent)
 *   - tasksCircle   — real tasks-v0 Circle agent
 *   - stoopAgent  — real Stoop NeighborhoodAgent
 *   - folioAgent  — real Folio browser agent (web-only handlers today)
 *
 * Portability rules (per Project Files/conventions/node-portability):
 *   - NO direct browser DOM globals (window / location / document)
 *   - Browser-globals consumed via `typeof globalThis.X !== 'undefined'`
 *     guards so Node + RN runtimes degrade cleanly
 *   - `nknLib` is INJECTED by the caller (web injects the browser
 *     nkn-sdk; RN injects the RN-compatible build)
 *
 * Web-specific wiring (OIDC, window/location, DOM mounts) lives in
 * the wrapper at `src/web/realAgent.js` + `web/main.js`.
 */

import {
  Agent, AgentIdentity, Bootstrap, InternalBus, InternalTransport, DataPart, TokenRegistry,
  PolicyEngine, TrustRegistry, deriveCircleAddress, signCircleLinkFromSeed,
} from '@onderling/core';
import { VaultMemory, VaultLocalStorage } from '@onderling/vault';
import { wireSkill } from '@onderling/sdk';
import { createSecureMeshAgent } from '@onderling/secure-agent';
import { createBrowserMultiCircleTasksAgent } from '@onderling-app/tasks/browser';
import { createBrowserStoopAgent } from '@onderling-app/stoop/browser';
import { createBrowserFolioAgent } from '@onderling-app/folio/browser';
// agents — the read-only "your agents" surface (2026-07-09). buildAgentSkills
// derives the two defineSkill-shaped handlers (listAgents / viewAgent) from
// the agents manifest via wireSkill; registerAgentBundle both registers THIS
// device in the registry resource and returns the live registry handle.
import { buildAgentSkills } from '@onderling-app/agents/wireSkills';
// Canonical Member projectors — the chat-shell `listGroupMembers` item is a
// PROJECTION of the ONE Member (kring-host), not a hand-reshape.
import { memberFrom, memberToChatItem } from '@onderling/kring-host/circleMembers';
// install — the curated-catalog SOURCE. commons-governance G1: when a
// bootstrap endorser root is configured (opts.commonsRoot), the default source
// is the REAL endorsement-backed catalog (createCatalogSource over signed,
// cardHash-bound recommendations); otherwise the local stub keeps the surface
// exercisable. Both satisfy the same { list, get } contract, so wireSkills /
// installCores are unchanged. Overridable via opts.agentsCatalog.
import { createStubCatalog } from '@onderling-app/agents/defaultCatalog';
import {
  registerAgentBundle,
  createAgentRegistry,
  createEndorsementResource,
  createCatalogSource,
  createCommunitySubscriptions,
  createProfile as registryCreateProfile,
  setOwn,
  setDisclosure as setDisclosurePolicy,
  releasedValues as releaseFromPolicy,
  createDriver,
  driversFromProperties,
  isRequestable,
  effectiveProperties,
} from '@onderling/agent-registry';
// REQUESTABLE BRIDGE (host-wiring seam J6) — the recipient's per-circle task
// surface (`createTaskStore`) + the convergence handler (`requestableSkillHandler`)
// that mints a `request` task instead of executing an offering. Wired below onto the
// live host agent as the `requestOffering` peer-facing dispatcher op.
import { createTaskStore, requestableSkillHandler } from '@onderling/item-store';

/**
 * Pick the right vault for the runtime.  Used here only for the
 * HOST agent (in-process app skills; no cross-peer); the CHAT
 * agent's vault is selected by createSecureAgent's picker via the
 * identityVaultPrefix opt.
 */
function makeBrowserVault(prefix) {
  if (typeof globalThis.localStorage !== 'undefined') {
    try { return new VaultLocalStorage({ prefix }); } catch { /* defensive */ }
  }
  return new VaultMemory();
}

/**
 * v0.7.P3a — try to restore an existing identity; generate fresh if
 * the vault is empty.  Either way returns a usable AgentIdentity.
 * (Host-only helper; createSecureAgent handles this for the chat side.)
 */
async function restoreOrGenerate(vault) {
  try {
    if (await vault.has('agent-privkey')) {
      return await AgentIdentity.restore(vault);
    }
  } catch { /* fall through to generate */ }
  return AgentIdentity.generate(vault);
}

/**
 * Owner root (step 1 of the identity-profiles substrate — see
 * plans/NOTE-identity-profiles-and-portability.md). ONE Bootstrap secret per
 * install/account, persisted as its 24-word phrase; the default profile derives
 * from it via HKDF so one phrase recovers the (feedback) pseudonym on any device.
 * Read-or-create — never overwrites an existing phrase.
 */
async function ensureOwnerRoot(vault) {
  try {
    const phrase = await vault.get('owner-phrase');
    if (phrase && typeof phrase === 'string' && phrase.trim().length > 0) {
      return Bootstrap.fromMnemonic(phrase);
    }
  } catch { /* fall through to create */ }
  const { bootstrap, mnemonic } = Bootstrap.create();
  await vault.set('owner-phrase', mnemonic);
  return bootstrap;
}

import {
  CalendarStore, registerCalendarSkills,
} from '@onderling-app/calendar';
// Imported by RELATIVE path (not the `@onderling-app/household` package name)
// because basis doesn't carry household as a workspace dep yet (the
// dissolve is in progress).  Mirrors basis-mobile/composeManifests.js,
// which relative-imports the sibling app sources for the same reason.
//
// L3 — basis no longer depends on the legacy household skill registry
// (`skillRegistry.js` → `HOUSEHOLD_SKILL_REGISTRY`) or the legacy `HouseholdAgent`.
// Household ops route through the dissolved pure cores (`v2/householdApp.js`) on a
// dedicated in-process agent via `wireSkill` (see below). We import ONLY the store +
// the no-pod cross-device sync substrate from their submodules — NOT `index.js`, which
// re-exports the retired `HOUSEHOLD_SKILL_REGISTRY` / `HouseholdAgent`. The `InMemoryStore`
// (`HouseholdStore`) survives here solely as the no-pod sync mirror's substrate backing;
// the live item data lives in the per-circle `CircleItemStore` (householdService).
import { InMemoryStore as HouseholdStore } from '../../../../household/src/storage/InMemoryStore.js';
import { buildHouseholdSubstrateStack }    from '../../../../household/src/lib/substrateStack.js';
import { wireHouseholdSubstrateMirror }    from '../../../../household/src/substrateMirror.js';
import { buildHouseholdDataSource }        from '../../../../household/src/storage/persist.js';
import { householdManifest }               from '../../../../household/manifest.js';
import { createSecureMeshEnvelopeAdapter } from '../sync/secureMeshEnvelopeAdapter.js';
import { isGenericOpId, decodeGenericOpId } from '@onderling/app-manifest';
import { makeSharedCirclePeerScope }        from '../../v2/sharedCirclePeerScope.js';

// Deterministic seed for the real household store.  Three open items across
// list types so `/list shopping` + the brief demo are non-empty out of the
// box.  Added oldest-first (the store preserves insertion order).
const SEED_HOUSEHOLD_ITEMS = [
  { type: 'shopping', text: 'Milk'                },
  { type: 'errand',   text: 'Post a parcel'       },
  { type: 'task',     text: 'Vacuum living room'  },
];

/**
 * Boot two in-process Agents on a shared InternalBus:
 *   - `host` owns the household skills
 *   - `chat` is basis's invoking identity
 *
 * Returns the same shape as `createMockHouseholdAgent`:
 *   { manifest, callSkill, reset, state }
 *
 * @returns {Promise<{
 *   manifest: object,
 *   callSkill: (appOrigin: string, opId: string, args: object) => Promise<*>,
 *   reset: () => void,
 *   state: () => Array<object>,
 *   meta: { hostAddress: string, chatAddress: string, transport: 'internal' },
 * }>}
 */
export async function createRealHouseholdAgent(opts = {}) {
  // Part G household — REAL `apps/household` store.  `chores`-as-an-array is
  // gone; all household state now lives in this `ItemStore`-backed store
  // (shopping/errand/repair/schedule items + tasks + contacts).
  //
  // OBJ-2 S1e — restart-survival: when the shell passes `householdPersistDb`
  // (web → `{ dbName: 'cc-household-state' }` IndexedDB; mobile →
  // `{ dbName, asyncStorage }` AsyncStorage; node → `{ path }`), back the
  // store with a persistent `CachingDataSource` so items survive a reload.
  // Default (undefined) → in-memory `MemorySource`, unchanged.  The actual
  // shell threading of `householdPersistDb` is a follow-up; realAgent just
  // accepts + wires it here.
  const householdDataSource = opts.householdPersistDb
    ? await buildHouseholdDataSource(opts.householdPersistDb)
    : undefined;
  // Per-circle store registry (no-pod scoping). One shared DataSource; each circle gets an ItemStore
  // rooted at mem://household/circles/<id>/ so its list is its OWN. The legacy bucket ('household' /
  // no active circle) keeps the bare root, so the pre-partition pile stays reachable as a default.
  const householdStores = new Map();   // circleId → HouseholdStore
  function getHouseholdScope(circleId) {
    const id = (typeof circleId === 'string' && circleId) ? circleId : 'household';
    let store = householdStores.get(id);
    if (!store) {
      const rootContainer = id === 'household' ? 'mem://household/' : `mem://household/circles/${id}/`;
      store = new HouseholdStore({ dataSource: householdDataSource, rootContainer });
      householdStores.set(id, store);
    }
    return store;
  }
  // The active circle (shell-supplied) scopes a household call when the chat args don't carry one
  // (read verbs like listOpen aren't auto-scoped by the dispatch). circleId in args still wins.
  const getActiveHouseholdCircleId = typeof opts.getActiveCircleId === 'function' ? opts.getActiveCircleId : () => null;
  function resolveHouseholdCircleId(args) {
    return (args?.circleId ?? args?.circleId ?? args?.groupId ?? getActiveHouseholdCircleId()) || 'household';
  }
  // cluster L · L3 — household is now the UNIFORM wired path by DEFAULT (the legacy agent is retired).
  // Household ops route to the dissolved pure cores (`v2/householdApp.js`) over the per-circle
  // CircleItemStore, via `wireSkill` on a dedicated in-process household agent (built below). Same
  // DataSource (persistent if a persistDb was passed; in-memory no-pod otherwise). `opts.householdViaCircleStore`
  // is accepted but no longer gates anything — the wired path is unconditional (there is no legacy fallback).
  const householdApp = await import('../../v2/householdApp.js');   // pure cores for the wireSkill registration below
  const { wireStoreMirror, wireCircleStoreInbound } = await import('@onderling/item-store');
  let householdAgent = null;           // B1 — dedicated in-process agent hosting the wireSkill-wrapped pure cores
  const householdSyncWired = new Set();   // circleIds whose store↔mirror sync (publish + inbound) is wired (once each)
  const householdService = householdApp.createHouseholdService({ dataSource: householdDataSource });
  // The wired household ops (dissolved cores on `householdAgent`). Everything else on the 'household'
  // app-origin (calendar_* passthrough, addMember, getChoreSnapshot, resolveContact, help, registerName)
  // routes to `hostAgent`; `household_briefSummary` is derived from the wired store (see callSkill).
  const HOUSEHOLD_WIRED_OPS = new Set([
    'addItem', 'addTask', 'markComplete', 'removeItem', 'claim', 'reassign', 'listOpen', 'listTasks',
  ]);
  // v0.7.12 — multi-pod RSVP coordination (simulated for the demo).
  // calendar.addEvent calls this when attendees are present; default
  // is no-op (registerCalendarSkills's inviteAttendee:null path).
  // main.js wires the real impl post-construction (forward-ref) since
  // it owns the simPeers map + threadStore.
  let inviteAttendeeRef = async (/* webid, snapshot */) => {};

  // v0.7.7 — optional event publisher.  When supplied, mutation
  // skills publish item-changed events via this callback so the
  // chat-shell EventRouter routes them to matching threads.
  // Unblocks J8's "household alerts" real-event demo.
  const publishEvent = typeof opts.publishEvent === 'function'
    ? opts.publishEvent
    : () => {};

  // Opt-in demo scaffolding. OFF by default: a freshly created REAL circle must
  // show only real members (the creator + actual joiners) and no phantom tasks.
  // When explicitly enabled (demo deploy / journey fixtures), the factory seeds
  // the three named demo members (Anne/Karl/Maria) into the default tasks + stoop
  // circles, the matching demo contacts, and the starter demo tasks/posts. Nothing
  // here fabricates peers into the `_sync` hint — that reads real state regardless.
  const seedDemoData = opts.seedDemoData === true;

  const bus = new InternalBus();

  // claim-router hook holder. Hosts call agent.setAfterClaimHook(fn)
  // post-construction (the hook typically needs agent.callSkill itself, so it
  // can't be passed in opts).  Default to a no-op.
  const claimRouterRef = { hook: typeof opts.afterClaimHook === 'function' ? opts.afterClaimHook : null };

  // Owner root — the one recovery secret for this account (step 1; other
  // sub-agents still generate independent random seeds until step 2 migrates
  // them onto the root). The default profile (= the chat identity below, which
  // the feedback no-login pseudonym uses) derives from it.
  const ownerRootVault = opts.ownerRootVault ?? makeBrowserVault('cc-owner-root:');
  const ownerRoot      = await ensureOwnerRoot(ownerRootVault);

  // Host agent — in-process app skills (household, tasks-v0, stoop,
  // folio, calendar).  No cross-peer; vault picks the standard browser
  // localStorage path.  Built manually because it's a pure backend.
  const hostVault = opts.hostVault ?? makeBrowserVault('cc-host-id:');
  const hostId    = await restoreOrGenerate(hostVault);
  const hostTransport = new InternalTransport(bus, hostId.pubKey);
  const hostAgent = new Agent({ identity: hostId, transport: hostTransport });

  // Chat agent — the user-facing surface.  Built via @onderling/secure-agent
  // factory so every safety primitive (identity persistence, SecurityLayer,
  // mute/block, helloGate, signed WebID claim, audit log, …) is wired
  // by default rather than re-assembled per app.
  //
  // - bus: shared with hostAgent so chatAgent.invoke(hostAgent.address)
  //        works in-process via InternalBus
  // - vault: opt.chatVault wins (tests inject VaultMemory); otherwise
  //   picker chooses VaultLocalStorage by prefix 'cc-chat-id:'
  // - auditLog: persistent under 'cc-audit'; autoLogs identity.rotate /
  //   mute / claim.sign / caps.issue / peer.connect
  // - muteListVaultKey: persistent peer mute across reloads
  // - nknLib: not passed here — caller (web main.js / RN bundle)
  //   wires sa.peer.connect() once its runtime nkn-sdk is available
  // - onPeerMessage: not passed here — main.js wires it when connecting
  //
  // SECURITY: any opt below this comment that is RESET / DISABLED needs
  // a `// SECURITY: opted out — <reason>` comment per
  // Project Files/conventions/architectural-layering.md.
  // Default-profile chat identity: derive from the owner root. Build the vault
  // ourselves (respecting an injected opts.chatVault) so we can pre-seed it, then
  // hand it to the factory — whose restoreOrGenerate then RESTORES this seed.
  // Only seed a FRESH vault: an existing install keeps its current identity on this
  // boot (a clean cutover re-keys via a wipe + re-onboard, never silently here).
  const chatVault = opts.chatVault ?? makeBrowserVault('cc-chat-id:');
  // The default profile's seed — the source for both the chat identity AND per-circle addresses
  // (step 5B/C). Kept so the returned agent can expose circleAddressFor(circleId).
  const defaultProfileSeed = ownerRoot.deriveAgentSeed('default');
  if (!(await chatVault.has('agent-privkey'))) {
    await AgentIdentity.fromSeed(defaultProfileSeed, chatVault);
  }
  const sa = await createSecureMeshAgent({
    bus,
    vault:               chatVault,
    identityVaultPrefix: 'cc-chat-id:',   // no effect when `vault` is supplied; documents the prefix
    muteListVaultKey:    'cc-mute',
    auditLog:            { vaultKey: 'cc-audit' },
    // T5.3b — the unified secure-mesh factory is now the single entry for the
    // chat agent (web + mobile). With no `transports`, it is behaviourally
    // identical to createSecureAgent; the value is the shared seam: the RN
    // bundle injects platform transports here (mdns/ble) so the unified router
    // ranks them alongside nkn/relay/rendezvous. Web injects none.
    transports:          opts.meshTransports,      // RN passes { mdns, ble }; web omits
    onTransportError:    opts.onTransportError,     // optional per-transport inject hook
    // onPeerMessage + nknLib supplied later via setPeerWiring().
    // Pass-through for extra factory opts (tests + future ops):
    // identityResolver, capabilityIssuer, policyEngine, groupManager,
    // a2aTls, rateLimit, usePerfectFwdSec, webidClaim, helloGate, …
    ...(opts.secureAgentOpts ?? {}),
  });
  const chatAgent = sa.agent;
  const chatId    = chatAgent.identity;

  /* ─── OBJ-2 (S1a/S1c) — household no-pod peer item-sync ─────────────────────
   * Wire the in-process household store into the substrate mirror over the REAL
   * cross-peer wire (the secure-mesh chat agent), so an item added on one device
   * fans out to the circle's other devices with NO pod. The mirror is
   * transport-agnostic; we hand it the secure-mesh envelope adapter (publish →
   * sa.peer.sendTo; receive → handleInbound, registered in the inbound router by
   * connectPeerTransport below). Peers are app-owned (the chat agent keeps no
   * core PeerGraph) — the shell feeds the roster via `addHouseholdPeer` as the
   * circle's members become known (publish early-returns while the roster is
   * empty, so this is inert until peers are added). Publish-on-write hooks in the
   * skills (S1d) + persistence (S1e) follow; the mirror is exposed on `ctx` now
   * so S1d only needs to add the publish calls.
   */
  const householdCircleId = opts.householdCircleId ?? 'household';
  const householdEnvelopeAdapter = createSecureMeshEnvelopeAdapter({
    // Durable circle content (tasks, noticeboard/prikbord items — every item-sync
    // envelope this mirror fans) rides with the hold-forward delivery guarantee:
    // a member who is briefly offline has the envelope HELD locally and delivered
    // on their next presence signal, instead of silently lost. One well-placed
    // default here covers every durable item fan (publishEnvelope is the single
    // choke), rather than opting in per write. The online path is unchanged
    // (a reachable peer is delivered immediately, held:false); receivers already
    // de-dupe by etag/_v so a late-flushed copy is idempotent.
    sendPeerMessage: (to, payload) => sa.peer.sendTo(to, payload, { guarantee: 'hold-forward' }),
    selfAddress:     chatId.pubKey,
  });
  const householdSubstrate = buildHouseholdSubstrateStack({
    transport: householdEnvelopeAdapter,
    deviceId:  chatId.pubKey,
  });
  const householdVault = sa.identity?.vault ?? sa.vault ?? null;
  const householdPeersKey = (circleId) => `cc-household-peers:${circleId || 'household'}`;

  // Per-circle MIRROR factory (OBJ-2 Phase 6). Each circle's store gets its OWN mirror — scopeId =
  // circleId, uriPrefix /household/circles/<id>/items/ — sharing the one transport-level substrate
  // (notifyEnvelope/pseudoPod). A write to circle A's store fans out under A's scope; an inbound
  // A-envelope routes to A's store; a device only in B never receives it. Lazy (first use) + its peer
  // roster restored from the vault per circle. S1d publish-on-write hook is wired here, per store.
  const householdMirrors = new Map();   // circleId → mirror
  async function ensureHouseholdMirror(circleId) {
    const id = (typeof circleId === 'string' && circleId) ? circleId : 'household';
    let mirror = householdMirrors.get(id);
    if (!mirror) {
      const store = getHouseholdScope(id);
      mirror = await wireHouseholdSubstrateMirror({
        itemStore:      store.substrate,
        notifyEnvelope: householdSubstrate.notifyEnvelope,
        pseudoPod:      householdSubstrate.pseudoPod,
        circleId:       id,
        selfPubKey:     chatId.pubKey,
      });
      store.setSyncHook({
        publishItem:        (item) => mirror.publishItem(item),
        publishItemRemoved: (rid)  => mirror.publishItemRemoved(rid),
      });
      householdMirrors.set(id, mirror);
      // Restore this circle's persisted manual pairings (best-effort).
      try {
        const raw   = await householdVault?.get?.(householdPeersKey(id));
        const saved = raw ? JSON.parse(raw) : [];
        for (const p of (Array.isArray(saved) ? saved : [])) {
          if (typeof p === 'string' && p && p !== chatId.pubKey) await mirror.addPeer(p);
        }
      } catch { /* no saved peers / unreadable — start empty */ }
    }
    return mirror;
  }
  // L3 no-pod-sync — bridge a circle's CircleItemStore (the live wired data) to its peer mirror,
  // BIDIRECTIONALLY, ONCE per circle (guard with the Set; inbound `subscribe` accumulates):
  //   PUBLISH — local writes fan out to the circle's other devices (`wireStoreMirror` → publish-on-write).
  //   INBOUND — peer envelopes ingest back into THIS circle store (`wireCircleStoreInbound`, id-preserving,
  //             no echo). Same kind/prefix the household mirror publishes. Best-effort (op still runs locally).
  async function ensureHouseholdCircleSync(circleId) {
    const id = (typeof circleId === 'string' && circleId) ? circleId : 'household';
    if (householdSyncWired.has(id)) return;
    try {
      const mirror      = await ensureHouseholdMirror(id);
      const circleStore = householdService.stores.getStore(id);
      wireStoreMirror(circleStore, mirror);
      wireCircleStoreInbound({
        notifyEnvelope: householdSubstrate.notifyEnvelope,
        store:          circleStore,
        prefix:         `/household/circles/${id}/items/`,
      });
      householdSyncWired.add(id);
    } catch { /* sync is best-effort; the op still runs locally */ }
  }
  // Legacy bucket's mirror (back-compat default for un-scoped peer ops + the seed/demo path).
  const householdMirror = await ensureHouseholdMirror('household');
  // Wire the default 'household' circle's store↔mirror sync eagerly at boot so an inbound peer envelope
  // that arrives BEFORE the first local household op still ingests into the wired store.
  await ensureHouseholdCircleSync('household');

  async function persistHouseholdPeers(circleId) {
    const m = householdMirrors.get(circleId || 'household');
    try { await householdVault?.set?.(householdPeersKey(circleId), JSON.stringify(m?.listPeers?.() ?? [])); }
    catch { /* best-effort — pairing still works in-memory this session */ }
  }
  // OBJ-2 hygiene — forget a circle's sync peers when you LEAVE it: drop its persisted roster + clear the
  // live mirror's peers, so a left/dead circle stops HI-pinging offline peers on every boot (the stale-peer
  // noise). Best-effort; the local items stay (leave keeps your data, just stops the peer fan-out).
  async function clearHouseholdPeers(circleId) {
    const id = (typeof circleId === 'string' && circleId) ? circleId : null;
    if (!id) return;
    try { await householdVault?.set?.(householdPeersKey(id), '[]'); } catch { /* */ }
    const m = householdMirrors.get(id);
    if (m) { try { for (const p of (m.listPeers?.() ?? [])) m.removePeer(p); } catch { /* */ } }
  }
  // OBJ-2 catch-up — the mirror fans out NEW writes only, so a freshly-paired peer never sees the
  // EXISTING list. When a GENUINELY new peer is added we re-publish that circle's current open items
  // (etag-deduped by the receiver), so both sides converge. Per-circle.
  async function republishHouseholdItemsToNewPeer(circleId) {
    const id = circleId || 'household';
    let items = [];
    try { items = await householdApp.listOpen(householdService.stores.getStore(id), {}); } catch { return; }
    const mirror = await ensureHouseholdMirror(id);
    for (const it of (Array.isArray(items) ? items : [])) {
      try { mirror.publishItem(it); } catch { /* best-effort */ }
    }
  }
  function isNewHouseholdPeer(circleId, pubKey) {
    if (!pubKey) return false;
    try { return !(householdMirrors.get(circleId || 'household')?.listPeers?.() ?? []).includes(pubKey); } catch { return true; }
  }

  // `_sync` reply hint — REAL connectivity state, never a fabricated demo roster.
  // Reads this device's live household no-pod peer roster (the mirror the shell
  // feeds as a circle's members become known). Empty until real peers pair, so the
  // renderer shows the honest "saved locally; awaiting peer sync" (formatSyncHints'
  // 0-peer branch) instead of inventing offline peers. Shape stays the
  // `decentralized` SyncHints envelope the renderer + calendar already consume.
  // (Kept named `simulateSync` — the param registerCalendarSkills + the callSkill
  // adapters expect — but the value is now real, not simulated.)
  function simulateSync() {
    let peers = [];
    try { peers = householdMirror?.listPeers?.() ?? []; } catch { peers = []; }
    return { style: 'decentralized', peers, pending: [], unreachable: [] };
  }

  /* ─────────── v0.7.10 — Calendar app skills ─────────── */
  // Composed via @onderling-app/calendar's registerCalendarSkills.  The
  // calendar app's CalendarStore is built fresh per agent instance
  // (in-memory pseudo-pod for v0.7.10; v0.7.11 swaps to real pod).
  //
  // v0.7.10 limitation: all 5 apps' skills register on ONE hostAgent.
  // For brief / search, app-prefixed names (calendar_briefSummary,
  // tasks_briefSummary, ...) avoid the collision.  main.js's callSkill
  // remaps the bare op id → the prefixed id.  v0.7.11+ may mount each
  // app as its own agent on the InternalBus for cleaner architecture.
  const calendarStore = new CalendarStore({ actor: 'webid:local-demo-user' });
  registerCalendarSkills(hostAgent, calendarStore, {
    simulateSync,
    publishEvent,
    skillPrefix: 'calendar_',     // ← namespaces colliding skill ids
    // v0.7.12 — invite-attendee callback wired by main.js (which has
    // the simPeers map).  Forward-ref pattern: realAgent doesn't
    // know about main.js's threadStore + simPeers at construction,
    // so we expose a setter the caller wires post-construction.
    inviteAttendee: (webid, snapshot) => inviteAttendeeRef(webid, snapshot),
  });

  // v0.7. — caller (main.js) wires the pod writer on sign-in via
  // this setter; calendar's .ics feed then write-throughs to
  // <pod>/canopy/calendar/feed.ics.
  const setCalendarPodWriter = (writer) => calendarStore.setPodWriter(writer);
  // v0.7. — surface pod-write success / failure as notification
  // events so /logs + matching threads pick them up.
  if (typeof calendarStore.setPodEventSink === 'function') {
    calendarStore.setPodEventSink((event) => {
      publishEvent({
        app:  'calendar',
        type: event.kind === 'pod-write-error' ? 'notification' : 'item-changed',
        payload: {
          message: event.kind === 'pod-write-ok'
            ? `📤 pod write OK: ${event.url}`
            : `❌ pod write failed (${event.status ?? 'no status'}): ${event.error}`,
        },
      });
    });
  }

  /* ─────────── L3 — household via the uniform route + wireSkill (the DEFAULT, legacy retired) ───────────
   * The dissolved-onto-CircleItemStore cores in `v2/householdApp.js` are registered on a DEDICATED
   * in-process household agent via `wireSkill(core, householdOp, { storeFor })` — the same
   * manifest-op-derives-the-handler mechanism B2 (tasks-v0) uses — and the `'household'` branch of
   * callSkill routes through `chatAgent.invoke(householdAgent.address, opId, parts)` so household ops
   * take the merged S1 InternalTransport fast-path AND pass the callSkill security gate.
   *
   *   • storeFor — the per-circle CircleItemStore: `householdService.stores.getStore(circleId)`.
   *     circleId is injected into the DataPart args at invoke time (below), so it resolves identically here.
   *   • `by` — the acting member.  The cores read `ctx.by`; the invoke context carries the caller as
   *     `ctx.from` (= chatId.pubKey in-process), so `withBy` threads it through.
   *   • listOpen/listTasks cores return a BARE ARRAY of items; `listWrap` boxes them in `{ items }` so
   *     invoke always yields a clean DataPart (an array would be mis-read as a Part[]).
   *   • listOpen's manifest `type` param is REQUIRED, but the dissolved app (like the legacy one) supports
   *     listOpen WITHOUT a type = "all open items across every list-type". We wire that op with a `type`-
   *     optional CLONE of the manifest op so `wireSkill`'s validation permits the no-type call; the core
   *     (householdApp.listOpen) reads the whole store when `type` is absent.  The shared manifest is
   *     untouched (addItem's `type` stays required; the standalone household app is unaffected). */
  {
    const householdId    = await restoreOrGenerate(makeBrowserVault('cc-household-agent-id:'));
    householdAgent       = new Agent({ identity: householdId, transport: new InternalTransport(bus, householdId.pubKey) });
    const hhOp = (id) => {
      const found = householdManifest.operations.find((o) => o.id === id);
      if (!found) throw new Error(`realAgent L3: no household manifest op "${id}"`);
      return found;
    };
    // listOpen supports the no-type ("all open") call the legacy path allowed — clone the op with the
    // `type` param made OPTIONAL so wireSkill's required-param validation doesn't reject it.
    const typeOptional = (op) => ({
      ...op,
      params: (op.params ?? []).map((p) => (p.name === 'type' ? { ...p, required: false } : p)),
    });
    const storeFor = (ctx) =>
      householdService.stores.getStore(resolveHouseholdCircleId(ctx.parts?.[0]?.data ?? {}));
    // Thread the acting member (`by`) from the invoke context into the pure core's ctx.
    const withBy   = (coreFn) => (store, a, ctx) => coreFn(store, a, { ...ctx, by: ctx.from ?? chatId?.pubKey });
    // Box the bare-array list cores so invoke returns a DataPart, not an array-mistaken-for-Parts.
    const listWrap = (coreFn) => async (store, a, ctx) => ({ items: await coreFn(store, a, ctx) });
    const wire     = (id, coreFn, op = hhOp(id)) => householdAgent.register(id, wireSkill(coreFn, op, { storeFor }));

    wire('addItem',      withBy(householdApp.addItem));
    wire('addTask',      withBy(householdApp.addTask));
    wire('markComplete', withBy(householdApp.markComplete));
    wire('claim',        withBy(householdApp.claim));
    wire('reassign',     withBy(householdApp.reassign));
    wire('removeItem',   householdApp.removeItem);          // no `by`
    wire('listOpen',     listWrap(householdApp.listOpen), typeOptional(hhOp('listOpen')));
    wire('listTasks',    listWrap(householdApp.listTasks));
  }

  /* ─────────── agents — the read-only "your agents" surface (2026-07-09) ───────────
   * The `apps/agents` manifest (listAgents /agents + viewAgent detail) reads the canonical
   * `@onderling/agent-registry` pod resource.  The registry is anchored on THE USER'S OWN
   * pseudo-pod: the shared substrate stack already built above for household
   * (`householdSubstrate.pseudoPod`), whose URI authority is the CHAT identity's pubKey —
   * i.e. this user's device pod, not a per-circle pod.  Mirrors the sibling bring-up
   * pattern (stoop-mobile bootstrapBundle / tasks-v0 Circle.js): `registerAgentBundle`
   * registers THIS device (the chat agent) in the resource — so the roster is non-empty
   * out of the box — and returns the live registry handle the read skills query.
   * Best-effort: a register failure falls back to a bare `createAgentRegistry` over the
   * same pod (empty roster) so the skills always register and boot never breaks.
   * The wireSkill-derived handlers live on `hostAgent` (same home as the other in-process
   * host skills); the 'agents' branch of callSkill routes through `chatAgent.invoke`. */
  let agentsTokenRegistry = null;   // issuer-side revocation list (exposed on the handle; null = degraded)
  {
    const agentsRegistry =
      (await registerAgentBundle({
        pseudoPod:   householdSubstrate.pseudoPod,
        podDeviceId: chatId.pubKey,
        agent:       chatAgent,
        opts: { capabilities: ['basis'], name: opts.agentsSelfName ?? 'basis (this device)' },
      }))
      ?? createAgentRegistry({ pseudoPod: householdSubstrate.pseudoPod, deviceId: chatId.pubKey });

    /* control ops — LIVE token binding (2026-07-09). hostAgent (the skills' home)
     * is the ISSUER: `issueCapabilityToken` signs with its identity and needs no other
     * machinery.  Neither hostAgent nor the default chat secure-agent composes a
     * TokenRegistry/PolicyEngine in this factory (hostAgent is built bare at the top;
     * sa.policy is null unless the caller opts in via secureAgentOpts.policyEngine), so
     * the issuer-side revocation list is built HERE: a real vault-backed `TokenRegistry`
     * (BotAgentRegistry precedent — issue → store; revoke flips `isRevoked`, the truth
     * any enforcement gate consults).  When a PolicyEngine IS composed (caller opt-in),
     * feed its revocation check from this registry, COMPOSING with a caller-supplied
     * `isRevoked` rather than clobbering it (nothing else in this file calls
     * setRevocationCheck).  Best-effort: any failure falls back to registry-only
     * (`tokenBacked: false`, the pre-binding behaviour) — never breaks boot. */
    let agentsTokens = null;
    try {
      const tokenVault = opts.agentsTokenVault ?? makeBrowserVault('cc-agent-tokens:');
      const tokenRegistry = new TokenRegistry(tokenVault);
      agentsTokens = {
        issue: async ({ subject, skill, expiresIn, constraints }) => {
          const token = await hostAgent.issueCapabilityToken({ subject, skill, expiresIn, constraints });
          await tokenRegistry.store(token);
          // Registry mirror expects an ISO string (resource.js nulls non-strings);
          // token.expiresAt is unix-ms.
          return { id: token.id, expiresAt: new Date(token.expiresAt).toISOString() };
        },
        revoke: (tokenId) => tokenRegistry.revoke(tokenId),
      };
      if (typeof sa.policy?.setRevocationCheck === 'function') {
        const callerIsRevoked = opts.secureAgentOpts?.policyEngine?.isRevoked;
        sa.policy.setRevocationCheck(async (tokenId) =>
          (await tokenRegistry.isRevoked(tokenId))
          || (typeof callerIsRevoked === 'function' ? Boolean(await callerIsRevoked(tokenId)) : false));
      }
      agentsTokenRegistry = tokenRegistry;
    } catch { agentsTokens = null; agentsTokenRegistry = null; }

    // recovery: the platform's circle-version-store resolver (web:
    // circleVersioning.getCircleVersionStore; mobile: its RN twin) rides in
    // via opts — the recovery cores stay platform-blind (doorgeefluik).
    // Absent → listDataVersions/restoreDataVersion answer the honest
    // `no-version-store` miss.
    const versionStoreFor = typeof opts.versionStoreFor === 'function' ? opts.versionStoreFor : null;
    // install: the curated-catalog SOURCE. A caller may inject a source via
    // opts.agentsCatalog (wins). Otherwise, commons-governance: when curator
    // root pubKey(s) are configured, the default source is the REAL
    // endorsement-backed catalog. G2 makes it a WEB OF TRUST — opts.commonsRoots
    // is an ARRAY of curator roots; the source WALKS the endorsement graph
    // (transitive, bounded depth) from all of them, verifies each signed
    // recommend (Ed25519 + cardHash-binding), and returns a list ranked by
    // trust-path proximity. opts.commonsRoot (single pubKey) stays a valid alias
    // → the G1 single-root special case. opts.agentsCardResolver resolves an
    // endorsed agent's Agent Card by pubKey (default injected/hermetic; the real
    // A2A well-known fetch is createWellKnownCardResolver, wired once its
    // subject→URL discovery is pinned). With no roots configured the local stub
    // keeps the install surface exercisable; the power-user override (install a
    // pasted card) works regardless of the source.
    const commonsRoots = Array.isArray(opts.commonsRoots)
      ? opts.commonsRoots.filter((r) => typeof r === 'string' && r.length > 0)
      : (typeof opts.commonsRoot === 'string' && opts.commonsRoot.length > 0 ? [opts.commonsRoot] : []);
    // commons-governance G3 — FEDERATION: the user's subscribed COMMUNITIES
    // (circles) contribute their admins as extra curator roots. `opts.communities`
    // maps a subscribed circleId → { admins, list } (the circle's admin pubKeys +
    // its admin-gated community catalog's endorsement list); joining a community =
    // trusting its curation. Subscriptions union with the pinned `commonsRoots`
    // above; the walk (G2) still applies within each community's admin roots. The
    // community catalog resource itself is an ordinary pod resource that CAN be
    // hosted on the community's companion node (R1-R3) — a deployment choice, not
    // wired here. With no communities configured this is inert (commonsRoots-only).
    const communitySubs = (opts.communities && typeof opts.communities === 'object')
      ? createCommunitySubscriptions({
          resolveCommunity: (id) => opts.communities[id] ?? null,
          resolveEndorsements: opts.communityCuratorEndorsements,   // optional transitive-WoT fallback
          initial: Array.isArray(opts.subscribedCommunities) ? opts.subscribedCommunities : Object.keys(opts.communities),
        })
      : null;
    let agentsCatalog;
    if (opts.agentsCatalog) {
      agentsCatalog = opts.agentsCatalog;
    } else if (communitySubs) {
      // Subscribed-community roots (live thunk) unioned with any pinned
      // commonsRoots; per-endorser records come from the subscriptions (their
      // community catalogs) plus the same shared endorsement resource pool.
      const endorsements = createEndorsementResource({ pseudoPod: householdSubstrate.pseudoPod, deviceId: chatId.pubKey });
      agentsCatalog = createCatalogSource({
        roots: async () => [...new Set([...commonsRoots, ...(await communitySubs.roots())])],
        resolveEndorsements: async (pk) => {
          const fromCommunities = await communitySubs.resolveEndorsements(pk);
          const pool = await endorsements.list();
          return [...fromCommunities, ...pool.filter((e) => e && e.endorser === pk)];
        },
        resolveCard: opts.agentsCardResolver ?? null,
        maxDepth:    opts.commonsMaxDepth,
      });
    } else if (commonsRoots.length > 0) {
      // Back-compat single-pool seam: each root's endorsements are read from the
      // shared-readable endorsement resource. (The general per-curator seam is
      // resolveEndorsements(pubKey); wired here as the pool the walk groups by
      // endorser so G1's single resource keeps working.)
      const endorsements = createEndorsementResource({
        pseudoPod: householdSubstrate.pseudoPod,
        deviceId:  chatId.pubKey,
      });
      agentsCatalog = createCatalogSource({
        endorsementResource: endorsements,
        roots:               commonsRoots,
        resolveCard:         opts.agentsCardResolver ?? null,
        maxDepth:            opts.commonsMaxDepth,
      });
    } else {
      agentsCatalog = createStubCatalog();
    }
    // 2.4b — owner-only CONTROL ops require 'trusted' (only the seeded in-process chat identity
    // clears it); reads (list/view) stay 'authenticated'. Chat-scoped: the shared wireSkills.js
    // `visibilityFor` + the standalone agents app are untouched.
    const TRUSTED_AGENT_OPS = new Set(['createProfile', 'grantAgent', 'revokeAgent', 'revokeGrant', 'purgeAgent', 'installAgent', 'restoreDataVersion']);
    // identity step 4 — the createProfile collaborator: derive a new profile from THIS user's owner
    // root + register it. Owner-root-backed (kept out of the dependency-free cores).
    const agentsProfiles = {
      create: ({ profileId, name, properties }) =>
        registryCreateProfile({ registry: agentsRegistry, ownerRoot, profileId, name, properties }),
      // Property layer — set/read a coarse property on a profile (curate once, reuse across apps). setProperty
      // merges (setOwn) then re-registers the FULL existing entry (register replaces), preserving key/role/grants.
      setProperty: async ({ profileId, key, value }) => {
        const cur = await agentsRegistry.lookup(profileId);
        if (!cur) throw new Error(`setProperty: no such profile ${profileId}`);
        await agentsRegistry.register({ ...cur, properties: setOwn(cur.properties ?? {}, key, value) });
        return { ok: true };
      },
      getProperties: async ({ profileId }) => (await agentsRegistry.lookup(profileId))?.properties ?? {},
      // Drivers (#3) — set an OWN personal driver property: build+validate the { kind, text, tags[] } value
      // (createDriver throws on an empty driver → the core reports invalid-driver), then store it like any
      // property (setOwn merge + re-register the full entry). getDrivers filters the map to driver values.
      setDriver: async ({ profileId, key, kind, text, tags, categoryId }) => {
        const cur = await agentsRegistry.lookup(profileId);
        if (!cur) throw new Error(`setDriver: no such profile ${profileId}`);
        const driver = createDriver({ kind, text, tags, categoryId });
        await agentsRegistry.register({ ...cur, properties: setOwn(cur.properties ?? {}, key, driver) });
        return { ok: true };
      },
      getDrivers: async ({ profileId }) => driversFromProperties((await agentsRegistry.lookup(profileId))?.properties ?? {}),
      // Personas — the PERSISTED per-context disclosure policy ("what this persona shares in circle X").
      // Merge via the pure disclosure setter, then re-register the FULL entry (preserves properties/key/grants).
      setDisclosure: async ({ profileId, contextId, key, enabled, rung, matchable, requestable }) => {
        const cur = await agentsRegistry.lookup(profileId);
        if (!cur) throw new Error(`setDisclosure: no such profile ${profileId}`);
        // Forward only the axes actually supplied (three independent axes);
        // the pure setter merges per-axis so one doesn't clobber the others.
        const patch = {};
        if (enabled !== undefined) patch.enabled = enabled;
        if (rung !== undefined) patch.rung = rung;
        if (matchable !== undefined) patch.matchable = matchable;
        if (requestable !== undefined) patch.requestable = requestable;
        await agentsRegistry.register({ ...cur, disclosure: setDisclosurePolicy(cur.disclosure ?? { perContext: {} }, contextId, key, patch) });
        return { ok: true };
      },
      getDisclosure: async ({ profileId }) => (await agentsRegistry.lookup(profileId))?.disclosure ?? { perContext: {} },
      // Personas — what a persona actually RELEASES in a context: its disclosure policy over its effective
      // (own + inherited-from-default) properties. Pre-loads self + default so releasedValues' SYNC getProfile
      // works; returns the coarse {key:value} that would be shared when joining/acting as this persona there.
      releaseFor: async ({ profileId, contextId, keys = [], defaultProfileId = 'default' }) => {
        const [self, dflt] = await Promise.all([agentsRegistry.lookup(profileId), agentsRegistry.lookup(defaultProfileId)]);
        const byId = { [profileId]: self, [defaultProfileId]: dflt };
        const request = { items: (Array.isArray(keys) ? keys : []).map((k) => ({ key: k })) };
        return releaseFromPolicy({ getProfile: (id) => byId[id] ?? null, profileId, defaultProfileId }, request, self?.disclosure ?? { perContext: {} }, contextId);
      },
    };
    for (const { id, handler, visibility } of buildAgentSkills({ registry: agentsRegistry, tokens: agentsTokens, versionStoreFor, catalog: agentsCatalog, profiles: agentsProfiles })) {
      hostAgent.register(id, handler, { visibility: TRUSTED_AGENT_OPS.has(id) ? 'trusted' : visibility });
    }
    // Property layer — REGISTER the default profile (the pseudonym) ONCE so a coarse property curated at consent
    // (setProfileProperty) has a profile to land on → cross-app reuse works for the no-login participant too.
    // Guarded on lookup so a later boot never re-registers (which would wipe accumulated properties). Best-effort.
    try {
      if (!(await agentsRegistry.lookup('default'))) await agentsProfiles.create({ profileId: 'default', name: 'default' });
    } catch { /* degraded (no owner root / registry) — the on-consent persist simply stays best-effort */ }

    /* ─── REQUESTABLE BRIDGE — the HOST-WIRING seam #1 (NOTE-skills-vs-capabilities
     * volleys 2–4 · journey J6) ─────────────────────────────────────────────────
     * A peer (A) invokes a local member's REQUESTABLE offering (a skill-kind driver
     * marked `requestable` in a circle's disclosure policy). The invocation does NOT
     * execute the offering — it MINTS a `request` task in that circle ("A asks: …")
     * that the recipient (B) then handles through the ordinary task lifecycle. That
     * is the convergence: "a request to a human IS a task."
     *
     * Wired as a PEER-FACING dispatcher op — same direct-register pattern as
     * `addMember`/`resolveContact`; `from` is the A2A caller (requester A). It is NOT
     * on `manifest.js` (this is an agent-to-agent op, not a local chat/web surface —
     * exactly like addMember), so it carries NO coverage-snapshot entry.
     *
     * ARCHITECTURAL CHOICE — resolve the circle context at INVOCATION time inside the
     * handler, NOT by pre-projecting one skill per offering onto the AgentCard. A
     * member is in N circles with DIFFERENT requestable policies AND a different task
     * store per circle, and invariant #6 is one-agent — so the single dispatcher takes
     * `{ contextId, key }` and resolves the right policy + per-circle store per call.
     * Pre-projecting N per-offering handlers would fan the one agent out per circle.
     *
     * DISCOVERY/ADVERTISEMENT stays a SEPARATE seam: `offeringsToSkillDefinitions`
     * (@onderling/item-store) is the offering→AgentCard projector (NOTE volley 3) —
     * deliberately NOT built in this pass. */
    hostAgent.register('requestOffering', async ({ parts, from }) => {
      try {
        const args      = parts?.[0]?.data ?? {};
        const contextId = String(args.contextId ?? '').trim();
        const key       = String(args.key ?? '').trim();
        if (!contextId || !key) return [DataPart({ ok: false, error: 'contextId-and-key-required' })];

        // Persona for this context. No explicit persona↔circle binding exists in this
        // factory yet, so default to the 'default' profile (the no-login pseudonym) —
        // the same profile the rest of this block treats as this device's identity.
        const profileId = 'default';
        const self      = await agentsRegistry.lookup(profileId);

        // THE GUARD — a non-requestable offering mints NOTHING.
        if (!isRequestable(self?.disclosure ?? { perContext: {} }, contextId, key)) {
          return [DataPart({ ok: false, error: 'not-requestable' })];
        }

        // Find the offering — a skill-kind driver on the persona. Registry `properties`
        // are stored in the own/inherit envelope ({ mode, value }); resolve to EFFECTIVE
        // (unwrapped) values before `driversFromProperties` reads the driver shapes.
        const props  = effectiveProperties((id) => (id === profileId ? self : null), profileId, { defaultProfileId: 'default' });
        const driver = driversFromProperties(props)[key];
        if (!driver) return [DataPart({ ok: false, error: 'no-such-offering' })];
        const offering = { key, ...driver };   // stamp the key for source-provenance legibility

        // The recipient's task surface for THAT circle — the per-circle CircleItemStore
        // (the established accessor, as the household wired path uses). `recipient` is this
        // device's local household member webid — the same local webid the addMember / seed
        // / calendar host ops use, so the minted task's `forMember` is legible alongside them.
        const recipient = 'webid:local-demo-user';
        const taskStore = createTaskStore(householdService.stores.getStore(contextId), {});

        const res = await requestableSkillHandler({ taskStore, offering, recipient, contextId })({
          from,
          requestText: typeof args.requestText === 'string' ? args.requestText : undefined,
        });
        return [DataPart(res)];   // { created:true, taskId, status:'pending', task }
      } catch (e) {
        return [DataPart({ ok: false, error: e?.message ?? 'request-failed' })];
      }
    }, { visibility: 'authenticated' });
  }

  // v0.4 — household membership demo.  The real manifest declares
  // `registerName` (writes a `contact` item); the legacy `/addmember`
  // membership demo + the cross-app follow-up chain (followUps.js) still
  // reference an `addMember` op, so keep a thin shim that records the member
  // as a real contact item AND returns the `{memberName}` shape the demo +
  // membership-redemption path expect.  (registerName is also wired above via
  // the registry, reachable through the manifest's /register surface.)
  hostAgent.register('addMember', async ({ parts, from }) => {
    const args = parts?.[0]?.data ?? {};
    const name = String(args.name ?? '').trim();
    if (!name) {
      return [DataPart({ ok: false, error: 'name required' })];
    }
    try {
      await householdService.stores.getStore('household').put(
        { type: 'contact', text: name, addedBy: from ?? 'webid:local-demo-user' },
        { by: from ?? 'webid:local-demo-user' },
      );
    } catch { /* defensive — the member reply doesn't depend on the write */ }
    return [DataPart({
      ok:         true,
      message:    `✓ Added member: ${name}`,
      memberName: name,
    })];
  });

  // v0.5 — snapshot factory for the J7 embed primitive. Consumed by
  // basis's /embed built-in.  Reads a real household item by id (or
  // id-prefix / keyword) from the store and shapes it as an ItemSnapshot.
  hostAgent.register('getChoreSnapshot', async ({ parts }) => {
    const id = String(parts?.[0]?.data?.choreId ?? '').trim();
    const open = await householdApp.listOpen(householdService.stores.getStore('household'), {});
    const target = open.find((it) => it.id === id)
      ?? (id.length >= 4 ? open.find((it) => it.id.startsWith(id.toUpperCase())) : null)
      ?? open.find((it) => it.text.toLowerCase().includes(id.toLowerCase()));
    if (!target) {
      return [DataPart({ ok: false, error: `No item with id "${id}".` })];
    }
    return [DataPart({
      id:    target.id,
      type:  target.type,
      state: 'open',
      title: target.text,
      fields: {
        state:       'open',
        assigned_to: target.claimedBy ?? target.assignee ?? 'unassigned',
      },
    })];
  });

  // v0.7.6 — resolveContact convention.  Returns webid + display
  // name when the query matches a known household member.
  hostAgent.register('resolveContact', async ({ parts }) => {
    const query = String(parts?.[0]?.data?.query ?? '').toLowerCase();
    // Demo-only contact directory (Anne/Karl/Maria). Empty in a real install so
    // resolveContact answers an honest "no contact matches" until real members
    // exist; the named contacts return only under the opt-in seedDemoData flag.
    const members = seedDemoData ? [
      { displayName: 'Anne',  webid: 'webid:anne',  handle: 'anne'  },
      { displayName: 'Karl',  webid: 'webid:karl',  handle: 'karl'  },
      { displayName: 'Maria', webid: 'webid:maria', handle: 'maria' },
    ] : [];
    const exact = members.find((m) => m.handle === query || m.displayName.toLowerCase() === query);
    if (exact) return [DataPart({ ...exact, confidence: 'exact' })];
    const fuzzy = members.find((m) => m.displayName.toLowerCase().includes(query) && query.length >= 2);
    if (fuzzy) return [DataPart({ ...fuzzy, confidence: 'fuzzy' })];
    return [DataPart({ ok: false, error: `No contact matches "${query}"` })];
  });

  /* ─── Identity: owner-root reveal + restore (step 1b) ────────────────────────
   * The ONE recovery phrase that re-derives every profile — including the feedback
   * no-login pseudonym (the default-profile chat identity). Host skills so they can
   * close over the owner root (created above); reached via callSkill('household', …).
   * Deliberately NOT the stoop `getMnemonicOnce` (that reveals the unrelated stoop
   * sub-agent seed) and NOT the shared `restoreFromMnemonic` (legacy direct-seed).
   */
  hostAgent.register('revealOwnerPhrase', async () => {
    // Re-revealable: backing up the phrase again is legitimate; the phrase is stable.
    try { return [DataPart({ shown: false, mnemonic: ownerRoot.toMnemonic() })]; }
    catch (e) { return [DataPart({ ok: false, error: e?.message ?? 'reveal-failed' })]; }
  }, { visibility: 'trusted' });   // 2.4b — the master recovery phrase: owner-only

  hostAgent.register('restoreOwnerPhrase', async ({ parts }) => {
    const mnemonic = String(parts?.[0]?.data?.mnemonic ?? '').trim();
    let root;
    try { root = Bootstrap.fromMnemonic(mnemonic); }
    catch { return [DataPart({ ok: false, error: 'invalid-phrase' })]; }
    try {
      // Persist the owner root + re-derive the default profile into the chat vault.
      // The live chatAgent keeps its current identity until an app RELOAD re-boots
      // realAgent, which then restores this seed + owner root.
      await ownerRootVault.set('owner-phrase', root.toMnemonic());
      await AgentIdentity.fromSeed(root.deriveAgentSeed('default'), chatVault);
      return [DataPart({ ok: true, reloadRequired: true })];
    } catch (e) { return [DataPart({ ok: false, error: e?.message ?? 'restore-failed' })]; }
  }, { visibility: 'trusted' });   // 2.4b — overwrites the owner root: owner-only


  /* folio's web-only handlers used to live here (~125 lines of mock-
   * real handlers registered on hostAgent). of the
   * integration-plan-2026-05-23 moved them into a dedicated browser
   * agent — see the `createBrowserFolioAgent` boot block below the
   * tasks/stoop blocks, and the 'folio' branch in `callSkill`.
   *
   * shareFolder now issues a REAL PodCapabilityToken via
   * autoShare.mintShareToken; the other skills retained their
   * placeholder reply shapes (real bytes/pod-IO is deferred to slice
   * 5 + the mobile pivot).
   */

  /* Identity step 2.4a/2.4b — attach a PolicyEngine to hostAgent so scoped access is ENFORCED
   * (the gate was structurally absent: hostAgent.policyEngine was null, so taskExchange/A2ATransport
   * skipped it for host traffic). 2.4b raised the owner-only CONTROL + secret-material skills
   * (grant/revoke/purge/install/restoreDataVersion/reveal/restoreOwnerPhrase) to 'trusted'. hostAgent
   * is IN-PROCESS ONLY (InternalTransport; no external peer can reach it), so the sole caller is the
   * chat agent — SEED its pubKey as 'trusted' below so those raised skills stay reachable in-process.
   * Reads stay 'authenticated'. Revocation feeds from the issuer-side agentsTokenRegistry. Best-effort:
   * a failure leaves the gate absent (prior behaviour) — never breaks boot. */
  try {
    // Vault-backed TrustRegistry: unknown peers → 'authenticated'; the seeded chat identity → 'trusted'.
    const hostTrustRegistry = new TrustRegistry(opts.hostTrustVault ?? makeBrowserVault('cc-host-trust:'));
    hostAgent.policyEngine = new PolicyEngine({
      trustRegistry: hostTrustRegistry,
      skillRegistry: hostAgent.skills,
      agentPubKey:   hostId.pubKey,
      isRevoked:     async (tokenId) => Boolean(await agentsTokenRegistry?.isRevoked(tokenId)),
    });
    // The in-process chat caller is the owner's device — trust it so it clears the 'trusted' host ops.
    await hostTrustRegistry.setTier(chatId.pubKey, 'trusted');
  } catch (e) { console.warn('[realAgent] hostAgent PolicyEngine attach skipped:', e?.message ?? e); }

  await Promise.all([
    hostAgent.start(),
    chatAgent.start(),
    ...(householdAgent ? [householdAgent.start()] : []),   // B1 — the wireSkill household agent (flag-on)
  ]);

  // hello-exchange so each agent knows the other.  InternalBus
  // delivers synchronously enough that one hello is sufficient.
  await chatAgent.hello(hostAgent.address);
  // B1 — seed chatAgent's SecurityLayer with the household agent's key so
  // `chatAgent.invoke(householdAgent.address, …)` takes the S1 fast-path.
  if (householdAgent) await chatAgent.hello(householdAgent.address);

  // Seed a few household items so `/list shopping` + `/brief` are non-empty
  // out of the box.  Deterministic order (added oldest-first); skip via
  // opts.seedHousehold:false (clean-slate fixtures).
  if (opts.seedHousehold !== false) {
    const seedStore = householdService.stores.getStore('household');
    for (const seed of SEED_HOUSEHOLD_ITEMS) {
      try {
        await householdApp.addItem(seedStore, { type: seed.type, text: seed.text }, { by: 'webid:local-demo-user' });
      } catch (err) {
        if (typeof console !== 'undefined') {
          console.warn('[realAgent] seed household item failed:', err?.message ?? err);
        }
      }
    }
  }

  /* ─── tasks-v0 real circle agent (— integration plan
   *     2026-05-23) ─────────────────────────────────────────────
   *
   * Replaces the previous mock-task handlers (~210 lines) with
   * the actual tasks-v0 Circle agent composed in-process.  Boots
   * 110 real skills (addTask, claimTask, completeTask, submitTask,
   * approveTask, rejectTask, listMyInbox, listOpen, listMine,
   * getTaskSnapshot, provisionMyCircle, …).
   *
   * Separate identity vault prefix so circle identity is isolated
   * from chat identity (per integration-plan decision #2).
   */
  const tasksIdentityVault = opts.tasksIdentityVault
    ?? makeBrowserVault('cc-tasks-id:');
  // Register the chatAgent's pubKey as the local member ("admin")
  // AND keep the legacy webid:* members for demo cross-actor tests.
  // Real tasks-v0 skills use `from` (caller) to look up the actor's
  // role; without the chatAgent's pubKey in the member list, every
  // call from basis would be treated as a stranger + denied
  // by RolePolicy.
  const tasksCircle = await createBrowserMultiCircleTasksAgent({
    bus,
    identityVault: tasksIdentityVault,
    primaryCircleConfig: opts.tasksCircleConfig ?? {
      circleId:  'cc-default',
      name:    'Canopy-chat tasks',
      kind:    'household',
      members: [
        // chatAgent's pubKey is what tasks-v0 sees as `from`; bind
        // it to the local-demo-user webid + admin role. This is the
        // only real member of a fresh circle — the creator.
        { webid: chatId.pubKey, displayName: 'me', role: 'admin' },
        // Demo-only aliases (Anne/Karl/Maria) — gated behind the opt-in
        // seedDemoData flag (OFF by default) so a fresh REAL circle's roster
        // holds only real members. With the flag on they let the demo +
        // journey fixtures that mention these webids resolve to circle members.
        ...(seedDemoData ? [
          { webid: 'webid:anne',  displayName: 'Anne',  role: 'coordinator' },
          { webid: 'webid:karl',  displayName: 'Karl',  role: 'member'      },
          { webid: 'webid:maria', displayName: 'Maria', role: 'member'      },
        ] : []),
      ],
    },
    // Mirrors `opts.stoopPersistDb` below.  Browser passes
    // `{dbName:'cc-tasks-state', storeName:'items'}` (IDB); mobile
    // gets `{dbName:'cc-tasks-cache', asyncStorage}` (AsyncStorage)
    // synthesised by basis-mobile/agentBundle.js.  Without it,
    // the tasks cache stays Map-only and every reload re-seeds the
    // 4 demo tasks (the data-loss bug behind the
    // `cc.firstBootSeeded.v1` workaround in App.js).
    persistDb: opts.tasksPersistDb,
    label: 'TasksCircle(cc)',
  });
  await chatAgent.hello(tasksCircle.address);

  // Pre-seed the demo circle with 4 starter tasks — the demo + journey
  // fixtures expect /mytasks to show these out of the box.  DEMO-ONLY: a real
  // circle gets no phantom tasks, so this is gated behind the opt-in
  // seedDemoData flag (OFF by default).  seedTasks:false is still honoured as
  // an independent clean-slate opt-out (e.g. persistence tests).
  //
  // Perf #1 (2026-05-30): also skip seeding when the circle already
  // has tasks (warm-boot after persisted storage).  One cheap listOpen
  // probe avoids 4 sequential addTask round-trips that were blocking
  // every boot on mobile.  Fail-open: if the probe errors, seed anyway.
  if (seedDemoData && opts.seedTasks !== false) {
    let alreadySeeded = false;
    try {
      const probe  = await chatAgent.invoke(tasksCircle.address, 'listOpen', [DataPart({})]);
      const data   = Array.isArray(probe) ? probe[0]?.data : null;
      const items  = Array.isArray(data?.items) ? data.items : [];
      alreadySeeded = items.length > 0;
    } catch { /* fall through — seed anyway */ }
    if (!alreadySeeded) {
      const SEED_TASKS = [
        { text: "Set up Anne's bedroom", requiredSkill: 'household' },
        { text: 'Fix the leaky tap',     requiredSkill: 'plumbing'  },
        { text: 'Order groceries',       assignee: 'webid:anne'     },
        { text: 'Take out the bins',     assignee: 'webid:karl'     },
      ];
      for (const seed of SEED_TASKS) {
        try {
          await chatAgent.invoke(tasksCircle.address, 'addTask', [DataPart(seed)]);
        } catch (err) {
          if (typeof console !== 'undefined') {
            console.warn('[realAgent] seed task failed:', err.message ?? err);
          }
        }
      }
    }
  }

  // 2026-05-24 — track circles provisioned via /circle-new at runtime.
  // The tasks-v0 agent runs in single-circle topology (one CircleState
  // wired at boot); provisionMyCircle persists a config to the
  // dataSource but doesn't instantiate a CircleState the dashboard
  // can see.  Until multi-circle topology lands as a separate slice
  // (ish), the /circles adapter appends these "pending"
  // entries so the user gets visible feedback on /circle-new.
  const provisionedCircles = new Map();   // circleId → {name, kind, provisionedAt}

  /* ─── stoop real agent (integration plan 2026-05-23) ──
   *
   * Replaces the previous mock-stoop handlers (~85 lines: listFeed,
   * postRequest, searchPosts, stoop_briefSummary, getStoopProfile,
   * revealPeer) with the actual Stoop NeighborhoodAgent composed
   * in-process.  Boots 110 real stoop skills; ~6 surface via chat
   * ops today, the rest reachable via agent.callSkill('stoop', …).
   *
   * Separate identity vault prefix (`cc-stoop-id:`) so stoop's per-
   * buurt identity is isolated from chat + tasks (decision #2).
   * IndexedDBPersist via opts.persistDb keeps the local cache alive
   * across page reloads.
   */
  const stoopIdentityVault = opts.stoopIdentityVault
    ?? makeBrowserVault('cc-stoop-id:');
  const stoopAgent = await createBrowserStoopAgent({
    bus,
    identityVault: stoopIdentityVault,
    // Bind chatAgent's pubKey as the local actor so real stoop
    // skills' `from` lookups resolve back to 'me' (admin role).
    localActor: chatId.pubKey,
    group:      opts.stoopGroup ?? 'cc-default-buurt',
    members:    opts.stoopMembers ?? [
      { webid: chatId.pubKey,     displayName: 'me',    role: 'admin'       },
      // Demo-only phantom members — gated behind seedDemoData (OFF by default)
      // so a fresh REAL buurt's roster shows only the creator + actual joiners.
      ...(seedDemoData ? [
        { webid: 'webid:anne',      displayName: 'Anne',  role: 'coordinator' },
        { webid: 'webid:karl',      displayName: 'Karl',  role: 'member'      },
        { webid: 'webid:maria',     displayName: 'Maria', role: 'member'      },
      ] : []),
    ],
    persistDb:  opts.stoopPersistDb,   // browser IDB; opt-in via caller
    // S4 — per-circle control-agent router: redeem→addMember / leave→removeMember route
    // to the joined circle's sealed-pod producer (multi-member sealing). Opt-in; absent
    // → membership hooks no-op (the pre-S4 behaviour).
    controlAgent: opts.stoopControlAgent,
    // Route kring chat fan-out through the SAME reliable choke durable circle content uses:
    // `sa.peer.sendTo(..., {guarantee:'hold-forward'})`. This is what gives a kring chat
    // failover (`_sendWithFailover`) + offline hold-forward — the reliability the bus-local
    // `chat.send` transport (stoop's own in-process agent) never had. The stoop skill builds a
    // conforming `kring-chat-message` envelope and calls this per recipient; a briefly-offline
    // member has the message HELD and flushed on reconnect, exactly like a task/noticeboard fan.
    reliableSend: (to, envelope, sendOpts = {}) =>
      sa.peer.sendTo(to, envelope, { guarantee: 'hold-forward', ...sendOpts }),
    // Connectivity Phase 3 — LIVE shared-pod key-custody seams (host-injected by circleApp over each
    // circle's per-circle StorageBackend + its live group-key {seal,open}). All keyed by circleId so the
    // ONE stoop agent resolves each circle's member-side custody per call (invariant #6):
    //   • circleDataMove(circleId)          → the send-path data-move branch (policy.pod).
    //   • podWrite(circleId, envelope)      → seal+write a chat row, return its opaque pod ref (pod-signal fan).
    //   • podReadSince(circleId, {sinceTs}) → range-query + open the shared pod (getMessagesSince catch-up merge).
    // Absent (opt not supplied) → the pre-Phase-3 behaviour, unchanged: fan-out-full / local-mirror reads.
    circleDataMove: opts.stoopCircleDataMove,
    podWrite:       opts.stoopPodWrite,
    podReadSince:   opts.stoopPodReadSince,
    label:      'StoopAgent(cc)',
  });
  await chatAgent.hello(stoopAgent.address);

  // Pre-seed the local actor's stoop handle + displayName so
  // /stoop-profile has something to show (real getMyProfile returns
  // {entry: null} until the user first sets these).  Opts out with
  // seedStoopProfile:false.
  if (opts.seedStoopProfile !== false) {
    try {
      await chatAgent.invoke(stoopAgent.address, 'setMyHandle', [DataPart({
        handle: opts.stoopHandle ?? 'nieuwe-buur',
      })]);
      await chatAgent.invoke(stoopAgent.address, 'setMyDisplayName', [DataPart({
        displayName: opts.stoopDisplayName ?? 'Nieuwe buur',
      })]);
    } catch (err) {
      if (typeof console !== 'undefined') {
        console.warn('[realAgent] seed stoop profile failed:', err.message ?? err);
      }
    }
  }

  // Pre-seed 3 demo posts so /feed has content out of the box.  DEMO-ONLY
  // (the posts name the demo members) — a real buurt starts with an empty
  // feed, so this is gated behind the opt-in seedDemoData flag (OFF by
  // default).  seedStoopPosts:false remains an independent opt-out.
  //
  // Perf #1 (2026-05-30): skip when stoop already has open posts
  // (warm-boot after persisted storage).  One listOpen probe avoids 3
  // sequential postRequest round-trips that were blocking every boot.
  if (seedDemoData && opts.seedStoopPosts !== false) {
    let alreadySeeded = false;
    try {
      const probe = await chatAgent.invoke(stoopAgent.address, 'listOpen', [DataPart({})]);
      const data  = Array.isArray(probe) ? probe[0]?.data : null;
      const items = Array.isArray(data?.items) ? data.items : [];
      alreadySeeded = items.length > 0;
    } catch { /* fall through — seed anyway */ }
    if (!alreadySeeded) {
      const SEED_POSTS = [
        { kind: 'ask',   text: 'Anne needs help moving a couch' },
        { kind: 'offer', text: 'Karl offers tomato seedlings'   },
        { kind: 'ask',   text: 'Maria looking for a bike pump'  },
      ];
      for (const seed of SEED_POSTS) {
        try {
          await chatAgent.invoke(stoopAgent.address, 'postRequest', [DataPart(seed)]);
        } catch (err) {
          if (typeof console !== 'undefined') {
            console.warn('[realAgent] seed stoop post failed:', err.message ?? err);
          }
        }
      }
    }
  }

  /* ─── folio web-only agent (integration plan 2026-05-23) ──
   *
   * Replaces the previous in-host folio handlers (~125 lines: readNote
   * / shareFolder / listFiles / searchFiles / getFileSnapshot /
   * verifyPodState / deleteFromPod / downloadFile / saveToMyPod /
   * folio_briefSummary / folioStatus) with a dedicated folio agent
   * composed in-process.  shareFolder now issues a REAL
   * PodCapabilityToken via autoShare.mintShareToken; the other skills
   * preserve their mock-era reply shapes (real pod-IO + Blob bytes
   * stay deferred per the slice-4 scope reduction).
   *
   * Separate identity vault prefix (`cc-folio-id:`) so folio's web
   * identity is isolated from chat / tasks / stoop (decision #2).
   * podRoot is reserved — when basis lands real pod-attached
   * folio writes (mobile), pass `opts.folioPodRoot` so
   * shareFolder tokens carry the real pod URI.
   */
  const folioIdentityVault = opts.folioIdentityVault
    ?? makeBrowserVault('cc-folio-id:');
  const folioAgent = await createBrowserFolioAgent({
    bus,
    identityVault: folioIdentityVault,
    podRoot:       opts.folioPodRoot,
    seedFiles:     opts.folioSeedFiles,   // pass [] for clean-slate fixtures
    label:         'FolioAgent(cc)',
    // 52.25 — the `/zoek` semantic embedder. Absent ⇒ lexical-only (the
    // default; llmTool:'off' / no Ollama). The circle shell wires the
    // policy-resolved embedder post-boot via `setFolioNoteEmbedder`, so no
    // embed call is ever made unless the circle's embed policy permits.
    noteEmbedder:  opts.folioNoteEmbedder,
  });
  await chatAgent.hello(folioAgent.address);

  /**
   * basis's CallSkill shape: `(appOrigin, opId, args) → payload`.
   *
   * Routing targets:
   *   - 'household'  → hostAgent (chores, members, calendar skills)
   *   - 'tasks'      → tasksCircle.address (the REAL tasks circle agent
   *                    via slice-1 integration; 110 skills).  Part G
   *                    (2026-06-17): the app-origin is now `'tasks'`
   *                    (was `'tasks-v0'`) — the merged manifest's
   *                    `.app` is `'tasks'`, and the catalog keys ops
   *                    by `m.app`.  The directory / npm package
   *                    (`@onderling-app/tasks`) keep their names.
   *   - 'stoop'      → stoopAgent.address (slice-2b NeighborhoodAgent)
   *   - 'folio'      → folioAgent.address (slice-4 web-only agent)
   *
   * Some opIds are renamed across the boundary (the chat surface
   * uses `myInbox` historically; the real tasks circle exposes
   * `listMyInbox`).  These SEMANTIC aliases are product decisions
   * (NOT drift); adapt here so the chat-shell renderer stays stable.
   */
  const TASKS_OP_ALIAS = {
    myInbox:  'listMyInbox',                  // basis → real tasks circle
    // listMine on real tasks-v0 filters by t.assignee === from (only
    // tasks ALREADY assigned to me).  The chat-shell semantic of
    // /mytasks is broader — "everything actionable in my circle".  Map
    // to listOpen so the chat user sees what they expect.
    listMine: 'listOpen',
    // F1 circle content (5.3) — `loadCircleItems` reads a circle's
    // tasks via the unique source op `getMyTasks` (no app defines it,
    // so `makeResolvingCallSkill` probes past stoop/household and lands
    // here).  Map to listOpen scoped to the resolved circle (= circle).
    getMyTasks: 'listOpen',
    // briefSummary / searchTasks: tasks-v0 doesn't expose these as
    // own skills today; basis derives them from listOpen below.
  };

  /**
   * Map real tasks-v0 status → chat-shell `state` field.
   *
   * Real status values (from item-store dag.js effectiveStatus):
   *   ready / blocked / claimed / submitted / rejected / complete
   * Chat-shell expects (mock-era):
   *   open / claimed / done
   *
   * 'rejected' goes back to 'claimed' (assignee can retry).
   * 'blocked' surfaces as 'open' for the chat-shell (UI gates the
   * action by openDeps.length).
   */
  function _statusToChatState(status, task) {
    if (task?.completedAt || status === 'complete') return 'done';
    if (status === 'submitted') return 'submitted';
    if (status === 'rejected')  return 'claimed';
    if (status === 'claimed' || task?.assignee) return 'claimed';
    return 'open';   // ready / blocked / undefined
  }

  /**
   * Stoop opId aliases — chat-shell vocabulary → real skill name.
   *   /feed       → listOpen     (no `listFeed` in real stoop)
   *   /stoop-profile → getMyProfile
   *
   * Part G dissolve (2026-06-17) — the `revealPeer → setPeerReveal`
   * alias was DROPPED: the `revealPeer` op no longer exists (the
   * `/reveal` collision was resolved by keeping ONE op, `setPeerReveal`,
   * in the merged manifest).  `setPeerReveal` dispatches directly; the
   * `peer→peerWebid` + `action→reveal` value transforms below STAY.
   *
   * F1 circle content (5.3d) — `loadCircleItems` reads a circle's
   * stoop posts via the source ops `getBulletin` / `getFeed`.  Stoop
   * has neither as a real skill; both are aspirational names in
   * `circleContent.DEFAULT_SOURCES`.  `makeResolvingCallSkill` probes
   * stoop first (`DEFAULT_CIRCLE_ORIGINS`), so aliasing `getBulletin`
   * here lands the call on the real `listOpen` per-circle reader.
   * `getFeed` stays un-aliased so the resolver falls through every
   * origin → null → no duplicate items (otherwise both source ops
   * would resolve to the same store and each post would appear
   * twice).  Same alias pattern tasks-v0 uses for
   * `getMyTasks → listOpen` above.
   */
  const STOOP_OP_ALIAS = {
    listFeed:        'listOpen',
    getStoopProfile: 'getMyProfile',
    // `getBulletin` is NOT a manifest op — it's a circleContent source
    // op (circleContent.DEFAULT_SOURCES); aliasing it to listOpen lands
    // per-circle reads on the real reader.  KEPT (used by circleContent).
    getBulletin:     'listOpen',
  };

  // 2026-05-24 — retry-on-HI-race now lives in secure-agent's
  // sendToPeer (task). sa.peer.sendTo handles it transparently.
  // Wrapper alias kept for the existing fan-out callsite so the diff
  // stays small; new code can call sa.peer.sendTo directly.
  // The one caller is the buurt-post/request fan-out (durable circle content), so it
  // rides with the hold-forward delivery guarantee: a member offline at fan time has
  // the post HELD and delivered on reconnect rather than dropped. Online delivery is
  // unchanged (reachable peer delivered immediately).
  const _saSendWithRetry = (sa, addr, payload) => sa.peer.sendTo(addr, payload, { guarantee: 'hold-forward' });

  /**
   * 2026-05-24 — list the buurts this user has peer-confirmed
   * memberships in (their own `membership-redemption` items).
   * Used by the cross-instance /post fan-out to decide WHICH
   * rosters to address when the caller didn't pin an explicit
   * group.  Dedupes + skips empty.
   */
  // ── G7: live presence, scoped to what a caller already knows ────────────────
  //
  // `reachable-peers` answers "which peers can this device reach directly?" with a SIGNED list — which is a
  // contact graph, not neutral routing metadata. The skill is `authenticated`, so before it is enabled the
  // host must say what each CALLER may learn; `registerReachablePeersSkill` discloses nothing without a
  // scope (deny-by-default, see packages/core/src/skills/reachablePeers.js).
  //
  // basis's answer: **you learn only about peers you already share a circle with.** A co-member already
  // holds that roster, so telling them "I can reach Bram" adds a reachability fact rather than an identity.
  // Everyone else learns nothing, and a withheld peer is ABSENT rather than marked, so a stranger cannot
  // tell whether this device has peers at all.
  //
  // Enabled AFTER the roster seams below exist, and idempotent — `enableReachabilityOracle` returns early
  // if the skill is already registered.
  function _enableReachabilityOracle() {
    try {
      chatAgent.enableReachabilityOracle({
        peerScope: makeSharedCirclePeerScope({
          myCircleIds: () => _listMyKnownBuurts(),
          rosterOf: async (circleId) => {
            const reply = await chatAgent.invoke(
              stoopAgent.address, 'listGroupRoster', [DataPart({ groupId: circleId })],
            );
            return reply?.[0]?.data?.members ?? [];
          },
        }),
      });
    } catch (err) {
      // Presence is an enhancement, never a boot dependency: a device that cannot answer "who can I reach"
      // still sends and receives. Log rather than fail the agent.
      console.info('[realAgent] reachability oracle not enabled:', err?.message ?? err);
    }
  }

  async function _listMyKnownBuurts() {
    try {
      const result = await chatAgent.invoke(
        stoopAgent.address, 'listMyBuurts', [DataPart({})],
      );
      const buurts = result?.[0]?.data?.buurts ?? [];
      return Array.isArray(buurts) ? buurts : [];
    } catch {
      return [];
    }
  }

  /**
   * F1 5.3d — read the post's first `kind:'group'` target groupId
   * off the substrate item.  Stoop persists per-call targets under
   * `source.targets[]`; basis's circle-scope filter
   * (`circleScope.itemCircleId`) reads top-level `item.groupId`.
   * The listOpen-reply adapter uses this to bridge the two.
   */
  function _groupIdFromTargets(item) {
    const ts = item?.source?.targets;
    if (!Array.isArray(ts)) return undefined;
    const groupTarget = ts.find((t) => t?.kind === 'group' && typeof t.groupId === 'string');
    return groupTarget?.groupId;
  }

  /** Slugify a name → safe circleId for provisionMyCircle. */
  function _slugifyCircleId(name) {
    const slug = String(name ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30) || 'circle';
    return /^[a-z0-9]/.test(slug) ? slug : `c-${slug}`;
  }

  const callSkill = async (appOrigin, opId, args) => {
    // §1b 1d — generic-capability dispatch. A synthetic op-id (`__generic__:app:atom:noun`)
    // carries a manifest-DECLARED noun that has no bespoke op-id; decode it at the waist and
    // route to the app's capability entry ("declare a noun → get CRUD free"). ADDITIVE: a
    // normal (non-generic) opId isn't matched here and flows to the branches below unchanged.
    if (isGenericOpId(opId)) {
      const g = decodeGenericOpId(opId);
      // household is the only app with a capability entry today; `by`/`circleId` are sourced
      // exactly like the bespoke household path below (chatId.pubKey actor · resolved circle).
      if (g?.app === 'household' && householdService) {
        return householdService.callCapability(g.atom, g.noun, args ?? {}, {
          circleId: resolveHouseholdCircleId(args),
          by:       chatId?.pubKey,
        });
      }
      // An app with no generic handler → a structured error, mirroring how callSkill
      // surfaces skill errors (never throw for this boundary case).
      return { ok: false, error: 'generic-capability-unavailable' };
    }
    if (appOrigin === 'household') {
      const circleId = resolveHouseholdCircleId(args);
      // The DISSOLVED cores route through the uniform invoke to the wireSkill-wrapped pure cores on the
      // dedicated household agent (S1 InternalTransport fast-path + the callSkill security gate). circleId
      // is injected into the DataPart args so the wired `storeFor` resolves the per-circle CircleItemStore.
      if (HOUSEHOLD_WIRED_OPS.has(opId)) {
        // Wire this circle's CircleItemStore ↔ its peer mirror (publish + inbound), once per circle.
        await ensureHouseholdCircleSync(circleId);
        const parts = await chatAgent.invoke(householdAgent.address, opId, [DataPart({ ...(args ?? {}), circleId })]);
        const data  = Array.isArray(parts) ? parts[0]?.data : null;
        return adaptWiredHouseholdReply(opId, data, args);
      }
      // /brief contributor — derived from the wired store (the dissolved app has no briefSummary core).
      if (opId === 'household_briefSummary') return householdBriefSummary(circleId);
      // Everything else on the 'household' app-origin (calendar_* passthrough, addMember, getChoreSnapshot,
      // resolveContact, help, registerName) is a hostAgent skill — route it there unchanged.
      const parts = [DataPart(args ?? {})];
      const result = await chatAgent.invoke(hostAgent.address, opId, parts);
      const first = Array.isArray(result) ? result[0] : null;
      return first?.data ?? null;
    }
    if (appOrigin === 'tasks') {
      // Derived ops (not in the real circle agent): build the reply
      // from listMine + a small shape adapter.
      if (opId === 'briefSummary' || opId === 'tasks_briefSummary') {
        const list = await callSkill('tasks', 'listMine', {});
        const items = (list?.items ?? []).filter((t) => t.state === 'open');
        if (items.length === 0) return { ok: true };   // empty → /brief skips
        return {
          items:   items.map((t) => ({ id: t.id, label: t.text ?? t.title })),
          message: `${items.length} open task${items.length === 1 ? '' : 's'}`,
        };
      }
      if (opId === 'searchTasks') {
        const q = String(args?.query ?? '').toLowerCase();
        if (!q) return { items: [] };
        const list = await callSkill('tasks', 'listMine', {});
        const hits = (list?.items ?? []).filter((t) =>
          String(t.text ?? t.title ?? '').toLowerCase().includes(q),
        );
        return {
          items: hits.map((t) => ({ id: t.id, label: t.text ?? t.title, type: 'task' })),
        };
      }
      const realOpId = TASKS_OP_ALIAS[opId] ?? opId;
      // Per-op arg normalisation between the chat-shell vocabulary
      // and tasks-v0's real skill arg names.  NB the rejectTask
      // `reason→note` rewrite + the submitTask note-default were REMOVED
      // in the Part G dissolve (2026-06-17): the manifest now declares
      // the real `note` param directly, so no shell-side vocab bridge.
      let realArgs = args ?? {};
      if (realOpId === 'provisionMyCircle' && !realArgs.circleId && realArgs.name) {
        // /circle-new sends a human name; real skill demands a slug.
        realArgs = { ...realArgs, circleId: _slugifyCircleId(realArgs.name) };
      }
      // Pass through any reject note so the adapter can append it
      // to the chat-shell reply message.
      const noteHint = (realOpId === 'rejectTask') ? realArgs.note : undefined;
      if (realOpId === 'issueInvite') {
        // Chat-shell flag `ttl-hours` → real arg `ttlMs`.  Default 24h
        // when omitted.
        const hours = Number.isFinite(Number(realArgs['ttl-hours']))
          ? Number(realArgs['ttl-hours']) : 24;
        realArgs = { ...realArgs, ttlMs: hours * 60 * 60 * 1000 };
      }
      // (B3) — circle admin skills require circleId; auto-inject
      // from the configured circle so the user doesn't have to type it.
      const CIRCLE_AUTO_INJECT = new Set([
        'getCircleConfig', 'pauseCircle', 'unpauseCircle',
        'archiveCircle',   'unarchiveCircle', 'issueInvite',
        'listAwaitingApproval', 'getMyCircles',
        'suggestSchedule', 'acceptSchedule',
        'getMyAvailability', 'setMyAvailability', 'setAvailabilityOptIn',
        'getCircleAvailability', 'listCircleMembers',
      ]);
      // 2026-05-24 — listCircleMembers is a derived op (no real skill);
      // dispatch to getCircleConfig + the adapter unpacks members[].
      if (realOpId === 'listCircleMembers') {
        realArgs = { ...realArgs, _derivedFromGetCircleConfig: true };
        // Swap to the real skill name; adapter inspects opId (not
        // realOpId) so it still hits the listCircleMembers branch.
        const parts = [DataPart({ circleId: realArgs.circleId })];
        const result = await chatAgent.invoke(tasksCircle.address, 'getCircleConfig', parts);
        const first = Array.isArray(result) ? result[0] : null;
        return adaptTasksReply('listCircleMembers', first?.data ?? null);
      }
      if (CIRCLE_AUTO_INJECT.has(realOpId) && !realArgs.circleId) {
        const circleId = opts.tasksCircleConfig?.circleId ?? 'cc-default';
        realArgs = { ...realArgs, circleId };
      }
      if (realOpId === 'archiveCircle' && realArgs.confirm !== true) {
        // two-step confirm.
        return {
          ok: false,
          error: 'Archiving the circle puts it read-only. Re-run with --confirm=true to proceed.',
        };
      }
      if (realOpId === 'suggestSchedule' && realArgs['lookahead-days']) {
        realArgs = {
          ...realArgs,
          lookaheadDays: Number(realArgs['lookahead-days']),
        };
      }
      if (realOpId === 'acceptSchedule' && realArgs.slotKey) {
        // decode "taskId|slotStart|slotEnd" packed into row id.
        const parts = String(realArgs.slotKey).split('|');
        if (parts.length === 3) {
          realArgs = {
            ...realArgs,
            taskId:    parts[0],
            slotStart: Number(parts[1]),
            slotEnd:   Number(parts[2]),
          };
        }
      }
      if (realOpId === 'setMyAvailability' && realArgs.cellKey) {
        // decode "week|day|half|state" packed into the cell id.
        // day: 0-6 (Mon-Sun); half: 'AM'|'PM'; state cycles
        // unknown → open → tight → unavailable → unknown.
        const parts = String(realArgs.cellKey).split('|');
        if (parts.length === 4) {
          realArgs = {
            ...realArgs,
            week:  parts[0],
            day:   Number(parts[1]),
            half:  parts[2],
            state: parts[3],
          };
        }
      }
      if (realOpId === 'setAvailabilityOptIn' && typeof realArgs.on === 'string') {
        // Chat-shell enum 'on'/'off' → real arg {optedIn: boolean}.
        realArgs = {
          ...realArgs,
          optedIn: realArgs.on.toLowerCase() === 'on',
        };
      }
      if (realOpId === 'redeemInvite' && typeof realArgs.invite === 'string') {
        // User pastes either a QR URL (`stoop-invite://<base64url>`) or
        // raw JSON.  Decode the URL form back to the invite object that
        // the real skill expects.  Pass JSON through unchanged.
        let inv = realArgs.invite.trim();
        const PREFIX = 'stoop-invite://';
        if (inv.startsWith(PREFIX)) {
          try {
            const b64 = inv.slice(PREFIX.length);
            const padded = b64.replace(/-/g, '+').replace(/_/g, '/')
                              + '=='.slice(0, (4 - b64.length % 4) % 4);
            const json = typeof globalThis.atob === 'function'
              ? globalThis.atob(padded) : padded;
            realArgs = { ...realArgs, invite: JSON.parse(json) };
          } catch (err) {
            return { ok: false, error: `Couldn't decode invite URL: ${err.message ?? err}` };
          }
        } else if (inv.startsWith('{')) {
          try {
            realArgs = { ...realArgs, invite: JSON.parse(inv) };
          } catch (err) {
            return { ok: false, error: `Couldn't parse invite JSON: ${err.message ?? err}` };
          }
        }
      }
      // F1 multi-circle (5.3) — when the dispatch carries a circle scope
      // (circleId injected by scopeReadyDispatch, or an explicit circle),
      // make sure that circle's circle exists before routing.  Unscoped
      // calls leave circleId unset → resolver falls back to the primary
      // circle (legacy single-circle behaviour).  ensureCircle is idempotent.
      if (typeof realArgs.circleId === 'string' && realArgs.circleId) {
        await tasksCircle.ensureCircle(realArgs.circleId);
      }
      const parts = [DataPart(realArgs)];
      const result = await chatAgent.invoke(tasksCircle.address, realOpId, parts);
      const first = Array.isArray(result) ? result[0] : null;
      const data  = first?.data ?? null;
      if (data && noteHint) data.noteHint = noteHint;
      return adaptTasksReply(opId, data);
    }
    if (appOrigin === 'stoop') {
      // Derived: briefSummary builds a summary from listOpen since
      // stoop doesn't expose its own briefSummary skill.
      if (opId === 'briefSummary' || opId === 'stoop_briefSummary') {
        const list = await callSkill('stoop', 'listFeed', {});
        const items = list?.items ?? [];
        if (items.length === 0) return { ok: true };   // empty → /brief skips
        return {
          items:   items.slice(0, 3).map((p) => ({ id: p.id, label: p.text ?? p.label })),
          message: `${items.length} buurt request${items.length === 1 ? '' : 's'}`,
        };
      }
      // Derived: searchPosts (no dedicated skill in stoop today).
      if (opId === 'searchPosts') {
        const q = String(args?.query ?? '').toLowerCase();
        if (!q) return { items: [] };
        const list = await callSkill('stoop', 'listFeed', {});
        const hits = (list?.items ?? []).filter((p) =>
          String(p.text ?? p.label ?? '').toLowerCase().includes(q),
        );
        return {
          items: hits.map((p) => ({ id: p.id, label: p.text ?? p.label, type: 'post' })),
        };
      }
      const realOpId = STOOP_OP_ALIAS[opId] ?? opId;
      // Arg normalisation between chat-shell vocabulary + real stoop.
      let realArgs = args ?? {};
      if (realOpId === 'setPeerReveal') {
        // Chat-shell sends {peer, action: 'on'/'off'}; real takes
        // {peerWebid, reveal: boolean}.
        if (realArgs.peer && !realArgs.peerWebid) {
          realArgs = { ...realArgs, peerWebid: realArgs.peer };
        }
        if (typeof realArgs.action === 'string' && realArgs.reveal === undefined) {
          realArgs = { ...realArgs, reveal: realArgs.action.toLowerCase() === 'on' };
        }
      }
      // Part G dissolve (2026-06-17) — the markReturned itemId→requestId
      // bridge was REMOVED: the merged manifest declares the real param
      // `requestId` directly (the `/lend-return` gate binds `arg:
      // 'requestId'`), so the chat-shell already sends `requestId` —
      // no shell-side rename needed.
      if (realOpId === 'setHolidayMode') {
        // Chat-shell sends {on: 'on'|'off'} (enum from /holiday-mode
        // <on|off>); real skill takes {on: boolean}.
        if (typeof realArgs.on === 'string') {
          realArgs = { ...realArgs, on: realArgs.on.toLowerCase() === 'on' };
        }
      }
      // Chat-shell trust enums use English ('known' / 'trusted');
      // stoop's underlying skill persists Dutch ('bekend' / 'vertrouwd').
      // Translate at the boundary so the chat surface stays EN-first.
      const TRUST_EN_TO_NL = { known: 'bekend', trusted: 'vertrouwd' };
      if (realOpId === 'listContacts') {
        // Chat-shell flag `min-trust` → real arg `minTrust`.
        if (realArgs['min-trust'] && !realArgs.minTrust) {
          realArgs = {
            ...realArgs,
            minTrust: TRUST_EN_TO_NL[realArgs['min-trust']] ?? realArgs['min-trust'],
          };
        }
      }
      if (realOpId === 'setContactTrust') {
        if (realArgs.level === 'none') {
          // Chat-shell uses 'none' to clear; real skill takes null.
          realArgs = { ...realArgs, level: null };
        } else if (TRUST_EN_TO_NL[realArgs.level]) {
          realArgs = { ...realArgs, level: TRUST_EN_TO_NL[realArgs.level] };
        }
      }
      if (realOpId === 'getContactShareQr' && realArgs.trust) {
        // Chat-shell flag `trust` → real arg `trustOffer` + EN→NL.
        realArgs = {
          ...realArgs,
          trustOffer: TRUST_EN_TO_NL[realArgs.trust] ?? realArgs.trust,
        };
      }
      if (realOpId === 'getContactShareQr') {
        // 2026-05-27 — inject the chat-shell's current NKN peer
        // address into the card so the scanner can DM straight back
        // (no pod lookup needed).  The stoop substrate has no NKN
        // identity of its own; only the chat-layer secure-agent does.
        const myPeerAddr = sa?.peer?.address ?? null;
        if (myPeerAddr) realArgs = { ...realArgs, peerAddr: myPeerAddr };
        if (typeof console !== 'undefined') {
          console.log('[realAgent] getContactShareQr inject peerAddr=' + (myPeerAddr ? myPeerAddr.slice(0,16)+'…' : 'NONE'));
        }
      }
      // F1 5.3d — per-circle posts.  Stoop's browser bundle in
      // basis runs single-group (`cc-default-buurt`); the
      // substrate's `postRequest` falls back to that bundle groupId
      // when `args.targets` is empty, so a per-call `groupId` (from
      // `scopeReadyDispatch`) would otherwise be silently dropped.
      // Pre-build `targets` here so the post lands tagged with the
      // ACTIVE circle's id, and `listOpen` / `keepForCircle` (via
      // `getBulletin` alias) can separate circle A from circle B
      // without a substrate multi-group rewrite.
      if (realOpId === 'postRequest'
          && typeof realArgs.groupId === 'string'
          && realArgs.groupId
          && !Array.isArray(realArgs.targets)) {
        realArgs = {
          ...realArgs,
          targets: [{ kind: 'group', groupId: realArgs.groupId }],
        };
      }
      // buurt/group skills. Several require groupId; the
      // chat-shell knows which buurt this agent is in (single-buurt
      // mode), so auto-inject when missing.
      const REQUIRES_GROUP_ID = new Set([
        'getGroupRules', 'leaveGroup', 'getMyMembershipStatus',
        'editGroupRules', 'removeMember',
      ]);
      if (REQUIRES_GROUP_ID.has(realOpId) && !realArgs.groupId) {
        realArgs = {
          ...realArgs,
          groupId: opts.stoopGroup ?? 'cc-default-buurt',
        };
      }
      // Identity 5B/C — present THIS device's per-circle ADDRESS
      // (deriveCircleAddress) on the direct redeem/create path so the substrate
      // records it into the roster (the roster-recording wire). ONE seam for
      // BOTH platforms (invariant #1): the join/create wizards dispatch through
      // here, so neither web nor mobile threads it. Derived from the resolved
      // groupId off the default profile seed; additive — an explicit caller value
      // wins, an op without a groupId is untouched. NOT verifyMembershipCodeForPeer:
      // there the JOINER's address is forwarded by the peer bridge, not the admin's.
      const PRESENTS_CIRCLE_ADDRESS = new Set(['redeemMembershipCode', 'createGroupV2']);
      if (PRESENTS_CIRCLE_ADDRESS.has(realOpId)
          && typeof realArgs.groupId === 'string' && realArgs.groupId
          && !realArgs.circleAddress) {
        try {
          realArgs = { ...realArgs, circleAddress: deriveCircleAddress(defaultProfileSeed, realArgs.groupId) };
        } catch { /* address derivation is additive — never block the redeem/create */ }
      }
      if (realOpId === 'leaveGroup' && realArgs.confirm !== true) {
        // style two-step confirm. Short-circuit before invoke.
        return {
          ok: false,
          error: 'Leaving your buurt is irreversible. Re-run with --confirm=true to proceed.',
        };
      }
      // Synthesize a `/groups` op locally — there's no listMyGroups
      // skill in single-buurt mode; we render what we know.  After
      // invoke for member count.
      if (realOpId === 'getCurrentGroup') {
        const membersResult = await chatAgent.invoke(
          stoopAgent.address, 'listGroupMembers',
          [DataPart({ groupId: opts.stoopGroup ?? 'cc-default-buurt' })],
        );
        const members = membersResult?.[0]?.data?.members ?? [];
        return {
          title:       'Your buurt',
          groupId:     opts.stoopGroup ?? 'cc-default-buurt',
          memberCount: members.length,
          mode:        'single-buurt (V0)',
          note:        'Multi-buurt support requires multi-agent topology — separate slice.',
        };
      }
      const parts = [DataPart(realArgs)];
      const result = await chatAgent.invoke(stoopAgent.address, realOpId, parts);
      const first  = Array.isArray(result) ? result[0] : null;
      const reply  = first?.data ?? null;

      // cross-instance fan-out (chat-layer bridge).
      // After a local postRequest succeeds, look up the buurt roster
      // (peers we know via membership-redemption items) + fan out a
      // 'buurt-post' envelope over NKN.  Each recipient's onPeerMessage
      // handler in main.js calls stoop.ingestRemotePost to write the
      // payload into THEIR feed.  Reuses the existing broadcast payload
      // shape (Phase 52.7.2) so a future substrate-multi-transport
      // slice can drop this bridge without protocol changes.
      if (realOpId === 'postRequest' && reply?.requestId) {
        if (sa?.peer?.status !== 'connected') {
          if (typeof console !== 'undefined') {
            console.warn('[realAgent] postRequest fan-out skipped — peer transport not connected (status=' + sa?.peer?.status + ')');
          }
        }
      }
      if (realOpId === 'postRequest' && reply?.requestId && sa?.peer?.status === 'connected') {
        // follow-up. The substrate bundle's
        // group is a hardcoded 'cc-default-buurt' from bundle bring-
        // up, but real buurts (the ones users /create- or /join-) are
        // tagged on membership-redemption items with their REAL
        // groupId (e.g. 'westend').  Caller-explicit > targets-derived
        // > '_any-known' fallback (= all buurts the user has peer-
        // confirmed memberships in).
        const explicitGroupId = realArgs.groupId
          ?? (Array.isArray(realArgs.targets)
              ? realArgs.targets.find(t => t?.kind === 'group')?.groupId
              : null)
          ?? null;
        // Fire-and-forget: don't block the user on remote delivery.
        (async () => {
          try {
            // Resolve the target buurt(s).  Explicit takes precedence;
            // otherwise list-all-my-buurts from membership-redemption
            // items so cross-instance posts reach the right peers
            // regardless of the substrate's static bundle group.
            const buurtIds = explicitGroupId
              ? [explicitGroupId]
              : await _listMyKnownBuurts();
            if (typeof console !== 'undefined') {
              console.info('[realAgent] postRequest fan-out: explicitGroupId=' + explicitGroupId
                + ' buurtIds=' + JSON.stringify(buurtIds));
            }
            if (buurtIds.length === 0) {
              if (typeof console !== 'undefined') {
                console.warn('[realAgent] postRequest fan-out: no buurts to address. '
                  + 'Posts from outside a buurt-scoped thread + with no targets arg fall here. '
                  + 'Post from inside the Buurt:<id> thread (Slice 3) or pass --targets.');
              }
              return;
            }
            const sent = new Set();   // dedupe addrs across multiple buurts
            for (const groupId of buurtIds) {
              const rosterReply = await chatAgent.invoke(
                stoopAgent.address, 'listGroupRoster',
                [DataPart({ groupId })],
              );
              const roster = rosterReply?.[0]?.data?.members ?? [];
              if (typeof console !== 'undefined') {
                console.info('[realAgent] fan-out: groupId=' + groupId
                  + ' roster=' + JSON.stringify(roster.map(m => ({ addr: m?.addr?.slice(0, 16) + '…', role: m?.role }))));
              }
              if (roster.length === 0) continue;
              const payload = {
                requestId:      reply.requestId,
                text:           realArgs.text ?? '',
                from:           chatId.pubKey,
                type:           realArgs.type ?? 'request',
                kind:           realArgs.kind ?? null,
                dueAt:          typeof realArgs.dueAt === 'number' ? realArgs.dueAt : null,
                categoryId:     realArgs.categoryId ?? null,
                skillTags:      Array.isArray(realArgs.skillTags) ? realArgs.skillTags : [],
                requiredSkills: realArgs.requiredSkills ?? [],
                targets:        Array.isArray(realArgs.targets) ? realArgs.targets : [{ kind: 'group', groupId }],
                attachments:    Array.isArray(realArgs.attachments) ? realArgs.attachments : [],
                ...(Array.isArray(realArgs.embeds) && realArgs.embeds.length > 0
                  ? { embeds: realArgs.embeds } : {}),
              };
              for (const m of roster) {
                if (!m?.addr || sent.has(m.addr)) continue;
                sent.add(m.addr);
                try {
                  await _saSendWithRetry(sa, m.addr, {
                    type:    'p2p-chat',
                    subtype: 'buurt-post',
                    groupId,
                    fromPubKey: chatId.pubKey,
                    payload,
                    sentAt: Date.now(),
                  });
                } catch (err) {
                  if (typeof console !== 'undefined') {
                    console.warn('[realAgent] buurt-post fan-out failed for', m.addr, err);
                  }
                }
              }
            }
            if (typeof console !== 'undefined') {
              console.info(`[realAgent] buurt-post fanned out to ${sent.size} peer(s) across ${buurtIds.length} buurt(s)`);
            }
          } catch (err) {
            if (typeof console !== 'undefined') {
              console.warn('[realAgent] postRequest fan-out failed', err);
            }
          }
        })();
      }

      return adaptStoopReply(opId, reply, realArgs);
    }
    if (appOrigin === 'folio') {
      // Folio's web-only skills already return chat-shell-shaped
      // replies (no adapter layer needed today).  The one alias is
      // briefSummary → folio_briefSummary so the chat-shell's generic
      // /brief op reaches folio's named briefSummary skill.
      const realOpId = (opId === 'briefSummary') ? 'folio_briefSummary' : opId;
      const parts = [DataPart(args ?? {})];
      const result = await chatAgent.invoke(folioAgent.address, realOpId, parts);
      const first  = Array.isArray(result) ? result[0] : null;
      return first?.data ?? null;
    }
    if (appOrigin === 'calendar') {
      // Calendar skills are registered on the household host agent with the
      // 'calendar_' prefix (v0.7.10 multi-app collision-avoidance).  Routing
      // lives HERE in the shared agent — not in a per-shell wrapper — so EVERY
      // surface reaches calendar through the bare `agent.callSkill`: the
      // classic web shell, the v2 circle launcher (web), and mobile (both pass
      // the bare agent, so before this they threw "unknown appOrigin" on every
      // calendar gate verb — schedule/accept/decline/cancel).  CLAUDE.md
      // invariant #1: routing belongs in shared code, not a shell.  The
      // cross-peer invite/RSVP fan-out (calendarOutbound hook) stays a
      // shell/bundle concern layered ON TOP of this routing.
      return callSkill('household', `calendar_${opId}`, args);
    }
    if (appOrigin === 'agents') {
      // The read-only "your agents" skills live on hostAgent (wireSkill-wrapped
      // pure cores over the user's own agent-registry — see the registration
      // block above).  Routing lives HERE in the shared agent (invariant #1) so
      // web + mobile both reach it through the bare `agent.callSkill`.  The
      // thin reply adapter below is presentation-only (same licence as the
      // stoop adapter): the cores return the registry vocabulary
      // ({agents:[…]} / {agent}), the chat-shell renderer expects
      // {items:[{id,label,…}]} for shape:'list' and a flat record payload for
      // shape:'record'.
      const parts  = await chatAgent.invoke(hostAgent.address, opId, [DataPart(args ?? {})]);
      const data   = Array.isArray(parts) ? parts[0]?.data : null;
      if (opId === 'listAgents') {
        const agents = Array.isArray(data?.agents) ? data.agents : [];
        return { items: agents.map((a) => ({ ...a, id: a.agentId, label: a.name ?? a.agentId })) };
      }
      if (opId === 'viewAgent') {
        // A miss surfaces as a soft failure (message, not a false record).
        return data?.agent ?? { ok: false, error: `No agent matches "${String(args?.agentId ?? '')}"` };
      }
      return data;
    }
    throw new Error(`realAgent: unknown appOrigin "${appOrigin}"`);
  };

  /* ─────────── L3 household — wired-core → chat-shell reply adapter ─────────── */
  // The dissolved cores (`v2/householdApp.js`) return thin values: list ops → `{items:[…]}`
  // (bare store items); addItem/addTask → the stored item; markComplete/claim/reassign →
  // `{ok, item}` (or `{ok:false, error}`); removeItem → `{ok, removed}`. basis's renderer
  // expects the chat-shell shapes the legacy path produced:
  //   - LIST   → { items: [{id, label, text, type, state}], _sync }
  //   - ACTION → { ok, message, text, itemId, _sync }  (or {ok:false, error})
  // This adapter re-shapes the wired-core outputs so /add · /list · /done · /task · /claim
  // round-trip through the existing chat-shell renderer exactly as before.

  /** Adapt a wired household-core reply (list OR mutation) to the chat-shell shape. */
  function adaptWiredHouseholdReply(opId, data, args) {
    if (opId === 'listOpen' || opId === 'listTasks') {
      const items = Array.isArray(data?.items) ? data.items : [];
      // v0.6 — annotate every-other row with a synthetic `_lastSync` so the per-row
      // 'stale Xh ago' badge has something to render (demo parity).
      const now = Date.now();
      return {
        items: items.map((it, i) => ({
          id:    it.id,
          label: it.text,
          text:  it.text,
          type:  it.type,
          state: 'open',
          ...(it.assignee ? { claimedBy: it.assignee } : {}),
          ...(i % 2 === 0 ? { _lastSync: now - 3 * 3_600_000 } : {}),   // 3h ago
        })),
        _sync: simulateSync(),
      };
    }
    return adaptWiredHouseholdAction(opId, data, args);
  }

  /** Adapt a wired mutation-core reply → `{ ok, message, text, itemId, _sync }` (or `{ ok:false, error }`). */
  function adaptWiredHouseholdAction(opId, data, args) {
    const publish = (itemId, message) => {
      if (!itemId) return;
      publishEvent({
        app:     'household',
        type:    'item-changed',
        actor:   'webid:local-demo-user',
        itemRef: { app: 'household', id: itemId },
        payload: { message },
      });
    };

    // Resolving ops (find-by-match): a miss surfaces as a soft failure so the user sees a message,
    // not a false "✓".  On MORE THAN ONE open match the core returns `{ambiguous:[…]}` and acts on none
    // — reproduce the legacy chat-shell disambiguation prompt (identical text/shape) so the user picks by
    // id-prefix rather than the tool silently completing the wrong item.
    if (opId === 'markComplete' || opId === 'removeItem' || opId === 'claim' || opId === 'reassign') {
      if (Array.isArray(data?.ambiguous)) {
        const lines = data.ambiguous.map((it) => `- [${String(it.id ?? '').slice(0, 8)}] ${it.text}`);
        return {
          ok:    false,
          error: `Multiple matches for '${String(args?.match ?? '')}'. Reply with the id-prefix:\n${lines.join('\n')}`,
        };
      }
      if (!data || data.ok === false) {
        const noun = (opId === 'claim' || opId === 'reassign') ? 'open task' : 'open item';
        return { ok: false, error: `Couldn't find an ${noun} matching '${String(args?.match ?? '')}'.` };
      }
      const item   = data.item ?? null;
      const text   = item?.text ?? '';
      const itemId = item?.id ?? data.removed ?? undefined;
      let message;
      switch (opId) {
        case 'markComplete': message = `✓ marked complete: ${text}`; break;
        case 'removeItem':   message = `✓ removed: ${text}`; break;
        case 'claim':        message = `✓ claimed: ${text}`; break;
        default:             message = `✓ reassigned: ${text} → ${String(args?.assignee ?? '').trim()}`; break;
      }
      publish(itemId, message);
      return { ok: true, message, ...(text ? { text } : {}), ...(itemId ? { itemId } : {}), _sync: simulateSync() };
    }

    // addItem / addTask — `data` is the stored item.
    const item    = data ?? {};
    const text    = item.text ?? '';
    const message = opId === 'addTask' ? `✓ added task: ${text}` : `✓ added to ${item.type}: ${text}`;
    publish(item.id, message);
    return { ok: true, message, ...(text ? { text } : {}), ...(item.id ? { itemId: item.id } : {}), _sync: simulateSync() };
  }

  /** /brief contributor — derive household's slot from the wired store's open items. */
  async function householdBriefSummary(circleId) {
    let open = [];
    try { open = await householdApp.listOpen(householdService.stores.getStore(circleId), {}); }
    catch { open = []; }
    if (!open.length) return { ok: true };   // empty → /brief skips the section
    const items = open.slice(0, 5).map((it) => ({ id: it.id, label: it.text }));
    return { items, message: `${open.length} open household item${open.length === 1 ? '' : 's'}` };
  }

  /**
   * Bridge real tasks-v0 reply shapes → basis's chat-shell
   * expectations.  Real skills return rich shapes
   * (e.g. `{task: {id, text, ...}}`); basis's renderer expects
   * the mock-era shapes (`{ok, message, itemId, _sync}`).
   *
   * Adapters keep the chat-shell stable while we run with real
   * tasks-v0 underneath.  Eventually the chat-shell renderer
   * absorbs the richer shape natively + these adapters fall away.
   */
  function adaptTasksReply(opId, data) {
    if (data == null) return null;
    // (B8) — DAG hard-dep blocking surface. Real skill returns
    // {error: 'has-open-dependencies', openDeps: [...]} when the user
    // tries to complete a task whose subtasks aren't done.  Translate
    // to a clear chat-shell message + structured payload the UI can
    // render the dep IDs from.
    if ((opId === 'completeTask' || opId === 'approveTask')
        && data?.error === 'has-open-dependencies') {
      const deps = Array.isArray(data.openDeps) ? data.openDeps : [];
      return {
        ok:    false,
        error: `🔒 Blocked: ${deps.length} open dependenc${deps.length === 1 ? 'y' : 'ies'} (${deps.slice(0, 3).join(', ')}${deps.length > 3 ? '…' : ''}). Close the sub-tasks first.`,
        openDeps: deps,
      };
    }
    // Skill returned an error envelope — pass through unchanged.
    if (data.ok === false) return data;

    // Real task skills variously return {task: ...} (addTask /
    // submitTask) OR {result: ...} (claimTask / completeTask) — the
    // field name differs by skill.  Normalise to a task variable.
    const task = data.task ?? data.result ?? null;

    // addTask: {task} → {ok, message, itemId, _sync}
    if (opId === 'addTask' && task) {
      return {
        ok:      true,
        message: `✓ Added task: ${task.text ?? task.title ?? task.id}`,
        itemId:  task.id,
        // S6.A — carry the mock-era `state` + `type` the manifest's appliesTo gates
        // on (the real circle uses `status`), so inline buttons compute on the reply.
        task:    { ...task, type: 'task', state: _statusToChatState(task.status, task) },
        _sync:   simulateSync(),
      };
    }
    // claimTask / completeTask / submitTask / approveTask / rejectTask:
    // shape adapter — emit the chat-shell ok/message envelope.
    const verbMap = {
      claimTask:   'Claimed',
      completeTask:'Completed',
      submitTask:  'Submitted',
      approveTask: 'Approved',
      rejectTask:  'Rejected',
      // editTask returns {task}; chat-shell needs
      // the ok/message envelope to render the confirmation bubble.
      editTask:    'Edited',
    };
    if (verbMap[opId] && task) {
      const title = task.text ?? task.title ?? task.id;
      // Reject path: surface the audit-log note in the message so
      // the chat-shell + user see WHY the task was rejected.
      const noteSuffix = (opId === 'rejectTask' && data.noteHint)
        ? ` — ${data.noteHint}` : '';
      // claim router: when the override has
      // flowThrough.tasksToPersonal, mirror the claimed task into the
      // personal circle so it shows up in "Mijn dingen".  Fire-and-forget;
      // the chat-shell envelope returns immediately.  Default hook is a
      // no-op so existing tests keep their behaviour.
      if (opId === 'claimTask' && typeof claimRouterRef.hook === 'function') {
        const circleId = args?.circleId ?? args?.circleId ?? args?.groupId ?? null;
        if (circleId) {
          Promise.resolve(claimRouterRef.hook({ task, circleId, args }))
            .catch((err) => publishEvent?.({
              app: 'basis', type: 'claim-router-error',
              payload: { circleId, taskId: task.id, error: err?.message ?? String(err) },
            }));
        }
      }
      return {
        ok:      true,
        message: `✓ ${verbMap[opId]}: ${title}${noteSuffix}`,
        itemId:  task.id,
        // S6.A — enrich with mock-era state/type so the post-action reply also
        // carries the right inline buttons (e.g. a claimed task → Mark complete).
        task:    { ...task, type: 'task', state: _statusToChatState(task.status, task) },
        _sync:   simulateSync(),
      };
    }
    // Task-less base — a circle with no tasks circle yet.  bundleResolver
    // returns null, so the read-only list skills answer {error:'circleId
    // required'}.  For a LIST op that's not a failure: there's simply
    // nothing to list.  Normalise to an empty result so loadCircleItems /
    // /mytasks render "no tasks" instead of an error bubble.  (Write ops
    // like addTask keep the error — you can't add to a circle that isn't there.)
    if ((opId === 'listMine' || opId === 'listOpen' || opId === 'listMyInbox'
         || opId === 'myInbox' || opId === 'getMyTasks' || opId === 'listClaimable')
        && data?.error === 'circleId required') {
      return { items: [], _sync: simulateSync() };
    }
    // listMine / listOpen: real returns {items: [...]} of task records.
    // Real items carry `status` (ready/claimed/submitted/rejected/
    // complete/blocked) but the chat-shell renderer + most tests
    // expect a mock-era `state` field (open/claimed/done).  Add the
    // mapped `state` alongside the original status. (B8): also
    // surface a `blockedBy` label when the task has openDeps so the
    // user sees the gate without clicking [Mark complete] first.
    if ((opId === 'listMine' || opId === 'listOpen' || opId === 'listMyInbox'
         || opId === 'myInbox' || opId === 'getMyTasks')
        && Array.isArray(data.items)) {
      return {
        ...data,
        items: data.items.map((t) => {
          const openDeps = Array.isArray(t.openDeps) ? t.openDeps : [];
          const baseRow = { ...t, state: _statusToChatState(t.status, t) };
          if (openDeps.length > 0) {
            baseRow.blockedBy = openDeps;
            baseRow.label = `${t.text ?? t.title ?? t.id} 🔒 blocked by ${openDeps.length} dep${openDeps.length === 1 ? '' : 's'}`;
          }
          return baseRow;
        }),
        _sync: simulateSync(),
      };
    }
    // getTaskSnapshot: real returns {task: {...}} → flatten to embed-card shape
    if (opId === 'getTaskSnapshot' && data.task) {
      const t = data.task;
      return {
        id:    t.id,
        type:  'task',
        state: t.state ?? 'open',
        title: t.text ?? t.title ?? t.id,
        fields: { state: t.state ?? 'open', assignee: t.assignee ?? 'unassigned' },
      };
    }
    // issueInvite: real returns {invite: {...JWT-shaped token...}} →
    // record-shape reply with a `qr` URI the chat-shell renders as
    // an actual scannable QR canvas (see classifyFieldKind + the
    // 'qr' branch in domAdapter.renderRecordPanel).  Inviter can
    // [Copy] the URL fallback or have the invitee scan the QR.
    if (opId === 'issueInvite' && data.invite) {
      const inv = data.invite;
      const json = typeof inv === 'string' ? inv : JSON.stringify(inv);
      // Browser-safe base64url encode (no Buffer dep).
      const b64url = typeof globalThis.btoa === 'function'
        ? globalThis.btoa(json)
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
        : json;
      const qrUri = `stoop-invite://${b64url}`;
      const expires = inv?.expiresAt
        ? new Date(inv.expiresAt).toISOString()
        : '(no expiry)';
      return {
        title:    'Circle invite',
        role:     inv?.role ?? 'member',
        expires,
        invite:   qrUri,   // classified as kind:'qr' by classifyFieldKind
        message:  `🎟️ Single-use invite minted. Have the invitee scan the QR or paste the URL into /redeem-invite.`,
      };
    }
    // redeemInvite: real returns {groupProof, members, ...} → friendly text.
    if (opId === 'redeemInvite' && (data.groupProof || data.members)) {
      const memberCount = Array.isArray(data.members) ? data.members.length : '?';
      return {
        ok: true,
        message: `✓ Joined circle. ${memberCount} members visible. /mytasks shows the circle's tasks.`,
        circle:   data,
        _sync:  simulateSync(),
      };
    }
    // (B7) — getMyAvailability: {enabled, optedIn, week,
    //   grid: {0: {AM, PM}, 1: {AM, PM}, ...}} → record reply with a
    // 'grid' field the chat-shell renders as a 7×2 clickable table.
    if (opId === 'getMyAvailability') {
      if (data.enabled === false) {
        return {
          title:   'Availability',
          status:  'disabled-for-circle',
          message: 'Availability hints aren\'t enabled for this circle yet. Ask an admin to enable them, then /availability-opt-in on to start setting your week.',
        };
      }
      const week = data.week ?? '(this week)';
      // 2026-05-24 — pad with a default blank 7×2 grid so the renderer
      // always has a structural grid to draw.  Real cells overlay
      // 'unknown' defaults; empty `data.grid` no longer renders as
      // the unreadable JSON `{}`.
      const blankGrid = {};
      for (let d = 0; d < 7; d++) {
        blankGrid[d] = { AM: 'unknown', PM: 'unknown' };
      }
      const merged = { ...blankGrid };
      for (const [day, halves] of Object.entries(data.grid ?? {})) {
        merged[day] = { ...blankGrid[day], ...halves };
      }
      return {
        title:   `Availability — ${week}`,
        optedIn: !!data.optedIn,
        week,
        // classifyFieldKind detects {0-6: {AM, PM}} shape as 'grid' →
        // renderGridField in domAdapter draws clickable cells.
        grid:    merged,
        message: data.optedIn
          ? 'Click a cell to cycle: unknown → open → tight → unavailable → unknown.'
          : 'You haven\'t opted in. /availability-opt-in on to start broadcasting.',
      };
    }
    // setMyAvailability: {ok, week, day, half, state} → text.
    if (opId === 'setMyAvailability' && data.ok) {
      const STATE_GLYPH = { open: '🟢', tight: '🟡', unavailable: '🔴', unknown: '⚪' };
      const dayName = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][data.day] ?? '?';
      return {
        ok: true,
        message: `${STATE_GLYPH[data.state] ?? '⚪'} ${dayName} ${data.half}: ${data.state}`,
        _sync: simulateSync(),
      };
    }
    // setAvailabilityOptIn: {ok, optedIn} → friendly text.
    if (opId === 'setAvailabilityOptIn' && data.ok) {
      return {
        ok: true,
        message: data.optedIn
          ? '✓ Opted in. Your availability hints are visible to your circle.'
          : '✓ Opted out. Coordinator sees you as "unknown" (indistinguishable from non-opted).',
        _sync: simulateSync(),
      };
    }
    // (B6) — suggestSchedule: {lookaheadDays, suggestions: [
    //   {taskId, slots: [{start, end, reasons: [...]}], ...}
    // ]} → chat-shell list with each row = ONE clickable slot
    // (top 3 per task).  Row label inlines date/time + reason chips.
    // slotKey packs (taskId|start|end) into the row id so the [Pick]
    // button dispatches all three to acceptSchedule.
    if (opId === 'suggestSchedule' && Array.isArray(data.suggestions)) {
      if (data.suggestions.length === 0) {
        return {
          items:   [],
          message: 'No schedulable tasks in your lookahead window (set --lookahead-days to expand).',
        };
      }
      const items = [];
      for (const s of data.suggestions) {
        const slots = Array.isArray(s.slots) ? s.slots.slice(0, 3) : [];
        for (let i = 0; i < slots.length; i++) {
          const slot = slots[i];
          const start = new Date(slot.start);
          const end   = new Date(slot.end);
          const fmt   = (d) => `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
          const reasonChips = (slot.reasons ?? []).map((r) => `[${r}]`).join(' ');
          const taskLabel = s.taskText ?? s.title ?? s.taskId;
          items.push({
            id:        `${s.taskId}|${slot.start}|${slot.end}`,
            type:      'schedule-slot',
            label:     `#${i + 1} ${taskLabel}: ${fmt(start)} – ${fmt(end).split(' ')[1]} ${reasonChips}`,
            taskId:    s.taskId,
            slotStart: slot.start,
            slotEnd:   slot.end,
            reasons:   slot.reasons ?? [],
          });
        }
      }
      return {
        items,
        message: `${data.suggestions.length} task${data.suggestions.length === 1 ? '' : 's'} with suggestions (${data.lookaheadDays}-day window). Click a slot to schedule it.`,
        _sync:   simulateSync(),
      };
    }
    // acceptSchedule: {ok, task} → friendly text.
    if (opId === 'acceptSchedule' && data?.task) {
      const t = data.task;
      const when = Number.isFinite(t.scheduledAt)
        ? new Date(t.scheduledAt).toLocaleString()
        : '(no time)';
      return {
        ok:      true,
        message: `📅 Scheduled "${t.text ?? t.title ?? t.id}" at ${when}.`,
        task:    t,
        _sync:   simulateSync(),
      };
    }
    // (B5) — getMyCircles: {circles: [{circleId, name, kind, counts}]}
    // → chat-shell list with circle-shape rows.  Each row's label
    // surfaces counters inline so the user sees the dashboard at a
    // glance without expanding rows.
    if (opId === 'getMyCircles' && Array.isArray(data.circles)) {
      // 2026-05-24 — fold in provisionedCircles (pending entries from
      // /circle-new since boot) so the user sees feedback even though
      // the dashboard's circlesProvider doesn't auto-pick them up.
      const knownIds = new Set(data.circles.map((c) => c.circleId));
      const pendingItems = [];
      for (const [circleId, info] of provisionedCircles.entries()) {
        if (knownIds.has(circleId)) continue;   // active now (after reload)
        pendingItems.push({
          id:    circleId,
          type:  'circle',
          label: `${info.name} (${info.kind}) — (pending — reload to activate)`,
          circleId,
          name:  info.name,
          kind:  info.kind,
          pending: true,
          counts: { open: 0, overdue: 0, mine: 0, awaitingApproval: 0 },
        });
      }
      if (data.circles.length === 0 && pendingItems.length === 0) {
        return {
          items:   [],
          message: 'You\'re not in any circles yet. Use /circle-new to create one.',
        };
      }
      let totalOpen = 0, totalOverdue = 0, totalMine = 0, totalApproval = 0;
      const items = data.circles.map((c) => {
        const cnt = c.counts ?? {};
        totalOpen     += cnt.open ?? 0;
        totalOverdue  += cnt.overdue ?? 0;
        totalMine     += cnt.mine ?? 0;
        totalApproval += cnt.awaitingApproval ?? 0;
        const stats = [
          `${cnt.open ?? 0} open`,
          cnt.overdue ? `${cnt.overdue} overdue` : null,
          cnt.mine    ? `${cnt.mine} mine`       : null,
          cnt.awaitingApproval ? `${cnt.awaitingApproval} awaiting approval` : null,
        ].filter(Boolean).join(' · ');
        return {
          id:    c.circleId,
          type:  'circle',
          label: `${c.name} (${c.kind}) — ${stats}`,
          circleId: c.circleId,
          name:   c.name,
          kind:   c.kind,
          counts: cnt,
        };
      });
      const allItems = [...items, ...pendingItems];
      const pendingSuffix = pendingItems.length > 0
        ? ` + ${pendingItems.length} pending (reload to activate)` : '';
      return {
        items: allItems,
        message: `Circles: ${data.circles.length}${pendingSuffix} · Total: ${totalOpen} open, ${totalOverdue} overdue, ${totalMine} mine, ${totalApproval} awaiting approval`,
        _sync: simulateSync(),
      };
    }
    // (B3) — getCircleConfig: {circle: {...}} or {circle: null} →
    // record reply with members + paused/archived state.
    if (opId === 'getCircleConfig') {
      const circle = data.circle;
      if (!circle) {
        return {
          title:   'Circle config',
          status:  'not-found',
          message: 'No circle config found for this id.',
        };
      }
      // 2026-05-24 — DON'T inline members[] here.  The record renderer
      // JSON-stringifies arrays of objects (unreadable).  Use the
      // separate /circle-members list reply (see listCircleMembers below).
      return {
        title:       'Circle config',
        circleId:      circle.circleId,
        name:        circle.name ?? circle.circleId,
        kind:        circle.kind ?? 'household',
        memberCount: Array.isArray(circle.members) ? circle.members.length : 0,
        paused:      !!circle.paused,
        archived:    !!circle.archived,
        hint:        'Use /circle-members for the member list.',
      };
    }
    // 2026-05-24 — listCircleMembers (derived from getCircleConfig): list
    // reply with one row per member, role surfaced inline.
    if (opId === 'listCircleMembers') {
      const circle = data?.circle;
      if (!circle || !Array.isArray(circle.members)) {
        return { items: [], message: 'No circle config — try /circle-info first.' };
      }
      return {
        items: circle.members.map((m) => ({
          id:    m.webid,
          type:  'member',
          webid: m.webid,
          label: `${m.displayName ?? m.webid.slice(0, 12)} (${m.role ?? 'member'})`,
          role:  m.role ?? 'member',
        })),
        message: `${circle.members.length} member${circle.members.length === 1 ? '' : 's'} in ${circle.name ?? circle.circleId}`,
        _sync: simulateSync(),
      };
    }
    // pauseCircle / unpauseCircle / archiveCircle / unarchiveCircle:
    // real returns {ok, paused?, archived?} → friendly text reply.
    if (opId === 'pauseCircle' && data.ok) {
      return {
        ok: true,
        message: data.paused
          ? '⏸️ Circle paused. No new tasks; existing tasks remain workable.'
          : '✓ Circle already unpaused.',
        _sync: simulateSync(),
      };
    }
    if (opId === 'unpauseCircle' && data.ok) {
      return {
        ok: true,
        message: data.paused
          ? '✓ Circle is paused.'
          : '▶️ Circle resumed. New tasks can be added again.',
        _sync: simulateSync(),
      };
    }
    if (opId === 'archiveCircle' && data.ok) {
      return {
        ok: true,
        message: data.archived
          ? '📦 Circle archived. Read-only ledger; use /unarchive-circle to reverse.'
          : '✓ Circle already unarchived.',
        _sync: simulateSync(),
      };
    }
    if (opId === 'unarchiveCircle' && data.ok) {
      return {
        ok: true,
        message: data.archived
          ? '✓ Circle is archived.'
          : '✓ Circle unarchived. Active again.',
        _sync: simulateSync(),
      };
    }
    // provisionMyCircle: real returns {circle: {...}} (or similar) →
    // adapt to mock-era {ok, message, circleId}.  2026-05-24: also
    // track newly-provisioned circles in provisionedCircles so /circles
    // shows them as pending entries (substrate doesn't auto-bind
    // a CircleState; needs reload + multi-circle topology).
    if (opId === 'provisionMyCircle') {
      const circleId = data.circleId ?? data.circle?.circleId ?? data.id ?? null;
      if (circleId && !provisionedCircles.has(circleId)) {
        provisionedCircles.set(circleId, {
          name: data.circle?.name ?? data.name ?? circleId,
          kind: data.circle?.kind ?? data.kind ?? 'household',
          provisionedAt: Date.now(),
        });
      }
      return {
        ok:      true,
        message: `✓ Circle "${circleId ?? '?'}" provisioned. It shows in /circles as "(pending)" — full activation requires multi-circle topology (deferred slice).`,
        circleId,
        circle:    data.circle ?? data,
        _sync:   simulateSync(),
      };
    }
    // Default: pass through.
    return data;
  }

  /**
   * Bridge real stoop reply shapes → basis's chat-shell
   * expectations.  Mock-era shapes the chat renderer was built
   * against:
   *   postRequest     → {ok, message, itemId, _sync}
   *   listFeed/Open   → {items: [{id, label, state, ...}], _sync}
   *   getMyProfile    → {title, handle, displayName, buurt, ...}
   *   setPeerReveal   → {ok, message, peer, action}
   */
  function adaptStoopReply(opId, data, args) {
    if (data == null) return null;
    if (data.ok === false || data.error)  {
      // Pass through error envelopes; basis dispatch handles them.
      return data.ok === false ? data : { ok: false, error: data.error };
    }

    // postRequest: {requestId, claims} → {ok, message, itemId, _sync}
    if (opId === 'postRequest' && data.requestId) {
      const text = args?.text ?? '(post)';
      return {
        ok:      true,
        message: `✓ Posted: ${text}`,
        itemId:  data.requestId,
        request: data,                       // preserve full shape
        _sync:   simulateSync(),
      };
    }
    // listFeed / listOpen / listMyRequests / getBulletin: items[] of
    // {id, text, ...} → add a `label` alias on each row + add _sync
    // envelope so the chat shell's renderer picks up the standard
    // chat shapes.
    if ((opId === 'listFeed' || opId === 'listOpen' || opId === 'listMyRequests'
         || opId === 'getBulletin')
        && Array.isArray(data.items)) {
      return {
        ...data,
        items: data.items.map((p) => ({
          ...p,
          label: p.text ?? p.label ?? p.id,
          // chat-shell appliesTo gate matches on
          // `item.type`.  Stoop posts are 'post' in the chat-shell
          // vocabulary (mockManifests respondToItem + markReturned
          // both gate `type: 'post'`).  Substrate item.type carries
          // the canonical 'request'|'offer'|'report' taxonomy, so we
          // map them all to chat-shell 'post' here.
          type:  'post',
          // Chat-shell convention: `state: open|done`.  Stoop posts
          // are "open" while addedBy is set + not closed; "done"
          // when there's a `closedAt`.
          state: p.closedAt ? 'done' : 'open',
          // F1 5.3d — surface the post's target groupId at the top
          // level so `circleScope.itemCircleId` (which reads
          // `item.groupId`, not `item.source.targets[]`) can match
          // the active circle.  Posts created in basis carry
          // `source.targets: [{kind:'group', groupId: '<circleId>'}]`
          // (set in the postRequest adapter above when a circle is
          // active).  Pre-existing posts without targets keep
          // `groupId: undefined`, which `keepForCircle` treats as
          // "no hint, trust upstream" — so unscoped reads still see
          // them.
          groupId: p.groupId ?? _groupIdFromTargets(p),
        })),
        _sync: simulateSync(),
      };
    }
    // getMyProfile: real returns {entry: {handle, displayName, ...}|null}
    // → adapt to {title, handle, displayName, buurt}.
    if (opId === 'getStoopProfile') {
      const e = data.entry ?? {};
      return {
        title:       'Stoop profile',
        handle:      e.handle ?? null,
        displayName: e.displayName ?? null,
        buurt:       opts.stoopGroup ?? 'cc-default-buurt',
      };
    }
    // setPeerReveal: real returns {} on success → adapt to chat shape.
    // Part G dissolve (2026-06-17) — keyed on `setPeerReveal` (was
    // `revealPeer`, the dropped alias op).  args still carry the
    // chat-shell `peer`/`action` vocab; the peer→peerWebid +
    // action→reveal transforms happen before invoke.
    if (opId === 'setPeerReveal') {
      const peer   = args?.peer ?? args?.peerWebid ?? '(peer)';
      const action = args?.action ?? (args?.reveal ? 'on' : 'off');
      return {
        ok: true,
        message: action === 'on'
          ? `🔓 Reveal flipped on for ${peer}. (Bilateral — they must flip on their side too.)`
          : `🔒 Reveal flipped off for ${peer}.`,
        peer, action,
      };
    }
    // setHolidayMode: real returns {holidayMode: bool} → friendly text.
    if (opId === 'setHolidayMode' && typeof data.holidayMode === 'boolean') {
      return {
        ok: true,
        message: data.holidayMode
          ? '🌙 Holiday mode on. Notifications suppressed; your skills marked unavailable.'
          : '🌅 Holiday mode off. Notifications and skill-match resume.',
        holidayMode: data.holidayMode,
      };
    }
    // getHolidayMode: real returns {holidayMode: bool} → record reply.
    if (opId === 'getHolidayMode' && typeof data.holidayMode === 'boolean') {
      return {
        title:       'Holiday mode',
        holidayMode: data.holidayMode,
        status:      data.holidayMode ? 'on' : 'off',
      };
    }
    // listContacts: real returns {contacts: [...]} → chat-shell {items: [...]}.
    // Each contact carries {webid, displayName?, handle?, trustLevel?, tags?, ...};
    // surface displayName || handle || webid as the label.  Stoop
    // persists trustLevel in Dutch ('bekend'/'vertrouwd'); we translate
    // to EN for the chat surface.
    const TRUST_NL_TO_EN = { bekend: 'known', vertrouwd: 'trusted' };
    if (opId === 'listContacts' && Array.isArray(data.contacts)) {
      if (typeof console !== 'undefined') {
        console.log('[realAgent] listContacts result:', data.contacts.map((c) => ({
          webid: String(c.webid).slice(0,32),
          peerAddr: c.peerAddr ? (c.peerAddr.slice(0,16) + '…') : 'NONE',
        })));
      }
      return {
        items: data.contacts.map((c) => ({
          id:          c.webid,
          type:        'contact',
          webid:       c.webid,
          label:       c.displayName ?? c.handle ?? c.webid,
          handle:      c.handle ?? null,
          trustLevel:  c.trustLevel ? (TRUST_NL_TO_EN[c.trustLevel] ?? c.trustLevel) : null,
          tags:        c.tags ?? [],
          // 2026-05-27 — surface the contact's NKN peer address (set
          // by addContactFromQr from the scanned card) so the [DM]
          // button can target the right NKN destination instead of
          // the contact's stableId/webid.  ListItemRow forwards this
          // to buttonSpecials.startDm.
          peerAddr:    c.peerAddr ?? null,
        })),
        _sync: simulateSync(),
      };
    }
    // addContact / setContactTrust / setContactTags: real returns
    // {contact} → friendly text reply.
    if ((opId === 'addContact' || opId === 'setContactTrust' || opId === 'setContactTags')
        && data.contact) {
      const c = data.contact;
      const who = c.displayName ?? c.handle ?? c.webid;
      const trustEn = c.trustLevel
        ? (TRUST_NL_TO_EN[c.trustLevel] ?? c.trustLevel) : null;
      const msg = opId === 'addContact'
        ? `✓ Added contact: ${who}`
        : opId === 'setContactTrust'
          ? `✓ Trust level updated for ${who}: ${trustEn ?? '(cleared)'}`
          : `✓ Tags updated for ${who}: ${(c.tags ?? []).join(', ') || '(none)'}`;
      return {
        ok: true, message: msg, contact: { ...c, trustLevel: trustEn }, _sync: simulateSync(),
      };
    }
    // removeContact: real returns {ok: true} → friendly text.
    if (opId === 'removeContact' && data.ok === true) {
      const who = args?.webid ?? '(contact)';
      return {
        ok: true,
        message: `✓ Removed contact: ${who}`,
        _sync: simulateSync(),
      };
    }
    // getContactShareQr: real returns {payload: 'stoop-contact://...'}
    // → record reply with the URL spelt out (user can paste into any
    // QR generator).  Canvas-rendered QR image is a follow-up.
    if (opId === 'getContactShareQr' && data.payload) {
      return {
        title:    'Share your contact card',
        trust:    args?.trustOffer ?? args?.trust ?? 'bekend',
        payload:  data.payload,
        message:  'Copy the payload above + paste into any QR generator.  The receiver scans + uses /add-contact to add you with the proposed trust level.',
      };
    }
    // listGroupMembers: {groupId, members: []} → chat-shell list.
    // Each member carries webid/handle/displayName/role from MemberMap.
    if (opId === 'listGroupMembers' && Array.isArray(data.members)) {
      return {
        // Preserve the RAW roster alongside the chat projection so programmatic
        // consumers (the admin panel roster, the mandate WIE picker) read the
        // full-fidelity `members` (webid/role/displayName/sealingPublicKey/…),
        // while the chat-shell list renderer reads the projected `items`. Dropping
        // `members` here silently emptied every non-chat roster consumer even
        // after the trail-derived roster (B1) started returning members.
        groupId: data.groupId,
        members: data.members,
        // The chat-shell item (shape 2) is now a PROJECTION of the ONE canonical
        // Member (kring-host), not a hand-reshape: `memberToChatItem(memberFrom(row))`.
        // Identity 5B/C — the recorded per-circle address rides through
        // `memberToChatItem` (additive; absent for pre-substrate members).
        items: data.members.map((m) => memberToChatItem(memberFrom(m))),
        _sync: simulateSync(),
      };
    }
    // getGroupRules: real returns {rules: <rules-item> | null}
    // where the item carries the structured rules under
    // source.rules (an object with rulesText + accessPolicy +
    // leavePolicy + conflictPolicy + tags etc, as written by C1).
    if (opId === 'getGroupRules') {
      if (!data || data.error) {
        return {
          title:   'Group rules',
          status:  'no-rules-set',
          message: 'No rules have been set for this buurt yet.',
        };
      }
      const item = data.rules ?? data.item ?? data;
      // 2026-05-24 fix — when the buurt was created without freeform
      // rulesText (user left the textarea blank in C1), the structured
      // rules object exists but has no `rulesText` field.  Synthesize
      // a human-readable summary from the structured fields instead of
      // emitting "shape unknown".
      const rulesObj = item?.source?.rules ?? null;
      let rulesText = rulesObj?.rulesText
        ?? item?.source?.text
        ?? item?.text
        ?? null;
      if (!rulesText && rulesObj) {
        const parts = [];
        if (rulesObj.purpose)        parts.push(`Purpose: ${rulesObj.purpose}`);
        if (rulesObj.accessPolicy)   parts.push(`Access: ${rulesObj.accessPolicy}`);
        if (rulesObj.leavePolicy)    parts.push(`Leave: ${rulesObj.leavePolicy}`);
        if (rulesObj.conflictPolicy) parts.push(`Conflict resolution: ${rulesObj.conflictPolicy}`);
        if (Array.isArray(rulesObj.tags) && rulesObj.tags.length) {
          parts.push(`Tags: ${rulesObj.tags.join(', ')}`);
        }
        if (Array.isArray(rulesObj.additionalAdmins) && rulesObj.additionalAdmins.length) {
          parts.push(`Extra admins: ${rulesObj.additionalAdmins.join(', ')}`);
        }
        rulesText = parts.length > 0
          ? parts.join('\n')
          : '(no freeform rules set; defaults apply)';
      }
      if (!rulesText) {
        rulesText = '(no rules set)';
      }
      return {
        title:   'Group rules',
        groupId: item?.source?.groupId ?? args?.groupId ?? '(unknown)',
        rules:   rulesText,
        addedAt: item?.addedAt ? new Date(item.addedAt).toISOString() : null,
      };
    }
    // leaveGroup: real returns {ok} or {error}. Confirm-gated
    // above; when invoked for real, friendly text.
    if (opId === 'leaveGroup' && data.ok) {
      // Forget the left circle's no-pod sync peers (stops stale-peer boot HI-pings).
      clearHouseholdPeers(args?.groupId ?? args?.circleId ?? args?.circleId).catch(() => {});
      return {
        ok: true,
        message: '👋 Left the buurt. Your local data stays; you no longer receive feed updates.',
        _sync: simulateSync(),
      };
    }
    // Default: pass through.
    return data;
  }

  // 5.8 — host-injected `LlmClient` providers, surfaced as-is.  Downstream
  // consumers pair the per-circle policy with `selectLlmClient(policy, agent.
  // llmProviders)`; the realAgent itself doesn't call .invoke() — it just
  // makes the seam available.  Defaults to `{}` so callers can read
  // `agent.llmProviders.local` without a null guard.
  const llmProviders = (opts.llmProviders && typeof opts.llmProviders === 'object')
    ? opts.llmProviders
    : {};

  // G7 — turn on live presence now that `_listMyKnownBuurts` + the roster invoke exist. Idempotent.
  _enableReachabilityOracle();

  return {
    // Part G — the REAL household app manifest (item/task vocab) is now the
    // catalog source of truth for the household surface.  (The mock manifest
    // + createMockHouseholdAgent stay in mockAgent.js as a test fixture.)
    manifest: householdManifest,
    callSkill,
    llmProviders,
    // host-injected claim router; called after every successful
    // claimTask.  Hosts wire `makeAfterClaimHook` here once the agent +
    // override store are both available.
    setAfterClaimHook(fn) { claimRouterRef.hook = typeof fn === 'function' ? fn : null; },
    // L3 — reset/state operate on the wired per-circle CircleItemStore (the live household data).
    // `reset()` wipes every open item + reseeds the demo items; `state()` returns the current open items.
    async reset() {
      const store = householdService.stores.getStore('household');
      const open = await householdApp.listOpen(store, {});
      for (const it of open) {
        try { await store.delete(it.id); } catch { /* defensive */ }
      }
      if (opts.seedHousehold !== false) {
        for (const seed of SEED_HOUSEHOLD_ITEMS) {
          try { await householdApp.addItem(store, { type: seed.type, text: seed.text }, { by: 'webid:local-demo-user' }); }
          catch { /* defensive */ }
        }
      }
    },
    async state() {
      try { return await householdApp.listOpen(householdService.stores.getStore('household'), {}); }
      catch { return []; }
    },
    meta: {
      hostAddress: hostAgent.address,
      chatAddress: chatAgent.address,
      transport:   'internal',
    },
    // agents — the ISSUER-side TokenRegistry backing grantAgent/revokeAgent/
    // revokeGrant (issue → store; revoke → isRevoked flips true).  null when the
    // token wiring fell back to registry-only mode.  Tests + admin surfaces
    // consult `isRevoked(tokenId)` here.
    agentsTokenRegistry,
    // v0.7.12 — caller wires the invite-attendee callback after
    // construction (so the simPeers map + threadStore from main.js
    // are visible here).
    setInviteAttendee(fn) {
      if (typeof fn === 'function') inviteAttendeeRef = fn;
    },
    // v0.7. — caller wires the pod-writer on sign-in / clears on
    // sign-out so calendar's .ics feed writes-through to the user's
    // pod under <pod>/canopy/calendar/feed.ics.
    setCalendarPodWriter,
    // N5 — caller wires the folio Drive's real-pod source on sign-in
    // (a PodClient + container) / clears on sign-out.  Lights up the
    // "My pod" toggle in the circle Folio browser.  Pass null to detach.
    setFolioPodSource: (src) => folioAgent.setPodSource?.(src) ?? null,
    // 52.25 — wire the `/zoek` semantic embedder from the ACTIVE circle's
    // embed policy (embedTool ?? llmTool). The circle shell resolves the
    // embedder (`resolveCircleEmbedder`) and calls this on circle switch /
    // settings change; pass null (policy 'off' / unconfigured) to revert
    // `/zoek` to lexical-only. Rebuilds the note index on the next `/zoek`
    // when the embedder identity changes.
    setFolioNoteEmbedder: (e) => folioAgent.setNoteEmbedder?.(e) ?? null,
    // S4 — route stoop's items to the user's REAL pod on sign-in (parity with folio/
    // calendar). Delegates to the stoop agent's attachPod (builds a SolidPodSource +
    // activates the already-built pod-routing write-through). Pass {podRoot, webid, fetch}.
    attachStoopPod: (opts) => (typeof stoopAgent?.attachPod === 'function' ? stoopAgent.attachPod(opts) : Promise.resolve({ ok: false })),
    detachStoopPod: () => stoopAgent?.detachPod?.(),
    // S6.4 — subscribe to events the inner stoop agent emits (e.g.
    // 'stoop:attachment-fetched' when a recipient's requested attachment bytes
    // arrive over the 1:1 channel). The stoop agent extends core.Emitter
    // (on/off). Returns an unsubscribe fn; a no-op when stoop isn't composed.
    onStoopEvent: (event, handler) => {
      const a = stoopAgent?.bundle?.agent;
      if (!a || typeof a.on !== 'function' || typeof handler !== 'function') return () => {};
      a.on(event, handler);
      return () => { try { a.off?.(event, handler); } catch { /* defensive */ } };
    },
    // Expose identity info for /me + /pod-status.  pubKeys are stable
    // across refreshes because identity is persisted to VaultLocalStorage.
    identity: {
      host: { pubKey: hostId.pubKey, stableId: hostId.stableId },
      chat: { pubKey: chatId.pubKey, stableId: chatId.stableId },
    },

    // Cross-peer state (delegates to sa.peer).  Same surface main.js
    // already consumes: peer.address / peer.status / peer.error.
    peer: sa.peer,

    // A1 (2026-05-23) — second cross-peer transport: WebSocket relay.
    // Symmetric to .peer; main.js + the /set-relay slash use these.
    relay: sa.relay,

    // T5.2d — secure-mesh seams (the unified secure-mesh factory's surface).
    // Lets a shell inject a RUNTIME-built transport (e.g. basis-mobile's
    // mDNS, which needs the agent's identity so it can't go through the
    // construction-time `meshTransports` opt) — security-wrapped + on the
    // unified router — and drive WebRTC rendezvous. connectPeerTransport below
    // calls enableSecureRendezvous for the common case; these stay exposed for
    // the Nearby/mDNS path + diagnostics.
    addSecureTransport:     sa.addSecureTransport,
    removeSecureTransport:  sa.removeSecureTransport,
    enableSecureRendezvous: sa.enableSecureRendezvous,
    upgradeToRendezvous:    sa.upgradeToRendezvous,
    isRendezvousActive:     sa.isRendezvousActive,

    // OBJ-2 (S1c) — household no-pod sync roster. Fed two ways: the circle-membership
    // feed (listGroupRoster) AND the in-app "paired devices" screen. Both land here;
    // add/remove persist the manual pairings (see HOUSEHOLD_PEERS_KEY) so they survive a
    // reload. Inert until peers are added. Returns the resulting roster for the UI.
    // OBJ-2 Phase 6 — peer ops are PER-CIRCLE. `(circleId, pubKey)`; a legacy 1-arg `(pubKey)` call
    // scopes to the active circle (the paired-devices screen pairs the open circle). Each circle's
    // mirror has its own roster — pairing circle A never fans A's items to a B-only device.
    addHouseholdPeer:    async (circleId, pubKey) => {
      if (pubKey === undefined) { pubKey = circleId; circleId = resolveHouseholdCircleId({}); }
      const id = (typeof circleId === 'string' && circleId) ? circleId : 'household';
      const mirror = await ensureHouseholdMirror(id);
      const fresh = isNewHouseholdPeer(id, pubKey);
      await mirror.addPeer(pubKey); await persistHouseholdPeers(id);
      if (fresh) republishHouseholdItemsToNewPeer(id).catch(() => {});
      return mirror.listPeers?.() ?? [];
    },
    removeHouseholdPeer: async (circleId, pubKey) => {
      if (pubKey === undefined) { pubKey = circleId; circleId = resolveHouseholdCircleId({}); }
      const id = (typeof circleId === 'string' && circleId) ? circleId : 'household';
      const mirror = await ensureHouseholdMirror(id);
      mirror.removePeer(pubKey); await persistHouseholdPeers(id);
      return mirror.listPeers?.() ?? [];
    },
    // OBJ-2 mutual pairing — add the peer AND ask it to add us back (a __pairReq carrying our address +
    // the circle), so a single scan makes the no-pod sync bidirectional. No echo → no loop.
    pairWithPeer:        async (circleId, pubKey) => {
      if (pubKey === undefined) { pubKey = circleId; circleId = resolveHouseholdCircleId({}); }
      const id = (typeof circleId === 'string' && circleId) ? circleId : 'household';
      const mirror = await ensureHouseholdMirror(id);
      const fresh = isNewHouseholdPeer(id, pubKey);
      await mirror.addPeer(pubKey); await persistHouseholdPeers(id);
      try { await sa.peer.sendTo(pubKey, { __pairReq: { addr: chatId.pubKey, circleId: id } }); } catch { /* best-effort */ }
      if (fresh) republishHouseholdItemsToNewPeer(id).catch(() => {});
      return mirror.listPeers?.() ?? [];
    },
    listHouseholdPeers:  (circleId) => householdMirrors.get((typeof circleId === 'string' && circleId) ? circleId : 'household')?.listPeers?.() ?? [],
    // This device's shareable household address (the pubKey peers route to — matches
    // relay.address; the OTHER device pastes this into its "paired devices" screen).
    householdSelfAddr:   chatId.pubKey,
    // OBJ-2 — re-push THIS circle's current open items to ALL its peers. Called on circle-open
    // (feedHouseholdRoster) so a late-subscribing / already-paired peer still converges: the
    // live publish-on-write only reaches peers subscribed AT THAT MOMENT, and catch-up fires
    // only on a FRESH pair — so without this, items added before the other side opened the
    // circle never arrive. The receiver de-dupes by etag/_v (idempotent), so re-push is safe.
    resyncHouseholdCircle: async (circleId) => { try { await republishHouseholdItemsToNewPeer(circleId); } catch { /* best-effort */ } },
    // Sync seam (mirror + inbound handler) — used by S1d skill hooks + tests.
    householdSync: {
      mirror:        householdMirror,
      handleInbound: householdEnvelopeAdapter.handleInbound,
      circleId:      householdCircleId,
      selfAddr:      chatId.pubKey,
    },

    // Transport-NEUTRAL reachability — true when ANY peer transport can carry a
    // message (NKN `.peer` OR the WebSocket `.relay`; sendPeerMessage already
    // picks whichever is up via the core RoutingStrategy). Callers that gate a
    // fan-out MUST use this, NOT `peer.status` alone — keying on `.peer` is an
    // NKN-only check that wrongly skips when relay is up but NKN is down.
    // (The whole peer layer is transport-agnostic; the `nkn`-flavoured naming
    // around it is a known cleanup — see REMAINING-WORK / the transport-naming note.)
    isPeerReachable: () => sa.peer?.status === 'connected' || sa.relay?.status === 'connected',

    get transportMode() { return sa.transportMode; },
    setTransportMode:    sa.setTransportMode,

    // The slash handlers persist the relay URL + transport mode here.
    // Expose the SA's identity-vault so /set-relay can stash both
    // across reloads (key: cc-relay-url; cc-transport-mode).
    vault: sa.identity?.vault ?? sa.vault ?? null,

    /**
     * Connect the cross-peer transport(s). Transport-neutral / local-first: NKN is ONE transport,
     * not a prerequisite — bring up whichever is configured (`nknLib` and/or `relayUrl`). Passing only
     * `relayUrl` is the LAN no-pod path (two devices over a relay, no public-NKN dependency); passing
     * only `nknLib` is the original NKN path; both → the unified router picks the best route per peer.
     * Caller (web main.js / circleApp / RN bundle) injects its runtime's nkn-sdk when available.
     */
    async connectPeerTransport({ nknLib, onPeerMessage, relayUrl, rendezvous = false, rtcLib = null }) {
      if (!nknLib && !relayUrl) {
        throw new Error('connectPeerTransport: provide nknLib and/or relayUrl (nothing to connect)');
      }
      // OBJ-2 (S1a) — consume household substrate-sync envelopes off the inbound
      // peer-message stream BEFORE the shell router. handleInbound returns true
      // (consumed) only for tagged household-item envelopes; everything else
      // (DMs, buurt-posts, calendar invites) falls through to the shell's
      // onPeerMessage unchanged.
      //
      // The secure-mesh receive path delivers a SINGLE `{ from, payload, ts }` env
      // (createSecureAgent makeReceiveHandler → onPeerMessageFn({from,payload,ts})),
      // and the shell router (makePeerRouter) also takes that env object. handleInbound,
      // though, wants `(fromAddress, payload)` positionally — so extract them from the
      // env. (The earlier `(addr, payload)` form passed the whole env as the address +
      // undefined payload, so household sync never matched over the real wire — a latent
      // bug surfaced by the Layer-3 relay test; the shell router was unaffected as it
      // reads the env object regardless.)
      const routedOnPeerMessage = (env) => {
        // OBJ-2 mutual pairing — the other device added us as a peer and asks us to add it back, so the
        // sync is bidirectional from one scan. Add + persist (no echo → no loop), then consume.
        const pr = env?.payload?.__pairReq;
        if (pr && typeof pr.addr === 'string' && pr.addr && pr.addr !== chatId.pubKey) {
          const cid = (typeof pr.circleId === 'string' && pr.circleId) ? pr.circleId : 'household';
          const fresh = isNewHouseholdPeer(cid, pr.addr);
          ensureHouseholdMirror(cid)
            .then((m) => m.addPeer(pr.addr))
            .then(() => persistHouseholdPeers(cid))
            .then(() => { if (fresh) return republishHouseholdItemsToNewPeer(cid); })   // backfill, per-circle
            .catch(() => {});
          return;
        }
        try { if (householdEnvelopeAdapter.handleInbound(env?.from, env?.payload)) return; }
        catch { /* fall through to the shell router */ }
        return onPeerMessage?.(env);
      };
      if (nknLib) {
        await sa.peer.connect({ nknLib, onPeerMessage: routedOnPeerMessage });
      }
      // T3a (unification / OBJ-1) — when a relay is configured, bring it up too. With NKN also up the
      // secure-agent's RoutingStrategy (T2) picks the BEST route per peer (relay > nkn by priority);
      // relay-ONLY pins transportMode to 'relay' so sends route over it. Best-effort: a relay failure
      // never blocks NKN — but if relay is the ONLY transport, its failure means no cross-peer wire.
      if (relayUrl) {
        try {
          await sa.relay.connect({ relayUrl, onPeerMessage: routedOnPeerMessage });
          sa.setTransportMode(nknLib ? 'both' : 'relay');
          if (typeof console !== 'undefined') console.info(`[realAgent] relay connected — routing across {${nknLib ? 'nkn, relay' : 'relay'}}`);
        } catch (err) {
          if (typeof console !== 'undefined') console.warn(`[realAgent] relay connect failed${nknLib ? ' (continuing on NKN)' : ' (no cross-peer wire — relay was the only transport)'}:`, err?.message ?? err);
        }
      }
      // T5.2d — opt in to direct WebRTC rendezvous, signalled over whichever transport just
      // came up (peer/relay). Web needs no rtcLib (RendezvousTransport uses globalThis
      // .RTCPeerConnection); RN injects react-native-webrtc via `rtcLib`. Best-effort: when the
      // rtcLib is missing the agent keeps routing over nkn/relay/mdns — rendezvous just stays off.
      if (rendezvous) {
        try {
          await sa.enableSecureRendezvous({ rtcLib });
          if (typeof console !== 'undefined') console.info('[realAgent] rendezvous enabled — direct WebRTC upgrade available');
        } catch (err) {
          if (typeof console !== 'undefined') console.warn('[realAgent] rendezvous enable failed (continuing without direct WebRTC):', err?.message ?? err);
        }
      }
      return sa.peer;
    },

    /**
     * Fire-and-forget cross-peer send.  Auto-HI on first contact,
     * SecurityLayer sign+encrypt — both handled inside the factory.
     * S1 mute-block: throws when targetAddress is muted.
     *
     * `opts` is forwarded to the secure send path. Pass
     * `{ guarantee: 'hold-forward' }` (or `{ hold: true }`) to opt in to the
     * delivery guarantee: a send to an unreachable peer is parked locally and
     * flushed on the peer's next presence signal instead of being lost/errored
     * (returns a `{ held: true, ... }` result rather than throwing).
     */
    async sendPeerMessage(targetAddress, payload, opts = {}) {
      return sa.peer.sendTo(targetAddress, payload, opts);
    },

    /**
     * Presence hook for the delivery guarantee — call when a peer becomes
     * reachable again (a reachability / peer-joined event) to flush any
     * messages held for them. Inbound traffic from the peer flushes
     * automatically; this is the explicit trigger for reachability events.
     */
    presenceSignal(targetAddress) {
      return sa.presenceSignal(targetAddress);
    },

    /** Diagnostics: how many messages are currently held for a peer. */
    heldFor(targetAddress) {
      return sa.heldFor(targetAddress);
    },

    /**
     * Rotate the chat-agent's Ed25519 identity.  Old key stays valid
     * for a 7-day grace period; KeyRotation.broadcast notifies known
     * peers.  S6 autoLog fires 'identity.rotate'.
     */
    async rotateChatIdentity(rotateOpts = {}) {
      return sa.rotateIdentity(rotateOpts);
    },

    /** Diagnostic for /security-status (proxies through the factory). */
    securityStatus() { return sa.securityStatus(); },

    /**
     * Direct access to the underlying secure-agent.  Lets new
     * basis commands (mute, audit-tail, claim, …) tap every
     * primitive the factory wires without re-exposing each one.
     */
    sa,
    // Diagnostic (step 2.4a) — the enforcement gate on the host skills' agent. Non-null proves
    // the PolicyEngine attached (vs the try/catch having silently swallowed it).
    hostPolicyEngine: hostAgent.policyEngine ?? null,
    // Step 5B/C — the per-circle ADDRESS this device presents in a circle (unlinkable-by-default),
    // derived from the default profile seed. The substrate the roster-recording wire consumes.
    circleAddressFor: (circleId) => deriveCircleAddress(defaultProfileSeed, circleId),
    // Decision B (SENSITIVE) — sign the cross-circle link challenge with the SOURCE circle's
    // key (seed-derived, no vault) so a "continue as an existing self" claim is PROVABLE. The
    // join wizard passes this on the redeem seam; the admin verifies it before recording.
    signCircleLink: (circleId, groupId, address) => signCircleLinkFromSeed(defaultProfileSeed, circleId, groupId, address),
  };
}
