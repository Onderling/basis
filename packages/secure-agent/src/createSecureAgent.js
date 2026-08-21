/**
 * @onderling/secure-agent — createSecureAgent factory.
 *
 * Safety-by-default composition.  This file ships the FOUNDATION
 * (S0 in the security roadmap); future slices (S1-S8) add opts
 * for mute / helloGates / signed-claim / passphrase-vault /
 * identity-resolver / capability-tokens / audit-log / groups /
 * PFS — each as a checkbox flag, not manual wiring.
 *
 * See Project Files/basis/security-roadmap-2026-05-23.md.
 *
 * # What lands in S0 (this file)
 *
 *   - Persistent identity (vault-backed) via restoreOrGenerate
 *   - Agent with auto-SecurityLayer (already core default)
 *   - Optional NknTransport, wired with useSecurityLayer + auto-HI
 *   - rotateIdentity wrapper (Agent.rotateIdentity + grace + broadcast)
 *   - securityStatus diagnostic
 *
 * # What lands in S1 + S2 + S3 (also this file)
 *
 *   - muteListVaultKey   (A.1)   persistent mute set + send-side block
 *   - helloGate          (A+.1)  PSK / predicate gate + mute base gate
 *   - webidClaim         (A.2)   sa.claim.sign/verify/serialize/parse
 *   - passphrase         (A.3)   forwards to vault picker → VaultIndexedDB
 *   - webAuthnUnlock     (A+.5)  sa.passkey.{register,unlock} via PRF
 *   - identityResolver   (A.4)   sa.resolver.* + alias-fanout mute
 *   - trustRegistry      (A+.3)  sa.trust (vault-backed)
 *   - capabilityIssuer   (A.5)   sa.caps.issue/verify
 *   - policyEngine       (A.5b)  sa.policy (composes trust + skills)
 *   - Roles re-exported as sa.ROLES + module export
 *   - auditLog           (A.6)   sa.audit signed hash-chain + autoLog
 *   - groupManager       (A.7)   sa.groups (auto-threaded into policy)
 *   - a2aTls             (A+.4)  sa.a2aTls (A2ATransport helper)
 *   - rateLimit          (A+.8)  drops over-quota envelopes
 *   - sa.migrateVaultToPod helper bound to our identity + vault
 *   - usePerfectFwdSec   (A.8)   sa.pfs partial Double-Ratchet
 *                                      (symmetric ratchet; no DH ratchet —
 *                                      see pfs.js header for scope)
 *
 * # Future work
 *
 *   - full Double-Ratchet (DH ratchet + per-message ephemerals)
 *           — requires transport-level integration; not in current scope
 *
 * All roadmap slices S0–S8 are now wired.  STUB_OPTS is empty.
 */

import {
  Agent,
  AgentIdentity,
  InternalBus,
  InternalTransport,
  RoutingStrategy,
  TRANSPORT_PRIORITY,
  firstContactRateGate,
} from '@onderling/core';
import {
  NknTransport,
  RelayTransport,
  RendezvousTransport,
} from '@onderling/transports';

import {
  tokenGate,
  TrustRegistry,
  CapabilityToken,
  PolicyEngine,
  ROLES,
  GroupManager,
  A2ATLSLayer,
} from '@onderling/core';
import { migrateVaultToPod as migrateVaultToPodFn } from '@onderling/pod-client';
import { createRateLimiter } from './rateLimit.js';
import { loadPFSChain }      from './pfs.js';

import { makeBrowserVault, restoreOrGenerate } from './vault.js';
import { loadMuteSet }                          from './mute.js';
import {
  signClaim    as signClaimFn,
  verifyClaim  as verifyClaimFn,
  serializeClaim,
  parseClaim,
} from './claim.js';
import {
  registerPasskey   as registerPasskeyFn,
  unlockWithPasskey as unlockWithPasskeyFn,
  webauthnAvailable,
  PASSKEY_ERRORS,
} from './passkey.js';
import { loadAuditLog }       from './auditLog.js';

/**
 * @typedef {object} CreateSecureAgentOpts
 *
 * @property {object}  [vault]                  Pre-built Vault (e.g. VaultMemory for tests)
 * @property {string}  [identityVaultPrefix]    Default 'sa-id:'
 * @property {object}  [bus]                    Pre-built InternalBus — share when this agent needs to talk to others in-process (e.g. basis's host+chat topology).  Default: factory builds its own siloed bus.
 * @property {string}  [passphrase]             wraps vault with AES-GCM via PBKDF2 (browser/IndexedDB)
 * @property {boolean|object} [webAuthnUnlock]  true | { rpId, prfSalt, userName, ... }
 *
 * @property {object}  [nknLib]                 window.nkn from CDN, or RN nkn-sdk; absent → no peer transport
 *
 * @property {string}  [muteListVaultKey]       persistent mute slot (omit = in-memory)
 * @property {Function|string|object} [helloGate] fn(envelope)=>bool, PSK string, or { token }
 * @property {object}  [webidClaim]             { webid } binds default WebID for claim.sign()
 * @property {object}  [identityResolver]       MemberMap-shape (or { memberMap }) for alias-aware mute + sa.resolver.*
 * @property {object}  [circleEnforcement]      5.7c — host-injected `{groupsIndex, getOverride, getCirclePolicy, memberMap, getCircleIdForEnv?}` accessors.  Inbound envelopes from a peer in any circle the local user has set `override.chatOff` on, OR from a peer whose MemberMap relation is `'agent'` in a circle where agents are blocked, are dropped after the existing mute-gate.  Fails OPEN on accessor throw so a broken store never silently drops inbound.
 * @property {boolean|object} [capabilityIssuer] true | { defaultExpiresIn }  exposes sa.caps
 * @property {boolean|object} [trustRegistry]    true | { vault }  exposes sa.trust
 * @property {boolean|object} [policyEngine]     true | { groupManager, isRevoked, actorResolver }  exposes sa.policy (requires trustRegistry)
 * @property {boolean|object} [auditLog]        true | { vaultKey, vault?, autoLog? }  exposes sa.audit
 * @property {boolean|object} [groupManager]    true | { vault } exposes sa.groups (auto-threaded into policy)
 * @property {boolean|object} [a2aTls]          true | { a2aAuth } exposes sa.a2aTls
 * @property {boolean|object} [rateLimit]       true | { perPeer, global, exempt(env)→bool } drops over-quota envelopes (exempt passes legitimate bursts, e.g. catch-up batches)
 * @property {boolean|object} [usePerfectFwdSec] true | { vaultKeyPrefix, maxSkip } exposes sa.pfs
 *
 * @property {Function} [onPeerMessage]         ({from, payload, ts}) => void
 * @property {object}   [podWriter]             For S2 / S6 pod-side writes
 *
 * @property {boolean}  [warnOnInsecure=true]   console.warn when a safety opt is off
 */

/**
 * Stubbed opts list — when the caller sets one of these, we warn
 * that it's not implemented yet but the API is reserved.  When the
 * corresponding S slice lands, the warning becomes an activation.
 */
const STUB_OPTS = Object.freeze([
  // passphrase        — wired in S3 (forwarded to vault picker)
  // webAuthnUnlock    — wired in S3 (exposes sa.passkey.{register,unlock})
  // muteListVaultKey  — wired in S1
  // helloGate         — wired in S1
  // webidClaim        — wired in S2
  // identityResolver  — wired in S4 (sa.resolver.* + mute-fanout)
  // capabilityIssuer  — wired in S5 (sa.caps.{issue,verify})
  // trustRegistry     — wired in S5 (sa.trust.* — vault-backed)
  // policyEngine      — wired in S5 (sa.policy)
  // auditLog          — wired in S6 (sa.audit.* signed hash-chain)
  // groupManager      — wired in S7 (sa.groups)
  // a2aTls            — wired in S7 (sa.a2aTls)
  // rateLimit         — wired in S7 (drops envelopes over quota)
  // usePerfectFwdSec  — wired in S8 (sa.pfs — partial Double-Ratchet)
]);

/**
 * Phase-2 · Piece-1 (G4) — default bound on failover attempts per send.
 * Caps how many transport tiers a single `sendToPeer` will try before it
 * gives up and lets the error propagate (to the outer handshake-retry, then
 * the app's hold/error path).  With direct→mesh (relay→NKN) only two tiers
 * exist today; the budget guards against a router that keeps yielding fresh
 * names so a truly-unreachable peer can't spin.  Override per-call with
 * `opts.failoverBudget`.
 */
const FAILOVER_ATTEMPT_BUDGET = 3;

/**
 * Phase-2 · Piece-1 (G4) — classify a send error as an APPLICATION/skill
 * error (which must NOT trigger transport failover) vs a transport-class
 * error (which does).  The secure send path performs only transport work
 * (HI handshake + one-way send), so the default is transport-class; this
 * returns `true` only for errors a different transport could not fix:
 *   - an explicit marker (`err.application` / `err.isApplicationError`, or
 *     `err.name` of `ApplicationError` / `SkillError`), or
 *   - a message that names an application-layer refusal (muted / refused /
 *     forbidden / not permitted / invalid payload).
 *
 * @param {*} err
 * @returns {boolean}
 */
function isApplicationError(err) {
  if (!err) return false;
  if (err.application === true || err.isApplicationError === true) return true;
  const name = err.name;
  if (name === 'ApplicationError' || name === 'SkillError') return true;
  return /\bmuted\b|refused|not permitted|forbidden|invalid payload/i.test(
    String(err?.message ?? err),
  );
}

/**
 * Build a secure agent + (optional) cross-peer transport.
 *
 * @param {CreateSecureAgentOpts} [opts]
 * @returns {Promise<{
 *   agent: Agent,
 *   identity: { pubKey: string, stableId: string, vault: object },
 *   peer: {
 *     connect: () => Promise<{ address: string, status: string }>,
 *     sendTo:  (addr: string, payload: any) => Promise<void>,
 *     status:  string,
 *     address: string|null,
 *   },
 *   rotateIdentity: (opts?: object) => Promise<{ oldPubKey, newPubKey, graceUntilDays }>,
 *   securityStatus: () => object,
 *   shutdown: () => Promise<void>,
 *   mute: {
 *     add: (addr) => Promise<boolean>,
 *     remove: (addr) => Promise<boolean>,
 *     has: (addr) => boolean,
 *     list: () => string[],
 *     clear: () => Promise<void>,
 *     size: number,
 *   },
 *   claim: {
 *     sign: (args?: { webid?: string, nknAddr?: string, ttlMs?: number }) => object,
 *     verify: (claim, opts?) => { ok: true, body } | { ok: false, reason },
 *     serialize: (claim) => string,
 *     parse: (str) => object,
 *     boundWebid: string|null,
 *   },
 * }>}
 */
