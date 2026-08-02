/**
 * NknTransport (React Native) — NKN MultiClient transport for RN apps.
 *
 * Plug-compatible with `core.Agent.addTransport()` (extends the core
 * `Transport` base class).  Implements `_put(to, envelope)` + lifecycle
 * (`connect` / `disconnect`) + the routing-hint `canReach()` + a
 * `sendHelloOnce(addr)` correctness gate that fixes the bilateral HI
 * race (see "HI race" below).
 *
 * ── nkn-multiclient / nkn-sdk on React Native ─────────────────────────
 * The NPM ecosystem ships NKN client functionality under `nkn-sdk` (the
 * package that the basis web layer loads from CDN; it exposes
 * `nkn.Client` and `nkn.MultiClient`).  There is also a thin community
 * package called `nkn-multiclient` that re-exports `nkn-sdk`'s
 * MultiClient with a Promise wrapper; this transport treats either as
 * an acceptable injection point via `opts.nknLib`.
 *
 * What works out-of-the-box on Hermes / RN:
 *   - WebSocket   — RN ships a working WebSocket polyfill globally.
 *     `nkn-sdk` uses it via `globalThis.WebSocket`; no extra shim needed.
 *   - fetch       — RN ships fetch globally; NKN uses it only for the
 *     RPC node bootstrap (small JSON POSTs), so the RN fetch is fine.
 *   - crypto.getRandomValues
 *                 — REQUIRED.  Apps MUST import
 *                   `@onderling/react-native/platform/polyfills` (which
 *                   imports `react-native-get-random-values`) BEFORE
 *                   constructing any agent or transport.  Without it,
 *                   nkn-sdk's seed/key derivation silently produces
 *                   weak addresses.
 *   - Buffer       — REQUIRED.  Same polyfill module sets
 *                   `globalThis.Buffer` from the `buffer` package.
 *                   nkn-sdk reads it as a free identifier in places.
 *
 * What does NOT work without extra work:
 *   - WebRTC datachannels — `nkn-sdk` opens RTCDataChannels for some
 *     send paths in browsers.  React Native does NOT ship RTCPeerConnection
 *     natively; on Hermes, the SDK silently falls back to relay-node
 *     send (slightly higher latency, no peer-to-peer hole punching).
 *     If you need RTC in RN, install `react-native-webrtc` and assign
 *     the globals (`globalThis.RTCPeerConnection`, etc.) before connect.
 *   - Binary frame handling via `fetch().then(r => r.arrayBuffer())`
 *     can be flaky on older RN runtimes.  `react-native-fetch-api`
 *     (or `react-native-blob-util`) installs a replacement fetch that
 *     handles binary frames correctly.  Not required for steady-state
 *     NKN traffic (which is text-JSON over WebSocket), but useful if
 *     you observe `Network request failed` during the bootstrap call.
 *
 * ── HI race fix (inherited from secure-agent commit d15051e) ───
 * Before sending the first OW (one-way) envelope to a peer, we MUST
 * send a HI envelope so the peer's SecurityLayer registers our pubKey
 * + can decrypt subsequent traffic.  The original code added the peer
 * to `helloedPeers` BEFORE awaiting `sendHello()` — a concurrent
 * `sendToPeer()` call would then see the address as "already helloed"
 * and skip HI, leading to a decryption failure on the receiver.
 *
 * The fix (mirrored in `secure-agent/src/createSecureAgent.js:231-241`):
 *
 *     if (!helloedPeers.has(addr)) {
 *       await tx.sendHello(addr, { pubKey: identity.pubKey });
 *       helloedPeers.add(addr);   //  ← added AFTER await
 *     }
 *
 * This transport bakes that gate into `sendHelloOnce(addr)` so callers
 * cannot accidentally regress the race.  `_put` / `sendOneWay` are
 * also wrapped with a retry loop that detects the canonical NKN
 * server errors ("no pubKey registered", "send HI first", "did not
 * respond with HI") and re-issues `sendHelloOnce()` before retrying.
 *
 * ── Running real-network tests ────────────────────────────────────────
 * The unit tests at `test/transport/NknTransport.test.js` mock the
 * NKN lib + run in CI.  An optional integration test reaches the live
 * NKN mainnet and is gated behind:
 *
 *     RUN_NKN_TESTS=1 pnpm exec vitest run test/transport/NknTransport.test.js
 *
 * Same convention as `apps/basis/test-browser/mesh-and-dm.spec.js`.
 *
 * ── Background suspend (future: #224B Detox) ──────────────────────────
 * iOS / Android background the JS runtime aggressively.  When the app
 * resumes, the NKN WebSocket may have been silently dropped — see
 * `disconnect()` for the close path + `connect()` for the bootstrap
 * retry.  TODO(#224B): hook into AppState.addEventListener('change')
 * + auto-reconnect on foreground.  Stub left in `_onAppStateChange()`.
 */
