/**
 * ┌─ PORT ──────────────────────────────────────────────────────────────────────┐
 * │ `Transport` is the interface a third-party adapter implements to stay        │
 * │ compatible with the @onderling SDK. "Compatible" = *satisfies this port*:        │
 * │ extend this base class, implement `_put(to, envelope)`, and the inherited     │
 * │ primitives (send/request/ack/hello + reply-correlation + auto-ACK) work       │
 * │ unchanged. Reference adapters: `InternalTransport` (in @onderling/core) and       │
 * │ Nkn/Mqtt/Relay/Rendezvous (in @onderling/transports). Prove conformance with     │
 * │ `assertTransportConformance()` (test/conformance/transportConformance.js).    │
 * └──────────────────────────────────────────────────────────────────────────────┘
 *
 * Transport base class.
 *
 * Provides the four interaction primitives as default envelope-based
 * implementations. Subclasses implement only _put(to, envelope).
 *
 * SecurityLayer is applied around _put (outbound) and _receive (inbound).
 * It is optional in Phase 1 tests but mandatory in production agents.
 *
 * Auto-ACK: AS (AckSend) envelopes are automatically acknowledged at the
 * transport level — the receiver's transport sends AK before dispatching
 * the payload to the application layer.
 *
 * ── The port contract (what an adapter must provide/uphold) ────────────────────
 *
 * REQUIRED to implement (override):
 *   • `_put(to, envelope) → Promise<void>`
 *       Put one (already-encrypted, or HI-plaintext) envelope on the wire toward
 *       `to`. The ONLY method a minimal adapter must override. Reject the promise
 *       if the envelope cannot be handed to the wire.
 *
 * SHOULD override when the transport is not address-agnostic:
 *   • `connect() → Promise<void>` / `disconnect() → Promise<void>`
 *       Establish / tear down the underlying channel. Default: no-op.
 *   • `canReach(peerAddress) → boolean`
 *       Whether this transport can deliver to `peerAddress` right now. Default:
 *       `true` (address-agnostic once connected). Peer-scoped transports (e.g.
 *       Rendezvous) must return `true` only for peers with a live channel.
 *   • `forgetPeer(address) → void`
 *       Drop cached per-peer state. Default: no-op.
 *
 * PROVIDED by this base (do NOT re-implement — call, don't override):
 *   • `sendOneWay(to, payload, opts?)` — OW, fire-and-forget. `opts.from` sends as one of our
 *     extra addresses (per-circle); every primitive below takes the same option.
 *   • `publishOneWay(to, topic, payload)` — OW with a wire-level topic hint.
 *   • `sendAck(to, payload, timeout?) → Promise<AK envelope>` — deliver + await AK.
 *   • `request(to, payload, timeout?) → Promise<RS envelope>` — RQ + await RS.
 *   • `respond(to, replyToId, payload)` — RS reply to a prior RQ.
 *   • `sendHello(to, payload)`       — HI, signed plaintext introduction.
 *   • `publishEnvelope({kind, recipients, …})` / `subscribeEnvelopes(cb)` — the
 *     notification-envelope fan-out (Phase 50.7).
 *   • `setReceiveHandler(fn)` / `get receiveHandler` — inbound dispatch wiring.
 *   • `useSecurityLayer(layer)` / `get securityLayer` — outbound/inbound crypto.
 *   • `get address` / `get identity` — this transport's wire address + identity.
 *
 * LIFECYCLE CONTRACT the base enforces on top of `_put` (an adapter gets these
 * for free once `_put` and inbound `_receive(rawEnvelope)` are wired):
 *   1. Reply correlation — `request`/`sendAck` register a pending promise keyed by
 *      the outbound envelope `_id`; an inbound RS/AK with a matching `_re` resolves
 *      it (and is NOT dispatched to the application handler).
 *   2. Auto-ACK — an inbound AS envelope is acknowledged (AK sent back to `_from`)
 *      before the AS is also dispatched to the application handler.
 *   3. Dispatch — every other inbound envelope goes to the `receiveHandler` (or is
 *      emitted as an `'envelope'` event when no handler is set).
 *
 * An adapter's inbound path MUST call `this._receive(rawEnvelope)` for each
 * envelope it pulls off the wire so the base can run steps 1–3.
 */