export async function createSecureAgent(opts = {}) {
  // warn about stubbed opts so callers know what's wired now
  // vs what they're asking for that will activate in a future slice.
  if (opts.warnOnInsecure !== false && typeof console !== 'undefined') {
    for (const key of STUB_OPTS) {
      if (opts[key] !== undefined) {
        console.warn(
          `[secure-agent] opt "${key}" is RESERVED for a future slice ` +
          `(see security-roadmap-2026-05-23.md).  Currently a no-op; the ` +
          `factory's S0 foundation has wired identity + SecurityLayer + ` +
          `auto-HI + rotation.  Your "${key}" value is preserved on the ` +
          `returned object as .pendingOpts.${key}.`,
        );
      }
    }
  }

  // Forward-declared so async ops below can fire-and-forget into the
  // audit log without caring whether it's wired or not.
  let auditLog = null;
  const audit = (event, subject, data) => {
    if (!auditLog) return;
    auditLog.append({ event, subject, data })
      .catch((err) => console.warn('[secure-agent] audit append failed', err));
  };

  // ─── Identity (persists across page loads when vault supports it) ───
  // when opts.passphrase is set, the picker promotes us from
  // VaultLocalStorage (plaintext) to VaultIndexedDB (AES-GCM via
  // PBKDF2(passphrase, dbName)).  See vault.js for the picker.
  const vault = opts.vault ?? makeBrowserVault({
    prefix:     opts.identityVaultPrefix ?? 'sa-id:',
    passphrase: opts.passphrase ?? null,
  });
  const identity = await restoreOrGenerate(vault);

  // ─── Agent on an InternalBus ─────────────────────────────────────
  // Default: factory builds its own siloed bus (single-agent topology).
  // Override: pass opts.bus when this agent must talk to other in-process
  // agents (e.g. basis's host+chat topology — chatAgent comes from
  // the factory; hostAgent is built manually; both share the bus).
  const bus = opts.bus ?? new InternalBus();
  const transport = new InternalTransport(bus, identity.pubKey);
  // ─── T5.1 (unification / OBJ-1) — ONE router shared with the core Agent ───
  // The secure-agent routes `sendToPeer` via this RoutingStrategy (T2), and we pass the SAME
  // instance to the core Agent so `agent.routing === routing`. That unifies the two routers: the
  // core Agent's hooks that pin a transport on `agent.routing` — notably `enableRendezvous` (auto
  // WebRTC upgrade) + mdns/ble registration — now take effect on the secure-agent's sendToPeer path
  // too (resolving the T3b/T4 entanglement). Transports register via `routing.addTransport(name, tx)`
  // DIRECTLY (not `agent.addTransport`, which would re-wrap security over makeReceiveHandler's wiring).
  //
  // Phase-2 · Piece-2 (B2 wiring) — attach a PeerGraph so the send path's
  // `addressFor` (route → PeerGraph.addressesOf) can resolve the
  // transport-appropriate wire address per peer (relay routes by the Ed25519
  // pubKey; NKN by its seed-derived native address — one canonical peer id,
  // two wire addresses). The app owns the peer registry, so it is normally
  // attached AFTER boot via `sa.attachPeerGraph(...)`; `opts.peerGraph` covers
  // callers (tests / pre-built topologies) that already have one at factory
  // time. With no graph, `addressesOf` has nothing to resolve and the address
  // degrades to the caller-supplied id — the pre-slice-2 behaviour.
  const routing = new RoutingStrategy({
    transports: new Map(),
    peerGraph:  opts.peerGraph ?? null,
  });
  const agent = new Agent({ identity, transport, routing });
  await agent.start();

  // ─── persistent mute set (A.1) ───────────────────────────────
  // Match key today = NKN peer address.  S4 (identity-resolver) will
  // additionally match on stableId + webid when those mappings exist.
  const muteSet = await loadMuteSet({
    vault,
    vaultKey: opts.muteListVaultKey ?? null,
  });

  // ─── helloGate (A+.1) ────────────────────────────────────────
  // Layers, composed AND-wise (ALL must pass to accept the HI):
  //   1. mute-block gate (always): reject a muted peer's HI (the only pre-registration drop point for it).
  //   2. first-contact rate bound (always): cap how fast NEW (not-yet-known) senders register, so a flood of
  //      stranger hellos on a local transport can't grow the peer graph unboundedly. A KNOWN peer (already in
  //      the graph) is unaffected. This bounds a RESOURCE — it is NOT the authz boundary (who-may-send binds
  //      at the receive-path roster-authorize + seal). "known" reads the PEER GRAPH, not the key store,
  //      because the SecurityLayer auto-registers the HI key before this gate runs. Tunable via
  //      `opts.helloRateLimit = { maxPerWindow, windowMs }`; a no-PeerGraph agent has nothing to grow, so the
  //      bound is a no-op there (every sender reads as "known").
  //   3. user-supplied gate (optional): tokenGate(string) | groupGate | custom fn.
  const userHelloGate = resolveHelloGate(opts.helloGate);
  const muteBlockGate = async (env) => !muteSet.has(env?._from);
  const rl = (opts.helloRateLimit && typeof opts.helloRateLimit === 'object') ? opts.helloRateLimit : {};
  const boundGate = firstContactRateGate({
    isKnown: async (from) => !agent.peers || !!(await agent.peers.get(from)),
    maxPerWindow: rl.maxPerWindow,
    windowMs:     rl.windowMs,
  });
  const gates = [muteBlockGate, boundGate, ...(userHelloGate ? [userHelloGate] : [])];
  const composedGate = async (env) => {
    for (const g of gates) { if (!(await g(env))) return false; }
    return true;
  };
  agent.setHelloGate(composedGate);

  // ─── signed WebID claim (A.2) ────────────────────────────────
  // Bind the WebID once (factory-time) if the caller passed one; then
  // signClaim() can default to it.  No bound webid → caller must pass
  // it to each signClaim call.
  const boundWebid = (typeof opts.webidClaim === 'object' && opts.webidClaim)
    ? (opts.webidClaim.webid ?? null)
    : null;

  // ─── passphrase + WebAuthn (A.3 + A+.5) ──────────────────────
  // The passphrase has already been forwarded to the vault picker
  // above.  Here we record whether the vault was actually wrapped,
  // for securityStatus reporting.
  // (No way to introspect VaultIndexedDB's enc state from outside;
  //  we proxy on the user's opts + runtime support.)
  const vaultEncrypted = !!opts.passphrase
                      && typeof globalThis.indexedDB !== 'undefined'
                      && !opts.vault;

  // WebAuthn binding — config + helpers.  Accept:
  //   true                          → infer rpId from window.location.hostname
  //   { rpId, rpName, prfSalt, ... }→ explicit config
  const passkeyConfig = resolvePasskeyConfig(opts.webAuthnUnlock);

  // ─── identity-resolver (A.4) ─────────────────────────────────
  // Compose SecurityLayer (addr→pubKey) with the caller-supplied
  // MemberMap-like (pubKey/webid/stableId→member).  Either source may
  // be absent; the resolver degrades gracefully (returns null).
  //
  // identityResolver opt forms:
  //   memberMap-shape       → treat as MemberMap directly
  //   { memberMap }         → object form for future expansion
  const resolverMemberMap = pickResolverMemberMap(opts.identityResolver);

  // ── Peer identity resolution (a device-local projection) ────────────────────────────────────────────
  // Maps a volatile identifier (a per-circle address / a rotating pubKey) to the stable person, and fans a
  // mute across ALL of a peer's known aliases. It lives HERE — inlined over this factory's own sources —
  // and deliberately NOT on the MemberMap/identity layer, for a disclosure reason, not just convenience:
  // `aliasesFor` is the one place that LINKS a person's per-circle addresses back to one person, and
  // per-circle unlinkability makes that linkage device-local ("nobody else's to see"), while a MemberMap
  // can be pod-backed/shared. Its three inputs all compose here: the SecurityLayer (addr→pubKey), the
  // device-local `peerIdentityOf` alias→canonical map, and the caller's MemberMap. The mute LIST is
  // portable (opaque strings, your list); the RESOLUTION of an address to a person is not.
  //
  // addr → pubKey. The device-local identity link FIRST — since Decision 4 the SecurityLayer can no longer
  // answer "who is this" for a per-circle address (its `getPeerKey` returns that CIRCLE's signing key, a
  // different answer per circle); only `peerIdentityOf` (kept below — read at CALL time, so referencing it
  // here is safe) knows the canonical person. Then a host-supplied hook, then the SecurityLayer.
  const pubKeyForAddr = (addr) => {
    try {
      const canonical = peerIdentityOf.get?.(addr)
        ?? (typeof opts.identityResolver?.identityForAddr === 'function'
          ? opts.identityResolver.identityForAddr(addr) : null);
      if (canonical) return canonical;
    } catch { /* fall through to the SecurityLayer */ }
    if (!agent.security || typeof agent.security.getPeerKey !== 'function') return null;
    return agent.security.getPeerKey(addr);
  };
  const resolveMemberByAddr = async (addr) => {
    if (!addr) return null;
    const pubKey = pubKeyForAddr(addr);
    if (pubKey && resolverMemberMap?.resolveByPubKey) {
      const m = await resolverMemberMap.resolveByPubKey(pubKey);
      if (m) return m;
    }
    // Fallback: treat addr AS a pubKey (pubKey-addressed transports, e.g. NKN — the address IS the key).
    if (resolverMemberMap?.resolveByPubKey) {
      const m = await resolverMemberMap.resolveByPubKey(addr);
      if (m) return m;
    }
    return null;
  };
  // The SET of identifiers we believe equate to this peer — the mute-fanout input. addr + pubKey + the
  // resolved member's {pubKey, webid, stableId}, deduped.
  const aliasesForAddr = async (addr) => {
    const set = new Set();
    if (addr) set.add(addr);
    const pubKey = pubKeyForAddr(addr);
    if (pubKey) set.add(pubKey);
    const m = await resolveMemberByAddr(addr);
    if (m?.pubKey)   set.add(m.pubKey);
    if (m?.webid)    set.add(m.webid);
    if (m?.stableId) set.add(m.stableId);
    return [...set];
  };
  // The `sa.resolver` surface (the security journeys assert `aliasesFor` here). A plain projection object,
  // not a class — its logic is these closures over the factory's sources.
  const peerResolver = {
    get hasMemberMap() { return !!resolverMemberMap; },
    get hasSecurity()  { return !!agent.security; },
    pubKeyForAddr,
    resolveByAddr:     resolveMemberByAddr,
    resolveByPubKey:   async (pubKey)   => (pubKey && resolverMemberMap?.resolveByPubKey   ? resolverMemberMap.resolveByPubKey(pubKey)     : null),
    resolveByWebid:    async (webid)    => (webid && resolverMemberMap?.resolveByWebid     ? resolverMemberMap.resolveByWebid(webid)       : null),
    resolveByStableId: async (stableId) => (stableId && resolverMemberMap?.resolveByStableId ? resolverMemberMap.resolveByStableId(stableId) : null),
    aliasesFor:        aliasesForAddr,
  };

  // ─── 5.7c — circle override enforcement (chat-off + agent-block) ──
  // Host-injected accessors let the substrate (basis v2) consult
  // its GroupsIndex + per-circle override store + per-circle policy
  // store without secure-agent knowing about them.  Only the addr→
  // webid resolution + the decision boundary live here.
  //
  // Failure model: FAIL-OPEN.  An accessor that throws — or the
  // predicate itself — is treated as "no decision" so a broken store
  // never silently drops user-facing inbound.  The audit log records
  // the throw when wired so operators can see the misconfig.
  //
  // Order vs mute-set: the receive handler runs the mute fast-path
  // FIRST (so muted peers never even reach the override layer); only
  // non-muted envelopes are evaluated against the circle gates.
  const circleEnf = pickCircleEnforcement(opts.circleEnforcement);

  /**
   * Resolve the inbound peer's webid via the identityResolver chain.
   * Returns null when the resolver/security layer don't yet know the
   * peer (e.g. a stranger pre-HI) — the caller treats null as "no
   * enforcement decision possible" and lets the envelope through.
   */
  async function peerWebidFor(addr) {
    if (!addr) return null;
    try {
      const m = await peerResolver.resolveByAddr(addr);
      return m?.webid ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Evaluate the 5.7c chat-off + agent-block gates for an inbound
   * envelope.  Returns `true` if the envelope must be DROPPED; `false`
   * otherwise.  Fails open on any error.
   */
  async function isInboundCircleBlocked(env) {
    if (!circleEnf) return false;
    const addr = env?._from;
    if (!addr) return false;
    let peerWebid = null;
    try {
      peerWebid = await peerWebidFor(addr);
    } catch (err) {
      console.warn('[secure-agent] circleEnforcement: webid resolve failed', err?.message ?? err);
      audit('circleEnforcement.error', addr, { stage: 'resolveWebid', error: String(err?.message ?? err) });
      return false;
    }
    if (!peerWebid) return false;   // unknown peer → no enforcement signal

    // 1) Chat-off — any shared-circle override silences this peer.
    try {
      const off = await isInboundChatOffLocal({
        peerWebid,
        groupsIndex: circleEnf.groupsIndex,
        getOverride: circleEnf.getOverride,
      });
      if (off) {
        audit('circleEnforcement.drop', addr, { reason: 'chatOff', peerWebid });
        return true;
      }
    } catch (err) {
      console.warn('[secure-agent] circleEnforcement: chat-off predicate threw', err?.message ?? err);
      audit('circleEnforcement.error', addr, { stage: 'chatOff', error: String(err?.message ?? err) });
      // fail open
    }

    // 2) Agent-block — needs a circleId scope; ask the host to pick.
    let circleId = null;
    try {
      circleId = typeof circleEnf.getCircleIdForEnv === 'function'
        ? circleEnf.getCircleIdForEnv(env, peerWebid)
        : null;
    } catch (err) {
      console.warn('[secure-agent] circleEnforcement: getCircleIdForEnv threw', err?.message ?? err);
      audit('circleEnforcement.error', addr, { stage: 'getCircleIdForEnv', error: String(err?.message ?? err) });
      circleId = null;
    }
    if (typeof circleId === 'string' && circleId) {
      try {
        const blocked = await isInboundAgentBlockedLocal({
          peerWebid,
          circleId,
          memberMap:       circleEnf.memberMap,
          getCirclePolicy: circleEnf.getCirclePolicy,
          getOverride:     circleEnf.getOverride,
        });
        if (blocked) {
          audit('circleEnforcement.drop', addr, { reason: 'agentBlocked', peerWebid, circleId });
          return true;
        }
      } catch (err) {
        console.warn('[secure-agent] circleEnforcement: agent-block predicate threw', err?.message ?? err);
        audit('circleEnforcement.error', addr, { stage: 'agentBlock', error: String(err?.message ?? err) });
        // fail open
      }
    }
    return false;
  }

  /**
   * Mute check with resolver fanout.  An envelope from `addr` is
   * considered muted if EITHER:
   *   - addr is in the mute set (sync fast-path), OR
   *   - any of {pubKey, webid, stableId} for addr is in the mute set.
   *
   * Without a resolver wired, this collapses to the sync fast-path.
   */
  async function isPeerMuted(addr) {
    if (!addr) return false;
    if (muteSet.has(addr)) return true;
    if (!resolverMemberMap) return false;
    const aliases = await peerResolver.aliasesFor(addr);
    for (const a of aliases) if (muteSet.has(a)) return true;
    return false;
  }

  // ─── TrustRegistry + CapabilityTokens + PolicyEngine ─────────
  // (A.5 caps + A+.2 Roles + A+.3 Trust)
  //
  // TrustRegistry: persistent per-peer trust/tier/group/token-grant
  // records.  Vault-backed; reuses the agent's vault by default (so
  // identity + trust live side-by-side), or a separate vault may be
  // supplied for isolation (e.g. pod-mirrored trust vs local identity).
  let trustRegistry = null;
  if (opts.trustRegistry) {
    const trustVault = (typeof opts.trustRegistry === 'object' && opts.trustRegistry.vault)
      ? opts.trustRegistry.vault
      : vault;
    trustRegistry = new TrustRegistry(trustVault);
  }

  // CapabilityToken issuance + verification helpers, bound to the
  // factory's identity (signer) and pubKey (expected-agent on verify).
  const capDefaults = (typeof opts.capabilityIssuer === 'object' && opts.capabilityIssuer)
    ? opts.capabilityIssuer
    : {};
  const capsWired = !!opts.capabilityIssuer;

  // ─── GroupManager (A.7) ──────────────────────────────────────
  // Closed-group membership proofs.  Vault-backed; reuses identity
  // vault by default.  Threaded into PolicyEngine when both are wired
  // (so policy checks can consult group membership).
  let groupManager = null;
  if (opts.groupManager) {
    const gmOpts = (typeof opts.groupManager === 'object') ? opts.groupManager : {};
    const gmVault = gmOpts.vault ?? vault;
    groupManager = new GroupManager({ identity, vault: gmVault });
  }

  // PolicyEngine wiring — composed when opted in.  Requires
  // trustRegistry (created here) + agent.skills (always present).  An
  // optional actorResolver may be the same MemberMap-shape we received
  // in S4 (it must expose .resolve to satisfy PolicyEngine — we adapt
  // below).
  let policyEngine = null;
  if (opts.policyEngine) {
    if (!trustRegistry) {
      throw new Error(
        'createSecureAgent: policyEngine requires trustRegistry to also be enabled.',
      );
    }
    const peOpts = (typeof opts.policyEngine === 'object') ? opts.policyEngine : {};
    policyEngine = new PolicyEngine({
      trustRegistry,
      skillRegistry: agent.skills,
      agentPubKey:   identity.pubKey,
      // Auto-thread the GroupManager we built above unless the caller
      // explicitly supplied a different one (covers the "use my own
      // pre-built GroupManager" escape hatch).
      groupManager:  peOpts.groupManager  ?? groupManager ?? null,
      isRevoked:     peOpts.isRevoked     ?? null,
      actorResolver: peOpts.actorResolver ?? null,
    });
    // ATTACH it to the agent — without this the engine is built + exposed as
    // `sa.policy` but `agent.policyEngine` stays null, so `runGatedSkill` never
    // consults it: a silent no-op that looks like enforcement. (The PE needs
    // `agent.skills`, hence attach-after-build.)
    agent.policyEngine = policyEngine;
  }

  // ─── A2ATLSLayer (A+.4) ──────────────────────────────────────
  // For agents that compose A2ATransport (HTTPS + Bearer JWT).  The
  // layer itself just wraps A2AAuth (which the caller supplies if any).
  let a2aTls = null;
  if (opts.a2aTls) {
    const aOpts = (typeof opts.a2aTls === 'object') ? opts.a2aTls : {};
    a2aTls = new A2ATLSLayer({ a2aAuth: aOpts.a2aAuth ?? null });
  }

  // ─── rate-limit (A+.8) ───────────────────────────────────────
  // Per-peer + global token-bucket; drops over-quota envelopes BEFORE
  // they reach onPeerMessage.  Default tuning is chat-pace; apps with
  // bursty traffic should pass explicit limits or false.
  let rateLimiter = null;
  // `exempt(env) → boolean` — an INJECTED predicate for legitimate bursts (the app's catch-up
  // replay batches: one reconnect serve is up to 1000 items, which the chat-pace buckets would
  // silently discard). The vocabulary of WHICH subtypes are burst-legitimate belongs to the app,
  // not this substrate, so it rides in rather than being read from a table here. An exempt
  // envelope neither consumes tokens nor drops. The stated trade: exempted subtypes fall back to
  // the verify gates behind them (signed-only ingest) instead of this bucket.
  let rateLimitExempt = null;
  if (opts.rateLimit) {
    const rlOpts = (typeof opts.rateLimit === 'object') ? opts.rateLimit : {};
    rateLimiter = createRateLimiter({
      perPeer: rlOpts.perPeer,
      global:  rlOpts.global,
    });
    rateLimitExempt = typeof rlOpts.exempt === 'function' ? rlOpts.exempt : null;
  }

  // ─── Perfect Forward Secrecy (A.8, partial Double-Ratchet) ──
  // Per-peer symmetric KDF chain.  Each message gets a fresh one-time
  // key derived via HKDF-SHA256; old keys are deleted after use.
  //
  // SCOPE NOTE: this implements the SYMMETRIC ratchet only.  Without
  // a DH ratchet, an attacker who later steals an identity private
  // key can recompute the chain seed (it's derived from static DH
  // over identity keys) and decrypt every message ever sent on the
  // chain.  Closing this gap is S8b (DH ratchet via per-message
  // ephemeral keys) — left as future work.  See pfs.js header.
  //
  // The chains are NOT auto-wrapped onto the transport: apps opt in
  // by passing payloads through sa.pfs.encrypt(peer, ...) before
  // sending, and sa.pfs.decrypt(peer, wire) on receive.  Auto-
  // wrapping needs the same DH ratchet to be done correctly, hence
  // S8b territory.
  const pfsEnabled = !!opts.usePerfectFwdSec;
  const pfsOpts    = (typeof opts.usePerfectFwdSec === 'object')
    ? opts.usePerfectFwdSec : {};
  const pfsChains  = new Map();   // peerPubKey → PFSChain

  async function pfsChainFor(peerPubKey) {
    if (!pfsEnabled) {
      throw new Error('sa.pfs: usePerfectFwdSec opt is off');
    }
    let c = pfsChains.get(peerPubKey);
    if (!c) {
      c = await loadPFSChain({
        identity,
        peerPubKey,
        maxSkip:  pfsOpts.maxSkip,
        vault,
        vaultKey: pfsOpts.vaultKeyPrefix
          ? `${pfsOpts.vaultKeyPrefix}${peerPubKey}`
          : null,
      });
      pfsChains.set(peerPubKey, c);
    }
    return c;
  }

  // ─── signed activity / audit log (A.6) ───────────────────────
  //
  // auditLog opt forms:
  //   true             → in-memory log, autoLog ON
  //   { vaultKey?, autoLog?, vault? }
  //                    → persistent (vault, vaultKey) + opt-in autoLog
  //
  // The autoLog flag (default true) wires fire-and-forget audit
  // entries for the security-critical actions exposed by the factory:
  // identity.rotate, mute.add, mute.remove, caps.issue, peer.connect,
  // claim.sign.  Disable with `autoLog: false` if you want full
  // manual control via sa.audit.append.
  let auditAutoLog = false;
  if (opts.auditLog) {
    const aOpts = (typeof opts.auditLog === 'object') ? opts.auditLog : {};
    auditAutoLog = aOpts.autoLog !== false;
    auditLog = await loadAuditLog({
      identity,
      vault:    aOpts.vault    ?? vault,
      vaultKey: aOpts.vaultKey ?? null,
      // Retention at the load checkpoint: fold anything past the AUDIT window (from the shared kind table)
      // into a summary. Opt-out via `{ auditLog: { autoCompact: false } }`.
      autoCompact: aOpts.autoCompact !== false,
    });
  }

  // ─── Peer state (NKN cross-peer; stays idle until connect()) ───
  let peerTransport = null;
  const peerState = { status: 'idle', address: null, error: null };
  // Keyed by `${peerAddress}|${theAddressWeSpokeFrom}` (`helloKey`) — Decision 4. An HI announces ONE
  // of our identities: having introduced our canonical self to a peer says nothing about whether they
  // hold the per-circle key we are about to sign with, and treating it as if it did leaves them unable
  // to verify a single circle envelope. One entry per (peer, identity-we-speak-as) is the honest key.
  const helloedPeers = new Set();
  const helloKey = (addr, sendAs = null) => `${addr}|${sendAs ?? ''}`;
  // Reciprocal HIs are tracked SEPARATELY from `helloedPeers`, and the difference matters.
  //
  // `helloedPeers` answers the SEND path's question: "have I announced myself to this peer, so may I
  // encrypt to them?". The receive path was reusing it to answer a different one: "have I already replied
  // to this peer?". One Set for two questions meant that once we had ever sent this peer an HI ourselves,
  // we would never answer THEIR handshake again — so a peer who lost our key (a restart, a reinstall, a new
  // per-circle address) could HI us forever and we would sit silent while they timed out into "they may be
  // offline". Found finishing the message round-trip on hardware, 2026-07-30: a walk-peer that had been up
  // for eight hours refused to answer the phone, and the phone reported the peer as offline.
  const reciprocatedPeers = new Set();

  // ─── Delivery guarantee — local sender-hold + presence-flush ───────
  // (Connectivity Phase 2, the "deliver" ladder — the offline ladder's
  // missing rung-1: hold-forward WITHOUT a companion/pod.)
  //
  // A send tagged `guarantee:'hold-forward'` (or `hold:true`) to a peer we
  // cannot reach right now is not dropped and does not hard-error — it is
  // parked in this local pending queue and re-sent the moment a PRESENCE
  // signal for that peer arrives (their inbound envelope in makeReceiveHandler,
  // or an explicit reachability/peer-joined event via `presenceSignal(addr)`).
  // Purely event-driven; there is no timer/poll here.
  //
  //   pendingHold : peerAddr → Map<holdKey, { payload, opts, ts }>
  //
  // De-dup is at TWO layers: the sender collapses a repeat `msgId` here (so a
  // retry while offline doesn't double-queue), and the receiver stays the
  // single source of exactly-once idempotency on `msgId` (unchanged — we do
  // NOT rebuild that). Flush snapshots-and-clears a peer's queue atomically so
  // two presence signals can't double-deliver.
  //
  // Later (kept for a following phase, NOT built here): the QueueStore that
  // unifies this local-pending queue with the relay + companion + pod hold
  // queues behind one port.
  //
  // ── The BOUNDS (2026-07-30) ────────────────────────────────────────────────
  // Until now this queue had no TTL, no size cap and no eviction. Entries drain only on a presence
  // signal from that identity — which, by definition, never arrives for a peer that no longer exists.
  // Found on hardware: five dead peers of abandoned test circles, three queued messages each, every one
  // of them paid for again on every later send to that address. It is in-memory, so a restart clears it;
  // that is not a bound, it is a coincidence.
  //
  // Three bounds, each answering a different way the queue grows:
  //   • TTL          — a message nobody could take for a day is not going to be taken by this queue;
  //                    catch-up (roster-driven, `sinceTs`) is the path that still repairs it.
  //   • size caps    — per peer and across peers, dropping the OLDEST first: the newest message is the
  //                    one the user is most likely still waiting on.
  //   • failure count — stop paying for a peer that keeps failing. This is the expensive one: relay/NKN
  //                    `canReach` is address-agnostic, so an address that no longer answers passes the
  //                    route check and then costs a full handshake-retry budget (~8 s) per send.
  //
  // Nothing here is a timer: the sweep runs on enqueue/flush, keeping the "purely event-driven" property
  // above intact. Every drop is REPORTED (`onHoldDropped` + a warn) — a message the user was told was
  // sent must never vanish quietly.
  const pendingHold = new Map();
  let   holdSeq     = 0;
  // ── DURABILITY (2026-08-18, Frits) ─────────────────────────────────────────────────────────────
  // The queue above is process memory, so until now a restart silently dropped every message the
  // app had already told the user was on its way — the one failure mode a hold queue exists to
  // prevent. With a `holdStore` (any `{read,write}` DataSource) the queue is written after every
  // mutation and restored at boot, so "held" survives the thing most likely to happen to a phone.
  // Without one the behaviour is exactly as before: memory-only, for tests and callers that do not
  // want a disk. Deliberately NOT a timer — persistence rides the existing event-driven mutations.
  const holdStore   = (opts.holdStore && typeof opts.holdStore.write === 'function') ? opts.holdStore : null;
  const holdStoreUri = typeof opts.holdStoreUri === 'string' ? opts.holdStoreUri : 'mem://secure-agent/outbox.json';
  let   holdPersist = Promise.resolve();
  let   outboxRestored = Promise.resolve(0);

  /** Serialise the queue. `opts` is JSON round-tripped, so anything unserialisable (a callback) is
   *  dropped rather than throwing — a resend must not depend on a closure the restart cannot restore. */
  function persistHolds() {
    if (!holdStore) return holdPersist;
    let snapshot;
    try {
      snapshot = JSON.stringify({
        v: 1,
        peers: [...pendingHold].map(([addr, q]) => [addr, [...q].map(([k, e]) => [k, {
          payload: e.payload, opts: e.opts ?? null, ts: e.ts ?? Date.now(),
        }])]),
      });
    } catch { return holdPersist; }          // a queue we cannot serialise stays in memory
    holdPersist = holdPersist.then(async () => {
      try { await holdStore.write(holdStoreUri, snapshot); }
      catch (err) { if (typeof console !== 'undefined') console.warn('[secure-agent] outbox persist failed', err?.message ?? err); }
    });
    return holdPersist;
  }

  /** Load the queue written by a previous run. Entries past the TTL are dropped on the way in and
   *  REPORTED, exactly as the live sweep does — a restart must not resurrect what had already expired. */
  async function restoreHolds() {
    if (!holdStore || typeof holdStore.read !== 'function') return 0;
    let parsed = null;
    try {
      const raw = await holdStore.read(holdStoreUri);
      parsed = raw ? JSON.parse(typeof raw === 'string' ? raw : raw?.content ?? 'null') : null;
    } catch (err) {
      if (typeof console !== 'undefined') console.warn('[secure-agent] outbox unreadable — starting empty', err?.message ?? err);
      return 0;
    }
    if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.peers)) return 0;
    let restored = 0;
    const now = Date.now();
    for (const [addr, entries] of parsed.peers) {
      if (typeof addr !== 'string' || !Array.isArray(entries)) continue;
      const q = pendingHold.get(addr) ?? new Map();
      for (const [key, e] of entries) {
        if (!e || typeof key !== 'string') continue;
        if (holdTtlMs > 0 && now - (e.ts ?? now) >= holdTtlMs) { dropHeld(addr, e, 'expired'); continue; }
        if (q.has(key)) continue;            // a live enqueue during boot wins over the stored copy
        q.set(key, { payload: e.payload, opts: e.opts ?? {}, ts: e.ts ?? now });
        restored += 1;
      }
      if (q.size) pendingHold.set(addr, q);
    }
    if (restored && typeof console !== 'undefined') {
      console.info(`[secure-agent] outbox restored ${restored} held message(s) across ${pendingHold.size} peer(s)`);
    }
    return restored;
  }
  /** How long a held message may wait for its peer. `0`/negative disables the TTL. */
  const holdTtlMs = Number.isFinite(opts.holdTtlMs) ? opts.holdTtlMs : 24 * 60 * 60 * 1000;
  /** Most messages held for ONE peer; the oldest is dropped past this. */
  const holdMaxPerPeer = Number.isFinite(opts.holdMaxPerPeer) ? opts.holdMaxPerPeer : 50;
  /** Most PEERS we hold anything for; the least-recently-queued peer's queue goes first. */
  const holdMaxPeers = Number.isFinite(opts.holdMaxPeers) ? opts.holdMaxPeers : 64;
  /** Consecutive failed delivery attempts to one address before we stop attempting (0 = never stop). */
  const holdMaxDeliveryFailures = Number.isFinite(opts.holdMaxDeliveryFailures)
    ? opts.holdMaxDeliveryFailures : 3;
  /**
   * Told about every held message we give up on: `{addr, msgId, reason, ageMs}`.
   *
   * `reason` is one of `expired` · `queue-full` · `peer-evicted` · `peer-unreachable`. The HOST turns this into
   * something a person sees (the δ.2 delivery-state map keys on the same `msgId`); the agent's own duty
   * is to never drop one silently.
   */
  const onHoldDropped = typeof opts.onHoldDropped === 'function' ? opts.onHoldDropped : null;
  /**
   * The RELAY gave up on a message we had already handed it — the far-end twin of `onHoldDropped`.
   *
   * Two different give-ups, deliberately reported by two different hooks: `onHoldDropped` means it never
   * left this device, `onUndelivered` means it left, waited at the relay, and the relay's TTL or a cap
   * ended it. Both mean "this did not arrive"; only the first means "we never sent it". Collapsing them
   * would lose the distinction the retry path needs.
   */
  const onUndelivered = typeof opts.onUndelivered === 'function' ? opts.onUndelivered : null;
  /** address → consecutive failed delivery attempts. Cleared by a success or a presence signal. */
  const deliveryFailures = new Map();

  // G12 — identity pubKey → the alias addresses bound to it (`registerPeerAddress`). The hold queue is
  // keyed by the address you SENT to, but presence arrives on the address the peer SPEAKS from: a peer
  // reconnecting announces itself as its canonical pubKey, so messages held for their per-circle address
  // would never be flushed without this reverse view. Same address-vs-identity confusion the binding
  // itself exists to fix, one layer up.
  const peerAliases = new Map();

  // The same fact from the other side: alias address → the peer's CANONICAL identity pubKey.
  //
  // Kept explicitly since Decision 4 (2026-07-31). It used to be readable from the SecurityLayer —
  // `getPeerKey(circleAddress)` returned the person's canonical key — but a per-circle address is now
  // bound to that circle's SIGNING key, which is deliberately unrelated to the person. Asking the
  // crypto layer "who is this" would therefore return a different answer per circle, which is exactly
  // the unlinkability we want on the wire and exactly the wrong answer for "flush what I held for
  // them". So the identity link lives here, on the device, where it is nobody else's to see.
  const peerIdentityOf = new Map();

  /** Does this send opt in to the hold-forward delivery guarantee? */
  function wantsHold(sendOpts) {
    return sendOpts?.hold === true || sendOpts?.guarantee === 'hold-forward';
  }

  /** The de-dup key for a payload: its message id when it carries one, else a
   *  per-send sequence (an id-less payload is never treated as a duplicate). */
  function holdKeyFor(payload) {
    const id = payload?.msgId ?? payload?.id ?? payload?._id;
    return (id != null) ? `id:${id}` : `seq:${++holdSeq}`;
  }

  /**
   * Report a held message we are giving up on. Never silent: the caller was told "held", and a queue
   * that quietly forgets is indistinguishable from one that delivered.
   */
  function dropHeld(addr, entry, reason) {
    const msgId = entry?.payload?.msgId ?? entry?.payload?.id ?? entry?.payload?._id ?? null;
    if (typeof console !== 'undefined') {
      console.warn(`[secure-agent] dropping held message for ${String(addr).slice(0, 16)}… (${reason}`
        + `${msgId ? `, msgId ${msgId}` : ''})`);
    }
    try { onHoldDropped?.({ addr, msgId, reason, ageMs: entry?.ts ? Date.now() - entry.ts : null }); }
    catch { /* a report hook must never break a send */ }
  }

  /** Drop everything that outlived the TTL, across every peer. Cheap at these sizes; no timer. */
  function sweepExpiredHolds(now = Date.now()) {
    if (!(holdTtlMs > 0)) return 0;
    let dropped = 0;
    for (const [addr, q] of pendingHold) {
      for (const [key, entry] of q) {
        if (now - (entry.ts ?? now) < holdTtlMs) continue;
        q.delete(key);
        dropHeld(addr, entry, 'expired');
        dropped += 1;
      }
      if (q.size === 0) pendingHold.delete(addr);
    }
    return dropped;
  }

  /**
   * Park a message for an unreachable peer. Collapses a repeat msgId so a
   * caller that retries while the peer is offline holds it only once. Returns
   * a structured `{ held:true, ... }` result (never throws) so the send path
   * can surface "held" to the app instead of an error.
   *
   * Bounded (see the note on `pendingHold`): expired entries are swept first, then the per-peer and
   * across-peers caps are enforced by dropping the OLDEST — reported, never silently.
   */
  function enqueueHold(addr, payload, sendOpts, reason = 'unreachable') {
    const msgId = payload?.msgId ?? payload?.id ?? payload?._id ?? null;
    sweepExpiredHolds();
    let q = pendingHold.get(addr);
    if (!q) { q = new Map(); pendingHold.set(addr, q); }
    const key = holdKeyFor(payload);
    if (q.has(key)) {
      return { held: true, delivered: false, deduped: true, msgId, pending: q.size, reason };
    }
    q.set(key, { payload, opts: sendOpts, ts: Date.now() });
    // Per-peer cap — a Map iterates in insertion order, so the first key IS the oldest.
    while (holdMaxPerPeer > 0 && q.size > holdMaxPerPeer) {
      const [oldestKey, oldest] = q.entries().next().value;
      q.delete(oldestKey);
      dropHeld(addr, oldest, 'queue-full');
    }
    // Across-peers cap — evict whole queues, least-recently-queued first (same insertion order, and
    // re-inserting on each enqueue below keeps `addr` at the young end).
    pendingHold.delete(addr);
    pendingHold.set(addr, q);
    while (holdMaxPeers > 0 && pendingHold.size > holdMaxPeers) {
      const [oldestAddr, oldestQueue] = pendingHold.entries().next().value;
      pendingHold.delete(oldestAddr);
      for (const entry of oldestQueue.values()) dropHeld(oldestAddr, entry, 'peer-evicted');
    }
    if (typeof console !== 'undefined') {
      console.info(`[secure-agent] peer ${String(addr).slice(0, 16)}… unreachable — holding message (${q.size} queued)`);
    }
    persistHolds();     // durable: a restart must not lose what the caller was told is held
    return { held: true, delivered: false, deduped: false, msgId, pending: q.size, reason };
  }

  /**
   * Record a failed delivery attempt to an address, and say whether we should stop attempting.
   *
   * "Stop attempting" is the point: an address that no longer answers still passes `canReach` on the
   * address-agnostic transports (relay, NKN), so every send to it buys the full handshake-retry budget
   * before failing. After `holdMaxDeliveryFailures` in a row we take the peer at its word until they
   * prove otherwise — any presence signal or successful send clears the count (`clearDeliveryFailures`).
   */
  function recordDeliveryFailure(addr) {
    const n = (deliveryFailures.get(addr) ?? 0) + 1;
    deliveryFailures.set(addr, n);
    return holdMaxDeliveryFailures > 0 && n >= holdMaxDeliveryFailures;
  }

  /** This address answered (or announced itself) — it is not a dead address after all. */
  function clearDeliveryFailures(addr) {
    deliveryFailures.delete(addr);
  }

  /** Have we given up on attempting delivery to this address until it shows a sign of life? */
  function isProbeSuppressed(addr) {
    return holdMaxDeliveryFailures > 0 && (deliveryFailures.get(addr) ?? 0) >= holdMaxDeliveryFailures;
  }

  /**
   * PRESENCE-FLUSH — a presence signal for `addr` says the peer is reachable
   * now, so re-send everything we were holding for them. Snapshot-and-clear
   * first so a concurrent presence signal doesn't double-send; a still-failing
   * transport-class send re-holds (a later presence retries), while an
   * application refusal (e.g. muted) drops the held message (a resend can't fix
   * it). Best-effort, fire-and-forget from the receive path.
   */
  /**
   * Flush every queue belonging to the peer that just became reachable — the address presence arrived
   * on, PLUS every alias bound to the same identity. Presence is an identity fact; the hold queue is
   * per-address, so without the fan-out a per-circle send stays held forever behind a peer who is
   * demonstrably back.
   */
  /** Every address that reaches the SAME peer as `addr` — itself plus its bound aliases. */
  function addressesOfIdentity(addr) {
    const out = new Set([addr]);
    try {
      const pubKey = peerIdentityOf.get(addr) ?? agent.security?.getPeerKey?.(addr) ?? null;
      for (const alias of (pubKey ? peerAliases.get(pubKey) ?? [] : [])) out.add(alias);
    } catch { /* the direct address is still correct */ }
    return out;
  }

  /** Are we holding anything for this PEER (under any of their addresses)? */
  function hasHoldForIdentity(addr) {
    for (const a2 of addressesOfIdentity(addr)) if (pendingHold.has(a2)) return true;
    return false;
  }

  /**
   * POSITIVE removal — the message REACHED this peer by another path (their app-level receipt says so),
   * so every copy still held for them is obsolete: keep re-sending it and the recipient pays for a
   * duplicate on every presence flush. Sweeps the peer's WHOLE identity (the address the receipt came
   * back on is whichever route their device happens to be using — the held copy may sit under another
   * of their aliases). Deliberately per-PEER, never global: in a circle, one member's receipt says
   * nothing about the copy still owed to a different, still-offline member.
   *
   * Not a drop — nothing is reported through `onHoldDropped`, because nothing was lost.
   *
   * @param {object} a
   * @param {string} a.addr   any address of the peer whose receipt arrived
   * @param {string} a.msgId  the confirmed message
   * @returns {number} how many held entries were removed
   */
  function removeHeld({ addr, msgId } = {}) {
    if (typeof addr !== 'string' || !addr || typeof msgId !== 'string' || !msgId) return 0;
    let removed = 0;
    for (const a2 of addressesOfIdentity(addr)) {
      const q = pendingHold.get(a2);
      if (!q) continue;
      for (const [key, entry] of q) {
        const heldId = entry?.payload?.msgId ?? entry?.payload?.id ?? entry?.payload?._id ?? null;
        if (heldId === msgId) { q.delete(key); removed += 1; }
      }
      if (q.size === 0) pendingHold.delete(a2);
    }
    if (removed) persistHolds();
    return removed;
  }

  async function flushPresence(addr) {
    let flushed = 0;
    // Presence is PROOF of life, so it also clears the give-up counter for every address of this peer —
    // otherwise a peer who went away for an hour and came back would stay written off.
    for (const t of addressesOfIdentity(addr)) {
      clearDeliveryFailures(t);
      flushed += (await flushPending(t)).flushed;
    }
    return { flushed };
  }

  async function flushPending(addr) {
    sweepExpiredHolds();
    const q = pendingHold.get(addr);
    if (!q || q.size === 0) return { flushed: 0 };
    const entries = [...q.values()];
    pendingHold.delete(addr);
    let flushed = 0;
    for (const entry of entries) {
      const { payload, opts } = entry;
      try {
        await _sendWithFailover(addr, payload, { ...opts, hold: false, guarantee: 'best-effort' });
        clearDeliveryFailures(addr);
        flushed++;
      } catch (err) {
        if (isApplicationError(err)) continue;   // unfixable by resend → drop
        // Still unreachable → re-hold, unless this address has now failed often enough that re-holding
        // is just paying for it again later. Giving up is REPORTED, like every other drop.
        if (recordDeliveryFailure(addr)) dropHeld(addr, entry, 'peer-unreachable');
        else enqueueHold(addr, payload, opts);
      }
    }
    if (flushed && typeof console !== 'undefined') {
      console.info(`[secure-agent] presence-flush delivered ${flushed} held message(s) to ${String(addr).slice(0, 16)}…`);
    }
    persistHolds();     // what got through is now GONE from the durable copy, not just from memory
    return { flushed };
  }

  // Read back the previous run's queue. Kicked here rather than at declaration so every constant it
  // reads (the TTL, the drop reporter) is initialised; nothing sends before boot completes anyway,
  // and `outboxRestored()` is the await for a caller that wants to be certain.
  outboxRestored = restoreHolds().catch(() => 0);

  /** Is there a live route to `addr` right now? (route() returns null when no
   *  connected transport reports it can reach the peer.) */
  async function hasLiveRoute(addr, scope = null) {
    try { return !!(await route(addr, scope)); }
    catch { return false; }
  }

  // ─── Relay state (WebSocket relay; stays idle until connectRelay) ───
  // A1 (2026-05-23): second cross-peer transport.  Both transports
  // share the same envelope handler (extracted into makeReceiveHandler
  // below) + the same helloed-peers cache, so a peer that HI'd via
  // NKN is also implicitly trusted on relay (same identity, same
  // SecurityLayer).  sendToPeer picks the transport based on
  // `transportMode` ('nkn' | 'relay' | 'both', default 'nkn').
  let relayTransport = null;
  const relayState = { status: 'idle', address: null, error: null, url: null };
  // How long `connectRelay` waits for the socket to actually open before reporting back. Bounded so a
  // relay that never comes up cannot hang a caller; the transport keeps reconnecting on its own either
  // way. Overridable mainly so tests do not sit here.
  const relayReadyTimeoutMs = Number.isFinite(opts.relayReadyTimeoutMs) ? opts.relayReadyTimeoutMs : 8_000;
  let transportMode = opts.transportMode ?? 'nkn';
  // T5.2a — extra transports added via addSecureTransport (mdns/ble injected by the RN app,
  // rendezvous by enableSecureRendezvous). Tracked for shutdown.
  const extraTransports = new Map();

  // (T2/T5.1 — `routing` is created above and shared with the core Agent; in transportMode:'both'
  // `sendToPeer` asks it for the BEST reachable route per peer. Transports register via
  // `routing.addTransport` as they connect; their security is already applied by makeReceiveHandler.)

  // v0.7.cc — rolling buffer of recent peer traffic for /debug-dump.
  // Tiny memory footprint (last 10 envelopes); diagnostic-only.
  const RECENT_LIMIT = 10;
  const recentTraffic = [];
  const recordTraffic = (entry) => {
    recentTraffic.push({ ts: Date.now(), ...entry });
    if (recentTraffic.length > RECENT_LIMIT) recentTraffic.shift();
  };

  // Late-binding hook for onPeerMessage: factory opts may not have it
  // (basis-style flow: construct first, wire UI later).  Caller
  // can pass onPeerMessage to connect() OR set it via setPeerMessageHandler().
  let onPeerMessageFn = (typeof opts.onPeerMessage === 'function')
    ? opts.onPeerMessage : null;

  /**
   * Wire a transport's receive-handler.  Shared by connectPeer (NKN)
   * and connectRelay (RelayTransport) so both apply the same
   * mute/rate-limit gates + reciprocal-HI + onPeerMessage fanout.
   *
   * @param {object} tx  any Transport-shaped object (NknTransport,
   *                     RelayTransport, ...) with .on('envelope', …)
   *                     and .sendHello(addr, payload).
   */
  function makeReceiveHandler(tx) {
    // Auto-wire SecurityLayer so every outbound envelope is signed
    // + nacl.box encrypted with a per-peer shared secret.  HI stays
    // plaintext-but-signed so peers can bootstrap.
    tx.useSecurityLayer(agent.security);
    // bilateral HI auto-handshake on receive.  When we
    // receive an envelope from a peer we haven't HI'd, send HI to
    // them so THEIR SecurityLayer registers our pubKey too.
    // Without this:
    //   A → B HI    : B knows A's pubKey ✓
    //   A → B OW    : encrypt requires B's pubKey at A — FAILS
    //   B → A HI    : A knows B's pubKey ✓ (only on B's first send)
    //   B → A OW    : encrypt requires A's pubKey at B — A already HI'd ✓
    // Bilateral fix: when B receives A's HI, B auto-sends HI back.
    // Now A also knows B's pubKey + can encrypt OW.
    tx.on('envelope', async (env) => {
      // 2026-05-27 (DM cross-device debug) — log every inbound
      // envelope so we can see HI / chat-message deliveries on the
      // other phone's Metro log.  Top-level type + subtype identify
      // the envelope shape; the from-address is truncated.
      if (typeof console !== 'undefined') {
        console.log('[secure-agent] recv envelope from=' + String(env?._from ?? '?').slice(0, 16) + '… type=' + (env?.type ?? '?') + ' subtype=' + (env?.payload?.subtype ?? 'n/a'));
      }
      // Keying — register the peer's crypto key under its CANONICAL chat
      // pubKey, not just the wire address.  A HI carries the sender's canonical
      // pubKey in `payload.pubKey`; SecurityLayer auto-registers it keyed by the
      // WIRE address (`env._from`).  On a relay/InternalTransport the wire
      // address IS the chat pubKey, so that already matches how the send path
      // resolves a peer (`getPeerKey(chatPubKey)` + encrypt-to-chatPubKey).  On
      // a mesh transport the wire address is the seed-derived native address,
      // which DIVERGES from the chat pubKey — so a lookup by the canonical
      // pubKey would miss even though the HI arrived.  Register the peer under
      // the canonical pubKey too: harmless idempotent self-mapping on relay,
      // the missing link on the mesh transport.
      //
      // Through `learnPeerKey`, not `registerPeer`: this key comes off the wire
      // (`payload.pubKey`), so it may ESTABLISH a binding but never replace
      // one.  The case that matters is a peer who has ROTATED — after
      // `migratePeerKey` the map holds `oldPubKey → newPubKey`, and an HI
      // asserting the retired key would reset it to `old → old`, putting a key
      // its owner deliberately retired back in service.  `registerPeer` stays
      // the overwriting setter for what WE establish out of band (roster rows).
      if (env?._p === 'HI' && env?.payload?.pubKey
            && typeof agent.security?.learnPeerKey === 'function') {
        agent.security.learnPeerKey(env.payload.pubKey, env.payload.pubKey);
      }
      // drop envelopes from muted peers BEFORE any further
      // bookkeeping (no reciprocal HI, no onPeerMessage fire).
      // fanout the check across resolver-known aliases.
      if (await isPeerMuted(env?._from)) return;
      // 5.7c — circle override enforcement runs AFTER mute (so muted
      // peers never reach the override layer) and BEFORE rate-limit /
      // reciprocal HI / onPeerMessage.  When the local user has
      // `override.chatOff` set for any circle the peer is in, OR the
      // peer is marked relation:'agent' in a circle that blocks agents,
      // the envelope is silently dropped.  Fails open if accessors
      // throw — never silently swallow inbound on a broken store.
      if (await isInboundCircleBlocked(env)) return;
      // rate-limit drop.  Over-quota peers are silently
      // ignored at the receive boundary (no reciprocal HI either —
      // we don't want them to make us spam them in return).  The injected
      // exemption passes legitimate bursts (catch-up batches) untouched.
      if (rateLimiter && !(rateLimitExempt?.(env)) && !rateLimiter.check(env?._from)) return;
      // v0.7.cc — record for /debug-dump.  Size is the JSON-
      // serialised length of the envelope; matches the wire bytes
      // the transport actually received.
      recordTraffic({
        dir:     'recv',
        from:    env?._from,
        subtype: env?.payload?.subtype ?? env?.type ?? null,
        size:    JSON.stringify(env ?? {}).length,
      });
      try {
        // First-contact reciprocal HI: when we receive from a peer we
        // haven't HI'd, send ours so THEIR SecurityLayer registers our
        // pubKey.  (We do NOT re-send on every inbound HI — that
        // creates an infinite HI ping-pong between two peers who both
        // keep replying.  The real cross-device delivery asymmetry is
        // handled at the transport layer via MultiClient.)
        // An explicit HI always deserves an answer — that is the whole point of a handshake, and the peer
        // may be asking precisely because they no longer hold our key. The ping-pong the old guard was
        // protecting against is avoided by MARKING the answer (`reply: true`) instead of by refusing to
        // answer twice: a reply never provokes a reply, so the exchange terminates in one round.
        const inboundIsHi    = env?._p === 'HI';
        // A reply is an HI that names the HI it answers (`_re`) — the envelope's own reply-to atom, not a
        // flag we invented. A reply never provokes a reply, so an exchange terminates in one round.
        const inboundIsReply = inboundIsHi && !!env?._re;
        const owePeerAnHi    = inboundIsHi ? !inboundIsReply : !reciprocatedPeers.has(env._from);
        if (owePeerAnHi) {
          if (typeof console !== 'undefined') {
            console.log('[secure-agent] sending reciprocal HI to ' + String(env._from).slice(0, 16) + '…');
          }
          // Answer AS the address they dialled (G13). Without `from`, the reply carries our canonical
          // address, the peer files our key under that, and it keeps waiting for a key under the alias it
          // sent to — so a handshake to a per-circle address never completes. `Transport.sendHello`
          // validates the claim against our own addresses and falls back to the primary.
          // Decision 4 — answer with the key that BELONGS to the address they dialled. They
          // dialled a per-circle address; replying with our canonical pubKey would hand them (and
          // the relay, in cleartext, via `_to`) the link between that address and the identity the
          // rest of our circles use — the exact linkage per-circle addressing exists to withhold.
          // Absent ⇒ the canonical key, which is right for contact/pairing traffic.
          const answerKey = (typeof agent.security?.selfIdentityFor === 'function'
            ? agent.security.selfIdentityFor(env._to)?.pubKey : null) ?? identity.pubKey;
          // `from` — answer AS the address they dialled (G13), or a handshake to a per-circle address
          // can never complete. `re` — name the envelope we are answering, which is what makes this a
          // REPLY and therefore unanswerable; no new wire field is needed for that.
          const helloArgs = [env._from, { pubKey: answerKey }, { from: env._to, re: env._id ?? null }];
          try {
            await tx.sendHello(...helloArgs);
            // NOT `helloedPeers` — answering someone is not the same as having announced ourselves to them,
            // and conflating the two also let the send path believe it had already introduced itself.
            reciprocatedPeers.add(env._from);
            if (typeof console !== 'undefined') {
              console.log('[secure-agent] reciprocal HI sent OK to ' + String(env._from).slice(0, 16) + '…');
            }
          } catch (err) {
            // ── The answer must not die with the transport it arrived on ────────────────────────────
            //
            // The reciprocal HI goes back over the transport that RECEIVED the envelope. That is normally
            // exactly right, and it is silently wrong when that transport can receive but not SEND — a
            // rendezvous route whose DataChannel never opened still delivers inbound traffic (its
            // signalling rides another transport) and then cannot answer.
            //
            // Giving up here used to be survivable because of "retry on next envelope". It is not, when
            // the peer is waiting for precisely this answer: no further envelope is coming, so the retry
            // never fires and both sides wait forever.
            //
            // Measured 2026-08-03 — this is what breaks a JOIN. The admin receives the redeem, sends its
            // HI and waits for the joiner's reciprocal HI; the joiner tries to answer over a dead
            // rendezvous channel and gives up; the admin times out ("did not respond with HI within
            // 5000ms"); the redeem RESPONSE is therefore never sent; and the joiner tells the person
            // **"no admin online"** about an admin that is online, listening, and holding their request.
            // One dead transport on the answering side, and the on-ramp closes.
            //
            // So: demote the route that could not answer, then answer over whatever the router picks
            // instead. If that also fails, the original behaviour stands — log and wait.
            try { routing.onTransportFailure?.(env._from, tx?.name ?? null); } catch { /* defensive */ }
            let recovered = false;
            try {
              const sel = await route(env._from);
              if (sel?.transport && sel.transport !== tx) {
                await sel.transport.sendHello(...helloArgs);
                reciprocatedPeers.add(env._from);
                recovered = true;
                if (typeof console !== 'undefined') {
                  console.log(
                    `[secure-agent] reciprocal HI re-routed to ${String(env._from).slice(0, 16)}… `
                    + `after ${tx?.name ?? 'the receiving transport'} could not answer`,
                  );
                }
              }
            } catch { /* fall through to the original warning */ }
            if (!recovered) {
              console.warn('[secure-agent] reciprocal HI failed (will retry on next envelope)', err?.message ?? err);
              // Don't record it — the next inbound envelope from this peer triggers another attempt.
            }
          }
        }
      } catch (err) {
        console.warn('[secure-agent] reciprocal-HI bookkeeping failed', err);
      }
      if (typeof onPeerMessageFn === 'function') {
        try {
          onPeerMessageFn({
            from:    env._from,
            payload: env.payload,
            ts:      env._ts ?? Date.now(),
          });
        } catch (err) {
          if (typeof console !== 'undefined') {
            console.error('[secure-agent] onPeerMessage threw', err);
          }
        }
      }
      // Delivery guarantee — PRESENCE-FLUSH. Any inbound envelope from a peer
      // (their reconnect HI, or any message) proves they are reachable now, so
      // flush anything we were holding for them. Fire-and-forget: re-hold on a
      // still-failing send is handled inside flushPending.
      // The gate asks about the PEER, not one address of them: with per-circle addressing the hold sits
      // under the address we sent to, while presence arrives on the address they speak from.
      if (hasHoldForIdentity(env._from)) {
        flushPresence(env._from).catch(() => { /* re-hold handled internally */ });
      } else {
        // No holds to flush, but this peer is demonstrably alive — reinstate any address of theirs we
        // had given up attempting delivery to, or the next send would be refused on stale evidence.
        for (const t of addressesOfIdentity(env._from)) clearDeliveryFailures(t);
      }
    });
  }

  /**
   * Establish the cross-peer NKN transport, wired with SecurityLayer
   * + receive-path that calls onPeerMessage.
   *
   * Both `nknLib` and `onPeerMessage` can be supplied here as overrides
   * for late-binding flows (e.g. apps that construct the agent before
   * window.nkn has loaded from a CDN).  Either takes precedence over
   * the factory-time opt.
   */
  async function connectPeer(callOpts = {}) {
    const nknLib = callOpts.nknLib ?? opts.nknLib;
    if (callOpts.onPeerMessage) onPeerMessageFn = callOpts.onPeerMessage;
    if (!nknLib) {
      throw new Error(
        'createSecureAgent: connect() called but no nknLib provided.  ' +
        'Pass window.nkn (CDN-loaded in browser) or the RN nkn-sdk — ' +
        'either at factory time (opts.nknLib) or at connect time ' +
        '(sa.peer.connect({ nknLib })).',
      );
    }
    if (peerState.status === 'connected' || peerState.status === 'connecting') {
      return { ...peerState };
    }
    peerState.status = 'connecting';
    try {
      const tx = new NknTransport({ identity, nknLib });
      makeReceiveHandler(tx);
      await tx.connect();
      peerTransport     = tx;
      peerState.status  = 'connected';
      peerState.address = tx.address;
      peerState.error   = null;
      routing.addTransport('nkn', tx);   // T2 — register for router-based selection ('both' mode)
      // A1 NOTE: we deliberately do NOT call agent.addTransport('nkn', tx)
      // here.  Agent.addTransport on an already-started agent re-wraps
      // useSecurityLayer + setReceiveHandler, which breaks the wiring
      // makeReceiveHandler() already set up.  secure-agent's
      // sendToPeer routes directly via peerTransport/relayTransport so
      // the Agent doesn't need to know about either transport.  If a
      // future app wants Agent-level routing (e.g. RoutingStrategy
      // picking transports per peer), this is the place to wire it.
      if (auditAutoLog) audit('peer.connect', tx.address);
      return { ...peerState };
    } catch (err) {
      peerState.status = 'error';
      peerState.error  = err?.message ?? String(err);
      throw err;
    }
  }

  /**
   * A1 (2026-05-23) — connect the optional RelayTransport (WebSocket
   * relay).  Independent of NKN; either can be on alone, or both.
   * sendToPeer() honours `transportMode` to pick which one routes
   * outbound traffic; both transports always feed the same
   * onPeerMessage receive handler.
   *
   * @param {object} callOpts
   * @param {string} callOpts.relayUrl  ws:// or wss:// URL
   */
  /**
   * Resolve once the transport's socket is genuinely open, or after `ms` — whichever comes first.
   * Never rejects: a relay that is slow (or down) leaves the caller to carry on with whatever other
   * transport it has, which is exactly the pre-existing behaviour.
   */
  async function waitForSocket(tx, ms) {
    if (!tx || tx.connected) return tx?.connected === true;
    const deadline = Date.now() + Math.max(0, ms);
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
      if (tx.connected) return true;
    }
    return tx.connected === true;
  }

  async function connectRelay(callOpts = {}) {
    const relayUrl = callOpts.relayUrl ?? opts.relayUrl;
    if (callOpts.onPeerMessage) onPeerMessageFn = callOpts.onPeerMessage;
    if (!relayUrl) {
      throw new Error(
        'createSecureAgent: connectRelay() called but no relayUrl provided.  ' +
        'Pass relayUrl at factory time (opts.relayUrl) or call-time ' +
        '(sa.relay.connect({relayUrl})).',
      );
    }
    if (relayState.status === 'connected' || relayState.status === 'connecting') {
      return { ...relayState };
    }
    relayState.status = 'connecting';
    relayState.url    = relayUrl;
    try {
      const tx = new RelayTransport({
        identity,
        relayUrl,
        onUndelivered: onUndelivered ? (info) => onUndelivered(info) : null,
      });
      makeReceiveHandler(tx);
      await tx.connect();
      // `connect()` only REQUESTS the socket — it deliberately does not await it, so that
      // `agent.start()` never blocks on a relay that may be unreachable. That is right for boot and
      // wrong for everyone else, because it left two facts disagreeing: `status` said 'connected' the
      // instant connect() returned, while `canReach()` (which reads the actual socket) still said no.
      //
      // Routing believes `canReach`, so it correctly skipped the relay — and callers believed `status`,
      // so they thought they were on it. On hardware that combination cost 15 seconds per join: the
      // dial reported success, the redeem was routed over NKN because the relay was not open YET, it
      // burned the full HI timeout, and only then failed over to the relay that had come up in the
      // meantime and answered instantly (S4, 2026-07-29).
      //
      // So: a caller that is about to SEND can ask to wait for the socket. Opt-in, because the
      // non-blocking default is right for boot — `agent.start()` must not stall behind a relay that may
      // be unreachable — and wrong only for callers who need the relay usable on the next line.
      // Bounded either way; the transport reconnects on its own regardless.
      if (callOpts.awaitReady === true) await waitForSocket(tx, relayReadyTimeoutMs);
      relayTransport     = tx;
      relayState.status  = 'connected';
      relayState.address = tx.address;
      relayState.error   = null;
      routing.addTransport('relay', tx);   // T2 — register for router-based selection ('both' mode)
      // Same NOTE as connectPeer: don't agent.addTransport here;
      // sendToPeer routes via relayTransport directly.
      if (auditAutoLog) audit('relay.connect', relayUrl);
      return { ...relayState };
    } catch (err) {
      relayState.status = 'error';
      relayState.error  = err?.message ?? String(err);
      throw err;
    }
  }

  /**
   * T5.2a — register ANY transport into the secure-mesh: apply the security layer
   * (`makeReceiveHandler` — sign/encrypt + mute + bilateral-HI + circle-override +
   * onPeerMessage), optionally connect it, and register it with the UNIFIED router
   * (`routing.addTransport`, which T5.1 made the same as `agent.routing`). This is
   * the one seam every non-NKN/relay transport flows through — `mdns`/`ble` built
   * + injected by the RN app (the secure-agent stays platform-neutral), `rendezvous`
   * by `enableSecureRendezvous`. We deliberately do NOT use `agent.addTransport`
   * (it re-wraps `useSecurityLayer` + `setReceiveHandler(_dispatch)` on a started
   * agent, which would CLOBBER makeReceiveHandler's secure receive wiring).
   *
   * @param {string} name  — a `TRANSPORT_PRIORITY` name ('mdns'|'ble'|'rendezvous'|…)
   * @param {object} tx     — an already-constructed Transport-shaped object
   * @param {{connect?:boolean}} [o]
   * @returns {Promise<object>} the transport
   */
  async function addSecureTransport(name, tx, { connect = true } = {}) {
    if (!name || !tx) throw new Error('addSecureTransport: name + transport required');
    makeReceiveHandler(tx);                                   // secure receive wiring (NOT agent.addTransport)
    if (connect && typeof tx.connect === 'function') await tx.connect();
    routing.addTransport(name, tx);                           // unified router selects among all transports
    extraTransports.set(name, tx);
    if (transportMode === 'nkn' || transportMode === 'relay') transportMode = 'both';  // let the router pick
    if (auditAutoLog) audit('transport.add', name);
    return tx;
  }

  async function removeSecureTransport(name) {
    const tx = extraTransports.get(name);
    if (tx) {
      try { await tx.disconnect?.(); } catch { /* swallow */ }
      try { routing.removeTransport(name); } catch { /* defensive */ }
      extraTransports.delete(name);
    }
  }

  /**
   * T5.2b — wire WebRTC RENDEZVOUS (direct DataChannel) into the secure-mesh, reusing the
   * core `RendezvousTransport` (signalled over an already-connected transport — peer/relay).
   * It registers via `addSecureTransport` (security-wrapped on the unified router), and pins
   * the direct route the moment a DataChannel opens (`RendezvousTransport.canReach` is true only
   * for peers with an open channel, so the router naturally prefers it once up).
   *
   * Browser: works on the native `RTCPeerConnection`. RN: pass `rtcLib` (react-native-webrtc).
   * Node: `connect()` works (registers the signalling listener); `upgradeToRendezvous` needs an rtcLib.
   *
   * T5.2c — AUTO-upgrade: by default (`auto:true`) the data path moves onto a direct WebRTC
   * DataChannel the moment a peer's hello advertises `capabilities.rendezvous`, with no manual
   * `upgradeToRendezvous` call. Two halves, mirroring core `Agent.enableRendezvous({auto})` but
   * driving the SECURE path (the secure-agent builds `rdv` directly rather than via core's
   * `enableRendezvous`, so neither half happens for free):
   *   1. set `agent._rendezvousEnabled` so `_snapshot(agent)` advertises `rendezvous:true` in our
   *      HI capabilities → the OTHER peer upgrades toward us;
   *   2. listen on the core agent's capability-bearing `'peer'` event (protocol/hello.js) and
   *      upgrade toward any peer that advertises the flag.
   *
   * @param {{signalingTransport?:object, rtcLib?:object, iceServers?:Array, auto?:boolean}} [o]
   * @returns {Promise<RendezvousTransport>}
   */
  async function enableSecureRendezvous({ signalingTransport, rtcLib, iceServers, auto = true } = {}) {
    if (extraTransports.has('rendezvous')) return extraTransports.get('rendezvous');
    const sig = signalingTransport ?? peerTransport ?? relayTransport;
    if (!sig) throw new Error('enableSecureRendezvous: a connected signalingTransport (peer/relay) is required first');
    const rdv = new RendezvousTransport({ signalingTransport: sig, identity, rtcLib, iceServers });
    // Pin/unpin the direct WebRTC route as the channel opens/closes (wire BEFORE connect so no event is missed).
    rdv.on('peer-connected',    (p) => { try { routing.setPreferredTransport(p, 'rendezvous'); } catch { /* defensive */ } });
    rdv.on('peer-disconnected', (p) => { try { routing.clearPreferredTransport(p); } catch { /* defensive */ } });
    await addSecureTransport('rendezvous', rdv);   // makeReceiveHandler + connect + routing.addTransport

    // T5.2c (1) — advertise the capability so peers auto-upgrade toward us. _snapshot(agent)
    // reads this flag into the HI `capabilities.rendezvous` field.
    agent._rendezvousEnabled = true;

    // T5.2c (2) — auto-upgrade toward a peer the instant its hello advertises rendezvous. The
    // early-return above guarantees this listener is bound at most once. Best-effort: a failed
    // upgrade (e.g. no rtcLib on this side) never bubbles — the router keeps using the
    // signalling transport. (rdv.canReach is true only once a DataChannel opens, so the router
    // naturally prefers the direct route after `peer-connected` pins it.)
    if (auto) {
      agent.on('peer', async ({ address, capabilities }) => {
        if (!capabilities?.rendezvous) return;
        if (rdv.hasOpenChannelTo?.(address)) return;     // already direct
        try { await upgradeToRendezvous(address); }
        catch (err) { try { agent.emit('rendezvous-failed', { peer: address, error: err }); } catch { /* defensive */ } }
      });
    }
    return rdv;
  }

  /** T5.2b — move the data path for `peerAddress` onto a direct WebRTC DataChannel (needs an rtcLib). */
  async function upgradeToRendezvous(peerAddress, timeout) {
    const rdv = extraTransports.get('rendezvous');
    if (!rdv) throw new Error('upgradeToRendezvous: enableSecureRendezvous() not called');
    return rdv.connectToPeer(peerAddress, timeout);
  }

  async function disconnectRelay() {
    if (relayTransport) {
      try { await relayTransport.disconnect(); } catch { /* swallow */ }
      try { agent.removeTransport?.('relay'); } catch { /* defensive */ }
      try { routing.removeTransport('relay'); } catch { /* defensive */ }   // T2 — deregister from the router
      relayTransport = null;
    }
    relayState.status = 'idle';
    relayState.address = null;
    relayState.url = null;
    relayState.error = null;
  }

  function setTransportMode(mode) {
    if (mode !== 'nkn' && mode !== 'relay' && mode !== 'both') {
      throw new Error(`setTransportMode: invalid mode "${mode}"; expected nkn|relay|both`);
    }
    transportMode = mode;
  }

  /**
   * Send an envelope to a peer.  Auto-HI on first contact so the
   * peer registers our pubKey + can decrypt the subsequent payload.
   *
   * Bilateral HI race fix (2026-05-23): the OW encrypt needs the
   * PEER's pubKey at our SecurityLayer.  We get it via their HI
   * envelope back to us — which is asynchronous.  Without waiting,
   * the first send to a never-contacted peer fails with
   * "No pubKey registered for recipient".  Solution: after sending
   * our HI, poll agent.security.getPeerKey(addr) for up to
   * `firstSendTimeoutMs` (default 5s) so the peer's bilateral HI
   * has time to arrive.  Subsequent sends to the same peer skip
   * the wait (helloedPeers cache).
   *
   * `firstSendTimeoutMs` opt at factory time lets transport-heavy
   * apps (RN, slow networks) extend the wait; set to 0 to opt out
   * (fall back to old eager-send behaviour).
   */
  /**
   * Phase-2 · Piece-1 (C1) — THE ONE routing owner for the secure send
   * path.  Folds the old `pickTransport` (which returned only a transport
   * and never surfaced the name) into a single selector that resolves a
   * complete `{ name, transport, address }` route over the SHARED
   * `RoutingStrategy` — the same instance the core Agent routes over
   * (T5.1).  The name is what makes real failover possible: it lets the
   * failover loop drive `routing.onTransportFailure(peer, name)` so the
   * degraded transport is skipped on the re-`route` (see `_sendWithFailover`).
   *
   *   'nkn'   — NknTransport only (explicit pin; no failover alternative)
   *   'relay' — RelayTransport only (explicit pin; no failover alternative)
   *   'both'  — the RoutingStrategy picks the BEST reachable, NON-DEGRADED
   *             route by canonical priority + latency; NKN is the always-on
   *             bottom tier, so a dead relay socket falls to NKN on re-route.
   *
   * `address` comes from Phase-1's per-transport address map
   * (`PeerGraph.addressesOf`, keyed by transport name) when a PeerGraph is
   * wired on the router; otherwise it degrades to the caller-supplied `addr`
   * (secure-agent does not populate a PeerGraph today, so this is inert —
   * `address === addr` — until one is wired, matching current behaviour).
   *
   * @param {string} addr  — the peer's canonical / wire address
   * @returns {Promise<{ name: string, transport: object, address: string }|null>}
   */
  /**
   * SCOPED routing — the constraint a circle's traffic carries with it.
   *
   * Routing is otherwise per-PERSON: `selectTransport(peerId)` picks the best transport for a peer from
   * one global priority list, with no idea which circle the traffic belongs to. That is the defect this
   * closes — circle content would ride whatever won for that peer, including transports the circle does
   * not live on, where its per-circle address means nothing.
   *
   * The scope arrives as **connection points** (urls), never as a circle id or a transport name: the app
   * owns points, this layer owns transports, and neither has to learn the other's vocabulary.
   *
   *   • `points` — the circle's own points. Empty ⇒ the deployment default (an unconfigured circle must
   *     mean "the default", never "nowhere"). A transport with no url cannot contradict a point, so it
   *     stays eligible.
   *   • `requireAliasCapable` — the user's address-fallback setting, inverted. With the fallback OFF we
   *     will not route a circle over a transport that cannot carry per-circle addressing, because doing
   *     so silently strips member-level unlinkability. With it ON the user has accepted that trade
   *     knowingly (this is what makes an NKN circle work — see NOTE-circle-scoped-routing.md).
   *
   * No eligible transport returns null, which the caller turns into a hold. That is honest — and it must
   * be made VISIBLE by the caller rather than left as silent holding.
   */
  function eligibleUnderScope(transport, scope) {
    if (!transport) return false;
    if (scope?.requireAliasCapable && transport.supportsAliases !== true) return false;
    const points = Array.isArray(scope?.points) ? scope.points.filter(Boolean) : [];
    if (points.length === 0) return true;
    const url = typeof transport.url === 'string' && transport.url ? transport.url : null;
    return url ? points.includes(url) : true;
  }

  async function route(addr, scope = null) {
    if (scope) {
      // The scope NARROWS the candidate set; it does not replace route selection. Reachability still
      // decides — otherwise an offline peer looks routable (their transport is not ours), the send goes
      // nowhere, and the hold-forward rung never engages. Priority: the relay the circle rides, then
      // anything else registered, then NKN last (reachable here only when the user accepted the fallback).
      const reachable = (t) => (typeof t.canReach !== 'function' ? true : t.canReach(addr) === true);
      const candidates = [relayTransport, ...extraTransports.values(), peerTransport].filter(Boolean);
      const pick = candidates.find((t) => eligibleUnderScope(t, scope) && reachable(t));
      if (!pick) return null;
      const name = pick === relayTransport ? 'relay'
        : pick === peerTransport ? 'nkn'
        : ([...extraTransports.entries()].find(([, t]) => t === pick)?.[0] ?? 'relay');
      return { name, transport: pick, address: await addressFor(addr, name) };
    }
    return routeUnscoped(addr);
  }

  async function routeUnscoped(addr) {
    // Explicit pin — respect a user-chosen single transport (no alternative
    // to fail over to; the failover loop degrades to a single attempt).
    if (transportMode === 'nkn') {
      return peerTransport
        ? { name: 'nkn', transport: peerTransport, address: await addressFor(addr, 'nkn') }
        : null;
    }
    if (transportMode === 'relay') {
      return relayTransport
        ? { name: 'relay', transport: relayTransport, address: await addressFor(addr, 'relay') }
        : null;
    }
    // 'both' (auto) — let the shared RoutingStrategy pick the best reachable,
    // non-degraded route for this peer (canonical priority + reachability).
    if (addr) {
      try {
        const sel = await routing.selectTransport(addr);
        if (sel?.transport) {
          return { name: sel.name, transport: sel.transport, address: await addressFor(addr, sel.name) };
        }
      } catch { /* fall through to the static fallback */ }
    }
    // Static fallback when the router can't decide — which is the FIRST-CONTACT case: a peer we have
    // never spoken to has no PeerGraph entry and no latency history, so the strategy has nothing to go on.
    // It therefore runs far more often than "can't decide" suggests, and it must agree with the canonical
    // order rather than invent its own.
    //
    // It used to hardcode "prefer NKN then relay", which is backwards: `TRANSPORT_PRIORITY` ranks relay
    // ABOVE nkn. On hardware that cost 15 seconds per first contact — a join's redeem went out over NKN,
    // waited for the full HI timeout, and only then failed over to the relay that was up the whole time
    // and answered immediately (S4, 2026-07-29). Slow enough that people conclude the join is broken.
    for (const name of TRANSPORT_PRIORITY) {
      const t = name === 'relay' ? relayTransport
        : name === 'nkn' ? peerTransport
        : extraTransports.get(name);
      if (t) return { name, transport: t, address: await addressFor(addr, name) };
    }
    return null;
  }

  /**
   * Resolve the transport-appropriate wire address for `peerId` on the
   * transport named `name`, from Phase-1's `PeerGraph.addressesOf` map.
   * Falls back to `peerId` itself when no PeerGraph is wired on the router
   * or it has no per-transport address recorded — which is the case for
   * secure-agent today, so this never changes the observable address.
   */
  async function addressFor(peerId, name) {
    const pg = routing.peerGraph;
    if (pg && typeof pg.addressesOf === 'function') {
      try {
        const map = await pg.addressesOf(peerId);
        if (map && typeof map[name] === 'string' && map[name]) return map[name];
      } catch { /* fall through to peerId */ }
    }
    return peerId;
  }

  /**
   * Backward-compat shim: the pre-fold `pickTransport(addr)` returned just
   * the transport.  Kept as a thin wrapper over `route` so any incidental
   * caller keeps working; the send path now uses `route` directly.
   */
  async function pickTransport(addr) {
    return (await route(addr))?.transport ?? null;
  }

  /**
   * Public sendToPeer wraps the inner _sendToPeerOnce with retry-on-
   * handshake-error so first-contact sends survive races between
   * sendHello + the peer's reciprocal HI.  Callers no longer need
   * application-layer retry wrappers.
   *
   * Default policy: 2 retries with 3s + 5s backoff (~8s total).
   * Override via `opts.retryDelays: number[]` per-call (e.g. `[]`
   * to disable retry).  Non-handshake errors throw immediately.
   *
   * Triggered by 2026-05-24 basis user reports of:
   *   - "No pubKey registered for recipient … — send HI first"
   *   - "did not respond with HI within 5000ms"
   * Both surface because HI is asynchronous + the very first send
   * to a fresh peer races the handshake.
   */
  async function sendToPeer(addr, payload, opts = {}) {
    // Delivery guarantee — hold-forward. When the caller opts in, a peer we
    // can't reach right now enqueues locally and returns "held" instead of
    // erroring; a later presence signal flushes it. Two triggers:
    //   1. PROACTIVE — no connected transport reports it can reach the peer
    //      (route() === null), so hold up front and skip the multi-second HI
    //      wait for a peer we already know is offline.
    //   2. REACTIVE — a real transport (NKN/relay canReach is address-agnostic,
    //      so offline surfaces only as a send failure) throws a transport-class
    //      error after failover → hold rather than propagate. An application
    //      refusal (muted / not permitted) still throws — a resend can't fix it.
    if (wantsHold(opts)) {
      // 0. GIVEN UP — this address has failed delivery `holdMaxDeliveryFailures` times in a row with
      //    nothing since to suggest it is alive. Neither probe nor queue it: answer honestly and
      //    immediately. `{held:false, delivered:false}` is the shape the fan-out already reads as a
      //    per-recipient `not-delivered`, which the chat surfaces as a retryable failure — so the user
      //    is told, rather than the message joining a queue for a peer that no longer exists. A presence
      //    signal (or an inbound envelope) clears the count and the peer is tried again at once.
      if (isProbeSuppressed(addr)) {
        const msgId = payload?.msgId ?? payload?.id ?? payload?._id ?? null;
        return { held: false, delivered: false, msgId, reason: 'peer-unreachable' };
      }
      if (!(await hasLiveRoute(addr, opts?.scope ?? null))) {
        // WHY we are holding matters to the caller. "No route this circle may use" is a different fact
        // from "this peer is offline": the first is a standing property of the connection that will not
        // fix itself, and the product owes the user an explanation rather than silent holding.
        //
        // The scope is to blame only when an UNSCOPED route would have worked — i.e. the peer is
        // reachable in general and the circle's own narrowing is what stopped this send. This test read
        // `!hasLiveRoute(addr)` until 2026-07-29, which is the exact opposite, and swapped both labels:
        // an ordinary offline peer was reported as `no-eligible-route` (surfacing as `blocked`, which
        // offers the address-fallback trade — a trade that cannot help someone who is simply offline),
        // while a genuinely scoped-out send was held silently as `unreachable`, so the one offer that
        // WOULD have fixed it never appeared. Found by J-CS4/CS6/CS7.
        const scopedOut = !!opts?.scope && (await hasLiveRoute(addr));
        return enqueueHold(addr, payload, opts, scopedOut ? 'no-eligible-route' : 'unreachable');
      }
      try {
        const result = await _sendWithHandshakeRetry(addr, payload, opts);
        const msgId = payload?.msgId ?? payload?.id ?? payload?._id ?? null;
        clearDeliveryFailures(addr);          // it answered — not a dead address
        return { held: false, delivered: true, msgId, result };
      } catch (err) {
        if (isApplicationError(err)) throw err;
        // A transport-class failure AFTER the route said yes — the only evidence we get that an address
        // is dead rather than briefly offline, so it is what the give-up counter counts.
        if (recordDeliveryFailure(addr)) {
          const msgId = payload?.msgId ?? payload?.id ?? payload?._id ?? null;
          if (typeof console !== 'undefined') {
            console.warn(`[secure-agent] giving up on ${String(addr).slice(0, 16)}… after `
              + `${holdMaxDeliveryFailures} failed deliveries — not holding (a presence signal reinstates it)`);
          }
          return { held: false, delivered: false, msgId, reason: 'peer-unreachable' };
        }
        return enqueueHold(addr, payload, opts);
      }
    }
    return _sendWithHandshakeRetry(addr, payload, opts);
  }

  /**
   * The first-contact-race retry loop around `_sendWithFailover`: retries only
   * on a HI-handshake error (the peer's reciprocal HI racing our first send),
   * with backoff, so callers don't need an application-layer retry wrapper.
   * Non-handshake errors propagate immediately.
   */
  async function _sendWithHandshakeRetry(addr, payload, opts = {}) {
    const delays = Array.isArray(opts.retryDelays) ? opts.retryDelays : [3000, 5000];
    let lastErr = null;
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        return await _sendWithFailover(addr, payload, opts);
      } catch (err) {
        lastErr = err;
        const msg = String(err?.message ?? err);
        const isHandshake = /No pubKey registered|send HI first|did not respond with HI/i.test(msg);
        if (!isHandshake) throw err;
        if (attempt === delays.length) break;
        if (typeof console !== 'undefined') {
          console.info(`[secure-agent] HI race for ${String(addr).slice(0, 16)}…, retrying in ${delays[attempt]}ms (${attempt + 1}/${delays.length})`);
        }
        await new Promise((r) => setTimeout(r, delays[attempt]));
      }
    }
    throw lastErr;
  }

  /**
   * Phase-2 · Piece-1 (G4) — REAL failover around the send.
   *
   * The old path picked ONE transport and, if its send threw, the whole
   * operation errored — `routing.onTransportFailure` (defined on the shared
   * RoutingStrategy but never driven from here) did nothing, so "try relay,
   * else NKN" was never automatic on the real send path.  This wraps the
   * per-route send: on a TRANSPORT-CLASS error (a routing/connectivity
   * failure — NOT a skill/application error) it degrades the failed
   * transport via `routing.onTransportFailure(peer, name)`, re-`route`s
   * (which now skips the degraded transport and drops to the next tier —
   * NKN is the always-on bottom), and resends.  Bounded by an attempt
   * budget so a truly-unreachable peer doesn't spin: once the budget is
   * spent (or no fresh transport remains) the last error propagates, which
   * the outer `sendToPeer` handshake-retry — and ultimately the app's
   * hold/error path — takes over.
   *
   * Transport-class vs application error: this send path does only
   * transport work (HI handshake + one-way send), so EVERY error here is
   * treated as transport-class and eligible for re-route EXCEPT those
   * explicitly marked as application/skill errors (`isApplicationError`) —
   * e.g. a muted-peer refusal or a caller-tagged `SkillError`.  Those bubble
   * unchanged; re-routing a different transport would not fix them.
   *
   * @param {string} addr
   * @param {*}      payload
   * @param {object} [opts]  — `firstSendTimeoutMs`, `failoverBudget`
   */
  async function _sendWithFailover(addr, payload, opts = {}) {
    // refuse to send to a muted peer (alias-aware) up front.
    // This is an APPLICATION decision, never a transport failure: no
    // re-route, no degrade.  Throws so the caller knows the intent didn't
    // reach the wire.
    if (await isPeerMuted(addr)) {
      throw new Error(`secure-agent: peer "${addr}" is muted; sendTo refused`);
    }

    const budget = Math.max(1, Number.isInteger(opts.failoverBudget)
      ? opts.failoverBudget
      : FAILOVER_ATTEMPT_BUDGET);
    const tried  = new Set();
    let   lastErr = null;

    for (let attempt = 0; attempt < budget; attempt++) {
      const sel = await route(addr, opts?.scope ?? null);
      if (!sel) {
        throw new Error(
          `Peer transport not connected (mode=${transportMode}).  ` +
          `Call sa.peer.connect() and/or sa.relay.connect() first.`,
        );
      }
      // The router keeps returning a transport we've already exhausted
      // (single-transport mode, or every alternative degraded) → no fresh
      // tier to fail over to.  Stop and surface the last error / send once.
      if (tried.has(sel.name)) {
        if (lastErr) throw lastErr;
      }
      tried.add(sel.name);

      try {
        return await _sendOverRoute(addr, payload, sel, opts);
      } catch (err) {
        lastErr = err;
        // Application/skill error → never re-route (a different transport
        // would hit the same rejection).  Bubble unchanged.
        if (isApplicationError(err)) throw err;
        // Transport-class error → degrade this transport for the peer so the
        // next `route()` picks a different tier (NKN is the bottom), then
        // loop.  When the budget is spent the error falls through below.
        try { routing.onTransportFailure(addr, sel.name); } catch { /* defensive */ }
        if (typeof console !== 'undefined') {
          console.info(
            `[secure-agent] transport "${sel.name}" failed for ${String(addr).slice(0, 16)}… ` +
            `(${String(err?.message ?? err)}); failing over (attempt ${attempt + 1}/${budget})`,
          );
        }
      }
    }
    throw lastErr;
  }

  /**
   * Send `payload` to `addr` over ONE already-resolved route (`sel` from
   * `route()`): first-contact HI handshake (unchanged bilateral-HI + peer-key
   * wait) then the one-way send.  Extracted from the old `_sendToPeerOnce`
   * so the failover loop can drive it once per candidate transport.
   */
  async function _sendOverRoute(addr, payload, sel, opts = {}) {
    const tx      = sel.transport;
    const wireAddr = sel.address ?? addr;   // per-transport address (Phase-1 map); === addr today
    // Decision 4 — WHICH of our identities this traffic belongs to. The caller passes an ADDRESS of
    // ours (a per-circle one); the SecurityLayer holds the key behind it, so nothing about a circle
    // travels down here and no private key travels back up. Unknown/absent ⇒ the canonical identity,
    // which is the whole of today's behaviour for contact and pairing traffic.
    const sendAs = typeof opts?.sendAs === 'string' && opts.sendAs ? opts.sendAs : null;
    const sendingIdentity = (sendAs && typeof agent.security?.selfIdentityFor === 'function')
      ? agent.security.selfIdentityFor(sendAs) : null;
    if (sendAs && !sendingIdentity && typeof console !== 'undefined') {
      // Named here, where the address is known, rather than surfacing three layers away as "my
      // messages in this circle never arrive": without the identity we would sign as the canonical
      // self while claiming the per-circle address, and the recipient would reject every envelope.
      console.warn(`[secure-agent] no identity registered for own address ${String(sendAs).slice(0, 16)}…`
        + ' — falling back to the canonical identity; per-circle signing is OFF for this send.');
    }
    const speakAs = sendingIdentity ? sendAs : null;
    if (!helloedPeers.has(helloKey(addr, speakAs))) {
      // The peer's key is known once its reciprocal HI has registered it at our
      // SecurityLayer.  Treated as "known" when there is no SecurityLayer to
      // consult, so a plaintext transport never blocks on a handshake it can't
      // observe (matches the pre-resend behaviour).
      const peerKeyKnown = () =>
        !(agent.security && typeof agent.security.getPeerKey === 'function')
        || !!agent.security.getPeerKey(addr);
      // One path for the initial HI and every propagation re-announce.
      const announceHi = async () => {
        try {
          // The HI announces the key we are about to SIGN with, from the address we will sign as —
          // the two halves of one claim. Announcing the canonical key from a per-circle address
          // would make the peer file the wrong key under it and reject everything that follows.
          await tx.sendHello(
            wireAddr,
            { pubKey: (sendingIdentity ?? identity).pubKey },
            speakAs ? { from: speakAs } : {},
          );
          if (typeof console !== 'undefined') {
            console.log('[secure-agent] outbound HI sent OK to ' + String(addr).slice(0, 16) + '…');
          }
        } catch (err) {
          // Log + continue — a later re-announce (or a peer that already has our
          // pubKey from a previous session) may still let the send through.
          if (typeof console !== 'undefined') {
            console.warn('[secure-agent] HI failed (continuing)', err?.message ?? err);
          }
        }
      };
      if (typeof console !== 'undefined') {
        console.log('[secure-agent] sending outbound HI to ' + String(addr).slice(0, 16) + '…');
      }
      await announceHi();
      // Wait for the peer's reciprocal HI to register their pubKey at our
      // SecurityLayer — otherwise the OW encrypt below throws 'No pubKey
      // registered for recipient'.  A freshly-connected peer on a mesh
      // transport takes several seconds to become reachable (its presence must
      // propagate into the mesh), and the FIRST HI sent into that cold-start
      // window is simply lost.  So instead of one send + a passive wait, we
      // RE-ANNOUNCE our HI on a coarse cadence across a longer window and
      // succeed the instant the peer's key arrives.  On an always-reachable
      // transport (relay / InternalTransport) the reciprocal HI lands in well
      // under a second, so the loop breaks on an early poll tick, the
      // re-announce never fires, and that path stays fast — the extra patience
      // is gated on the mesh transport.
      const meshTransport = sel.name === 'nkn';
      const defaultWaitMs = meshTransport ? 15_000 : 5_000;
      const waitMs = typeof opts.firstSendTimeoutMs === 'number'
        ? opts.firstSendTimeoutMs : defaultWaitMs;
      const resendEveryMs = 2_500;
      if (waitMs > 0 && !peerKeyKnown()) {
        const start = Date.now();
        let lastResend = start;
        while (Date.now() - start < waitMs) {
          if (peerKeyKnown()) break;
          await new Promise((r) => setTimeout(r, 100));
          if (!peerKeyKnown() && Date.now() - lastResend >= resendEveryMs) {
            lastResend = Date.now();
            if (typeof console !== 'undefined') {
              console.log('[secure-agent] re-announcing HI to ' + String(addr).slice(0, 16) + '… (peer still propagating)');
            }
            await announceHi();
          }
        }
        if (!peerKeyKnown()) {
          // 2026-05-24 — DON'T add to helloedPeers when the wait times out.
          // Previously this happened right after the single tx.sendHello, so
          // subsequent retries skipped the HI re-send entirely and threw
          // "No pubKey registered" forever.  Leaving helloedPeers unset lets
          // the next call retry the full handshake (which may succeed once the
          // peer finishes propagating or a lost HI is re-sent).
          throw new Error(
            `secure-agent: peer "${addr}" did not respond with HI within ${waitMs}ms; ` +
            `they may be offline.  Try again after they reconnect.`,
          );
        }
      }
      // Only mark as helloed after the bidirectional handshake fully
      // completed (or wasn't needed because we already had their key).
      helloedPeers.add(helloKey(addr, speakAs));
      // Phase-2 · Piece-2b (population) — now that HI resolved a live route to
      // this peer, record its transport-appropriate wire address into the
      // app-owned PeerGraph attached on the shared router, so LATER sends
      // resolve `addressesOf(peer)[name]` (rather than degrading to the id).
      // `addr` is the canonical peer id (the pubKey the graph keys on); `sel.name`
      // is the transport that reached them; `wireAddr` is that transport's address.
      // Best-effort + additive: no graph / upsert failure → inert (pre-2b behaviour).
      const pg = routing.peerGraph;
      if (pg && typeof pg.upsert === 'function') {
        pg.upsert({
          pubKey:     addr,
          transports: { [sel.name]: { address: wireAddr, lastSeen: Date.now() } },
        }).catch(() => { /* population must never break a send */ });
      }
    }
    // v0.7.cc — record outbound for /debug-dump diagnostic.
    recordTraffic({
      dir:     'send',
      to:      addr,
      subtype: payload?.subtype ?? payload?.type ?? null,
      size:    JSON.stringify(payload ?? {}).length,
    });
    return tx.sendOneWay(wireAddr, payload, speakAs ? { from: speakAs } : {});
  }

  /**
   * Rotate the agent's Ed25519 identity.  Wraps Agent.rotateIdentity
   * + emits KeyRotation.broadcast to known peers.  Old key valid for
   * the grace period (default 7 days) so in-flight envelopes decrypt.
   */
  async function rotateIdentity(rotateOpts = {}) {
    const oldPubKey = agent.identity.pubKey;
    await agent.rotateIdentity(rotateOpts);
    const result = {
      oldPubKey,
      newPubKey: agent.identity.pubKey,
      graceUntilDays: rotateOpts.gracePeriodSeconds
        ? rotateOpts.gracePeriodSeconds / 86_400
        : 7,
    };
    if (auditAutoLog) audit('identity.rotate', oldPubKey, { newPubKey: result.newPubKey });
    return result;
  }

  /**
   * Diagnostic snapshot.  Initially reports identity + peer transport
   * state; later slices add audit log status / mute count / token
   * count / group memberships.
   */
  function securityStatus() {
    return {
      layerWired:     !!agent.security,
      identityPub:    agent.identity.pubKey,
      identityStable: agent.identity.stableId,
      peerTransportConnected: !!peerTransport,
      peerAddress:    peerState.address,
      helloedPeerCount: helloedPeers.size,
      reciprocatedPeers: [...reciprocatedPeers],
      helloedPeers:   [...helloedPeers],
      // mute state
      muteCount:       muteSet.size,
      mutedPeers:      muteSet.list(),
      muteIsPersistent: !!opts.muteListVaultKey,
      helloGateWired:  !!userHelloGate,
      // claim state
      claimWebidBound: boundWebid,
      // vault encryption + passkey
      vaultEncrypted,
      passkeyConfigured: !!passkeyConfig,
      passkeyAvailable:  webauthnAvailable(),
      // resolver state
      resolverWired:    !!resolverMemberMap,
      // 5.7c — circle override enforcement
      circleEnforcementWired: !!circleEnf,
      // caps + trust + policy
      trustWired:       !!trustRegistry,
      capsWired,
      policyWired:      !!policyEngine,
      // audit log
      auditWired:       !!auditLog,
      auditAutoLog,
      auditSize:        auditLog?.size ?? 0,
      // groups + a2aTls + rate-limit
      groupsWired:      !!groupManager,
      a2aTlsWired:      !!a2aTls,
      rateLimitWired:   !!rateLimiter,
      rateLimitState:   rateLimiter?.snapshot() ?? null,
      // PFS (partial)
      pfsWired:         pfsEnabled,
      pfsChainCount:    pfsChains.size,
      pfsPartial:       true,            // honest: no DH ratchet
      // STUB sections — surfaces what's reserved vs what's wired:
      pendingOpts: pickStubOpts(opts),
    };
  }

  /**
   * Close the peer transport + stop the in-process agent.
   */
  async function shutdown() {
    for (const [, tx] of extraTransports) { try { await tx.disconnect?.(); } catch { /* defensive */ } }
    extraTransports.clear();
    try { await relayTransport?.disconnect?.(); } catch { /* defensive */ }
    try { await peerTransport?.disconnect?.(); } catch { /* defensive */ }
    try { await agent.stop?.(); } catch { /* defensive */ }
    peerTransport = null;
    peerState.status = 'idle';
    peerState.address = null;
  }

  return {
    agent,
    identity: {
      pubKey:   identity.pubKey,
      stableId: identity.stableId,
      vault,
    },
    /**
     * G12/G13 — bind an ALIAS address to a peer's identity key.
     *
     * `SecurityLayer` keys a peer's public key by **the address you send to**, and the HI handshake only
     * ever populates that under the peer's canonical pubKey. So a send to any OTHER address of the same
     * person — a per-circle address, a mesh-native address — throws `No pubKey registered`, the
     * handshake-retry loop gives up, and the message is held forever. That failure lives ABOVE the
     * transport, which is why it looks identical on relay, NKN and in-process alike.
     *
     * This is the binding half of G12 ("three key spaces, no membership record"): an alias is not a new
     * identity, it is another address for one, and the sealing key is per identity. Callers hold the two
     * facts together already — a circle roster row carries `{pubKey, circleAddress}` side by side — so
     * the app registers the mapping when it learns the roster.
     *
     * Idempotent. Re-registering after a rotation simply overwrites.
     *
     * ── Two keys, not one (Decision 4, 2026-07-31) ──────────────────────────────────────────────
     * `signingKey` is the key that actually signs and is sealed to AT that address; `pubKey` is who
     * the person is. Before per-circle signing they were the same key and one argument was enough.
     * They are now deliberately different for a circle address, and each is used for exactly one
     * thing: the crypto binding gets the signing key, the alias/presence index gets the identity.
     * Collapsing them either breaks verification (sign with one, check the other) or re-links the
     * circles locally under a key that the roster says is the same person everywhere.
     *
     * @param {string} address  the alias to make sendable (e.g. a per-circle address)
     * @param {string} pubKey   the peer's canonical identity pubKey (b64url)
     * @param {{signingKey?: string}} [opts]  the key that signs AT this address; default `pubKey`
     * @returns {boolean} whether the mapping was recorded
     */
    registerPeerAddress(address, pubKey, opts = {}) {
      if (typeof address !== 'string' || !address) return false;
      if (typeof pubKey !== 'string' || !pubKey) return false;
      if (typeof agent.security?.registerPeer !== 'function') return false;
      const signingKey = (typeof opts?.signingKey === 'string' && opts.signingKey)
        ? opts.signingKey : pubKey;
      agent.security.registerPeer(address, signingKey);
      if (address !== pubKey) {
        let set = peerAliases.get(pubKey);
        if (!set) { set = new Set(); peerAliases.set(pubKey, set); }
        set.add(address);
        peerIdentityOf.set(address, pubKey);
      }
      return true;
    },

    /**
     * Decision 4 — install an identity of OUR OWN that this device speaks as from `address`: the
     * per-circle signing identity (`circleIdentity(profileSeed, circleId, vault)`).
     *
     * The mirror of `registerPeerAddress`: that one says "this address belongs to that peer's key",
     * this one says "this address of mine is backed by this key of mine". Once installed, a send
     * carrying `{ sendAs: address }` is signed and sealed with it, and inbound traffic sealed to it
     * opens — so BOTH directions of a circle work only if this ran, which is why it is done for
     * every circle this device is in rather than lazily on the first send.
     *
     * The key never leaves the SecurityLayer; callers hold the address and nothing else.
     *
     * @param {string} address   one of this device's own addresses (a per-circle address)
     * @param {object} identity  the AgentIdentity behind it
     * @returns {boolean}
     */
    registerSelfIdentity(address, identity) {
      if (typeof agent.security?.addSelfIdentity !== 'function') return false;
      return agent.security.addSelfIdentity(address, identity);
    },

    /** Stop speaking as the identity at `address` — the circle was left. Idempotent. */
    forgetSelfIdentity(address) {
      if (typeof agent.security?.removeSelfIdentity !== 'function') return false;
      return agent.security.removeSelfIdentity(address);
    },

    /** Diagnostic: the addresses this device holds an identity of its own for. */
    get selfIdentityAddresses() { return agent.security?.selfAddresses ?? []; },

    /**
     * Decision 1 step 3 — install the ROSTER AUTHORIZE step.
     *
     * The kernel verifies an inbound envelope against the key the envelope carries, which is
     * self-consistent and establishes nothing about who the sender is. This is the step that turns
     * a proven key into a person: the caller supplies a function that answers, synchronously,
     * whether that key is on the roster of the circle the envelope was addressed to. Without one,
     * the kernel has no membership knowledge and every validly-signed envelope passes the step —
     * which is honest, counted (`agent.security.senderAuthorizationsByAbsence`), and not a
     * membership check.
     *
     * This substrate deliberately does not implement one: it holds no rosters, and inventing a
     * notion of membership here would put circle vocabulary below the app (design §2, invariant 5).
     * It passes the port through and nothing more — which is also the shape that survives L3 being
     * answered "a substrate", because then the implementation moves INTO a substrate and this line
     * still just installs it.
     *
     * @param {((context: object) => {allow: boolean, reason: string})|null} authorizer
     * @returns {boolean} whether an authorizer is now installed
     */
    setSenderAuthorizer(authorizer) {
      if (typeof agent.security?.setSenderAuthorizer !== 'function') return false;
      return agent.security.setSenderAuthorizer(authorizer);
    },

    /** Diagnostic: is anything checking circle membership on the receive path? */
    get senderAuthorizerInstalled() { return !!agent.security?.hasSenderAuthorizer; },

    /**
     * Drop an alias binding — a member who left or was removed. Their canonical pubKey mapping is
     * untouched (they may still be a contact); only the circle-scoped address stops being sealable.
     */
    forgetPeerAddress(address) {
      if (typeof address !== 'string' || !address) return false;
      if (typeof agent.security?.unregisterPeer !== 'function') return false;
      // Resolve the identity BEFORE dropping the mapping, or the reverse index leaks the alias.
      // `peerIdentityOf` first: since Decision 4 the crypto layer answers with the address's own
      // signing key, which is not the person (see `peerIdentityOf`).
      const pubKey = peerIdentityOf.get(address) ?? agent.security.getPeerKey?.(address) ?? null;
      peerIdentityOf.delete(address);
      agent.security.unregisterPeer(address);
      if (pubKey) {
        const set = peerAliases.get(pubKey);
        if (set) { set.delete(address); if (set.size === 0) peerAliases.delete(pubKey); }
      }
      return true;
    },

    peer: {
      connect: connectPeer,
      sendTo:  sendToPeer,
      get status()  { return peerState.status;  },
      get address() { return peerState.address; },
      get error()   { return peerState.error;   },
    },
    // A1 (2026-05-23) — second cross-peer transport: WebSocket relay.
    // Independent of NKN; either or both can be active.  sa.sendToPeer
    // honours `transportMode` (default 'nkn') to pick which routes.
    relay: {
      connect:    connectRelay,
      disconnect: disconnectRelay,
      get status()  { return relayState.status;  },
      get address() { return relayState.address; },
      get url()     { return relayState.url;     },
      get error()   { return relayState.error;   },
      // G13 — the alias half of the transport PORT, surfaced here so a host registers per-circle
      // addresses through the facade it already holds instead of reaching for the transport (the
      // anti-pattern the surface rule exists to stop). Quacks like the port: `registerCircleAddresses`
      // accepts this object unchanged. Before connect: no aliases, adds report not-connected — and the
      // port KEEPS a failed bind for replay, so an early add is deferred, not lost.
      get supportsAliases() { return relayTransport?.supportsAliases ?? false; },
      get addresses()       { return relayTransport?.addresses ?? []; },
      // opts carries { sign } — the proof-of-possession signer for a per-circle alias. Dropping the
      // second argument here made alias registration inert: the alias is a DIFFERENT key from the
      // transport's own identity, so without the caller's signer the relay's challenge cannot be answered.
      addAddress: (a, opts) => (relayTransport
        ? relayTransport.addAddress(a, opts)
        : Promise.resolve({ ok: false, reason: 'not-connected' })),
      removeAddress: (a) => { try { relayTransport?.removeAddress(a); } catch { /* best-effort */ } },
      // The PUSH half of the transport port (offline delivery, the wake rung) — surfaced here for
      // the same reason as the alias half: a host registers its wake token through the facade it
      // already holds, never by reaching for the transport.
      registerPushToken: (a) => (relayTransport
        ? relayTransport.registerPushToken(a)
        : Promise.resolve({ ok: false, reason: 'not-connected' })),
      unregisterPushToken: () => (relayTransport
        ? relayTransport.unregisterPushToken()
        : Promise.resolve({ ok: false, reason: 'not-connected' })),
    },
    get transportMode() { return transportMode; },
    setTransportMode,
    // Phase-2 · Piece-2 (B2 wiring) — attach (or replace) the peer registry on
    // the SHARED router so the send path resolves the transport-appropriate
    // wire address per peer (`route` → `addressFor` → `PeerGraph.addressesOf`).
    // The app owns the roster (basis's `circlePeerGraph`) and builds it after
    // boot, so it wires it here rather than at factory time.
    attachPeerGraph: (peerGraph) => routing.attachPeerGraph(peerGraph),
    get peerGraph() { return routing.peerGraph; },
    // T5.2a — register an externally-built transport (mdns/ble from the RN app, or any
    // Transport-shaped object) into the secure-mesh: security-wrapped + router-registered.
    addSecureTransport,
    removeSecureTransport,
    // T5.2b — WebRTC rendezvous (direct DataChannel), security-wrapped + auto-pinned on open.
    enableSecureRendezvous,
    upgradeToRendezvous,
    isRendezvousActive: (peer) => !!extraTransports.get('rendezvous')?.hasOpenChannelTo?.(peer),
    rotateIdentity,
    securityStatus,
    shutdown,

    // Delivery guarantee — hold-forward + presence-flush.
    // `presenceSignal(addr)` is the explicit reachability/peer-joined hook (the
    // inbound-envelope path in makeReceiveHandler flushes automatically); it
    // re-sends everything held for `addr` and resolves with `{ flushed }`.
    // `heldFor(addr)` reports how many messages are currently parked for a peer
    // (0 when none) for diagnostics + tests.
    presenceSignal: (addr) => flushPresence(addr),
    heldFor: (addr) => pendingHold.get(addr)?.size ?? 0,
    /** Receipt-keyed removal: the peer's app confirmed `msgId` arrived, so every copy still held for
     *  them (any of their addresses) is obsolete. Per-peer, never global; not a drop, so not reported. */
    removeHeld: (a) => removeHeld(a),
    /** Resolves once a persisted outbox has been read back (no-op without a `holdStore`). Callers
     *  that must not send before the previous run's queue is known await this at boot. */
    outboxRestored: () => outboxRestored,
    /** Flush any pending durable write — for a caller that wants the queue on disk before exiting. */
    outboxFlushed: () => holdPersist,
    /**
     * What the (bounded) hold queue currently holds, and the bounds it is held to. Diagnostics + tests:
     * an unbounded queue was invisible until a device got slow, and this is what makes it visible.
     */
    holdStats: () => ({
      peers: pendingHold.size,
      messages: [...pendingHold.values()].reduce((n, q) => n + q.size, 0),
      givenUpOn: [...deliveryFailures.keys()].filter(isProbeSuppressed).length,
      limits: { ttlMs: holdTtlMs, maxPerPeer: holdMaxPerPeer, maxPeers: holdMaxPeers, maxDeliveryFailures: holdMaxDeliveryFailures },
    }),

    /** v0.7.cc — diagnostic snapshot of the last 10 envelopes,
     * inbound + outbound, for /debug-dump bug reports. */
    recentTraffic: () => recentTraffic.slice(),

    // mute / block list (instrumented for autoLog)
    mute: {
      async add(addr) {
        const r = await muteSet.add(addr);
        if (auditAutoLog && r) audit('mute.add', addr);
        return r;
      },
      async remove(addr) {
        const r = await muteSet.remove(addr);
        if (auditAutoLog && r) audit('mute.remove', addr);
        return r;
      },
      has:    (addr) => muteSet.has(addr),
      list:   ()     => muteSet.list(),
      clear:  ()     => muteSet.clear(),
      get size() { return muteSet.size; },
    },

    // identity-resolver (peer alias resolution + mute fanout)
    resolver: peerResolver,

    // TrustRegistry (vault-backed per-peer trust)
    trust: trustRegistry,                  // null when not opted in

    // CapabilityToken issuance + verification (autoLog issue)
    caps: capsWired ? {
      async issue(issueOpts = {}) {
        const token = await CapabilityToken.issue(identity, {
          agentId:   identity.pubKey,
          expiresIn: capDefaults.defaultExpiresIn ?? 3_600_000,
          skill:     '*',
          ...issueOpts,
        });
        if (auditAutoLog) {
          audit('caps.issue', issueOpts.subject, {
            tokenId:   token.id,
            skill:     token.skill,
            expiresAt: token.expiresAt,
          });
        }
        return token;
      },
      verify(token, vOpts = {}) {
        return CapabilityToken.verify(
          token,
          vOpts.expectedAgentId ?? identity.pubKey,
          vOpts,
        );
      },
    } : null,

    // PolicyEngine
    policy: policyEngine,                  // null when not opted in

    // Roles constants (no per-instance state)
    ROLES,

    // signed activity / audit log
    audit: auditLog,                       // null when not opted in
    auditAutoLog,                          // diagnostic: were auto-fires wired?

    // closed groups
    groups: groupManager,                  // null when not opted in

    // A2A TLS layer (for A2ATransport composition)
    a2aTls,                                // null when not opted in

    // rate limiter (the running instance, for inspection)
    rateLimit: rateLimiter,                // null when not opted in

    // 5.7c — circle override enforcement.  When `circleEnforcement`
    // wasn't opted in, `wired === false` and `isInboundBlocked` always
    // resolves false.  Exposed for tests + diagnostics; the live
    // receive handler invokes the same predicate.
    circleEnforcement: {
      get wired() { return !!circleEnf; },
      isInboundBlocked(env) { return isInboundCircleBlocked(env); },
    },

    // Perfect Forward Secrecy chains (partial Double-Ratchet)
    pfs: pfsEnabled ? {
      enabled: true,
      get partial() { return true; },     // honest about scope
      async encrypt(peerPubKey, plaintext) {
        const chain = await pfsChainFor(peerPubKey);
        return chain.encrypt(plaintext);
      },
      async decrypt(peerPubKey, wire) {
        const chain = await pfsChainFor(peerPubKey);
        return chain.decrypt(wire);
      },
      async chainFor(peerPubKey)   { return pfsChainFor(peerPubKey); },
      knownPeers() { return [...pfsChains.keys()]; },
    } : null,

    // pod-mirror identity migration (bound to our identity + vault)
    async migrateVaultToPod(args = {}) {
      if (!args.podClient || !args.podRoot || !args.mnemonic) {
        throw new Error(
          'sa.migrateVaultToPod: { podClient, podRoot, mnemonic } required.',
        );
      }
      const report = await migrateVaultToPodFn({
        vault,
        identity,
        podClient:  args.podClient,
        podRoot:    args.podRoot,
        mnemonic:   args.mnemonic,
        deviceMeta: args.deviceMeta ?? {},
        dryRun:     args.dryRun ?? false,
        force:      args.force ?? false,
      });
      if (auditAutoLog) audit('vault.migrate', args.podRoot, {
        migrated: report.migrated.length,
        skipped:  report.skipped.length,
        dryRun:   report.dryRun,
      });
      return report;
    },

    // WebAuthn / passkey unlock helpers
    passkey: {
      get available() { return webauthnAvailable(); },
      get config()    { return passkeyConfig; },
      async register(extra = {}) {
        if (!passkeyConfig) {
          throw new Error(
            'passkey.register: opt webAuthnUnlock not set at factory time.',
          );
        }
        return registerPasskeyFn({ ...passkeyConfig, ...extra });
      },
      async unlock(extra = {}) {
        if (!passkeyConfig) {
          throw new Error(
            'passkey.unlock: opt webAuthnUnlock not set at factory time.',
          );
        }
        return unlockWithPasskeyFn({ ...passkeyConfig, ...extra });
      },
      ERRORS: PASSKEY_ERRORS,
    },

    // signed WebID claim (autoLog claim.sign)
    claim: {
      sign(args = {}) {
        const webid = args.webid ?? boundWebid;
        if (!webid) {
          throw new Error(
            'claim.sign: no webid bound + none passed.  Either set ' +
            'opts.webidClaim.webid at factory time or pass {webid} here.',
          );
        }
        const c = signClaimFn(identity, { ...args, webid });
        if (auditAutoLog) audit('claim.sign', webid, { nknAddr: args.nknAddr ?? null });
        return c;
      },
      verify:    (c, vOpts) => verifyClaimFn(c, vOpts),
      serialize: (c)        => serializeClaim(c),
      parse:     (s)        => parseClaim(s),
      get boundWebid() { return boundWebid; },
    },

    // pendingOpts is the bridge between 'caller asked for X' and
    // 'X not wired yet'.  Future slices delete each entry from
    // STUB_OPTS as they activate.
    pendingOpts: pickStubOpts(opts),
  };
}

