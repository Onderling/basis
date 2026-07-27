/**
 * ToggleableTransport — wraps a real Transport instance with an
 * `enabled: boolean` flag.  When disabled, every primitive
 * (sendOneWay, sendAck, request, respond, sendHello, _put) rejects
 * synchronously with `TRANSPORT_DISABLED`; inbound delivery is also
 * suppressed so a partition is bidirectional.
 *
 * This is the chaos primitive used by:
 *   - `Lab.dropTransport(agentName, transportName)`
 *   - `Lab.partitionMesh(groups)`
 *   - `Lab.injectLatency(a, b, ms)` (uses delay rather than disable)
 *
 * Implementation note — composition, not inheritance.  Wrapping a
 * Transport via subclassing breaks because the base Transport stores
 * pending-reply promises in a private field on `#wrapped` (the original
 * instance).  We cannot move them.  Instead we keep `#wrapped` intact
 * (Agent's existing wiring still hits its `_receive`, `setReceiveHandler`,
 * useSecurityLayer, etc.) and intercept by overriding the public
 * primitives at the wrapped object via a Proxy + monkey-patching.
 *
 * The simpler approach we use here: ToggleableTransport is a separate
 * object that holds a reference to the wrapped Transport and forwards
 * to it.  Lab keeps a registry of ToggleableTransports and toggles them
 * directly; the underlying wrapped Transport remains the one Agent
 * interacts with.  When `enabled === false`, ToggleableTransport's
 * forwarders throw, AND Lab additionally muzzles the wrapped transport
 * by intercepting its `_send` (the SecurityLayer-applying private
 * helper that all four primitives flow through).  We muzzle by
 * monkey-patching `_send` on the wrapped instance.
 *
 * This way, even code that bypasses the wrapper (e.g. Agent's
 * dispatch loop calling `transport.sendOneWay`) hits the muzzle.
 */

const TRANSPORT_DISABLED = () =>
  Object.assign(new Error('Transport disabled by chaos'), {
    code: 'TRANSPORT_DISABLED',
  });

export class ToggleableTransport {
  #wrapped;
  #originalSend;
  #originalReceive;
  #originalCanReach;
  #enabled = true;
  #latencyMs = 0;
  #name;

  /**
   * @param {string}                                                    name             — e.g. 'internal' or 'relay'
   * @param {import('@onderling/core').Transport}                        wrappedTransport — the real Transport instance
   */
  constructor(name, wrappedTransport) {
    if (!wrappedTransport) {
      throw new Error('ToggleableTransport: wrappedTransport is required');
    }
    this.#name    = name;
    this.#wrapped = wrappedTransport;

    // Monkey-patch the wrapped transport's `_send` helper.  Every public
    // primitive (sendOneWay, sendAck, request, respond, sendHello) flows
    // through `_send`, so a single intercept covers all outbound paths.
    this.#originalSend = wrappedTransport._send.bind(wrappedTransport);
    wrappedTransport._send = async (to, envelope) => {
      if (!this.#enabled) throw TRANSPORT_DISABLED();
      if (this.#latencyMs > 0) {
        await new Promise((r) => setTimeout(r, this.#latencyMs));
      }
      return this.#originalSend(to, envelope);
    };

    // Inbound muzzle: monkey-patch `_receive` so disabled transports also
    // refuse to deliver envelopes that arrive on them.  Symmetric drop.
    this.#originalReceive = wrappedTransport._receive.bind(wrappedTransport);
    wrappedTransport._receive = (rawEnvelope) => {
      if (!this.#enabled) return;  // silently drop
      // No latency on receive — the sender already paid the latency cost.
      return this.#originalReceive(rawEnvelope);
    };

    // Reachability muzzle: a disabled transport must also SAY it cannot reach anyone.
    //
    // The `_send`/`_receive` patches only cover traffic that reaches the wire, and not all of it does:
    // `invokeAgentSkill` has an in-process fast path that runs a skill directly when both agents share a
    // bus. It consults `canReach` (and nothing else) before taking that shortcut, so without this a
    // partitioned pair kept talking and every chaos scenario silently passed. Muzzling the wire without
    // muzzling the claim is what made `partitionMesh` and `dropTransport` look correct while doing nothing.
    this.#originalCanReach = wrappedTransport.canReach?.bind(wrappedTransport) ?? (() => true);
    wrappedTransport.canReach = (peerAddress) => {
      if (!this.#enabled) return false;
      return this.#originalCanReach(peerAddress);
    };
  }

  /** The wrapped transport name in the agent's transports map. */
  get name() {
    return this.#name;
  }

  /** The underlying Transport (Agent uses this, not the wrapper). */
  get wrapped() {
    return this.#wrapped;
  }

  /** Is the transport currently delivering messages? */
  get enabled() {
    return this.#enabled;
  }

  /** Enable the transport (delivery resumes). */
  enable() {
    this.#enabled = true;
  }

  /** Disable the transport (every primitive throws TRANSPORT_DISABLED). */
  disable() {
    this.#enabled = false;
  }

  /** Set per-edge latency in ms.  0 = instant (default). */
  setLatency(ms) {
    if (typeof ms !== 'number' || ms < 0) {
      throw new Error('ToggleableTransport.setLatency: ms must be a non-negative number');
    }
    this.#latencyMs = ms;
  }

  /** Restore the wrapped transport's original `_send` / `_receive` / `canReach`. */
  restore() {
    this.#wrapped._send    = this.#originalSend;
    this.#wrapped._receive = this.#originalReceive;
    this.#wrapped.canReach = this.#originalCanReach;
    this.#enabled = true;
    this.#latencyMs = 0;
  }
}
