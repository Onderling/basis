/**
 * NknTransport — NKN network transport.
 *
 * Wraps `nkn-sdk` (nkn.Client). The NKN address is derived from the agent's
 * Ed25519 seed, giving a deterministic address from the identity keypair.
 *
 * Browser: load nkn-sdk from CDN and pass it as `nknLib`.
 * Node.js: npm install nkn-sdk; it will be auto-imported if not passed.
 *
 * Robustness (carried over from working demo.html implementation):
 *   - RTCDataChannel transient send errors → poll-retry up to 12 s
 *   - Soft warn at 20 s if still connecting
 *   - Hard timeout at 90 s → seedless retry (different node pool)
 */
import { Transport, b64encode, b64decode, createSenderBinding } from '@onderling/core';
import { log } from '@onderling/logger';
import nacl from 'tweetnacl';

import { nknAuthenticatedSender } from './nknSenderBinding.js';

/**
 * Derive a peer's NKN address from its base64url chat pubKey. NKN uses the agent's
 * ed25519 pubKey BYTES as the client seed, so a peer's NKN address is
 * `hex( fromSeed(pubKeyBytes).publicKey )` (=== nkn-sdk's own MultiClient(seed).addr).
 * A peer MUST be addressed by that derived form; NKN rejects the raw base64url pubKey
 * ("neither a valid public key nor a registered name"). Idempotent: an address that is
 * already NKN-native (64-hex, optionally `identifier.`-prefixed) passes through unchanged.
 */