/**
 * Resolve the helloGate opt to a predicate fn.  Accepts:
 *   - function           → use as-is
 *   - string             → tokenGate(secret)
 *   - { token: 'xyz' }   → tokenGate('xyz')
 *   - null / undefined   → no user gate (mute-only base gate still applies)
 *
 * Returns null when no user gate; the factory installs only the mute
 * base gate in that case.
 */
function resolveHelloGate(opt) {
  if (opt == null) return null;
  if (typeof opt === 'function') return opt;
  if (typeof opt === 'string')   return tokenGate(opt);
  if (typeof opt === 'object' && typeof opt.token === 'string') {
    return tokenGate(opt.token);
  }
  throw new Error(
    'createSecureAgent: helloGate must be a function, a string ' +
    '(PSK), or { token: string }.  Got: ' + typeof opt,
  );
}

/**
 * Normalise the identityResolver opt to a MemberMap-shaped object,
 * or null if the opt wasn't set.
 *
 *   memberMapInstance  → used directly (must expose resolveByPubKey OR resolveByWebid)
 *   { memberMap }      → unwrapped
 */
function pickResolverMemberMap(opt) {
  if (opt == null) return null;
  const mm = (opt.memberMap && typeof opt.memberMap === 'object') ? opt.memberMap : opt;
  // Sanity check: at least one resolver method must be present.
  if (typeof mm.resolveByPubKey !== 'function'
   && typeof mm.resolveByWebid  !== 'function'
   && typeof mm.resolveByStableId !== 'function') {
    throw new Error(
      'createSecureAgent: identityResolver must expose at least one of ' +
      'resolveByPubKey / resolveByWebid / resolveByStableId.',
    );
  }
  return mm;
}

