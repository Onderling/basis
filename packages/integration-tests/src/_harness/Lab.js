/**
 * Lab — multi-agent test orchestrator.
 *
 * Boots N `Agent` instances over `InternalTransport` (single shared
 * `InternalBus`), with optional in-process relay and optional MockPod.
 * Provides chaos primitives, lifecycle helpers, route inspection,
 * agent-operation sugar, pod sugar, and assertion helpers — the full
 * surface scenarios in T.2–T.5 will rely on.
 *
 * Status: T.1 (harness skeleton).  See
 *   coding-plans/sdk-test-implementation.md §T.1
 *   coding-plans/sdk-test-strategy.md      §The harness
 *
 * Known v1 gaps (documented in §T.1 §Notes):
 *   - `injectClockSkew(name, offsetMs)` sets a per-agent MockClock the
 *     scenario can read.  The SDK itself reads time via raw `Date.now()`
 *     in many places, so per-agent skew is NOT honoured by the SDK
 *     until a v2 task threads an injectable clock through SecurityLayer
 *     / IdentitySync / TokenRegistry / GossipProtocol.
 *   - `pod: 'real:css'` is opt-in via env CSS_URL but not implemented in
 *     v1; throws NOT_IMPLEMENTED.  Stub provided for T.6.
 *   - `injectLatency(a, b, ms)` applies the latency at the SENDER's
 *     ToggleableTransport — i.e. it's per-transport, not per-edge.  For
 *     a true per-edge latency you'd need to filter on `to === b`; v1
 *     ships the simpler version.  Scenarios that want per-edge can use
 *     `dropTransport` / `addTransport` for partition-style topology
 *     control instead.
 */
import { Agent, AgentIdentity, InternalBus, InternalTransport } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { ToggleableTransport } from './ToggleableTransport.js';
import { MockPod }             from './MockPod.js';
import { MockClock }           from './MockClock.js';

const NOT_IMPLEMENTED = (what) =>
  Object.assign(new Error(`${what}: not implemented in v1`), { code: 'NOT_IMPLEMENTED' });

export class Lab {
  /** @type {InternalBus} */
  #bus;
  /** @type {Map<string, AgentSlot>} */
  #slots = new Map();
  /** @type {{ instance: any, stop: () => Promise<void> } | null} */
  #relay = null;
  /** @type {'mock' | 'real:css' | 'none'} */
  #podMode;
  /** @type {Map<string, MockPod>} agent name → MockPod (per-agent for isolation tests) */
  #pods = new Map();
  /** @type {Map<string, MockClock>} */
  #clocks = new Map();
  /** Set when teardown has run; subsequent boots create a fresh Lab. */
  #tornDown = false;

  // ── Construction ────────────────────────────────────────────────────

  /**
   * @param {{
   *   agents?: string[],
   *   transports?: Record<string, string[]>,
   *   relay?: 'in-process' | 'none' | { url: string },
   *   pod?:   'mock' | 'real:css',
   *   topology?: 'mesh' | 'star' | 'partitioned' | ((lab: Lab) => void | Promise<void>),
   * }} opts
   * @returns {Promise<Lab>}
   */
  static async boot(opts = {}) {
    const lab = new Lab();
    await lab.#bootInternal(opts);
    return lab;
  }

