/**
 * LocalTransport — localhost WebSocket transport (Group F).
 *
 * Connects to a WebSocket server on localhost (port or Unix socket path).
 * Uses the same register/send/message relay protocol as RelayTransport,
 * so it works out-of-the-box with WsServerTransport from @onderling/relay.
 *
 * Browser: uses globalThis.WebSocket.
 * Node.js: lazily imports the `ws` package.
 *
 * Unlike RelayTransport there is no auto-reconnect — if the connection drops
 * the transport emits 'disconnect' and must be manually reconnected.
 *
 * Registration is challenge-first, exactly as on `RelayTransport` (2026-07-31,
 * DESIGN-boundary-authentication §7): the server sends a nonce, we sign it with the key behind our
 * address, and a `registered` we never answered a challenge for is refused rather than accepted.
 * This transport speaks the same protocol as the relay brokers, so it inherits the same rule — a
 * localhost server is still a server that decides where our inbound traffic goes.
 */
import { Transport } from './Transport.js';
import { signAddressPossession } from '../identity/addressPossession.js';

/**
 * WebSocket transport to a localhost relay-style server, addressed by port, Unix
 * socket path, or full ws:// URL. Registers its address on open and feeds inbound
 * 'message' frames to `_receive`. No auto-reconnect: when the connection drops it
 * emits 'disconnect' and must be reconnected manually.
 */
export class LocalTransport extends Transport {
  #ws          = null;
  #url;
  #connectResolve = null;
  #connectPromise = null;
  #stopped     = false;

  /**
   * @param {object} opts
   * @param {import('../identity/AgentIdentity.js').AgentIdentity} opts.identity
   * @param {number}  [opts.port]       — localhost port
   * @param {string}  [opts.socketPath] — Unix socket path (Node.js only)
   * @param {string}  [opts.url]        — full ws:// URL (overrides port/socketPath)
   */
  constructor(opts) {
    if (!opts?.identity) throw new Error('LocalTransport requires identity');
    if (!opts.url && !opts.port && !opts.socketPath) {
      throw new Error('LocalTransport requires port, socketPath, or url');
    }
    super({ address: opts.identity.pubKey, identity: opts.identity });
    this.#url = opts.url
      ?? (opts.socketPath ? `ws+unix://${opts.socketPath}` : `ws://localhost:${opts.port}`);
  }

  get url() { return this.#url; }

  /** True when the WebSocket is open and registered with the server. */
  get connected() { return this.#ws?.readyState === 1; }

  async connect() {
    this.#stopped = false;
    this.#connectPromise = new Promise(r => { this.#connectResolve = r; });
    await this.#openSocket();
    return this.#connectPromise;
  }

  async disconnect() {
    this.#stopped = true;
    this.#ws?.close();
    this.#ws = null;
    this.emit('disconnect');
  }

  async _put(to, envelope) {
    if (!this.#connectPromise) throw new Error('LocalTransport: not connected');
    await this.#connectPromise;
    if (this.#ws?.readyState !== 1) throw new Error('LocalTransport: WebSocket not open');
    this.#ws.send(JSON.stringify({ type: 'send', to, envelope }));
  }

  // ── Private ───────────────────────────────────────────────────────────────

  async #openSocket() {
    let WS;
    if (typeof WebSocket !== 'undefined') {
      WS = WebSocket;
    } else {
      try {
        const mod = await import('ws');
        WS = mod.default ?? mod;
      } catch {
        throw new Error('LocalTransport: ws package not installed. Run: npm install ws');
      }
    }

    const ws = new WS(this.#url);
    this.#ws = ws;

    let proved = false;   // did we answer a challenge on THIS socket?

    ws.onopen = () => {
      proved = false;
      ws.send(JSON.stringify({ type: 'register', address: this.address }));
    };

    ws.onmessage = event => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

      if (msg.type === 'challenge' && msg.address === this.address && msg.nonce) {
        proved = true;
        ws.send(JSON.stringify({
          type:    'register-proof',
          address: this.address,
          nonce:   msg.nonce,
          proof:   signAddressPossession(this.identity, this.address, msg.nonce),
        }));
        return;
      }

      if (msg.type === 'registered') {
        if (!proved) {
          // No fallback: a server that registers an address without demanding proof is one where
          // anyone may claim ours. Report it and stay unregistered.
          this.emit('error', new Error(
            'LocalTransport server: registered without demanding proof of address possession — refusing.',
          ));
          try { ws.close(); } catch { /* already gone */ }
          return;
        }
        this.emit('connect', { address: this.address });
        const res = this.#connectResolve;
        this.#connectResolve = null;
        res?.();
        return;
      }
      if (msg.type === 'message' && msg.envelope) {
        this._receive(msg.envelope);
        return;
      }
      if (msg.type === 'error') {
        this.emit('error', new Error(`LocalTransport server: ${msg.message}`));
      }
    };

    ws.onerror = err => {
      const e = err?.error ?? err;
      this.emit('error', e instanceof Error ? e : new Error('LocalTransport WebSocket error'));
    };

    ws.onclose = () => {
      if (!this.#stopped) this.emit('disconnect');
    };
  }
}