function pickStubOpts(opts) {
  const out = {};
  for (const key of STUB_OPTS) {
    if (opts[key] !== undefined) out[key] = opts[key];
  }
  return out;
}

/**
 * 5.7c — normalise the circleEnforcement opt to a `{groupsIndex,
 * getOverride, getCirclePolicy, memberMap, getCircleIdForEnv?}` bundle,
 * or null if the opt wasn't set / is empty.  Accepts a partial bundle
 * (any missing accessor degrades gracefully — the predicates handle
 * `null` / `undefined` and return false).
 */
function pickCircleEnforcement(opt) {
  if (opt == null) return null;
  if (typeof opt !== 'object') {
    throw new TypeError(
      'createSecureAgent: circleEnforcement must be an object with ' +
      '{groupsIndex, getOverride, getCirclePolicy, memberMap, ' +
      'getCircleIdForEnv?} accessors.',
    );
  }
  const {
    groupsIndex, getOverride, getCirclePolicy, memberMap, getCircleIdForEnv,
  } = opt;
  return {
    groupsIndex:     groupsIndex     ?? null,
    getOverride:     getOverride     ?? null,
    getCirclePolicy: getCirclePolicy ?? null,
    memberMap:       memberMap       ?? null,
    getCircleIdForEnv: typeof getCircleIdForEnv === 'function'
      ? getCircleIdForEnv
      : null,
  };
}