import { MAX_ENVELOPE_BYTES, EnvelopeTooLargeError, envelopeExceedsLimit } from './envelopeSize.js';
import { Emitter }               from '../Emitter.js';
import { mkEnvelope, P, REPLY_CODES } from '../Envelope.js';
import {
  DISCOVERABILITY, isDiscoverability, normalizeDiscoverability, maxExposure,
} from './discoverability.js';

import { param, PARAM_SCOPE, PARAM_KIND } from '../params.js';

// Parameter register (#36) — transport ack/request timeouts (scope:device, kind:internal — per-install
// protocol timing). Caller-overridable via the `timeout` arg. `param()` returns each default unchanged.
const ACK_TIMEOUT = param({ key: 'transport.ackTimeoutMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 10_000 });  // ms
const REQ_TIMEOUT = param({ key: 'transport.reqTimeoutMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 30_000 });  // ms

/**
 * Abstract transport base class — the port a wire adapter implements. Subclasses
 * override `_put(to, envelope)` (plus connect/disconnect/canReach where relevant) and
 * call `_receive(rawEnvelope)` for inbound traffic; the base then provides the
 * interaction primitives (sendOneWay/sendAck/request/respond/sendHello), reply
 * correlation, auto-ACK of AS envelopes, SecurityLayer wiring, and receive-handler
 * dispatch. See the file header for the full port contract.
 */
export class Transport extends Emitter {
  #address;

  /**
   * G13 — extra addresses this transport answers to (per-circle / per-contact), each with what the
   * caller gave us to prove it is theirs: address → `{ sign }` (see `addAddress`).
   */
  #aliases = new Map();

  /** Nearby step A — what this transport is actually doing about discovery. */
  #discoverability = DISCOVERABILITY.OFF;
  #identity;
  #securityLayer        = null;
  #receiveHandler       = null;
  #pending              = new Map();  // envelopeId → { resolve, reject, timer }
  #envelopeSubscribers  = null;       // Set<(payload, rawEnvelope) => void> — Phase 50.7

  /**
   * @param {object} opts
   * @param {string} opts.address  — this transport's address (pubKey or NKN addr)
   * @param {object} [opts.identity] — AgentIdentity instance (optional in tests)
   */
  constructor({ address, identity } = {}) {
    super();
    this.#address  = address;
    this.#identity = identity;
  }

  /** This agent's address on this transport. */
  get address() { return this.#address; }

  /** The AgentIdentity backing this transport. */
  get identity() { return this.#identity; }

  // Allow subclasses to set address after construction (e.g. after connect()).
  _setAddress(addr) { this.#address = addr; }

  // ── Additional addresses (G13) ───────────────────────────────────────────────
  //
  // A member presents a DIFFERENT address in every circle, so a device has to be reachable at several at
  // once. That is a property of the PORT, not of one adapter — putting it here means there is one alias
  // set, one public API and one replay rule, and an adapter only says HOW to bind. Implementing it per
  // transport would be three subtly different answers to the same question.
  //
  // An adapter opts in by overriding `supportsAliases` + `_bindAddress`/`_unbindAddress`, and calls
  // `_rebindAddresses()` after a (re)connect — a fresh connection knows nothing about the last one, so
  // without replay a device is reachable per-circle exactly once, until the first blip.

  /** Does this transport actually support extra addresses? Adapters that implement binding override this. */
  get supportsAliases() { return false; }

  /** Every address this transport answers to — the primary first, then aliases in insertion order. */
  get addresses() { return [this.#address, ...this.#aliases.keys()]; }

  /**
   * Also answer at `address`.
   *
   * Returns a RESULT rather than throwing, because "this transport cannot do aliases" is a normal
   * configuration fact a caller needs to branch on (per-circle addressing can only be enabled once every
   * transport a recipient listens on can bind one) — not an error.
   *
   * `opts.sign` is how a caller proves the alias is theirs (2026-07-31,
   * `plans/DESIGN-boundary-authentication.md` §7). A per-circle address is a DIFFERENT key from the
   * primary, so holding the primary proves nothing about it: the only party that can answer a
   * challenge for an alias is whoever holds that alias's key, and only the caller knows which circle
   * an address belongs to. It lives on `addAddress` rather than on the constructor for exactly that
   * reason — the caller has the circleId in hand at this call site and nowhere else.
   *
   * The signer is handed a MESSAGE built by the adapter, never bytes chosen by the far end: an
   * adapter must construct what is signed from its own protocol, so registration cannot be used as
   * a signing oracle. It is kept for the lifetime of the alias because a reconnect re-binds and
   * therefore has to re-prove.
   *
   * @param {string} address
   * @param {{ sign?: (message: string) => (string|Uint8Array|Promise<string|Uint8Array>) }} [opts]
   * @returns {Promise<{ok: boolean, reason?: string}>}
   */
  async addAddress(address, opts = {}) {
    if (typeof address !== 'string' || !address) return { ok: false, reason: 'invalid-address' };
    if (address === this.#address) return { ok: true };            // the primary is already ours
    if (!this.supportsAliases) return { ok: false, reason: 'aliases-unsupported' };
    if (this.#aliases.has(address)) return { ok: true };            // idempotent
    this.#aliases.set(address, { sign: opts?.sign ?? null });
    try { await this._bindAddress(address, this.#aliases.get(address)); } catch (err) {
      // Keep it in the set: a bind can fail because we are offline, and the replay on reconnect is
      // precisely what should fix that. Report so a caller is not told it worked.
      return { ok: false, reason: err?.message ?? 'bind-failed' };
    }
    return { ok: true };
  }

  /** Stop answering at `address`. Idempotent. */
  removeAddress(address) {
    if (!this.#aliases.delete(address)) return;
    try { this._unbindAddress(address); } catch { /* unbinding is best-effort; it is gone from the set */ }
  }

  /** Re-bind every alias — adapters call this after a (re)connect. */
  async _rebindAddresses() {
    for (const [alias, opts] of this.#aliases) {
      try { await this._bindAddress(alias, opts); } catch { /* a failed replay is retried on the next connect */ }
    }
  }

  /** @protected adapters override: start listening at `address`. `opts.sign` proves it is ours. */
  async _bindAddress(_address, _opts) {}

  /** @protected adapters override: stop listening at `address`. */
  _unbindAddress(_address) {}

  // ── Discoverability (Nearby step A) ──────────────────────────────────────────
  //
  // Whether this transport LISTENS for nearby peers and whether it ANNOUNCES us to them. Same reasoning as
  // aliases above: it is a property of the PORT — one state machine, one public API, one honesty rule — and
  // an adapter only says HOW to apply it. See `discoverability.js` for the three states and why the
  // aggregate takes the MOST exposed answer.
  //
  // An adapter opts in by overriding `supportsDiscoverability` + `_applyDiscoverability`, and may report a
  // DEGRADED result: mDNS cannot browse without publishing until the native split, so it answers `browse`
  // with an effective `browse+publish`. That degradation is reported, never absorbed — a device that thinks
  // it is unlisted while it is announcing is the one failure this whole surface exists to prevent.

  /** Does this transport participate in discovery at all? Discovering adapters (mDNS, BLE) override this. */
  get supportsDiscoverability() { return false; }

  /**
   * What this transport is ACTUALLY doing — not what was asked for.
   * A non-discovering transport is `off`: a relay socket neither browses nor announces.
   */
  get discoverability() { return this.#discoverability; }

  /**
   * Set the discovery state.
   *
   * Returns a result rather than throwing, for the same reason `addAddress` does: "this transport does not
   * discover" is a configuration fact to branch on, and a partial/degraded apply is a normal outcome that
   * the caller must be able to SHOW a user, not an error to swallow.
   *
   * @param {string} state  one of `DISCOVERABILITY`
   * `degraded` means MORE exposed than asked (the dangerous direction). A transport that ends up LESS
   * exposed — no radio, Wi-Fi off — is not degraded; it simply is not offering discovery.
   *
   * @returns {Promise<{ok:boolean, requested:string, effective:string, degraded:boolean, reason?:string}>}
   */
  async setDiscoverability(state) {
    const norm = normalizeDiscoverability(state);
    const requested = norm.value;
    if (!norm.ok) {
      return { ok: false, requested, effective: this.#discoverability, degraded: false, reason: norm.reason };
    }
    if (!this.supportsDiscoverability) {
      // Not a failure to report upward as breakage — this transport was never part of the answer.
      return { ok: true, requested, effective: DISCOVERABILITY.OFF, degraded: false, reason: 'discoverability-unsupported' };
    }
    let effective = requested;
    try {
      const applied = await this._applyDiscoverability(requested);
      if (isDiscoverability(applied)) effective = applied;
    } catch (err) {
      // The state is unknown after a failed apply, so assume the worst: report what we last knew we were
      // doing, at least as exposed as the request. Claiming the request succeeded would be the lie.
      const effectiveOnError = maxExposure(this.#discoverability, requested);
      return { ok: false, requested, effective: effectiveOnError, degraded: true, reason: err?.message ?? 'apply-failed' };
    }
    this.#discoverability = effective;
    return {
      ok: true, requested, effective,
      degraded: effective !== requested && maxExposure(effective, requested) === effective,
    };
  }

  /**
   * @protected adapters override: apply `state`, and RETURN the state actually achieved.
   * Returning a different state than asked is how an adapter declares a degradation honestly.
   */
  async _applyDiscoverability(state) { return state; }

  /**
   * Re-announce at the CURRENT state (Nearby step C).
   *
   * Discovery announcements are tied to a network interface, so switching Wi-Fi, coming back from
   * airplane mode, or waking from a long background invalidates them without any of our code being told.
   * Nothing throws, nothing reconnects, and the state we report stays correct — we ARE set to publish. We
   * are just publishing to a network that no longer exists. To everyone else the device silently vanished.
   *
   * `setDiscoverability` cannot fix this, because it short-circuits: adapters skip work when the state is
   * already applied. So this is a separate verb meaning "the same state, from scratch".
   *
   * @returns {Promise<{ok:boolean, effective:string, reason?:string}>}
   */
  async reannounce() {
    if (!this.supportsDiscoverability) {
      return { ok: true, effective: DISCOVERABILITY.OFF, reason: 'discoverability-unsupported' };
    }
    if (this.#discoverability === DISCOVERABILITY.OFF) {
      // Nothing to re-announce, and re-announcing would be the bug: a network change must never make a
      // device that chose to be invisible start announcing itself.
      return { ok: true, effective: DISCOVERABILITY.OFF, reason: 'not-discovering' };
    }
    const state = this.#discoverability;
    try {
      const applied = await this._reannounce(state);
      const effective = isDiscoverability(applied) ? applied : state;
      this.#discoverability = effective;
      return { ok: true, effective };
    } catch (err) {
      // A failed re-announce leaves us in whatever state the old interface left behind — which we cannot
      // know. Keep reporting the more exposed reading rather than claiming a clean restart.
      return { ok: false, effective: state, reason: err?.message ?? 'reannounce-failed' };
    }
  }

  /**
   * @protected adapters override: re-establish the announcement at `state` from scratch.
   * The default is a plain re-apply, which is correct for an adapter whose `_applyDiscoverability` is not
   * short-circuiting; adapters that skip already-applied work must override this to actually restart.
   */
  async _reannounce(state) { return this._applyDiscoverability(state); }

  // ── Security layer ──────────────────────────────────────────────────────────

  /** Attach a SecurityLayer (or A2ATLSLayer for A2ATransport). */
  useSecurityLayer(layer) { this.#securityLayer = layer; }

  get securityLayer() { return this.#securityLayer; }

  // ── Inbound handler ─────────────────────────────────────────────────────────

  /**
   * Register the inbound dispatch function (called by Agent in Phase 2).
   * If not set, unhandled envelopes are emitted as 'envelope' events.
   */
  setReceiveHandler(fn) { this.#receiveHandler = fn; }

  /**
   * Currently-registered inbound dispatch function, or null. Used by
   * transports that wrap another transport (e.g. RendezvousTransport
   * chaining to its signalling transport's prior handler).
   *
   * @returns {((envelope:object)=>void)|null}
   */
  get receiveHandler() { return this.#receiveHandler ?? null; }

  // ── Lifecycle (subclasses override) ────────────────────────────────────────

  async connect()    {}
  async disconnect() {}

  /**
   * Can this transport deliver to `peerAddress` right now?
   * Default: yes (most transports are address-agnostic once connected).
   * Override in transports where reachability is peer-scoped — e.g.
   * RendezvousTransport returns true only when an open DataChannel
   * exists for the given peer.
   *
   * @param {string} _peerAddress
   * @returns {boolean}
   */
  canReach(_peerAddress) { return true; }

  /**
   * Drop any per-peer state this transport caches (e.g. deduped discovery
   * entries).  Called by Agent.forget() so a forgotten peer can be
   * re-discovered if they're still reachable.  Default: no-op.
   */
  forgetPeer(_address) {}

  // ── Four primitives ─────────────────────────────────────────────────────────

  /**
   * WHICH of our addresses to speak from (G13 / Decision 4).
   *
   * A caller may ask to send AS one of our extra addresses — the per-circle address that circle's
   * traffic belongs to — so that neither the header nor the signature over it names the person
   * globally. The claim is validated against the addresses this transport actually holds: `_to` on
   * an inbound envelope is attacker-influenced and is one of the things callers pass here, so a bad
   * value must never let someone make us claim an address that is not ours. Unknown ⇒ the primary.
   *
   * `warn` is on for a DELIBERATE claim (a caller that meant to send as a circle) and off where the
   * claim is opportunistic (answering at whatever address an inbound envelope was addressed to,
   * which on a mesh transport is routinely a pubkey rather than one of our bound addresses).
   *
   * @param {string|null|undefined} claimed
   * @param {{warn?: boolean}} [opts]
   * @returns {string} one of our own addresses
   */
  #ownAddress(claimed, { warn = true } = {}) {
    const asked = typeof claimed === 'string' && claimed ? claimed : null;
    if (!asked) return this.#address;
    if (asked === this.#address || this.#aliases.has(asked)) return asked;
    if (warn && typeof console !== 'undefined') {
      // Loud on purpose (Frits, review 2026-07-30). The fallback is SAFE against hostile input — but
      // a genuine wiring mistake, passing an address this transport never bound, would otherwise
      // look like success, and "looks right, does nothing" is the failure class behind most of this
      // month's bugs. Hostile input can at worst make log noise; a real bug now leaves a trace.
      console.warn(
        `[transport] asked to send as "${String(asked).slice(0, 16)}…" `
        + 'which this transport does not hold — falling back to the primary address',
      );
    }
    return this.#address;
  }

  /**
   * OW — fire-and-forget. No reply expected.
   * `opts.from` — send AS one of our extra addresses (see `#ownAddress`).
   */
  async sendOneWay(to, payload, opts = {}) {
    await this._send(to, mkEnvelope(P.OW, this.#ownAddress(opts?.from), to, payload));
  }

  /**
   * OW with a wire-level topic hint — fire-and-forget pubsub publish.
   * The topic is stamped on the outer envelope (`_topic`), survives
   * SecurityLayer (signed-but-not-encrypted), and is exposed to the
   * underlying transport for per-(recipient, topic) routing decisions
   * (e.g. relay's topic-aware offline queue).  Equivalent to
   * `sendOneWay(to, payload)` for transports that don't use the hint.
   */
  async publishOneWay(to, topic, payload, opts = {}) {
    await this._send(to, mkEnvelope(P.OW, this.#ownAddress(opts?.from), to, payload, { topic }));
  }

  /**
   * AS — deliver and wait for AK (delivery confirmation).
   * Resolves with the AK envelope on success, rejects on timeout.
   */
  async sendAck(to, payload, timeout = ACK_TIMEOUT, opts = {}) {
    const env = mkEnvelope(P.AS, this.#ownAddress(opts?.from), to, payload);
    return this._awaitReply(env._id, timeout, () => this._send(to, env));
  }

  /**
   * RQ — send request and wait for RS (response with result).
   * Resolves with the RS envelope on success, rejects on timeout.
   */
  async request(to, payload, timeout = REQ_TIMEOUT, opts = {}) {
    const env = mkEnvelope(P.RQ, this.#ownAddress(opts?.from), to, payload);
    return this._awaitReply(env._id, timeout, () => this._send(to, env));
  }

  /**
   * RS — send a reply to a previous RQ.
   */
  async respond(to, replyToId, payload, opts = {}) {
    await this._send(to, mkEnvelope(P.RS, this.#ownAddress(opts?.from), to, payload, { re: replyToId }));
  }

  /**
   * HI — announce self to a peer (signed plaintext, no encryption).
   * Fire-and-forget; SecurityLayer on the receiving end auto-registers the sender.
   * Use agent.hello() to do a bidirectional introduction.
   */
  async sendHello(to, payload, opts = {}) {
    // `opts.from` — answer AS the address you were addressed to (G13).
    //
    // Per-circle addresses live in `#aliases`, and this used to stamp `this.#address` unconditionally. So a
    // peer who dialled one of our circle addresses got a reply from our CANONICAL address, filed our key
    // under that, and went on waiting for a key under the alias it had dialled — then timed out and reported
    // us offline while we were actively answering it. A handshake to a per-circle address could therefore
    // never complete, which is why no message ever crossed between two devices (found 2026-07-30).
    //
    // Passing the alias keeps the circle address as the identity on the wire end to end, so the peer never
    // learns our canonical address — the unlinkability G13 exists for. The alternative (letting the peer
    // credit a canonical-address reply to the alias it dialled) would have worked too and would have handed
    // them exactly the circle-address → identity link the design withholds.
    //
    // Unknown addresses fall back to the primary rather than throwing: `_to` on an inbound envelope is
    // attacker-influenced, and a bad value must not let someone make us claim an address that is not ours.
    // The validation itself is `#ownAddress`, shared with every other primitive so there is one rule.
    const from = this.#ownAddress(opts.from);
    // `opts.re` — the `_id` of the HI this one ANSWERS.
    //
    // An earlier version of the reciprocal-HI fix invented a `reply: true` field in the payload to mark an
    // answer, so that answering could not provoke another answer. That was a new wire field for something
    // the envelope already expresses: `_re` ("reply-to envelope `_id`") is an atom on EVERY envelope, and
    // saying which HI you are answering is both zero new fields and strictly more informative than a
    // boolean. (Frits, 2026-07-30: "check the transport atoms first" — he was right.)
    //
    // Safe against the reply-correlation machinery: `_receive` resolves a pending promise only when
    // `REPLY_CODES.has(_p) && _re`, and HI is not a reply code — so an HI carrying `_re` cannot resolve
    // someone's outstanding request.
    await this._send(to, mkEnvelope(P.HI, from, to, payload, { re: opts.re ?? null }));
  }

  // ── Notification envelopes (Phase 50.7) ────────────────────────────────────

  /**
   * Publish a **notification envelope** to multiple recipients.
   *
   * The wire format is the standardisation §II.6 envelope shape:
   *   `{ v: 1, kind, ref, etag, fromActor, timestamp, payload? }`.
   *
   * Each recipient receives the envelope as a OW message tagged with
   * topic `envelope:<kind>` (so receivers can subscribe by kind).
   * The transport doesn't know what `kind` means; that's the
   * substrate's domain (typically `@onderling/notify-envelope`).
   *
   * @param {object} opts
   * @param {string} opts.kind        — the envelope kind (item-types name).
   * @param {string} [opts.ref]       — URI of the referenced resource (for pod-primary mode).
   * @param {string} [opts.etag]      — etag of the referenced resource.
   * @param {string} [opts.fromActor] — agent-URI of the author.
   * @param {string[]} opts.recipients — recipient addresses.
   * @param {*} [opts.payload]        — inline payload (for pseudo-pod-replicated mode).
   * @param {string} [opts.timestamp] — ISO timestamp; default: now.
   * @returns {Promise<void>}
   */
  async publishEnvelope({ kind, ref, etag, _v, fromActor, recipients, payload, timestamp } = {}) {
    if (typeof kind !== 'string' || kind.length === 0) {
      throw Object.assign(
        new Error('publishEnvelope: `kind` is required'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    if (!Array.isArray(recipients) || recipients.length === 0) {
      throw Object.assign(
        new Error('publishEnvelope: `recipients` must be a non-empty array'),
        { code: 'INVALID_ARGUMENT' },
      );
    }

    // `_v` (Phase 52.14, Q-D 2026-05-14) — Lamport-style per-key
    // version counter from `pseudo-pod`. Forward-additive on the
    // wire: legacy receivers ignore it.
    const wire = {
      v: 1,
      kind,
      timestamp: timestamp ?? new Date().toISOString(),
      ...(ref          !== undefined ? { ref }       : {}),
      ...(etag         !== undefined ? { etag }      : {}),
      ...(typeof _v === 'number'    ? { _v }        : {}),
      ...(fromActor    !== undefined ? { fromActor } : {}),
      ...(payload      !== undefined ? { payload }  : {}),
    };

    const topic = `envelope:${kind}`;
    await Promise.all(recipients.map(to => this.publishOneWay(to, topic, wire)));
  }

  /**
   * Subscribe to inbound **notification envelopes**.
   *
   * Returns an unsubscribe function.
   *
   * The callback fires for every inbound envelope whose `_topic`
   * starts with `envelope:` — invoked with
   * `(payload, rawEnvelope)`:
   *   - `payload`: the envelope wire shape `{ v, kind, ref, etag,
   *                fromActor, timestamp, payload? }`.
   *   - `rawEnvelope`: the raw transport envelope (with `_from`,
   *                    `_topic`, etc.).
   *
   * Subscribers fire **alongside** the Agent's normal receive
   * dispatch — they don't suppress it. Designed for the
   * notify-envelope substrate to tap inbound traffic without
   * conflicting with the Agent's skill-routing.
   *
   * @param {(payload: object, rawEnvelope: object) => void} callback
   * @returns {() => void} unsubscribe
   */
  subscribeEnvelopes(callback) {
    if (typeof callback !== 'function') {
      throw Object.assign(
        new Error('subscribeEnvelopes: callback must be a function'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    if (!this.#envelopeSubscribers) this.#envelopeSubscribers = new Set();
    this.#envelopeSubscribers.add(callback);
    return () => { this.#envelopeSubscribers?.delete(callback); };
  }

  // ── Wire primitive — subclasses MUST implement ──────────────────────────────

  /**
   * Send an envelope on the wire. Called after SecurityLayer has encrypted it.
   * @param {string} to       — recipient address
   * @param {object} envelope — encrypted (or HI plaintext) envelope
   */
  async _put(to, envelope) {  // eslint-disable-line no-unused-vars
    throw new Error(`${this.constructor.name} must implement _put()`);
  }

  // ── Inbound — subclasses call this when a raw envelope arrives ──────────────

  /**
   * Process an incoming envelope.
   *  1. SecurityLayer.decryptAndVerify (if set)
   *  2. Auto-ACK for AS envelopes
   *  3. Resolve pending promise for reply codes (AK, RS)
   *  4. Dispatch remaining envelopes to receiveHandler or 'envelope' event
   *
   * @param {object} rawEnvelope — as received from the network
   */
  _receive(rawEnvelope) {
    // Inbound is the check an attacker cannot skip. A relay-side limit protects the relay and everyone
    // routed through it, but mDNS and NKN never touch a relay — so without this, the bound exists only on
    // the path that happens to have a server on it.
    const tooBig = envelopeExceedsLimit(rawEnvelope, this.maxEnvelopeBytes);
    if (tooBig) {
      // Reported, not silently dropped: a receiver must be able to tell "too big" from "never arrived".
      this.emit('security-error', new EnvelopeTooLargeError(tooBig.bytes, tooBig.limit), rawEnvelope);
      return;
    }
    let envelope;
    try {
      envelope = this.#securityLayer
        ? this.#securityLayer.decryptAndVerify(rawEnvelope)
        : rawEnvelope;
    } catch (err) {
      this.emit('security-error', err, rawEnvelope);
      return;
    }

    // Tag with the receiving transport so inbound handlers can reply on the
    // same channel without guessing from routing tables.
    envelope._transport = this;

    // Transport-level delivery acknowledgment for AS envelopes.
    // Sent before the application layer sees the envelope.
    if (envelope._p === P.AS) {
      // Answer AS the address that was dialled (G13 / Decision 4), exactly as the reciprocal HI
      // does: an ack stamped with our canonical address would hand the sender — and anything on the
      // path — the link between our per-circle address and our global one, which is the whole point
      // of having a per-circle address. `warn: false` because `_to` is the key the sender sealed to
      // and is routinely not one of our bound addresses (a mesh transport's primary is not a pubkey);
      // that is the ordinary case, not a wiring mistake.
      const ack = mkEnvelope(
        P.AK, this.#ownAddress(envelope._to, { warn: false }), envelope._from, {}, { re: envelope._id },
      );
      this._send(envelope._from, ack).catch(err => this.emit('error', err));
      // fall through — also dispatch AS to the application
    }

    // Reply codes resolve pending outbound promises.
    if (REPLY_CODES.has(envelope._p) && envelope._re) {
      const pending = this.#pending.get(envelope._re);
      if (pending) {
        clearTimeout(pending.timer);
        this.#pending.delete(envelope._re);
        pending.resolve(envelope);
        return; // don't dispatch reply envelopes to the application
      }
    }

    // Fan envelope-topic'd messages out to envelope subscribers (Phase 50.7).
    // Fires *alongside* the Agent's normal receive dispatch — doesn't suppress.
    if (this.#envelopeSubscribers && typeof envelope._topic === 'string' && envelope._topic.startsWith('envelope:')) {
      for (const cb of this.#envelopeSubscribers) {
        try { cb(envelope.payload, envelope); } catch (err) { this.emit('error', err); }
      }
    }

    // Everything else goes to the Agent layer (or falls back to 'envelope' event).
    if (this.#receiveHandler) {
      try { this.#receiveHandler(envelope); } catch (err) { this.emit('error', err); }
    } else {
      this.emit('envelope', envelope);
    }
  }

  /**
   * The per-envelope wire ceiling for this transport. Overridable by an adapter whose medium genuinely
   * differs; the default is the shared one so every path agrees unless someone says otherwise.
   */
  get maxEnvelopeBytes() { return MAX_ENVELOPE_BYTES; }

  // ── Internals ───────────────────────────────────────────────────────────────

  /** Apply SecurityLayer (if set) and call _put. */
  async _send(to, envelope) {
    const outgoing = this.#securityLayer
      ? this.#securityLayer.encrypt(envelope)
      : envelope;
    // Refuse before the wire, so the SENDER gets a clear error rather than a mysterious disconnect. The
    // check is after encryption on purpose: what matters is the size of what actually goes out.
    const tooBig = envelopeExceedsLimit(outgoing, this.maxEnvelopeBytes);
    if (tooBig) throw new EnvelopeTooLargeError(tooBig.bytes, tooBig.limit);
    await this._put(to, outgoing);
  }

  /** Register a pending-reply promise, call send(), return the promise. */
  _awaitReply(id, timeout, send) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Timeout waiting for reply to ${id}`));
      }, timeout);

      this.#pending.set(id, { resolve, reject, timer });

      send().catch(err => {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(err);
      });
    });
  }
}