import { Transport, createSenderBinding } from '@onderling/core';
// Sender binding: the shared RULE is kernel logic (`@onderling/core` → `transport/senderBinding.js`);
// nkn's half — the `__N__.` sub-client normalisation and the encrypted-only `src` guarantee — lives with
// the nkn adapters in `@onderling/transports`. Both NKN adapters ask the same question of the same code,
// so web ≡ mobile by construction rather than by copy (invariants 2 + 3).
import { nknAuthenticatedSender, nknSenderVerdict } from '@onderling/transports';

// Canonical NKN server-side error strings.  When `_put` fails with any
// of these, the receiver hasn't seen our HI yet — re-issue HI then
// retry the send.
const HI_RACE_PATTERNS = [
  /no\s*pub[Kk]ey\s*registered/i,
  /send\s*HI\s*first/i,
  /did\s*not\s*respond\s*with\s*HI/i,
];

const DEFAULT_WARN_AFTER_MS    = 20_000;
const DEFAULT_CONNECT_TIMEOUT  = 90_000;
const DEFAULT_SEND_RETRIES     = 2;     // total attempts = retries + 1
const DEFAULT_SEND_RETRY_DELAY = 500;   // ms between retries
// A send must not be able to outlive the handshake window that is waiting on it.
//
// `nkn-sdk`'s `client.send()` waits for the client to become ready and never times out on its own, and
// `_put` used to guard only on `#client` EXISTING — which it does from construction, ~90 s before it can
// actually be connected. So every HI issued while the mesh was still coming up hung forever. That was bad
// on its own, but the real damage was upstream: `secure-agent`'s `announceHi()` awaits this call, so
// `_sendOverRoute` never returned, its own 5 s/15 s HI wait never ran, and the routing layer never failed
// over — the relay was connected and working the whole time and could not be reached, because the
// transport that was down never said no. (Found on hardware 2026-07-30: 812 "sending outbound HI" against
// 11 "sent OK", and no failures at all.)
//
// 8 s, not the relay's 5 s: NKN is legitimately slower. But well inside secure-agent's 15 s mesh wait, so
// a failure surfaces while there is still time to re-announce or fail over.
const DEFAULT_SEND_TIMEOUT     = 8_000;

// ── Sender binding ───────────────────────────────────────────────────────────
//
// The rule and nkn's normalisation used to live here as local helpers. They now live once — the shared
// verdict in `@onderling/core` (`transport/senderBinding.js`), nkn's `authenticatedSender` port in
// `@onderling/transports` (`nknSenderBinding.js`) — and both NKN adapters import them. All of the
// reasoning (why `src` and `_from` are comparable, why an unencrypted frame is refused rather than
// checked, why we drop instead of annotate) is in those two files.
//
// Re-exported here because this module is where callers and tests already reach for it.
export { nknSenderVerdict };

export class NknTransport extends Transport {
  #client    = null;
  #nknLib    = null;
  #opts;
  #connected = false;
  // Addresses we've sent HI to.  Mutated atomically AFTER `sendHello`
  // resolves (see HI race fix in header).
  #helloedPeers = new Set();
  // sendHelloOnce serialises concurrent HI requests for the same peer
  // so two parallel _put()s don't both fire HI.
  #inFlightHello = new Map();   // addr → Promise<void>
  /** The shared sender-binding rule, asked with nkn's `authenticatedSender` port. */
  #checkSender;

