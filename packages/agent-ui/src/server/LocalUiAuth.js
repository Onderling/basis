/**
 * LocalUiAuth — V0 localhost-trust shim for `mountLocalUi`.
 *
 * Satisfies A2ATransport's `a2aTLSLayer` interface (encrypt /
 * decryptAndVerify pass-throughs + `validateInbound` / `wrapOutbound`).
 * On `validateInbound`, every request is treated as **tier 1 authenticated**
 * for a configured `localActor` webid — no token check, no per-request
 * cap-token, no OIDC. This is the deliberate V0 trade-off: when the agent
 * binds on `127.0.0.1`, any process on the same machine could already
 * exfiltrate the keypair from disk, so localhost-trust is the right level
 * of security for the localhost-only UI.
 *
 * V1 will replace this with one of:
 *   - cap-token-in-cookie (admin issues a per-browser-session token).
 *   - OAuth-PKCE flow against the user's Solid OIDC issuer.
 *
 * Until then, do **not** pass `host: '0.0.0.0'` to `mountLocalUi` while
 * using `LocalUiAuth` — that exposes the agent's skills to the LAN as
 * the configured actor, which is almost never what you want.
 *
 * @example
 *   import { mountLocalUi, LocalUiAuth } from '@onderling/agent-ui';
 *   const ui = await mountLocalUi(bundle.agent, {
 *     port:        8080,
 *     a2aTLSLayer: new LocalUiAuth({ localActor: 'https://id.example/anne' }),
 *     staticDir:   path.join(__dirname, 'web'),
 *   });
 */

export class LocalUiAuth {
  #localActor;
  #tier;

  /**
   * @param {object} opts
   * @param {string} opts.localActor
   *   webid (or any opaque identifier) the localhost-bound UI claims to be.
   *   Surfaces to skill handlers as `ctx.from` and `ctx.claims.sub`.
   * @param {number} [opts.tier=1]
   *   A2A tier the validated requests claim. 1 = "authenticated" (the
   *   tier `visibility: 'authenticated'` skills require). 2+ exists for
   *   richer auth schemes; V0 doesn't need them.
   */
  constructor({ localActor, tier = 1 } = {}) {
    if (!localActor || typeof localActor !== 'string') {
      throw new TypeError('LocalUiAuth: localActor (webid string) required');
    }
    this.#localActor = localActor;
    this.#tier       = tier;
  }

  // ── SecurityLayer interface (pass-throughs) ────────────────────────────
  encrypt(envelope)             { return envelope; }
  decryptAndVerify(rawEnvelope) { return rawEnvelope; }
  registerPeer()                { /* no-op */ }
  learnPeerKey()                { return 'unchanged'; }

  // ── HTTP-level auth ────────────────────────────────────────────────────
  /**
   * Outbound calls from this agent to other A2A peers don't get auth
   * headers from this layer — apps that need outbound auth supply their
   * own A2AAuth via a real A2ATLSLayer.
   */
  async wrapOutbound(_peerUrl, requestInit) { return requestInit; }

  /**
   * Inbound: every localhost-bound request is the configured actor.
   * Returns the tier + synthesised claims.sub so skill handlers see
   * `ctx.from === localActor`.
   */
  async validateInbound(_req) {
    return {
      tier:    this.#tier,
      claims:  { sub: this.#localActor, iss: 'local-ui' },
      peerId:  this.#localActor,
    };
  }
}
