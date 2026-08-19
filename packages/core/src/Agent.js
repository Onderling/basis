/**
 * Agent — developer-facing class.
 *
 * Owns: identity, transport(s), security, skill registry, state manager,
 * optional policy engine, optional peer graph, optional storage, optional config.
 *
 * Single-transport usage (backward compat):
 *   const agent = new Agent({ identity, transport });
 *   agent.register('echo', async ({ parts }) => parts);
 *   await agent.start();
 *   await agent.hello(peerAddress);
 *   const result = await agent.invoke(peerAddress, 'echo', [TextPart('hi')]);
 *
 * Multi-transport usage:
 *   const agent = new Agent({ identity, transport: relayTransport });
 *   agent.addTransport('ble', bleTransport);
 *   await agent.start();           // connects all transports
 *
 * With full wiring:
 *   const agent = new Agent({ identity, transport, peers, storage, config });
 *   // agent.peers  → PeerGraph
 *   // agent.storage → StorageManager
 *   // agent.config  → AgentConfig
 */
import { Emitter }            from './Emitter.js';
import { SecurityLayer }      from './security/SecurityLayer.js';
import { SkillRegistry }      from './skills/SkillRegistry.js';
import { defineSkill }        from './skills/defineSkill.js';
import { StateManager }       from './state/StateManager.js';
import { Parts }              from './Parts.js';
import { P }                  from './Envelope.js';
import { sendHello, handleHello }                    from './protocol/hello.js';
import { handleMessage }                             from './protocol/messaging.js';
import { handleKeyRotationOW, KeyRotation, migratePeerGraph } from './protocol/keyRotation.js';
import { AgentIdentity }                              from './identity/AgentIdentity.js';
import { handleSkillDiscovery }                      from './protocol/skillDiscovery.js';
import { invokeAgentSkill, handleTaskRequest, handleTaskOneWay } from './protocol/taskExchange.js';
import { handlePubSub }                              from './protocol/pubSub.js';
import { invokeWithHop, callWithHop }                from './routing/invokeWithHop.js';
import { registerRelayForward }                      from './skills/relayForward.js';
import { registerTunnelOpen }                         from './skills/tunnelOpen.js';
import { registerTunnelOw }                           from './skills/tunnelOw.js';
import { registerReachablePeersSkill }               from './skills/reachablePeers.js';
import { PeerDiscovery }                             from './discovery/PeerDiscovery.js';
import { pullPeerList }                              from './discovery/pullPeerList.js';

/**
 * The developer-facing agent class. Owns the identity, one or more named transports,
 * the SecurityLayer, skill registry and state manager, plus optional policy/trust/token
 * registries, peer graph, storage, config, and routing strategy. Register skills with
 * `register()`, then `start()` connects all transports and begins dispatching inbound
 * envelopes; talk to peers via `hello()` and `invoke()`. Emits lifecycle and protocol
 * events (extends Emitter).
 */
export class Agent extends Emitter {
  #identity;
  #transport;              // primary / default transport (backward compat)
  #transports;             // Map<name, Transport> — all named transports
  #security;
  #skills;
  #stateManager;
  #policyEngine  = null;
  #trustRegistry = null;
  #tokenRegistry = null;
  #peers         = null;   // PeerGraph | null
  #storage       = null;   // StorageManager | null
  #config        = null;   // AgentConfig | null
  #routing       = null;   // RoutingStrategy | null
  #discovery     = null;   // PeerDiscovery | null — lazy, via startDiscovery()
  #autoHelloOpts = null;   // opts object if enableAutoHello() has been called
  #autoHelloBound = new WeakSet();  // transports that already have the listener
  #autoHelloedMacs = new Set();     // MACs we've already initiated BLE hello to
  #maxTaskTtl    = null;
  #pubSubHistory = 0;
  #started       = false;
  #label         = null;
  #webid         = null;   // optional WebIdCache (or any object) — standardisation Phase 50.2
  #pseudoPod         = null;   // optional pseudo-pod (or any object) — standardisation Phase 50.3
  #agentRegistry     = null;   // optional agent-registry (or any object) — standardisation Phase 50.8
  #interfaceRegistry = null;   // optional interface-registry (or any object) — standardisation Phase 50.13 (direction)
  #protocol          = null;   // optional protocol substrate (or any object) — standardisation Phase 50.14 (direction)
  #helloGate     = null;   // optional (envelope) => boolean gate; see Group W
  #sealedConfigs = null;   // Map<groupId, { enabled, ... }> — Group BB
  #rotationInlineSeen = new Set();  // Group FF+1 — newPubKey seen via inline proof (dedup)

  /**
   * @param {object} opts
   * @param {import('./identity/AgentIdentity.js').AgentIdentity}     opts.identity
   * @param {import('./transport/Transport.js').Transport}             opts.transport   — primary transport
   * @param {import('./security/SecurityLayer.js').SecurityLayer}      [opts.security]
   * @param {import('./permissions/PolicyEngine.js').PolicyEngine}     [opts.policyEngine]
   * @param {import('./permissions/TrustRegistry.js').TrustRegistry}  [opts.trustRegistry]
   * @param {import('./permissions/TokenRegistry.js').TokenRegistry}   [opts.tokenRegistry]
   * @param {import('./discovery/PeerGraph.js').PeerGraph}             [opts.peers]
   * @param {import('./storage/StorageManager.js').StorageManager}     [opts.storage]
   * @param {import('./config/AgentConfig.js').AgentConfig}            [opts.config]
   * @param {import('./routing/RoutingStrategy.js').RoutingStrategy}   [opts.routing]
   * @param {Array}  [opts.skills]
   * @param {string} [opts.label]
   */
  constructor({ identity, transport, security, policyEngine, trustRegistry,
                tokenRegistry, peers, storage, config, routing,
                maxTaskTtl, pubSubHistory,
                skills = [], label, webid, pseudoPod, agentRegistry,
                interfaceRegistry, protocol } = {}) {
    super();
    if (!identity)  throw new Error('Agent requires an identity');
    if (!transport) throw new Error('Agent requires a transport');

    this.#identity      = identity;
    this.#transport     = transport;
    this.#transports    = new Map([['default', transport]]);
    this.#security      = security ?? new SecurityLayer({ identity });
    this.#skills        = new SkillRegistry();
    this.#stateManager  = new StateManager();
    this.#policyEngine  = policyEngine  ?? null;
    this.#trustRegistry = trustRegistry ?? null;
    this.#tokenRegistry = tokenRegistry ?? null;
    this.#peers         = peers         ?? null;
    this.#storage       = storage       ?? null;
    this.#config        = config        ?? null;
    this.#routing       = routing       ?? null;
    this.#maxTaskTtl    = maxTaskTtl    ?? null;
    this.#pubSubHistory = pubSubHistory ?? 0;
    this.#label         = label         ?? null;
    this.#webid             = webid             ?? null;
    this.#pseudoPod         = pseudoPod         ?? null;
    this.#agentRegistry     = agentRegistry     ?? null;
    this.#interfaceRegistry = interfaceRegistry ?? null;
    this.#protocol          = protocol          ?? null;

    for (const s of skills) this.#skills.register(s);
  }