/**
 * 5.7c — inlined predicate logic.  Duplicates `isInboundChatOff` from
 * apps/basis/src/v2/circleEnforcement.js so secure-agent doesn't
 * have to depend on basis (layering: substrates may not import
 * apps).  Keep the two in sync; basis's substrate version is the
 * source of truth + has the full test matrix.
 */
async function isInboundChatOffLocal({ peerWebid, groupsIndex, getOverride } = {}) {
  if (typeof peerWebid !== 'string' || !peerWebid) return false;
  if (!groupsIndex || typeof groupsIndex.groupsFor !== 'function') return false;
  let circles;
  try { circles = groupsIndex.groupsFor(peerWebid); }
  catch { return false; }
  if (!Array.isArray(circles) || circles.length === 0) return false;
  for (const circleId of circles) {
    let ov = null;
    try { ov = await getOverride?.(circleId); }
    catch { ov = null; }
    if (ov?.chatOff === true) return true;
  }
  return false;
}

/**
 * 5.7c — inlined predicate logic mirroring `isInboundAgentBlocked`
 * from apps/basis/src/v2/circleEnforcement.js.
 */
async function isInboundAgentBlockedLocal({
  peerWebid, circleId, memberMap, getCirclePolicy, getOverride,
} = {}) {
  if (typeof peerWebid !== 'string' || !peerWebid) return false;
  if (typeof circleId  !== 'string' || !circleId)  return false;
  if (!memberMap || typeof memberMap.resolveByWebid !== 'function') return false;

  let member = null;
  try { member = await memberMap.resolveByWebid(peerWebid); }
  catch { member = null; }
  if (!member || member.relation !== 'agent') return false;

  let policy = null;
  try { policy = await getCirclePolicy?.(circleId); }
  catch { policy = null; }
  if (policy?.agents === 'no') return true;

  let ov = null;
  try { ov = await getOverride?.(circleId); }
  catch { ov = null; }
  if (ov?.agentsMayContactMe === false) return true;

  return false;
}