  /**
   * @param {object} opts
   * @param {import('@onderling/core').AgentIdentity} opts.identity
   * @param {string}  [opts.identifier]      — NKN address identifier prefix
   * @param {object}  [opts.nknLib]          — nkn-sdk or nkn-multiclient module
   * @param {boolean} [opts.multiClient=true]— prefer MultiClient over Client
   * @param {number}  [opts.numSubClients=4] — passed to MultiClient (durability)
   * @param {number}  [opts.warnAfter=20000]
   * @param {number}  [opts.connectTimeout=90000]
   * @param {number}  [opts.sendRetries=2]
   * @param {number}  [opts.sendRetryDelayMs=500]
   * @param {number}  [opts.sendTimeoutMs=8000] — hard bound per wire send; a mesh that never answers
   *   must fail rather than hang, or the routing layer above cannot fail over to a transport that works.
   */
  constructor(opts = {}) {
    if (!opts?.identity) throw new Error('NknTransport requires identity');
    super({ identity: opts.identity });
    this.#opts = {
      multiClient:      true,
      numSubClients:    4,
      warnAfter:        DEFAULT_WARN_AFTER_MS,
      connectTimeout:   DEFAULT_CONNECT_TIMEOUT,
      sendRetries:      DEFAULT_SEND_RETRIES,
      sendRetryDelayMs: DEFAULT_SEND_RETRY_DELAY,
      sendTimeoutMs:    DEFAULT_SEND_TIMEOUT,
      ...opts,
    };
    this.#checkSender = createSenderBinding({
      transportName:       'NknTransport',
      authenticatedSender: nknAuthenticatedSender,
      // Loud absence: a transport that cannot authenticate its senders must SAY so once, or an unchecked
      // receive path reads exactly like a checked one.
      onUnauthenticated:   (message) => this.emit('warn', message),
    });
  }

  /** True after the underlying NKN client has emitted 'connect'. */
  get connected() { return this.#connected; }

  /**
   * Routing hint — we can reach any address as long as our own NKN
   * client is connected to the mainnet.  Per-peer reachability is
   * implicit (NKN routes via the relay-node mesh).
   */
  canReach(_peerAddress) { return this.#connected; }

  async connect() {
    // Resolve nkn lib: explicit opts.nknLib, then window globals (CDN),
    // then dynamic import of 'nkn-sdk' / 'nkn-multiclient' (Node tests).
    this.#nknLib = await this.#resolveNknLib();

    const seed = this.#deriveSeed();
    await this.#tryConnect(seed, /* isRetry */ false);
  }

  async disconnect() {
    this.#connected = false;
    try { this.#client?.close?.(); } catch { /* defensive */ }
    this.#client = null;
    this._setAddress(null);
    this.#helloedPeers.clear();
    this.#inFlightHello.clear();
    this.emit('disconnect');
  }

  /**
   * Forget a peer — drop our cached "already helloed" mark so the
   * next send re-issues HI.  Routing layer calls this on transport
   * failure (e.g. peer rotated key).
   */
  forgetPeer(address) {
    this.#helloedPeers.delete(address);
    this.#inFlightHello.delete(address);
  }

  /**
   * Send HI to a peer at most once.  Concurrent callers serialise
   * on a per-address in-flight promise.  The `helloedPeers.add(addr)`
   * call happens AFTER `await sendHello` resolves — this is the
   * HI race correctness gate.
   *
   * Re-export of the gate for callers that want to pre-warm without
   * triggering a real send.
   */
  async sendHelloOnce(address) {
    if (this.#helloedPeers.has(address)) return;
    let inFlight = this.#inFlightHello.get(address);
    if (!inFlight) {
      inFlight = (async () => {
        // The payload carries our pubKey so the peer's SecurityLayer
        // auto-registers us (see SecurityLayer._autoRegisterFromHi).
        await this.sendHello(address, { pubKey: this.identity?.pubKey });
        // ── HI RACE FIX (inherited from secure-agent d15051e) ──
        // Mutation happens ONLY after the await resolves.  Concurrent
        // _put()s queued on the same address see helloedPeers === false
        // until the HI is actually on the wire.
        this.#helloedPeers.add(address);
      })().finally(() => {
        this.#inFlightHello.delete(address);
      });
      this.#inFlightHello.set(address, inFlight);
    }
    return inFlight;
  }

  /**
   * Wire-level send.  Wrapped with HI auto-introduce + retry on the
   * canonical NKN "send HI first" failure modes (see HI_RACE_PATTERNS).
   *
   * @param {string} to
   * @param {object} envelope
   */
  async _put(to, envelope) {
    if (!this.#client) throw new Error('NknTransport: not connected');
    // `#client` exists from construction; `#connected` only after the 'connect' event, which can be ~90 s
    // later. Passing the truthiness test and calling into a client that is still connecting is what hung
    // 801 sends — say no NOW so the routing layer can try a transport that is actually up. (`canReach()`
    // already reports this correctly; a transport must still refuse rather than trust every caller to ask.)
    if (!this.#connected) throw new Error('NknTransport: not connected yet (mesh still coming up)');

    // Auto-HI BEFORE the first OW to a peer.  HI envelopes themselves
    // skip this guard (they ARE the introduction).
    if (envelope?._p !== 'HI') {
      await this.sendHelloOnce(to);
    }

    const payload  = JSON.stringify(envelope);
    const retries  = Math.max(0, this.#opts.sendRetries | 0);
    const delayMs  = Math.max(0, this.#opts.sendRetryDelayMs | 0);

    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        await this.#withSendTimeout(this.#client.send(to, payload, { noReply: true }), to);
        return;
      } catch (err) {
        lastErr = err;
        const msg = String(err?.message ?? err ?? '');
        const isHiRace = HI_RACE_PATTERNS.some((re) => re.test(msg));

        if (!isHiRace) {
          // Non-HI errors propagate immediately so RoutingStrategy can
          // fall back to the next transport tier.
          throw err;
        }

        if (attempt < retries) {
          // The peer doesn't know us yet — most likely the receiver
          // restarted or we forgot to HI.  Drop the mark + retry.
          this.#helloedPeers.delete(to);
          await this.sendHelloOnce(to);
          if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
        // Out of retries; give the routing layer a clear signal.
        throw new Error(
          `NknTransport: send to ${to} failed after ${retries + 1} attempts; last error: ${msg}`,
        );
      }
    }
    /* istanbul ignore next */ throw lastErr;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  /**
   * Bound a wire send so a wedged mesh fails instead of hanging.
   *
   * Deliberately does NOT cancel the underlying send — nkn-sdk gives us no handle to do so, and a send that
   * lands late is harmless. What matters is that OUR promise settles, so the caller's timeout and failover
   * logic can run at all.
   */
  async #withSendTimeout(promise, to) {
    const ms = Math.max(0, this.#opts.sendTimeoutMs | 0);
    if (!ms) return promise;
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`NknTransport: send to ${to} timed out after ${ms}ms`)),
            ms,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }


  /**
   * Derive a 64-hex-char NKN seed from the agent's Ed25519 pubKey
   * bytes.  Same convention as `core/src/transport/NknTransport.js`
   * so a given agent has a stable NKN address across web + RN.
   */
  #deriveSeed() {
    if (!this.identity) return null;
    const bytes = this.identity.pubKeyBytes;
    if (!bytes) return null;
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Resolve the NKN library from (in order):
   *   1. opts.nknLib       — explicit injection (preferred, test seam)
   *   2. globalThis.nkn    — CDN UMD global (browser parity)
   *   3. dynamic import    — 'nkn-multiclient' then 'nkn-sdk' (Node + tests)
   *
   * Returns an object exposing `Client` and `MultiClient`.  Either is
   * acceptable; constructor will prefer MultiClient when opts.multiClient.
   */
  async #resolveNknLib() {
    if (this.#opts.nknLib) return this.#opts.nknLib;

    // eslint-disable-next-line no-undef
    if (typeof globalThis !== 'undefined' && globalThis.nkn) return globalThis.nkn;

    // Dynamic import for Node / RN-with-bundler.  Try nkn-multiclient
    // first (lighter wrapper); fall back to nkn-sdk.
    // Metro (unlike Node) requires a dynamic import's specifier to be a STRING LITERAL — it resolves the
    // dependency graph statically, so `import(pkg)` is an "Invalid call" and the whole bundle fails to
    // build. Spelling both out keeps the same behaviour (try the lighter wrapper, fall back to the SDK)
    // while staying analyzable. Found 2026-07-29 by running the app: it bundles on Node and not on RN.
    try {
      const mod = await import('nkn-multiclient');
      return mod.default ?? mod;
    } catch { /* fall through to nkn-sdk */ }
    try {
      const mod = await import('nkn-sdk');
      return mod.default ?? mod;
    } catch { /* neither available — the throw below is the honest answer */ }
    throw new Error(
      'NknTransport: no NKN library available.  Install `nkn-multiclient` ' +
      'or `nkn-sdk`, or pass opts.nknLib (e.g. window.nkn from CDN).',
    );
  }

  async #tryConnect(seed, isRetry) {
    return new Promise((resolve, reject) => {
      const clientOpts = seed ? { seed } : {};
      if (this.#opts.identifier) clientOpts.identifier = this.#opts.identifier;
      if (this.#opts.multiClient && Number.isFinite(this.#opts.numSubClients)) {
        clientOpts.numSubClients = this.#opts.numSubClients;
      }

      // Prefer MultiClient if both library and opts say so; else Client.
      const Ctor = this.#opts.multiClient && this.#nknLib.MultiClient
        ? this.#nknLib.MultiClient
        : this.#nknLib.Client;
      if (!Ctor) {
        reject(new Error('NknTransport: nknLib exposes neither MultiClient nor Client'));
        return;
      }
      this.#client = new Ctor(clientOpts);

      const warnTimer = setTimeout(() => {
        if (this.#connected) return;
        this.emit('warn', 'NKN still connecting — this can take up to 90 s on some nodes…');
      }, this.#opts.warnAfter);

      const hardTimer = setTimeout(() => {
        if (this.#connected) return;
        clearTimeout(warnTimer);
        // Seedless retry: occasionally the seed-derived node pool is
        // unreachable; without a seed nkn-sdk picks a fresh pool.
        if (!isRetry && seed) {
          this.emit('warn', 'NKN timed out with seed — retrying without seed…');
          try { this.#client?.close?.(); } catch { /* defensive */ }
          this.#client = null;
          this.#tryConnect(null, true).then(resolve, reject);
        } else {
          try { this.#client?.close?.(); } catch { /* defensive */ }
          this.#client = null;
          reject(new Error('NknTransport: connect timed out'));
        }
      }, this.#opts.connectTimeout);

      // nkn-sdk emits 'connect' with no args; addr is on the client.
      this.#client.on?.('connect', () => {
        clearTimeout(warnTimer);
        clearTimeout(hardTimer);
        this.#connected = true;
        this._setAddress(this.#client.addr);
        this.emit('connect', { address: this.address });
        resolve();
      });

      this.#client.on?.('message', (msg) => {
        let envelope;
        try {
          const raw = typeof msg.payload === 'string'
            ? msg.payload
            : msg.payload?.toString?.() ?? '';
          envelope = JSON.parse(raw);
        } catch { return; }

        // ── Sender binding — second line, NOT the wall (2026-07-31) ──────────
        //
        // The frame nkn hands us carries `msg.src`, and until now this handler threw it away and
        // delivered whatever sender the envelope's own `_from` field claimed. `_from` is free text: no
        // transport authenticates it, and a signature only proves someone holds A key, never that the key
        // belongs at the address the envelope names. So a peer who could reach us at all could speak as
        // anyone we had already keyed.
        //
        // This does not fix that. The fix is inverting identity resolution so the SIGNING KEY is the
        // identity and is authorised against the circle roster — a separate, larger build. Two limits are
        // worth stating plainly rather than discovering later:
        //   • it covers the transports that authenticate. The web/Node NKN adapter and the relay's two
        //     forward paths now ask the SAME rule, but a hostile relay sits outside the relay's own check
        //     (it is the thing checking), and any transport whose port returns null is unchecked — which
        //     is why the port announces that case instead of passing quietly.
        //   • it trusts nkn's own authentication, so it is only as good as that.
        // It exists to make the cheap remote impersonation expensive, not to be the boundary.
        const verdict = this.#checkSender(msg, envelope);
        if (!verdict.ok) {
          this.emit('warn',
            `NknTransport: dropped inbound envelope (${verdict.reason}) — `
            + `claimed "${String(verdict.claimed ?? '?').slice(0, 16)}…", `
            + `transport says "${String(verdict.authenticated ?? '?').slice(0, 16)}…"`);
          return;
        }
        this._receive(envelope);
      });

      this.#client.on?.('error', (err) => {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
      });
    });
  }

  /**
   * TODO(#224B Detox) — wire React Native AppState transitions so we
   * close on background + reconnect on foreground.  Left as a stub
   * because real-device verification is needed; will be tested via
   * Detox in the #224B slice.
   *
   * Suggested wiring (in the app, NOT here, to keep the transport
   * platform-pure):
   *
   *   import { AppState } from 'react-native';
   *   AppState.addEventListener('change', (state) => {
   *     if (state === 'background') tx.disconnect();
   *     if (state === 'active')     tx.connect();
   *   });
   */
  _onAppStateChange(_state) { /* TODO(#224B) */ }
}

// Re-export the HI race regex constants so secure-agent / tests can
// reuse the canonical patterns without re-deriving them.
export { HI_RACE_PATTERNS };