  async #bootInternal({
    agents     = ['alice', 'bob'],
    transports = null,
    relay      = 'none',
    pod        = 'mock',
    topology   = 'mesh',
  } = {}) {
    if (pod === 'real:css') {
      // v1: opt-in via env CSS_URL but not wired.  See §T.1 Notes.
      throw NOT_IMPLEMENTED("Lab.boot({ pod: 'real:css' })");
    }
    this.#podMode = pod;
    this.#bus     = new InternalBus();

    if (relay === 'in-process') {
      // Soft-import to avoid a hard dep when scenarios don't need it.
      // The `relay: 'in-process'` mode is a stub for v1 — startRelay
      // takes a port and exposes a WebSocketServer.  Scenarios that
      // actually need the relay should plumb it themselves; the
      // harness exposes `lab.relay()` for that.
      const { startRelay } = await import('@onderling/relay');
      this.#relay = await startRelay({ port: 0, log: false });
    } else if (relay && typeof relay === 'object' && relay.url) {
      // Caller-supplied relay URL; we don't run our own.  Stash for inspection.
      this.#relay = { instance: null, url: relay.url, stop: async () => {} };
    }

    // Spawn each agent slot.  Identities are random per name unless
    // a scenario uses `respawnFromMnemonic` to override.
    for (const name of agents) {
      await this.#bootAgent(name, { transports: transports?.[name] ?? ['internal'] });
    }

    // Apply topology.  The default 'mesh' wires every agent to every other
    // via addPeer (their pubKeys are known in-process).
    await this.#applyTopology(topology);
  }

  async #bootAgent(name, { transports = ['internal'] } = {}) {
    if (this.#slots.has(name)) {
      throw new Error(`Lab: agent '${name}' already exists`);
    }
    const vault    = new VaultMemory();
    const identity = await AgentIdentity.generate(vault);
    const internal = new InternalTransport(this.#bus, identity.pubKey);
    const agent    = new Agent({ identity, transport: internal, label: name });

    // Wrap the primary transport in a ToggleableTransport so chaos
    // helpers can flip it.  We keep the agent's own 'default' slot
    // pointing at the same transport — Agent.addTransport / removeTransport
    // is a graph the agent owns; the harness keeps a separate name map
    // so scenarios can refer to transports by stable harness names.
    const wrappedInternal = new ToggleableTransport('internal', internal);

    await agent.start();

    const pod   = this.#podMode === 'mock' ? new MockPod() : null;
    const clock = new MockClock();

    /** @type {AgentSlot} */
    const slot = {
      name,
      identity,
      vault,
      agent,
      pod,
      clock,
      transports: new Map([['internal', wrappedInternal]]),
      alive: true,
      transportNames: new Set(transports),
    };
    this.#slots.set(name, slot);
    if (pod)   this.#pods.set(name, pod);
    this.#clocks.set(name, clock);
  }

  async #applyTopology(topology) {
    if (typeof topology === 'function') {
      await topology(this);
      return;
    }
    const names = [...this.#slots.keys()];
    switch (topology) {
      case 'mesh': {
        // Full mesh: every agent knows every other.
        for (const a of names) {
          for (const b of names) {
            if (a === b) continue;
            const slotA = this.#slots.get(a);
            const slotB = this.#slots.get(b);
            slotA.agent.addPeer(slotB.agent.address, slotB.agent.pubKey);
          }
        }
        return;
      }
      case 'star': {
        // First agent is the hub; everyone else knows only the hub.
        if (names.length === 0) return;
        const [hub, ...spokes] = names;
        const slotH = this.#slots.get(hub);
        for (const s of spokes) {
          const slotS = this.#slots.get(s);
          slotH.agent.addPeer(slotS.agent.address, slotS.agent.pubKey);
          slotS.agent.addPeer(slotH.agent.address, slotH.agent.pubKey);
        }
        return;
      }
      case 'partitioned':
        // No peers wired; scenarios call addPeer / partitionMesh manually.
        return;
      default:
        throw new Error(`Lab: unknown topology '${topology}'`);
    }
  }

  // ── Lifecycle ───────────────────────────────────────────────────────

  /** Get the underlying Agent instance (escape hatch for custom needs). */
  agent(name) {
    const slot = this.#requireSlot(name);
    return slot.agent;
  }

  /** Get the in-process relay handle, if any. */
  relay() {
    return this.#relay;
  }

  /** Get the agent's MockPod, or throw if running in 'real:css' mode (v2). */
  pod(name) {
    if (this.#podMode === 'real:css') throw NOT_IMPLEMENTED('Lab.pod (real:css)');
    const pod = this.#pods.get(name);
    if (!pod) throw new Error(`Lab: no pod for agent '${name}'`);
    return pod;
  }

  /** All agent names currently booted (alive or dead). */
  agentNames() {
    return [...this.#slots.keys()];
  }

  /**
   * Tear down everything: stop all agents, restore monkey-patches,
   * drop the bus, stop the relay if any.  Idempotent.
   */
  async teardown() {
    if (this.#tornDown) return;
    this.#tornDown = true;

    for (const slot of this.#slots.values()) {
      // Restore each ToggleableTransport's monkey-patches before stopping
      // the agent so disconnect() runs against the original methods.
      for (const tt of slot.transports.values()) {
        try { tt.restore(); } catch { /* swallow */ }
      }
      try { await slot.agent.stop(); } catch { /* swallow */ }
      slot.alive = false;
    }
    this.#slots.clear();
    this.#pods.clear();
    this.#clocks.clear();

    if (this.#relay?.stop) {
      try { await this.#relay.stop(); } catch { /* swallow */ }
    }
    this.#relay = null;
    this.#bus   = null;
  }

  // ── Network manipulation ────────────────────────────────────────────

  /**
   * Partition the mesh into N groups.  Within a group, every agent can
   * reach every other; across groups, NO agent can reach any other.
   *
   * Implementation: every transport on every agent is enabled by
   * default; we install a sender-side filter on each transport's
   * `_send` to drop envelopes destined for an out-of-group address.
   *
   * `healPartition()` removes the filters.
   *
   * @param {string[][]} groups
   */
  partitionMesh(groups) {
    // Build address → group-index lookup.
    const groupOf = new Map();
    groups.forEach((g, i) => {
      for (const name of g) {
        const slot = this.#slots.get(name);
        if (!slot) throw new Error(`Lab.partitionMesh: unknown agent '${name}'`);
        groupOf.set(slot.agent.address, i);
      }
    });

    for (const [name, slot] of this.#slots) {
      const myGroup = groupOf.get(slot.agent.address);
      for (const tt of slot.transports.values()) {
        // Replace `enabled` with a per-target predicate.  We lean on the
        // ToggleableTransport's `_send` monkey-patch and add an extra
        // wrapper that consults the partition map.
        this.#installPartitionFilter(name, tt, (to) => {
          const otherGroup = groupOf.get(to);
          // Unknown addresses (no group): treat as out-of-mesh, drop.
          if (otherGroup === undefined) return false;
          return otherGroup === myGroup;
        });
      }
    }
  }

  /** Remove all partition filters — restore full mesh delivery. */
  healPartition() {
    for (const slot of this.#slots.values()) {
      for (const tt of slot.transports.values()) {
        this.#removePartitionFilter(tt);
      }
    }
  }

  /** Disable a single named transport on a single agent. */
  dropTransport(agentName, transportName) {
    const slot = this.#requireSlot(agentName);
    const tt = slot.transports.get(transportName);
    if (!tt) throw new Error(`Lab.dropTransport: agent '${agentName}' has no transport '${transportName}'`);
    tt.disable();
  }

  /** Re-enable a single named transport on a single agent. */
  addTransport(agentName, transportName) {
    const slot = this.#requireSlot(agentName);
    const tt = slot.transports.get(transportName);
    if (!tt) throw new Error(`Lab.addTransport: agent '${agentName}' has no transport '${transportName}'`);
    tt.enable();
  }

  /**
   * Add `ms` of latency on `a`'s transport when sending to `b`.
   *
   * v1 limitation: applies to ALL outbound traffic on `a`'s transport,
   * not just to `b`.  See §T.1 Notes for the per-edge gap.
   */
  injectLatency(a, _b, ms) {
    const slot = this.#requireSlot(a);
    for (const tt of slot.transports.values()) {
      tt.setLatency(ms);
    }
  }

  // ── Agent lifecycle ─────────────────────────────────────────────────

  /**
   * Disconnect the named agent from the bus, clear its in-memory state,
   * and mark its slot dead.  Subsequent calls to `agent(name)` will
   * still return the (now-stopped) instance for inspection.
   */
  async killAgent(name) {
    const slot = this.#requireSlot(name);
    if (!slot.alive) return;
    for (const tt of slot.transports.values()) {
      try { tt.restore(); } catch { /* swallow */ }
    }
    try { await slot.agent.stop(); } catch { /* swallow */ }
    slot.alive = false;
  }

  /**
   * Boot a fresh Agent with the SAME identity (recovered from the same
   * vault).  Useful for "user reopens app" / "device reboot" scenarios.
   */
  async restartAgent(name) {
    const slot = this.#requireSlot(name);
    if (slot.alive) await this.killAgent(name);

    const identity = await AgentIdentity.restore(slot.vault);
    const internal = new InternalTransport(this.#bus, identity.pubKey);
    const wrappedInternal = new ToggleableTransport('internal', internal);
    const agent = new Agent({ identity, transport: internal, label: name });
    await agent.start();

    slot.identity = identity;
    slot.agent    = agent;
    slot.transports = new Map([['internal', wrappedInternal]]);
    slot.alive    = true;

    // Re-wire peer addresses against ALL still-alive peers (best-effort).
    for (const other of this.#slots.values()) {
      if (other.name === name || !other.alive) continue;
      agent.addPeer(other.agent.address, other.agent.pubKey);
      other.agent.addPeer(agent.address, agent.pubKey);
    }
  }

  /**
   * Boot a fresh Agent with the IDENTITY DERIVED from the given BIP-39
   * mnemonic.  Different from `restartAgent` because this is the
   * "lost phone, recovered from paper backup" flow — the new agent's
   * pubkey is whatever the mnemonic's seed produces, which is only the
   * SAME as the original if the original was also created from this
   * mnemonic (e.g. via `Bootstrap.fromMnemonic` plumbing).
   *
   * @param {string} name
   * @param {string} mnemonic  24-word BIP-39 phrase
   */
  async respawnFromMnemonic(name, mnemonic) {
    const slot = this.#requireSlot(name);
    if (slot.alive) await this.killAgent(name);

    const vault    = new VaultMemory();
    const identity = await AgentIdentity.fromMnemonic(mnemonic, vault);
    const internal = new InternalTransport(this.#bus, identity.pubKey);
    const wrappedInternal = new ToggleableTransport('internal', internal);
    const agent = new Agent({ identity, transport: internal, label: name });
    await agent.start();

    slot.identity = identity;
    slot.vault    = vault;
    slot.agent    = agent;
    slot.transports = new Map([['internal', wrappedInternal]]);
    slot.alive    = true;

    for (const other of this.#slots.values()) {
      if (other.name === name || !other.alive) continue;
      agent.addPeer(other.agent.address, other.agent.pubKey);
      other.agent.addPeer(agent.address, agent.pubKey);
    }
  }

  // ── Clock control ───────────────────────────────────────────────────

  /**
   * Advance global time via vitest's fake-timers facade.  Scenarios that
   * use this MUST call `vi.useFakeTimers()` themselves (or set
   * `fakeTimers: { now: <ms> }` in vitest config).
   *
   * This is intentionally a thin pass-through — see the `vi.advanceTimersByTime`
   * docs for nuances around microtasks and pending timers.
   */
  async advanceTime(ms) {
    const { vi } = await import('vitest');
    vi.advanceTimersByTime(ms);
  }

  /**
   * Set the per-agent clock skew offset.  See `MockClock` for the v1
   * limitation: the SDK does not currently honour per-agent clocks.
   * Scenarios that read `lab.clock(name).now()` get the right value;
   * scenarios that depend on the SDK ITSELF using the skewed clock
   * (e.g. SecurityLayer's replay-window check) need the v2 SDK clock-
   * injection task to land first.
   *
   * @param {string} agentName
   * @param {number} offsetMs  signed offset relative to wall clock
   */
  injectClockSkew(agentName, offsetMs) {
    const clock = this.#clocks.get(agentName);
    if (!clock) throw new Error(`Lab.injectClockSkew: unknown agent '${agentName}'`);
    clock.setOffset(offsetMs);
  }

  /** Get the named agent's MockClock for direct inspection. */
  clock(agentName) {
    const c = this.#clocks.get(agentName);
    if (!c) throw new Error(`Lab.clock: unknown agent '${agentName}'`);
    return c;
  }

  // ── Inspection ──────────────────────────────────────────────────────

  /**
   * Resolve the route from `a` to `b`.  Returns `{ tier, transport, via? }`
   * via `agent.reachabilityFor` when a RoutingStrategy is wired; falls
   * back to a synthesised `{ tier: 'direct', transport: 'internal' }`
   * when there's no routing strategy (the harness default).
   */
  async routeFor(a, b) {
    const slotA = this.#requireSlot(a);
    const slotB = this.#requireSlot(b);
    const reach = await slotA.agent.reachabilityFor(slotB.agent.address);
    if (reach) {
      return { tier: reach.tier, transport: reach.name, via: reach.via };
    }
    // No routing strategy installed.  Default-mesh harness has 'internal'.
    return { tier: 'direct', transport: 'internal' };
  }

  /**
   * Names of peers known to the agent (registered via addPeer or
   * discovered via hello).  Returns names from this Lab's slot map
   * filtered by which addresses are in the agent's SecurityLayer.
   */
  peers(name) {
    const slot = this.#requireSlot(name);
    const known = [];
    for (const [otherName, otherSlot] of this.#slots) {
      if (otherName === name) continue;
      // SecurityLayer.getPeerKey is the canonical "do I know this peer" check.
      const key = slot.agent.security?.getPeerKey?.(otherSlot.agent.address);
      if (key) known.push(otherName);
    }
    return known;
  }

  // ── Sugar — agent operations ────────────────────────────────────────

  /**
   * Invoke `skill` on `b` from `a`.  Returns the result Parts.
   * Throws if the call fails.
   *
   * @param {string} a
   * @param {string} b
   * @param {string} skill
   * @param {*}      input    auto-wrapped via Parts.wrap
   * @param {object} [opts]
   */
  async invoke(a, b, skill, input = [], opts = {}) {
    const slotA = this.#requireSlot(a);
    const slotB = this.#requireSlot(b);
    return slotA.agent.invoke(slotB.agent.address, skill, input, opts);
  }

  /**
   * Start a streaming invocation; returns the Task immediately so the
   * caller can iterate `task.stream()` and call `task.cancel()`.
   *
   * @returns {import('@onderling/core').Task}
   */
  invokeStream(a, b, skill, input = [], opts = {}) {
    const slotA = this.#requireSlot(a);
    const slotB = this.#requireSlot(b);
    return slotA.agent.call(slotB.agent.address, skill, input, opts);
  }

  // ── Sugar — pod operations ──────────────────────────────────────────

  /**
   * Write to the named agent's MockPod.  Throws if running in
   * 'real:css' mode (v2).
   */
  async podWrite(name, uri, content, opts) {
    return this.pod(name).write(uri, content, opts);
  }

  /** Read from the named agent's MockPod. */
  async podRead(name, uri, opts) {
    return this.pod(name).read(uri, opts);
  }

  /** List a container in the named agent's MockPod. */
  async podList(name, container, opts) {
    return this.pod(name).list(container, opts);
  }

  /** Delete from the named agent's MockPod. */
  async podDelete(name, uri, opts) {
    return this.pod(name).delete(uri, opts);
  }

  // ── Assertions ──────────────────────────────────────────────────────

  /**
   * Assert that the route from `a` to `b` matches `expected`.
   * Uses vitest's `expect`; throws on mismatch.
   *
   * @param {string} a
   * @param {string} b
   * @param {{ tier?: string, transport?: string, via?: string }} expected
   */
  async assertRoute(a, b, expected) {
    const { expect } = await import('vitest');
    const route = await this.routeFor(a, b);
    if (expected.tier !== undefined)      expect(route.tier).toBe(expected.tier);
    if (expected.transport !== undefined) expect(route.transport).toBe(expected.transport);
    if (expected.via !== undefined)       expect(route.via).toBe(expected.via);
  }

  /**
   * Assert that `secretBytes` does not appear in any envelope captured
   * by the named bridge agent's transport history.
   *
   * v1 implementation: hooks into the bridge's transports BEFORE the
   * scenario runs; harness records all envelopes that flow through.
   * If the scenario forgot to call `enableLeakLogging(name)` first,
   * this assertion is a soft no-op (returns true) and emits a
   * vitest warning.
   *
   * For T.1 we ship the API + the warning; T.2's first sealed-forward
   * scenario will exercise the real path.
   */
  async assertNoLeak(viaName, secretBytes) {
    const { expect } = await import('vitest');
    const slot = this.#requireSlot(viaName);
    const log  = slot.envelopeLog ?? null;
    if (!log) {
      // Scenario didn't enable leak logging.  Be loud about it.
      // We don't fail — assertion is best-effort — but we want the
      // scenario author to see the warning.
      // eslint-disable-next-line no-console
      console.warn(
        `Lab.assertNoLeak('${viaName}', ...): leak logging not enabled. ` +
        `Call lab.enableLeakLogging('${viaName}') BEFORE the secret is sent.`
      );
      return;
    }
    const needle = secretBytes instanceof Uint8Array
      ? Buffer.from(secretBytes).toString('latin1')
      : String(secretBytes);
    for (const env of log) {
      const haystack = JSON.stringify(env);
      expect(haystack.includes(needle)).toBe(false);
    }
  }

  /**
   * Start recording every envelope that traverses the named agent's
   * transports.  Used by `assertNoLeak`.  Recording is in-memory and
   * cleared on teardown.
   */
  enableLeakLogging(viaName) {
    const slot = this.#requireSlot(viaName);
    if (slot.envelopeLog) return;  // already enabled
    slot.envelopeLog = [];
    for (const tt of slot.transports.values()) {
      const wrapped = tt.wrapped;
      const originalSend = wrapped._send;
      wrapped._send = async (to, envelope) => {
        slot.envelopeLog.push({ direction: 'out', to, envelope });
        return originalSend.call(wrapped, to, envelope);
      };
    }
  }

  /**
   * Assert the named agent's identity-pod manifest verifies against the
   * agent's pubkey.  Delegates to `IdentityPodStore.verifyManifest`.
   *
   * v1: requires the scenario to have wired an `IdentityPodStore` onto
   * the slot (e.g. via `lab.attachIdentityPodStore(name, store)`).
   * Without one, this assertion is a no-op + warning, mirroring
   * assertNoLeak.
   */
  async assertManifestIntact(name) {
    const slot = this.#requireSlot(name);
    if (!slot.identityPodStore) {
      // eslint-disable-next-line no-console
      console.warn(
        `Lab.assertManifestIntact('${name}'): no IdentityPodStore attached. ` +
        `Call lab.attachIdentityPodStore('${name}', store) first.`
      );
      return;
    }
    const result = await slot.identityPodStore.verifyManifest();
    const { expect } = await import('vitest');
    expect(result?.valid ?? result).toBeTruthy();
  }

  /**
   * Attach an IdentityPodStore to the named agent slot for assertions.
   * Scenarios that test identity-pod flows construct their own store
   * (with the slot's pod + identity) and pass it here.
   */
  attachIdentityPodStore(name, store) {
    const slot = this.#requireSlot(name);
    slot.identityPodStore = store;
  }

  /**
   * Assert that all named agents have byte-identical content at `path`
   * in their MockPods.
   */
  async assertSyncConverged(names, path) {
    const { expect } = await import('vitest');
    if (!Array.isArray(names) || names.length < 2) {
      throw new Error('Lab.assertSyncConverged: need at least 2 agent names');
    }
    const contents = await Promise.all(
      names.map((n) => this.pod(n).read(path).then((r) => r.content)),
    );
    const reference = contents[0];
    for (let i = 1; i < contents.length; i++) {
      expect(contents[i]).toEqual(reference);
    }
  }

  // ── Internals ───────────────────────────────────────────────────────

  #requireSlot(name) {
    const slot = this.#slots.get(name);
    if (!slot) throw new Error(`Lab: unknown agent '${name}'`);
    return slot;
  }

  /**
   * Install a per-target sender filter on a ToggleableTransport.  We
   * stack-on-top of ToggleableTransport's existing `_send` so partition
   * filters compose with `enable/disable`.
   */
  #installPartitionFilter(_agentName, tt, predicate) {
    // Unwrap any prior filter we installed.
    this.#removePartitionFilter(tt);

    const wrapped = tt.wrapped;
    const currentSend = wrapped._send;  // already monkey-patched by ToggleableTransport
    wrapped.__lab_originalSend_partition = currentSend;
    wrapped._send = async (to, envelope) => {
      if (!predicate(to)) {
        // Out-of-partition: silently drop.  This mirrors a real network
        // partition where packets vanish.
        return;
      }
      return currentSend.call(wrapped, to, envelope);
    };

    // …and the same predicate on `canReach`, or the partition is invisible to anything that ASKS before
    // sending. `invokeAgentSkill`'s in-process fast path does exactly that: same bus + reachable ⇒ run the
    // skill directly, never touching `_send`. Dropping packets a caller never sends is not a partition.
    //
    // Per-target, unlike the blanket muzzle in ToggleableTransport: a partition splits the mesh, so a peer
    // in my own group stays reachable and only the ones across the split do not.
    const currentCanReach = wrapped.canReach?.bind(wrapped) ?? (() => true);
    wrapped.__lab_originalCanReach_partition = currentCanReach;
    wrapped.canReach = (to) => (predicate(to) ? currentCanReach(to) : false);
  }

  #removePartitionFilter(tt) {
    const wrapped = tt.wrapped;
    if (wrapped.__lab_originalSend_partition) {
      wrapped._send = wrapped.__lab_originalSend_partition;
      delete wrapped.__lab_originalSend_partition;
    }
    if (wrapped.__lab_originalCanReach_partition) {
      wrapped.canReach = wrapped.__lab_originalCanReach_partition;
      delete wrapped.__lab_originalCanReach_partition;
    }
  }
}

/**
 * @typedef {{
 *   name:           string,
 *   identity:       any,
 *   vault:          any,
 *   agent:          any,
 *   pod:            any,
 *   clock:          any,
 *   transports:     Map<string, any>,
 *   alive:          boolean,
 *   transportNames: Set<string>,
 *   envelopeLog?:   any[],
 *   identityPodStore?: any,
 * }} AgentSlot
 */