/**
 * Normalise the webAuthnUnlock opt to a config object usable by
 * the passkey helpers, or null if the opt wasn't set.
 *
 *   true         → infer rpId from window.location.hostname; userName='onderling-user'
 *   { rpId, … }  → use as-is, fill in defaults
 */
function resolvePasskeyConfig(opt) {
  if (opt == null || opt === false) return null;
  const base = (opt === true) ? {} : opt;
  const inferredRpId =
    (typeof globalThis.location !== 'undefined' && globalThis.location.hostname)
      ? globalThis.location.hostname
      : null;
  const rpId = base.rpId ?? inferredRpId;
  if (!rpId) {
    throw new Error(
      'createSecureAgent: webAuthnUnlock=true requires window.location.hostname; ' +
      'pass { rpId } explicitly outside a browser.',
    );
  }
  return {
    rpId,
    rpName:   base.rpName   ?? rpId,
    userName: base.userName ?? 'onderling-user',
    userId:   base.userId   ?? 'onderling-user',
    // Key-derivation input for the WebAuthn/passkey-backed vault. Renamed pre-launch: an existing
    // passkey now derives a different key, so a dev vault must be re-registered (accepted).
    prfSalt:  base.prfSalt  ?? 'onderling/secure-agent/v1',
    ...(base.credentialId ? { credentialId: base.credentialId } : {}),
  };
}