  // ── Identity / address ────────────────────────────────────────────────────

  get address()       { return this.#transport.address; }
  get pubKey()        { return this.#identity.pubKey; }
  get label()         { return this.#label; }
  get identity()      { return this.#identity; }
  get security()      { return this.#security; }
  get skills()        { return this.#skills; }
  get stateManager()  { return this.#stateManager; }
  get policyEngine()  { return this.#policyEngine; }
  /**
   * Attach a PolicyEngine AFTER construction — the PolicyEngine needs
   * `agent.skills`, so factories build the agent first, then the engine, then
   * attach it here. Set-once (throws on a conflicting re-attach) so enforcement
   * can never be silently swapped or cleared out from under `runGatedSkill`.
   */
  set policyEngine(pe) {
    if (this.#policyEngine && this.#policyEngine !== pe) {
      throw new Error('Agent.policyEngine: already attached — cannot replace');
    }
    this.#policyEngine = pe ?? this.#policyEngine;
  }
  get trustRegistry() { return this.#trustRegistry; }
  get tokenRegistry() { return this.#tokenRegistry; }
  get transport()     { return this.#transport; }

  /** PeerGraph — optional. Populated automatically by hello() when provided. */
  get peers()    { return this.#peers; }
  /** StorageManager — optional. */
  get storage()  { return this.#storage; }
  /** WebIdCache (or any object) — optional. Populated by Bootstrap for pod-having users
   *  (standardisation Phase 50.2). `null` for no-pod users. */
  get webid()    { return this.#webid; }
  /** Pseudo-pod handle (or any object) — optional. Populated by the provisioning facade
   *  (standardisation Phase 50.3). Core never imports `@onderling/pseudo-pod`; this is
   *  an opaque slot the caller fills with whatever it wants. `null` when no pseudo-pod
   *  is wired (e.g. tests that don't need storage). */
  get pseudoPod() { return this.#pseudoPod; }
  /** Agent-registry handle (or any object) — optional. Populated by the provisioning
   *  facade (standardisation Phase 50.8). Core never imports `@onderling/agent-registry`;
   *  this is an opaque slot the caller fills with whatever it wants. `null` when no
   *  registry is wired (e.g. no-pod users, tests, single-agent setups). */
  get agentRegistry() { return this.#agentRegistry; }
  /** Interface-registry handle (or any object) — optional. Populated by the provisioning
   *  facade once the destination shape (§II.13) ships (standardisation Phase 50.13,
   *  direction). Core never imports `@onderling/interface-registry`; this is an opaque
   *  slot for the per-type renderer registry that Hub V2 introduces. `null` pre-. */
  get interfaceRegistry() { return this.#interfaceRegistry; }
  /** Protocol substrate handle (or any object) — optional. Populated by the provisioning
   *  facade once the destination shape (§II.13) ships (standardisation Phase 50.14,
   *  direction). Core never imports `@onderling/protocol`; this is an opaque slot for the
   *  state-machine orchestrator (Tasks's propose-subtask is the canonical first
   *  consumer). `null` pre-. */
  get protocol() { return this.#protocol; }
  /** AgentConfig — optional. */
  get config()   { return this.#config; }
  /** RoutingStrategy — optional. Used by call() when multiple transports are present. */
  get routing()  { return this.#routing; }

  get maxTaskTtl()    { return this.#maxTaskTtl; }
  get pubSubHistory() { return this.#pubSubHistory; }

  // ── Multi-transport management ────────────────────────────────────────────

  /**
   * Add a named transport. On start() (or immediately if already started)
   * the transport is connected and its receive handler wired to this agent's
   * dispatch loop.
   *
   * @param {string} name  — e.g. 'relay', 'ble', 'nkn'
   * @param {import('./transport/Transport.js').Transport} transport
   */
  addTransport(name, transport) {
    this.#transports.set(name, transport);
    if (this.#routing?.addTransport) this.#routing.addTransport(name, transport);
    if (this.#started) {
      transport.useSecurityLayer(this.#security);
      transport.setReceiveHandler(env => this._dispatch(env));
      transport._ownerAgent = this;   // B★ in-process fast-path back-ref
      transport.on('security-error', err => this.emit('security-error', err));
      transport.connect().catch(err => this.emit('error', err));
    }
    // If enableAutoHello() was called earlier, newly-added transports also
    // get the peer-discovered handler installed.
    if (this.#autoHelloOpts) this.#bindAutoHello(transport);
    return this;
  }

  /** Remove and disconnect a named transport. */
  removeTransport(name) {
    const t = this.#transports.get(name);
    if (t) {
      t.disconnect().catch(() => {});
      this.#transports.delete(name);
      if (t === this.#transport && this.#transports.size > 0) {
        // Promote next transport as primary
        this.#transport = this.#transports.values().next().value;
      }
    }
    return this;
  }

  /** Get a named transport by name. */
  getTransport(name) {
    return this.#transports.get(name) ?? null;
  }

  /** All transport names currently registered. */
  get transportNames() {
    return [...this.#transports.keys()];
  }

  // ── Peer management ───────────────────────────────────────────────────────

  /**
   * Manually register a peer's pubKey (skip hello).
   * @param {string} address
   * @param {string} pubKeyB64
   */
  addPeer(address, pubKeyB64) {
    this.#security.registerPeer(address, pubKeyB64);
    return this;
  }

  /**
   * Forget a peer: clear their key from SecurityLayer, remove from PeerGraph,
   * and tell every transport to drop its caches.  Each transport can then
   * re-discover the peer (and re-emit peer-discovered) if they're still
   * reachable — so forget → natural re-hello.
   *
   * @param {string} pubKeyOrAddress
   */
  async forget(pubKeyOrAddress) {
    this.#security.unregisterPeer(pubKeyOrAddress);
    if (this.#peers) await this.#peers.remove(pubKeyOrAddress).catch(() => {});
    for (const t of this.#transports.values()) {
      try { t.forgetPeer?.(pubKeyOrAddress); } catch {}
    }
    this.emit('peer-forgotten', pubKeyOrAddress);
  }

  // ── Skill registration ────────────────────────────────────────────────────

  /**
   * Register a skill handler inline.
   * @param {string}   id
   * @param {Function} handler  async ({ parts, from, taskId, envelope, agent }) → Part[]|any
   *                            async function*(...) for streaming
   * @param {object}   [opts]
   */
  register(id, handler, opts = {}) {
    this.#skills.register(defineSkill(id, handler, opts));
    return this;
  }

  // ── Hub binding (Phase 50.12) ─────────────────────────────────────────────

  /**
   * Notify the agent's opaque substrate slots that we're now bound to a
   * Hub. Each slot decides for itself how to honour the binding — core
   * just **fans out** the notification via a duck-typed
   * `setHost('hub', binder)` call. Slots that don't implement `setHost`
   * are silently skipped.
   *
   * Strict layering: core has no knowledge of what the Hub binder
   * actually is (AIDL, IPC, whatever) — it's opaque. The substrate
   * (typically `@onderling/pseudo-pod` for the storage slot,
   * `@onderling/agent-registry` for the registry slot) handles the
   * actual delegation.
   *
   * Typical use, from `@onderling/agent-provisioning` or a bundle's
   * own bring-up code:
   *
   *   const hubInfo = await hubDiscovery.check();
   *   if (hubInfo.hubInstalled) {
   *     const binder = await hubBinding.bind({hubVersion: hubInfo.hubVersion});
   *     agent.bindToHub(binder);
   *     // ↑ pseudo-pod + agent-registry round-trip through the Hub now.
   *   }
   *
   * Phase 50.12 — see
   * `Project Files/SDK/core-v2-coding-plan-2026-05-11.md`.
   *
   * @param {object} binder  — opaque Hub binder
   * @returns {{ notified: string[] }} list of slot names that received
   *          the binding (for diagnostics / tests).
   */
  bindToHub(binder) {
    if (binder == null) {
      throw Object.assign(
        new Error('bindToHub: `binder` is required'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    const notified = [];
    for (const [slotName, slot] of [
      ['pseudoPod',         this.#pseudoPod],
      ['agentRegistry',     this.#agentRegistry],
      ['interfaceRegistry', this.#interfaceRegistry],
      ['protocol',          this.#protocol],
      ['webid',             this.#webid],
    ]) {
      if (slot && typeof slot.setHost === 'function') {
        try {
          slot.setHost('hub', binder);
          notified.push(slotName);
        } catch (err) {
          this.emit('error', Object.assign(err, { slot: slotName }));
        }
      }
    }
    this.emit('hub-bound', { binder, notified });
    return { notified };
  }

  /**
   * Inverse of `bindToHub`: notify substrate slots that the Hub binding
   * is gone (e.g. user uninstalled the Hub mid-session, or the Hub
   * service crashed). Each slot's `setHost(null)` (when implemented)
   * reverts to local handling.
   *
   * Symmetric duck-typing rules: slots without `setHost` are silently
   * skipped; per-slot errors are emitted but don't abort the fan-out.
   *
   * @returns {{ notified: string[] }}
   */
  unbindFromHub() {
    const notified = [];
    for (const [slotName, slot] of [
      ['pseudoPod',         this.#pseudoPod],
      ['agentRegistry',     this.#agentRegistry],
      ['interfaceRegistry', this.#interfaceRegistry],
      ['protocol',          this.#protocol],
      ['webid',             this.#webid],
    ]) {
      if (slot && typeof slot.setHost === 'function') {
        try {
          slot.setHost(null);
          notified.push(slotName);
        } catch (err) {
          this.emit('error', Object.assign(err, { slot: slotName }));
        }
      }
    }
    this.emit('hub-unbound', { notified });
    return { notified };
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async start() {
    if (this.#started) return;
    this.#started = true;

    for (const [, transport] of this.#transports) {
      transport.useSecurityLayer(this.#security);
      transport.setReceiveHandler(env => this._dispatch(env));
      transport._ownerAgent = this;   // B★ in-process fast-path back-ref
      transport.on('security-error', err => this.emit('security-error', err));
    }
    // Connect all transports (in parallel; errors on non-primary are soft)
    const entries = [...this.#transports.entries()];
    await Promise.all(entries.map(([name, t]) =>
      t.connect().catch(err => {
        if (t === this.#transport) throw err; // primary failure is fatal
        this.emit('error', Object.assign(err, { transportName: name }));
      })
    ));
    this.emit('start', { address: this.address });
  }

  async stop() {
    if (!this.#started) return;
    this.#started = false;
    // Tear down the tunnel session sweeper if we registered tunnel-open.
    this._tunnelSessions?.stop?.();
    await Promise.allSettled([...this.#transports.values()].map(t => t.disconnect()));
    this.emit('stop');
  }

  // ── Transport selection ───────────────────────────────────────────────────

  /**
   * Resolve the best transport for a peer.
   * Uses RoutingStrategy when available; otherwise returns the primary transport.
   *
   * @param {string} peerId
   * @param {object} [opts]   — passed to RoutingStrategy.selectTransport
   * @returns {Promise<import('./transport/Transport.js').Transport>}
   */
  async transportFor(peerId, opts = {}) {
    // Self-loopback: never route a self-addressed envelope through
    // a remote transport (mDNS / relay / NKN / etc.).  Without this,
    // RoutingStrategy can pick the relay (its default canReach()
    // returns true) and `agent.invoke(self, ...)` makes a wire
    // round-trip just to call its own skill — visibly slow + prone
    // to timeouts when the relay is congested.  The primary slot is
    // always self-loop-capable (InternalTransport on mobile,
    // OfflineTransport in mesh-demo's mDNS-only path, etc.).
    if (peerId === this.#transport.address) return this.#transport;

    if (this.#routing && this.#transports.size > 1) {
      const result = await this.#routing.selectTransport(peerId, opts);
      if (result?.transport) return result.transport;
    }
    return this.#transport;
  }

  /**
   * Like transportFor() but returns both the chosen transport AND the
   * name RoutingStrategy indexed it under.  Callers that want to report
   * success/failure back to the FallbackTable need the name.
   *
   * @param {string} peerId
   * @param {object} [opts]
   * @returns {Promise<{ name: string, transport: import('./transport/Transport.js').Transport }>}
   */
  async routeFor(peerId, opts = {}) {
    // Same self-loopback short-circuit as transportFor().
    if (peerId === this.#transport.address) {
      return { name: 'default', transport: this.#transport };
    }

    if (this.#routing && this.#transports.size > 1) {
      const result = await this.#routing.selectTransport(peerId, opts);
      if (result?.transport) return result;
    }
    return { name: 'default', transport: this.#transport };
  }

  /**
   * Classify how this agent reaches `peerId` into a three-tier
   * reachability model: `direct` (WebRTC/BLE/mDNS/local/internal),
   * `mesh` (relay/NKN/MQTT/offline), or `hop` (peer-as-relay).
   *
   * Returns `null` when there is no RoutingStrategy or no candidate
   * transport for the peer.  Returns
   * `{ transport, name, tier, latencyEstimate? }` otherwise — see
   * `routing/ReachabilityTier.js`.
   *
   * Additive — does not change behaviour of `transportFor()` /
   * `routeFor()`; intended for apps that want to surface the link
   * quality / privacy posture per peer.
   *
   * @param {string} peerId
   * @param {object} [opts]   — passed to RoutingStrategy.tierFor
   * @returns {Promise<{ name: string, transport: object, tier: 'direct'|'mesh'|'hop', latencyEstimate?: number }|null>}
   */
  async reachabilityFor(peerId, opts = {}) {
    if (!this.#routing || typeof this.#routing.tierFor !== 'function') return null;
    return this.#routing.tierFor(peerId, opts);
  }

  // ── High-level API ────────────────────────────────────────────────────────

  /**
   * Bidirectional hello handshake.  After resolving, both SecurityLayers
   * have each other's pubKey.  If agent.peers (PeerGraph) is set, the peer
   * record is upserted automatically.
   *
   * @param {string} peerAddress
   * @param {number} [timeout=15000]
   */
  async hello(peerAddress, timeout) {
    await sendHello(this, peerAddress, timeout);
    // Wire into PeerGraph if available (best-effort — don't fail hello on graph error)
    if (this.#peers) {
      const peerPubKey = this.#security.getPeerKey(peerAddress);
      if (peerPubKey) {
        // B2 / G5 — record the address under the NAME of the transport that reaches
        // it (relay/nkn/…), not the opaque `default`, so `addressesOf(pubKey)`
        // resolves the transport-appropriate wire address. `peerAddress` IS the
        // transport-specific address the hello travelled over. Falls back to
        // `default` in single-transport setups (unchanged behaviour there).
        let txName = 'default';
        try { txName = (await this.routeFor(peerAddress))?.name ?? 'default'; } catch { /* keep default */ }
        this.#peers.upsert({
          type:          'native',
          pubKey:        peerPubKey,
          transports:    { [txName]: { address: peerAddress, lastSeen: Date.now() } },
          lastSeen:      Date.now(),
          reachable:     true,
          discoveredVia: 'hello',
        }).catch(() => {});
      }
    }
  }

  /**
   * Call a skill on a peer. Returns a Task immediately.
   * Await task.done() or iterate task.stream() for chunks.
   *
   * @param {string}   peerId
   * @param {string}   skillId
   * @param {Array|*}  input
   * @param {object}   [opts]
   * @param {number}   [opts.timeout]
   * @param {string}   [opts.transport]   — named transport to use (bypasses routing)
   * @returns {import('./protocol/Task.js').Task}
   */
  call(peerId, skillId, input = [], opts = {}) {
    const parts = Parts.wrap(input);
    // If a specific transport name is requested, use it directly
    if (opts.transport) {
      const t = this.#transports.get(opts.transport);
      if (!t) throw new Error(`Unknown transport: ${opts.transport}`);
      return invokeAgentSkill({ ...this._asCallCtx(), _overrideTransport: t }, peerId, skillId, parts, opts);
    }
    return invokeAgentSkill(this, peerId, skillId, parts, opts);
  }

  /**
   * call() + await done() + return parts.  Throws if task fails.
   * @returns {Promise<import('./Parts.js').Part[]>}
   */
  async invoke(peerId, skillId, input = [], opts = {}) {
    const task   = this.call(peerId, skillId, input, opts);
    const result = await task.done();
    if (result.state === 'failed') throw new Error(result.error ?? `Skill "${skillId}" failed`);
    return result.parts;
  }

  /**
   * Hop-aware invoke: tries direct first, falls back to relay-forward via a
   * bridge peer (record.via or any reachable direct peer). Handles the
   * "hello not yet done" case by auto-hello'ing once and retrying.
   *
   * See packages/core/src/routing/invokeWithHop.js for the full strategy.
   *
   * @param {string}   peerId
   * @param {string}   skillId
   * @param {Array|*}  [input]
   * @param {object}   [opts]
   * @returns {Promise<import('./Parts.js').Part[]>}
   */
  invokeWithHop(peerId, skillId, input = [], opts = {}) {
    return invokeWithHop(this, peerId, skillId, Parts.wrap(input), opts);
  }

  /**
   * Hop-aware version of agent.call() — returns a Task synchronously.
   *
   * Unlike invokeWithHop (which awaits terminal and returns Parts[]), this
   * returns the Task immediately so the caller can iterate task.stream(),
   * listen for task.on('input-required'), or task.cancel().  When the
   * chosen bridge advertises `tunnel: true` in get-capabilities, the call
   * goes through the Group CC hop-aware tunnel; otherwise it falls back
   * to the one-shot relay-forward path with semantically-equivalent
   * results (no streaming / IR / cancel).
   *
   * @param {string}   peerId
   * @param {string}   skillId
   * @param {Array|*}  [input]
   * @param {object}   [opts]
   * @returns {import('./protocol/Task.js').Task}
   */
  callWithHop(peerId, skillId, input = [], opts = {}) {
    return callWithHop(this, peerId, skillId, Parts.wrap(input), opts);
  }

  /**
   * Group FF — rotate this agent's Ed25519 identity.
   *
   * Generates a new keypair, persists both current + previous (with
   * graceUntil) to the vault, broadcasts a signed KeyRotationProof to
   * reachable peers, and swaps SecurityLayer over to the new identity.
   * During the grace window, envelopes addressed to our OLD pubkey
   * still decrypt (peers that missed the broadcast), and outbound
   * envelopes are signed with the NEW key only.
   *
   * Order of operations matters:
   *   1. Generate + persist the new keypair (vault dual-key blob).
   *   2. Build the proof with the OLD identity (before swap).
   *   3. Broadcast while peers still have our OLD pubkey — their
   *      receive-handler verifies against OLD, then migrates.  If we
   *      swapped first, broadcasts signed by NEW would fail verification
   *      on peers who haven't heard yet.
   *   4. Register OLD in SecurityLayer.#selfHistory (for inbound
   *      decryption from late peers) + swap to NEW for outbound.
   *
   * @param {object}  [opts]
   * @param {number}  [opts.gracePeriodSeconds=604800]  — 7 days default
   * @param {boolean} [opts.broadcast=true]             — send proof to reachable peers
   * @returns {Promise<{ oldPubKey: string, newPubKey: string, proof: object, graceUntil: number }>}
   */
  async rotateIdentity({ gracePeriodSeconds = 604_800, broadcast = true } = {}) {
    const vault = this.#identity.vault;
    if (!vault) throw new Error('rotateIdentity: current identity has no vault');

    // 1. Generate + persist.  Vault now contains { current: new, previous: { seed: old, graceUntil } }.
    const { oldIdentity, newIdentity, graceUntil } =
      await AgentIdentity.rotate(vault, { gracePeriodSeconds });

    // 2. Build the proof BEFORE the swap so it's signed by the old key.
    const proof = await KeyRotation.buildProof(oldIdentity, newIdentity.pubKey, gracePeriodSeconds);

    // 3. Broadcast with old key still active.  Best-effort — peers that
    //    miss this heal on next hello (SecurityLayer auto-registers
    //    payload.pubKey from HI).
    if (broadcast && this.#peers) {
      try { await KeyRotation.broadcast(proof, this, this.#peers); }
      catch (err) { this.emit('error', err); }
    }

    // 4. Register the old identity for grace-period inbound decryption,
    //    then swap current.  Order matters: if we swapped first, a
    //    race-arriving peer reply signed by a peer that's been informed
    //    could use our old pubkey as _to and fail.
    this.#security.registerSelfRotation(oldIdentity, graceUntil);
    this.#security.swapIdentity(newIdentity);
    // Group FF+1 — attach the proof inline to every outbound envelope
    // until graceUntil, so peers that missed the broadcast still learn
    // about the rotation on their first post-rotation message from us.
    this.#security.setInlineProof(proof, graceUntil);
    this.#identity = newIdentity;

    this.emit('self-rotated', {
      oldPubKey:   oldIdentity.pubKey,
      newPubKey:   newIdentity.pubKey,
      graceUntil,
      proof,
    });

    return { oldPubKey: oldIdentity.pubKey, newPubKey: newIdentity.pubKey, graceUntil, proof };
  }

  /**
   * Mid-flight identity swap — replace the running agent's keypair
   * with a freshly-supplied AgentIdentity.
   *
   * Unlike `rotateIdentity` (which rotates for unlinkability + emits
   * a signed proof so peers heal smoothly), `swapIdentity` is the
   * **restore** path: a new device has just decoded the user's
   * mnemonic into a different keypair than the one this Agent
   * happens to be running with, and we want to adopt the
   * mnemonic-derived identity NOW without restarting the process.
   *
   * No proof is broadcast (peers haven't heard from this device
   * yet; first envelope they see will carry the new pubKey via the
   * normal HI-ACK).  No grace window (we're abandoning the random
   * keypair we briefly held).
   *
   * Caller is responsible for any app-level resubscription that
   * depends on the agent's address (e.g. `OfferingMatch.start` should
   * be called again to re-bind topics keyed by `agent.address`).
   *
   * @param {AgentIdentity} newIdentity  freshly constructed identity
   * @returns {{oldPubKey: string, newPubKey: string}}
   */
  swapIdentity(newIdentity) {
    if (!newIdentity || !newIdentity.pubKey) {
      throw new TypeError('swapIdentity: newIdentity (AgentIdentity) required');
    }
    const oldPubKey = this.#identity.pubKey;
    const newPubKey = newIdentity.pubKey;
    if (oldPubKey === newPubKey) return { oldPubKey, newPubKey };   // no-op

    // SecurityLayer swap (mirrors what rotateIdentity does, minus
    // the grace-period / inline-proof bookkeeping — this is a
    // wholesale replace, not a rotation with linkability).
    this.#security.swapIdentity(newIdentity);
    this.#identity = newIdentity;

    this.emit('self-swapped', { oldPubKey, newPubKey });
    return { oldPubKey, newPubKey };
  }

  /**
   * Opt-in: register the 'relay-forward' skill so trusted peers can ask us
   * to forward their messages to third parties we can reach directly.
   * Idempotent — calling twice does nothing the second time.
   *
   * @param {object} [opts]
   * @param {'never'|'authenticated'|'trusted'|`group:${string}`|'always'} [opts.policy]
   *        Override for the allowRelayFor policy. Otherwise pulls from
   *        agent.config.get('policy.allowRelayFor') and then 'never'.
   */
  enableRelayForward(opts = {}) {
    if (this.#skills.get('relay-forward')) return this;
    if (opts.policy !== undefined && this.#config?.set) {
      this.#config.set('policy.allowRelayFor', opts.policy);
    }
    registerRelayForward(this, opts);
    return this;
  }

  /**
   * Opt-in: register the `tunnel-open` + `tunnel-ow` skills so this agent
   * can act as a bridge for a hop-aware task tunnel (Group CC).  Unlike
   * `enableRelayForward` which gives callers a one-shot await-for-terminal
   * hop, a tunnel is bidirectional for the task's lifetime — streaming,
   * input-required, and cancel flow through the bridge transparently.
   *
   * See Design-v3/hop-tunnel.md.
   *
   * @param {object} [opts]
   * @param {'never'|'authenticated'|'trusted'|`group:${string}`|'always'} [opts.policy]
   *        Override for the allowTunnelFor policy. Otherwise pulls from
   *        `agent.config.get('policy.allowTunnelFor')` → `allowRelayFor` → 'never'.
   * @returns {this}
   */
  enableTunnelForward(opts = {}) {
    if (this.#skills.get('tunnel-open')) return this;
    if (opts.policy !== undefined && this.#config?.set) {
      this.#config.set('policy.allowTunnelFor', opts.policy);
    }
    registerTunnelOpen(this, opts);
    registerTunnelOw(this);
    return this;
  }

  /**
   * Opt-in: register the `reachable-peers` skill so callers can cache a
   * signed list of who this agent can reach directly. Used by the oracle
   * bridge-selection path in invokeWithHop.
   *
   * Each option resolves as: explicit arg → `agent.config.get('oracle.<name>')`
   * → built-in default. Calling twice is a no-op.
   *
   * See Design-v3/oracle-bridge-selection.md.
   *
   * @param {object} [opts]
   * @param {number} [opts.ttlMs]              Validity window of each claim (default 5 min)
   * @param {number} [opts.refreshBeforeMs]    Re-sign when this much TTL remains (default 60 s)
   * @param {number} [opts.maxPeers]           Truncate peer list to this size (default 256)
   * @param {object} [opts.seqStore]           Custom { read, write } store for monotonic `s`
   */
  enableReachabilityOracle(opts = {}) {
    if (this.#skills.get('reachable-peers')) return this;
    registerReachablePeersSkill(this, opts);
    return this;
  }

  // ── Rendezvous (Group AA) ─────────────────────────────────────────────────

  /**
   * Opt-in: enable WebRTC rendezvous on this agent.
   *
   * Creates a `RendezvousTransport` that uses `signalingTransport` (typically
   * the relay) for SDP / ICE exchange and moves data onto a direct
   * DataChannel once a peer accepts. Idempotent — the second call returns
   * the same transport.
   *
   * When `auto: true`, the agent listens for `peer` events and — if the
   * remote peer advertised `capabilities.rendezvous === true` in the hello
   * payload — kicks off `upgradeToRendezvous(peer)` in the background.
   *
   * On DataChannel open, the routing layer pins rendezvous as the preferred
   * transport for that peer. On close, the pin is cleared and subsequent
   * sends fall back to priority order (typically the relay). No retry loop
   * inside the transport — the next hello re-arms the upgrade.
   *
   * Ref: Design-v3/rendezvous-mode.md.
   *
   * The concrete `RendezvousTransport` lives OUTSIDE the kernel (it will move to
   * `@onderling/transports`); the caller supplies it as a built instance or a factory, so the
   * kernel depends only on the transport port. The `@onderling/sdk` facade / `createMeshAgent`
   * wire the concrete for you.
   *
   * @param {object}  opts
   * @param {object}  [opts.transport]           — a pre-built rendezvous transport, OR
   * @param {(o:object)=>object} [opts.makeTransport] — factory: `({signalingTransport,identity,rtcLib,iceServers}) => transport`
   * @param {import('./transport/Transport.js').Transport} [opts.signalingTransport] — passed to makeTransport
   * @param {object}  [opts.rtcLib]       — passed to makeTransport
   * @param {object[]} [opts.iceServers]  — passed to makeTransport
   * @param {boolean} [opts.auto=false]   — auto-upgrade on capability match
   * @returns {object} the rendezvous transport
   */
  enableRendezvous(opts = {}) {
    const existing = this.#transports.get('rendezvous');
    if (existing) return existing;

    const rdv = opts.transport ?? (typeof opts.makeTransport === 'function'
      ? opts.makeTransport({
          signalingTransport: opts.signalingTransport,
          identity:           this.#identity,
          rtcLib:             opts.rtcLib,
          iceServers:         opts.iceServers,
        })
      : null);
    if (!rdv) {
      throw new Error('enableRendezvous: pass a built { transport } or a { makeTransport } factory — the kernel no longer bundles RendezvousTransport (it lives in @onderling/transports / the @onderling/sdk facade)');
    }
    this.addTransport('rendezvous', rdv);
    this._rendezvousEnabled = true;

    // Hook: DataChannel opened → pin rendezvous as the preferred transport
    // for this peer. Also emit a user-visible event.
    rdv.on('peer-connected', (peerAddress) => {
      if (this.#routing?.setPreferredTransport) {
        this.#routing.setPreferredTransport(peerAddress, 'rendezvous');
      }
      this.emit('rendezvous-upgraded', { peer: peerAddress });
    });

    // Hook: DataChannel closed → clear the pin, fall back to relay.
    rdv.on('peer-disconnected', (peerAddress) => {
      if (this.#routing?.clearPreferredTransport) {
        this.#routing.clearPreferredTransport(peerAddress);
      }
      this.emit('rendezvous-downgraded', { peer: peerAddress, reason: 'channel-closed' });
    });

    // Auto-upgrade on hello if the peer advertises the flag.
    if (opts.auto) {
      this.on('peer', async ({ address, capabilities }) => {
        if (!capabilities?.rendezvous) return;
        if (rdv.hasOpenChannelTo(address)) return;       // already up
        try {
          await this.upgradeToRendezvous(address);
        } catch (err) {
          // Don't bubble — fall back to the signalling transport silently.
          this.emit('rendezvous-failed', { peer: address, error: err });
        }
      });
    }

    return rdv;
  }

  /**
   * Attempt to move the data path for `peerPubKey` onto a direct WebRTC
   * DataChannel. Requires `enableRendezvous()` to have been called.
   *
   * @param {string} peerPubKey
   * @param {number} [timeout=30000]
   * @returns {Promise<void>}  resolves when the DataChannel is open
   */
  async upgradeToRendezvous(peerPubKey, timeout) {
    const rdv = this.#transports.get('rendezvous');
    if (!rdv) throw new Error('upgradeToRendezvous: enableRendezvous() not called');
    if (rdv.hasOpenChannelTo(peerPubKey)) return;
    await rdv.connectToPeer(peerPubKey, timeout);
  }

  /**
   * True if the agent currently holds an open DataChannel to the given peer.
   *
   * @param {string} peerPubKey
   * @returns {boolean}
   */
  isRendezvousActive(peerPubKey) {
    const rdv = this.#transports.get('rendezvous');
    return !!(rdv && rdv.hasOpenChannelTo(peerPubKey));
  }

  // ── Sealed forwarding (Group BB) ──────────────────────────────────────────

  /**
   * Opt-in: enable blind relay-forwarding for messages scoped to `groupId`.
   *
   * When enabled, outbound `invokeWithHop(target, skill, parts, { group:
   * groupId })` builds a `nacl.box` sealed payload addressed to the target
   * and hands it to the bridge as an opaque blob — the bridge sees
   * `{ target, sealed }` and never reads skill id or parts. The target
   * opens the seal via `relay-receive-sealed`, verifies the origin sig
   * (Group Z), and dispatches the inner skill.
   *
   * Direct delivery bypasses sealing entirely; per-group opt-in means
   * private networks pay zero overhead.
   *
   * Ref: Design-v3/blind-forward.md.
   *
   * @param {string} groupId
   * @param {object} [opts]  — reserved for future knobs (pathLength, etc.)
   * @returns {this}
   */
  enableSealedForwardFor(groupId, opts = {}) {
    if (typeof groupId !== 'string' || !groupId) {
      throw new Error('enableSealedForwardFor: groupId required');
    }
    if (!this.#sealedConfigs) this.#sealedConfigs = new Map();
    this.#sealedConfigs.set(groupId, { enabled: true, ...opts });
    return this;
  }

  /** @param {string} groupId */
  disableSealedForwardFor(groupId) {
    if (this.#sealedConfigs) this.#sealedConfigs.delete(groupId);
    return this;
  }

  /**
   * @param {string} groupId
   * @returns {{ enabled: boolean }|null}  null if the group has no entry.
   */
  getSealedForwardConfig(groupId) {
    return this.#sealedConfigs?.get(groupId) ?? null;
  }

  /**
   * Opt-in: install a hello-gate predicate. An inbound HI is handled
   * normally only when the gate returns `true`. On `false` (or a thrown
   * error) the HI is silently dropped — no ack, no `peer` event, no
   * SecurityLayer registration. From the sender's perspective the result
   * is indistinguishable from being offline.
   *
   * Default (no gate set) accepts all hellos (backward-compatible).
   *
   * See packages/core/src/security/helloGates.js for ready-made gates
   * (tokenGate, groupGate, anyOf) and Design-v3 "layered hello" + Group W.
   *
   * @param {null | ((envelope: object) => boolean | Promise<boolean>)} fn
   */
  setHelloGate(fn) {
    if (fn !== null && typeof fn !== 'function') {
      throw new Error('setHelloGate: argument must be a function or null');
    }
    this.#helloGate = fn;
    return this;
  }

  /** The currently-installed hello gate, or null. */
  get helloGate() { return this.#helloGate; }

  /**
   * Opt-in: start the ping + gossip loops (PeerDiscovery). Also registers
   * the 'peer-list' skill.  Idempotent — second call is a no-op.
   *
   * @param {object} [opts]
   * @param {number} [opts.pingIntervalMs=30000]
   * @param {number} [opts.gossipIntervalMs=60000]
   * @param {number} [opts.maxGossipPeers=8]
   * @returns {import('./discovery/PeerDiscovery.js').PeerDiscovery}
   */
  startDiscovery(opts = {}) {
    if (this.#discovery) return this.#discovery;
    this.#discovery = new PeerDiscovery({
      agent:           this,
      peerGraph:       this.#peers,
      pingIntervalMs:  opts.pingIntervalMs,
      gossipIntervalMs: opts.gossipIntervalMs,
      maxGossipPeers:  opts.maxGossipPeers,
    });
    this.#discovery.start();
    return this.#discovery;
  }

  /** The active PeerDiscovery instance, if startDiscovery() has been called. */
  get discovery() { return this.#discovery; }

  /**
   * Opt-in: for every attached transport, automatically hello any peer that
   * is discovered, optionally followed by a peer-list pull. Covers the glue
   * every mesh app writes today (see EXTRACTION-PLAN.md §3).
   *
   * Behaviour per `peer-discovered` event:
   *   • If the address contains ':' — it's a BLE MAC. Send a raw HI frame via
   *     the 'ble' transport (one per MAC, deduplicated).
   *   • Otherwise it's a pubKey. Skip if SecurityLayer already has the key;
   *     otherwise call agent.hello(). If opts.pullPeers, follow up with
   *     pullPeerList() to populate indirect peers in the graph.
   *
   * Idempotent — subsequent calls update opts but don't re-bind listeners.
   * Safe to call before or after addTransport(...) — transports added later
   * pick up the handler via addTransport() above.
   *
   * @param {object}  [opts]
   * @param {boolean} [opts.pullPeers=false]
   * @param {number}  [opts.helloTimeout=15000]
   */
  enableAutoHello(opts = {}) {
    this.#autoHelloOpts = {
      pullPeers:    !!opts.pullPeers,
      helloTimeout: opts.helloTimeout ?? 15_000,
    };
    for (const t of this.#transports.values()) this.#bindAutoHello(t);
    return this;
  }

  #bindAutoHello(transport) {
    if (this.#autoHelloBound.has(transport)) return;
    this.#autoHelloBound.add(transport);

    transport.on('peer-discovered', async (peerAddress) => {
      if (!this.#autoHelloOpts) return;           // disabled between discovery and handler
      if (!peerAddress) return;
      try {
        if (typeof peerAddress === 'string' && peerAddress.includes(':')) {
          // BLE MAC — send raw HI, dedup per MAC.
          if (this.#autoHelloedMacs.has(peerAddress)) return;
          this.#autoHelloedMacs.add(peerAddress);
          const bleTransport = this.getTransport('ble');
          if (bleTransport) {
            await bleTransport.sendHello(peerAddress, {
              pubKey: this.pubKey,
              label:  this.#label ?? null,
              ack:    false,
            });
          }
          return;
        }

        // pubKey — skip if SecurityLayer already knows them.
        if (this.#security.getPeerKey(peerAddress)) return;

        await this.hello(peerAddress, this.#autoHelloOpts.helloTimeout);

        if (this.#autoHelloOpts.pullPeers) {
          pullPeerList(this, peerAddress).catch(() => {});
        }
      } catch (err) {
        this.emit('auto-hello-error', { peer: peerAddress, error: err });
      }
    });
  }

  /**
   * Send a one-way message (OW). No delivery confirmation.
   */
  async message(peerId, partsOrValue) {
    await this.#transport.sendOneWay(peerId, {
      type:  'message',
      parts: Parts.wrap(partsOrValue),
    });
  }

  /**
   * Forward a peer's contact card to another peer (introduction).
   * The recipient can then use the card to initiate hello.
   *
   * @param {string} peerId   — who receives the introduction
   * @param {object} card     — { pubKey, address, label?, skills? }
   */
  async introduce(peerId, card) {
    await this.#transport.sendOneWay(peerId, {
      type: 'introduction',
      card,
    });
  }

  /**
   * Fetch and register an A2A agent by its base URL.
   * Upserts into agent.peers (PeerGraph) if available.
   *
   * @param {string} url  — base URL, e.g. 'https://agent.example.com'
   * @returns {Promise<object>}  — the A2A peer record
   */
  async discoverA2A(url, opts = {}) {
    const { discoverA2A: _discover } = await import('./a2a/a2aDiscover.js');
    return _discover(this, url, { peerGraph: this.#peers, ...opts });
  }

  /**
   * Issue a signed capability token granting a native peer access to a skill.
   *
   * @param {object} opts
   * @param {string}  opts.subject      — recipient pubKey (base64url)
   * @param {string}  opts.skill        — skill id, or '*' for all
   * @param {number}  [opts.expiresIn]  — seconds (default 86400)
   * @param {object}  [opts.constraints]
   * @param {object}  [opts.parentToken]
   * @returns {Promise<import('./permissions/CapabilityToken.js').CapabilityToken>}
   */
  async issueCapabilityToken(opts = {}) {
    const { CapabilityToken } = await import('./permissions/CapabilityToken.js');
    return CapabilityToken.issue(this.#identity, {
      agentId: this.pubKey,
      ...opts,
    });
  }

  /**
   * Issue a JWT capability token for an A2A peer.
   *
   * @param {object} opts — same as issueCapabilityToken
   * @returns {Promise<string>}  — signed JWT string
   */
  async issueA2ACapabilityToken(opts = {}) {
    const { CapabilityToken } = await import('./permissions/CapabilityToken.js');
    return CapabilityToken.issueJWT(this.#identity, {
      agentId: this.pubKey,
      ...opts,
    });
  }

  /**
   * Store an outbound Bearer token for an A2A peer URL.
   * Used by A2AAuth.buildHeaders when calling that peer.
   *
   * @param {string} peerUrl
   * @param {string} token
   */
  async storeA2AToken(peerUrl, token) {
    const vault = this.#identity._vault ?? this.#identity.vault;
    if (!vault) throw new Error('No vault available on identity');
    await vault.set(`a2a-token:${peerUrl}`, token);
  }

  /**
   * Request the skill list from a peer.
   * @returns {Promise<Array>}
   */
  async discoverSkills(peerId, timeout) {
    const { requestSkills } = await import('./protocol/skillDiscovery.js');
    return requestSkills(this, peerId, timeout);
  }

  /**
   * Publish to all subscribed peers.
   */
  async publish(topic, partsOrValue) {
    const { publish: _publish } = await import('./protocol/pubSub.js');
    return _publish(this, topic, partsOrValue);
  }

  /**
   * Clear stored pub/sub history.
   * @param {string} [topic]
   */
  clearPubSubHistory(topic) {
    if (topic) {
      this._pubSubHistory?.delete(topic);
    } else {
      this._pubSubHistory?.clear();
    }
    return this;
  }

  /**
   * Export this agent as a plain object (no secrets).
   * Suitable for serialisation, QR codes, or card sharing.
   *
   * With no argument, returns the agent's own view (all non-private,
   * enabled skills). Pass `{ callerPubKey }` to filter group-visible
   * skills the way they'd appear to that caller — non-members don't
   * see hidden skills; with `default: 'visible'` they show up but the
   * call path still rejects them as `Unknown skill`.
   *
   * @param {{ callerPubKey?: string, tier?: string }} [opts]
   */
  async export(opts = {}) {
    const callerPubKey = opts.callerPubKey ?? null;
    const tier         = opts.tier         ?? 'authenticated';

    // Self-view: no caller constraint; show all non-private skills.
    let visibleSkills;
    if (!callerPubKey) {
      visibleSkills = this.#skills.all()
        .filter(s => s.visibility !== 'private' && s.enabled);
    } else {
      const gm = this.#security?.groupManager;
      visibleSkills = await this.#skills.forCaller({
        tier,
        callerPubKey,
        checkGroup: gm ? (pk, gid) => gm.hasValidProof(pk, gid) : undefined,
      });
      visibleSkills = visibleSkills.filter(s => s.enabled);
    }

    const skills = visibleSkills.map(s => ({
      id:          s.id,
      description: s.description,
      inputModes:  s.inputModes,
      outputModes: s.outputModes,
      tags:        s.tags,
      streaming:   s.streaming,
      visibility:  s.visibility,
    }));

    return {
      pubKey:  this.pubKey,
      address: this.address,
      label:   this.#label ?? null,
      skills,
      transports: [...this.#transports.entries()].map(([name, t]) => ({
        name,
        address: t.address,
      })),
    };
  }

  // ── Static factory methods ────────────────────────────────────────────────

  /**
   * Create a new agent with a freshly generated identity.
   *
   * @param {object} opts
   * @param {import('./transport/Transport.js').Transport} opts.transport
   * @param {import('@onderling/vault').Vault}          opts.vault      — required Vault port (inject a concrete)
   * @param {string}                                        [opts.label]
   * @param {object}                                        rest            — any other Agent constructor options
   * @returns {Promise<Agent>}
   */
  static async createNew({ transport, vault, label, ...rest } = {}) {
    if (!transport) throw new Error('Agent.createNew requires transport');
    if (!vault)     throw new Error('Agent.createNew requires a vault — inject a Vault port (the @onderling/sdk facade supplies a VaultMemory default)');
    const { AgentIdentity }  = await import('./identity/AgentIdentity.js');
    const identity           = await AgentIdentity.generate(vault);
    return new Agent({ identity, transport, label, ...rest });
  }

  /**
   * Restore an agent from an existing vault (private key must already be stored).
   *
   * @param {object} opts
   * @param {import('./transport/Transport.js').Transport} opts.transport
   * @param {import('@onderling/vault').Vault}          opts.vault
   * @returns {Promise<Agent>}
   */
  static async restore({ transport, vault, ...rest } = {}) {
    if (!transport) throw new Error('Agent.restore requires transport');
    if (!vault)     throw new Error('Agent.restore requires vault');
    const { AgentIdentity } = await import('./identity/AgentIdentity.js');
    const identity          = await AgentIdentity.restore(vault);
    return new Agent({ identity, transport, ...rest });
  }

  /**
   * Restore an agent from a BIP39 mnemonic.
   * The same mnemonic always produces the same keypair.
   *
   * @param {string} mnemonic
   * @param {object} opts
   * @param {import('./transport/Transport.js').Transport} opts.transport
   * @param {import('@onderling/vault').Vault}          [opts.vault]
   * @returns {Promise<Agent>}
   */
  static async restoreFromMnemonic(mnemonic, { transport, vault, ...rest } = {}) {
    if (!transport) throw new Error('Agent.restoreFromMnemonic requires transport');
    if (!vault)     throw new Error('Agent.restoreFromMnemonic requires a vault — inject a Vault port');
    const { AgentIdentity } = await import('./identity/AgentIdentity.js');
    const identity          = await AgentIdentity.fromMnemonic(mnemonic, vault);
    return new Agent({ identity, transport, ...rest });
  }

  /**
   * Create an agent from a plain config object.
   *
   * The object shape follows the YAML agent file format (agent.* fields):
   * {
   *   label?: string,
   *   connections?: { relay?: { url }, nkn?: {}, mqtt?: { broker } },
   *   skills?: object[],       // registered after construction
   * }
   * The caller must supply transport (or connections) and optionally vault.
   *
   * @param {object} obj
   * @param {object} opts
   * @param {import('./transport/Transport.js').Transport} [opts.transport]
   * @param {import('@onderling/vault').Vault}          [opts.vault]
   * @returns {Promise<Agent>}
   */
  static async fromPlainObject(obj, { transport, vault, ...rest } = {}) {
    if (!vault) throw new Error('Agent.fromPlainObject requires a vault — inject a Vault port');
    const { AgentIdentity } = await import('./identity/AgentIdentity.js');
    const { AgentConfig }   = await import('./config/AgentConfig.js');

    const agentSection = obj.agent ?? obj;

    // Try restore first (existing key in vault), else generate
    let identity;
    try {
      identity = await AgentIdentity.restore(vault);
    } catch {
      identity = await AgentIdentity.generate(vault);
    }

    // Transport is injected (the kernel no longer builds concrete transports from a
    // `connections` config — that lived in the now-removed _buildTransportFromConnections).
    const resolvedTransport = transport;
    if (!resolvedTransport) throw new Error('Agent.fromPlainObject requires transport');

    const config = new AgentConfig({ file: agentSection });

    const agent = new Agent({
      identity,
      transport: resolvedTransport,
      label: agentSection.label ?? agentSection.id ?? null,
      config,
      ...rest,
    });

    return agent;
  }

  /**
   * Create an agent from a JSON string.
   * @param {string} json
   * @param {object} [opts]  — same as fromPlainObject opts
   */
  static async fromJson(json, opts = {}) {
    let obj;
    try { obj = JSON.parse(json); }
    catch (e) { throw new Error(`Agent.fromJson: invalid JSON — ${e.message}`); }
    return Agent.fromPlainObject(obj, opts);
  }

  /**
   * Create an agent from a YAML string.
   * Requires js-yaml to be available (import or CDN).
   * Falls back to JSON parsing if the string is valid JSON.
   *
   * @param {string} yaml
   * @param {object} [opts]
   */
  static async fromYaml(yaml, opts = {}) {
    // Try JSON first (YAML is a superset of JSON)
    let obj;
    try { obj = JSON.parse(yaml); }
    catch {
      // Try dynamic import of js-yaml (must be available in the environment)
      let jsYaml;
      try {
        jsYaml = (await import('js-yaml')).default ?? (await import('js-yaml'));
      } catch {
        throw new Error(
          'Agent.fromYaml: js-yaml not available. ' +
          'Install js-yaml (npm/esm.sh) or pass pre-parsed object to Agent.fromPlainObject().'
        );
      }
      obj = jsYaml.load(yaml);
    }
    return Agent.fromPlainObject(obj, opts);
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  /**
   * Internal: return a context object for invokeAgentSkill when an override transport
   * is needed.  Not part of the public API.
   */
  _asCallCtx() { return this; }

  // ── Inbound dispatch ──────────────────────────────────────────────────────

  _dispatch(envelope) {
    // Group FF+1 — if SecurityLayer auto-migrated this peer via an
    // inline rotation proof, mirror the migration into PeerGraph +
    // TrustRegistry and emit `peer-rotated` so UIs + gossip see the new
    // pubkey.  We only do this ONCE per proof (dedup on newPubKey) so
    // subsequent envelopes within the grace window don't re-upsert.
    if (envelope._rotationMigrated) {
      const { oldPubKey, newPubKey, proof } = envelope._rotationMigrated;
      if (!this.#rotationInlineSeen.has(newPubKey)) {
        this.#rotationInlineSeen.add(newPubKey);
        migratePeerGraph(this, proof).catch(err => this.emit('error', err));
        if (this.trustRegistry) {
          KeyRotation.applyToRegistry(proof, this.trustRegistry, { removeOld: false })
            .catch(err => this.emit('error', err));
        }
        this.emit('peer-rotated', {
          oldPubKey, newPubKey,
          from:       envelope._from,
          inGrace:    true,
          via:        'inline-proof',
          issuedAt:   proof.issuedAt,
          gracePeriod: proof.gracePeriod,
        });
      }
    }

    switch (envelope._p) {

      case P.HI:
        handleHello(this, envelope).catch(err => this.emit('error', err));
        break;

      case P.RQ:
        handleTaskRequest(this, envelope)
          .then(handled => {
            if (handled) return;
            return handleSkillDiscovery(this, envelope);
          })
          .then(handled => {
            if (!handled) this.emit('envelope', envelope);
          })
          .catch(err => this.emit('error', err));
        break;

      case P.OW:
      case P.AS: {
        // Group FF: peer key-rotation notifications arrive as OW envelopes
        // with payload.type === 'key-rotation'. Intercepting here keeps
        // rotation safety-critical (always-on, no opt-in) and out of the
        // skill registry (rotation is protocol-level, not an app skill).
        if (handleKeyRotationOW(this, envelope)) break;
        if (handleTaskOneWay(this, envelope)) break;
        if (handlePubSub(this, envelope)) break;
        handleMessage(this, envelope);
        break;
      }

      case P.PB:
        this.emit('publish', {
          from:  envelope._from,
          topic: envelope._topic ?? envelope.payload?.topic,
          parts: envelope.payload?.parts ?? [],
        });
        break;

      default:
        this.emit('envelope', envelope);
    }
  }
}