export function nknAddressFromChatPubKey(to) {
  if (typeof to !== 'string' || !to) return to;
  const bare = to.includes('.') ? to.slice(to.lastIndexOf('.') + 1) : to;
  if (/^[0-9a-f]{64}$/i.test(bare)) return to;   // already an NKN address
  let bytes;
  try { bytes = b64decode(to); } catch { return to; }
  if (!bytes || bytes.length !== 32) return to;
  const pub = nacl.sign.keyPair.fromSeed(bytes).publicKey;
  return Array.from(pub).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * NKN network `Transport` wrapping `nkn-sdk`'s Client. The NKN address is derived from the
 * identity's Ed25519 seed, so it is deterministic per keypair. Pass the library as `nknLib`
 * (browser/CDN) or let `connect()` dynamic-import it (Node). Includes robustness handling for
 * slow connects: transient send retries, a soft warning, and a hard timeout with seedless retry.
 */
export class NknTransport extends Transport {
  /**
   * NKN's own ceiling, declared where it is a fact of THIS transport rather than hardcoded by callers:
   * nkn-sdk-js MaxClientMessageSize ≈ 65 528 bytes, and an over-size message is dropped SILENTLY
   * (measured 2026-05-23: a 117 KB /send-file "sent" and never arrived). 60 KB leaves framing room
   * under that. The peer façade reads this to chunk anything bigger — basis's old 32 KB cap was this
   * number, hardcoded one layer too high.
   */
  get maxEnvelopeBytes() { return 60 * 1024; }

  #client    = null;
  #nknLib    = null;
  #opts;
  /** The shared sender-binding rule, asked with nkn's `authenticatedSender` port. */
  #checkSender;

  /**
   * @param {object} opts
   * @param {import('../identity/AgentIdentity.js').AgentIdentity} opts.identity
   * @param {string}  [opts.identifier]   — NKN address identifier prefix
   * @param {object}  [opts.nknLib]       — inject nkn-sdk (auto-loaded if omitted)
   * @param {number}  [opts.warnAfter=20000]
   * @param {number}  [opts.connectTimeout=90000]
   */
  constructor(opts = {}) {
    if (!opts?.identity) throw new Error('NknTransport requires identity');
    super({ identity: opts.identity });
    this.#opts = {
      warnAfter:      20_000,
      connectTimeout: 90_000,
      ...opts,
    };
    this.#checkSender = createSenderBinding({
      transportName:       'NknTransport',
      authenticatedSender: nknAuthenticatedSender,
      // Loud absence: if nkn ever stops handing us `src` (or the injected lib does not), the receive path
      // is delivering unchecked envelopes and must say so rather than read as protected.
      onUnauthenticated:   (message) => {
        log.warn('transport', 'transport.inbound.sender-unchecked');
        this.emit('warn', message);
      },
    });
  }

  // ── G13 aliases — DELIBERATELY UNSUPPORTED (2026-07-27) ─────────────────────
  //
  // An NKN client IS an address: `MultiClient` is constructed from one seed, and a per-circle address is
  // derived from a DIFFERENT seed (`deriveCircleSeed`). So answering at N addresses means N clients — N
  // sets of websocket connections to NKN nodes, N sub-client fan-outs — which on a phone is a real battery
  // and memory cost, not a detail.
  //
  // DECIDED 2026-07-28 (docs/decisions.md): this is the design, not a pending measurement. NKN reaches a
  // PERSON; circles ride relays or pods — so `supportsAliases` stays false as a design fact, and per-circle
  // addressing is a relay concern. `addAddress()` reports `{ok:false, reason:'aliases-unsupported'}`. A caller
  // wiring per-circle addressing can therefore SEE that this path is not ready, rather than sending to an
  // address nobody answers — which is exactly the silent hole that gated step C.
  //
  // Implementing it later means one client per circle address, and should be measured before it ships.

  async connect() {
    // Lazy-load nkn-sdk if not injected (Node.js path).
    this.#nknLib = this.#opts.nknLib
      ?? (typeof nkn !== 'undefined' ? nkn : null);   // browser global  // eslint-disable-line no-undef

    if (!this.#nknLib) {
      try {
        // Dynamic import for Node.js environments.
        const mod     = await import('nkn-sdk');
        this.#nknLib  = mod.default ?? mod;
      } catch {
        throw new Error(
          'nkn-sdk not found. Run: npm install nkn-sdk   or pass opts.nknLib.',
        );
      }
    }

    const seed = this._deriveSeed();
    // 2026-05-28 — start with MultiClient when the lib exposes it
    // (better inbound delivery — multiple sub-client routes to our
    // address), but fall back to single Client on timeout so the
    // known-good single-client path stays available if MultiClient
    // misbehaves on a given network.  `opts.preferMultiClient: false`
    // forces single Client from the start.
    const canMulti = !!this.#nknLib.MultiClient
      && this.#opts.preferMultiClient !== false;
    await this.#tryConnect(seed, { multi: canMulti, seedRetried: false });
  }

  async disconnect() {
    try { this.#client?.close(); } catch { /**/ }
    this.#client = null;
    this._setAddress(null);
    // PII-SAFE: no address/payload — a bare lifecycle marker.
    log.info('transport', 'transport.disconnect');
    this.emit('disconnect');
  }

  async _put(to, envelope) {
    if (!this.#client) throw new Error('NknTransport: not connected');
    const payload = JSON.stringify(envelope);

    // NKN SDK opens an RTCDataChannel lazily — poll until it accepts the send.
    const POLL_MS    = 200;
    const TIMEOUT_MS = 12_000;
    const deadline   = Date.now() + TIMEOUT_MS;

    while (true) {
      try {
        await this.#client.send(nknAddressFromChatPubKey(to), payload, { noReply: true });
        // PII-SAFE: byte COUNT of the wire payload only — never `to` (the peer
        // address) nor the payload/envelope contents.
        log.info('transport', 'transport.send', { bytes: payload.length });
        return;
      } catch (err) {
        const msg        = String(err?.message ?? '').toLowerCase();
        const isTransient =
          msg.includes('rtcdatachannel')  ||
          msg.includes('readystate')      ||
          msg.includes('no longer')       ||
          (typeof DOMException !== 'undefined' &&
           err instanceof DOMException && err.name === 'InvalidStateError');
        if (!isTransient) {
          // PII-SAFE: error NAME + a boolean; no address, no payload.
          log.error('transport', 'transport.send.fail', { err: err?.name ?? 'Error', transient: false });
          throw err;
        }
        if (Date.now() >= deadline) {
          log.error('transport', 'transport.send.fail', { reason: 'timeout', transient: true });
          throw new Error('NKN send timed out — channel may be reconnecting');
        }
        await new Promise(r => setTimeout(r, POLL_MS));
      }
    }
  }

  // ── Private ───────────────────────────────────────────────────────────────

  /**
   * Derive a 64-hex-char NKN seed from the agent's Ed25519 pubKey bytes.
   * Using the pubKey (not the private key) as the NKN seed is intentional —
   * the NKN seed is only for address derivation, not for the agent's identity.
   */
  _deriveSeed() {
    if (!this.identity) return null;
    const bytes = this.identity.pubKeyBytes;
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async #tryConnect(seed, { multi, seedRetried }) {
    return new Promise((resolve, reject) => {
      const clientOpts = seed ? { seed } : {};
      if (this.#opts.identifier) {
        clientOpts.identifier = this.#opts.identifier;
      }
      // 2026-05-28 — MultiClient (when `multi`) spawns N sub-clients
      // across different nodes, so a message to our base address
      // reaches whichever sub-client is reachable — far better inbound
      // delivery than a single Client's one route (which can be
      // unreachable from a sender's node even when our OUTBOUND works,
      // the asymmetric-delivery bug we saw on two phones).  We fall
      // back to single Client on timeout so the known-good path stays
      // available.
      const Ctor = (multi && this.#nknLib.MultiClient)
        ? this.#nknLib.MultiClient
        : this.#nknLib.Client;
      if (multi && this.#nknLib.MultiClient && clientOpts.numSubClients === undefined) {
        clientOpts.numSubClients = this.#opts.numSubClients ?? 4;
      }
      if (typeof console !== 'undefined') {
        console.log('[NknTransport] connecting via '
          + (Ctor === this.#nknLib.MultiClient ? 'MultiClient(' + clientOpts.numSubClients + ')' : 'Client')
          + (seed ? ' (seeded)' : ' (seedless)'));
      }
      this.#client = new Ctor(clientOpts);

      const warnTimer = setTimeout(() => {
        if (this.address) return;
        this.emit('warn', 'NKN still connecting — this can take up to 90 s on some nodes…');
      }, this.#opts.warnAfter);

      const hardTimer = setTimeout(() => {
        if (this.address) return;
        clearTimeout(warnTimer);
        try { this.#client?.close(); } catch { /**/ }
        this.#client = null;
        // PII-SAFE: route-shape booleans only; a coarse connect-timeout marker.
        log.warn('transport', 'transport.connect.timeout', { multi: !!multi, seeded: !!seed });
        // Fallback chain: MultiClient+seed → Client+seed →
        // Client+seedless → reject.
        if (multi) {
          this.emit('warn', 'NKN MultiClient timed out — falling back to single Client…');
          this.#tryConnect(seed, { multi: false, seedRetried }).then(resolve, reject);
        } else if (seed && !seedRetried) {
          this.emit('warn', 'NKN timed out with seed — retrying without seed…');
          this.#tryConnect(null, { multi: false, seedRetried: true }).then(resolve, reject);
        } else {
          reject(new Error('NKN connect timed out'));
        }
      }, this.#opts.connectTimeout);

      this.#client.on('connect', () => {
        clearTimeout(warnTimer);
        clearTimeout(hardTimer);
        this._setAddress(this.#client.addr);
        // PII-SAFE: route-shape booleans only — NOT the NKN address.
        log.info('transport', 'transport.connect', {
          multi: Ctor === this.#nknLib.MultiClient,
          seeded: !!seed,
        });
        this.emit('connect', { address: this.address });
        resolve();
      });

      this.#client.on('message', (msg) => {
        let envelope;
        try { envelope = JSON.parse(msg.payload.toString()); } catch { return; }

        // ── Sender binding — second line, NOT the wall (2026-07-31) ──────────────────────────────
        //
        // This handler used to discard `msg.src` — the one sender fact nkn actually authenticates — and
        // deliver whatever sender the envelope's `_from` claimed. `_from` is free text, so any peer that
        // could reach us could speak as anyone we had already keyed. The rule + the reasoning live in
        // `nknSenderBinding.js` (nkn's half) and `@onderling/core` `senderBinding.js` (the shared half).
        //
        // Limits, stated so nobody reads this as the boundary: it covers ONE transport (the same envelope
        // arriving over the relay is checked there, separately, and only against the relay's own view);
        // it trusts nkn's authentication; and it binds a sender to a CONNECTION, never to a key. The real
        // fix — the signing key IS the identity, authorised against the circle roster — is the circle
        // layer's sealing + roster work, a separate build.
        //
        // This adapter can receive over MultiClient *or* single Client (it falls back automatically on a
        // MultiClient connect timeout, see #tryConnect), so the `__N__.` sub-client prefix genuinely
        // reaches this comparison — the normalisation in the port is load-bearing, not defensive dressing.
        const verdict = this.#checkSender(msg, envelope);
        if (!verdict.ok) {
          // PII-SAFE: the verdict REASON only — never `src`, `_from`, or payload contents.
          log.warn('transport', 'transport.inbound.sender-rejected', { reason: verdict.reason });
          this.emit('warn', `NknTransport: dropped inbound envelope (${verdict.reason})`);
          return;
        }
        this._receive(envelope);
      });

      this.#client.on('error', (err) => {
        // PII-SAFE: error NAME only — no address, no message content.
        log.error('transport', 'transport.error', { err: err?.name ?? 'Error' });
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
      });
    });
  }
}
