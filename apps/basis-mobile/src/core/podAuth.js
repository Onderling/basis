/**
 * Mobile podAuth adapter for Bundle F.
 *
 * Bridges the basis-mobile `useBasisAuth` hook + an
 * `OidcSessionRN` SecureStore-backed token holder into the
 * `podAuth`-shaped interface that
 * `apps/basis/src/core/localBuiltins.js` expects (the same
 * surface web's `@onderling/oidc-session` exposes).  Web's localBuiltins
 * handlers — `signin`, `signout`, `whoami` — call:
 *
 *   - `podAuth.startSignIn({issuer})`
 *   - `podAuth.resolveIssuer(input)`
 *   - `podAuth.getCurrentSession()`        // {webid} | null
 *   - `podAuth.getRawSessionInfo()`        // diagnostic shape
 *
 * `buildMobilePodAuth` returns that shape, delegating to the hook's
 * `signIn()` for the OAuth flow and to `OidcSessionRN` for
 * persisted-session lookups.
 *
 * Wiring: ChatScreen calls `useBasisAuth()` at render-time and
 * constructs `buildMobilePodAuth({hook, session})` once.  The shape
 * is stable across re-renders so localBuiltins sees a consistent
 * podAuth.
 *
 * V1 caveats:
 *   Real-pod end-to-end testing parks behind (no creds). The
 *     wiring + flow ARE in place; without creds the actual sign-in
 *     prompt returns "no issuer redirect" type errors.  Web has the
 *     same gap.
 *   - `resolveIssuer` uses the substrate's `resolveIssuer` for the
 *     KNOWN_ISSUERS list (Inrupt, NSS, SolidCommunity).
 */
import { resolveIssuer as _resolveIssuer, DEFAULT_ISSUER } from '@onderling/oidc-session-rn';

/**
 * @param {object} args
 * @param {object} args.hook      result of useBasisAuth (has .signIn(), .ready, .lastError)
 * @param {object} args.session   OidcSessionRN instance (already restored from SecureStore)
 * @returns {object} podAuth-shaped object
 */
export function buildMobilePodAuth({ hook, session, hookNow = null, chooseIssuer = null, readyWithinMs = 20000 }) {
  // the hook as it is NOW (its state changes after the issuer prop does); without a getter, the one handed in
  const current = () => (typeof hookNow === 'function' ? hookNow() : hook) ?? hook;
  return {
    // the system browser comes back to the app, so the sign-in completes here: the `signin` op waits for it and says
    // how it ended (localBuiltins.js); the web's navigates away instead
    completesInPlace: true,
    /**
     * Begin OAuth sign-in flow.  Returns a promise that resolves
     * AFTER the user completes (or cancels) the system browser
     * prompt — different from web's startSignIn which throws a
     * full-page redirect.
     *
     * THE CHOSEN PROVIDER: the hook's issuer is its PROP (useOidcSignIn), so the provider asked for is handed to the
     * screen that makes the hook (`chooseIssuer`), and the sign-in waits until the hook is ready FOR that provider (its
     * own discovery and client, `hook.issuer`). Until 2026-11-27 the choice never reached the hook: every sign-in went
     * to the default provider.
     */
    async startSignIn({ issuer } = {}) {
      const resolved = _resolveIssuer(issuer ?? DEFAULT_ISSUER?.url);
      const want = resolved?.url ?? issuer ?? null;
      if (typeof chooseIssuer === 'function' && want) {
        chooseIssuer(want);
        const until = Date.now() + readyWithinMs;
        for (;;) {
          const h = current();
          if (h?.issuer === want && h?.ready) break;
          // the provider ANSWERED and said no (its registration refused this app): not one that did not answer, and
          // nothing to wait for
          if (h?.issuer === want && h?.lastError?.code === 'REGISTRATION_REJECTED') {
            throw Object.assign(new Error(`the sign-in at ${want} was refused: ${h.lastError.message}`), { code: 'ISSUER_REFUSED', issuer: want });
          }
          if (Date.now() >= until) {
            throw Object.assign(new Error(`the sign-in at ${want} could not start: ${h?.lastError?.message ?? 'the provider did not answer'}`), { code: 'ISSUER_NOT_READY', issuer: want });
          }
          await new Promise((r) => setTimeout(r, 50));
        }
      }
      const result = await current().signIn({
        issuer: want,
      });
      // hook.signIn returns the FLAT token object ({accessToken, refreshToken, idToken, expiresAt, webid},
      // per completeSignIn + the package README) — adopt `result` itself, NOT `result.tokens` (which never
      // existed). The old `result.tokens` check silently skipped adoption, so sign-in "completed" with the
      // WebID resolved but the session never authenticated.
      if (result?.accessToken) {
        await session.adoptTokens(result);
      }
      return result;
    },

    /**
     * Resolve an issuer id/url to a {id, name, url} shape OR null
     * when the input doesn't match a known issuer.  Web's signin
     * handler uses this to validate the --issuer= flag.
     */
    resolveIssuer(input) {
      if (!input) return DEFAULT_ISSUER ?? null;
      return _resolveIssuer(input) ?? null;
    },

    /**
     * Return {webid} when a stored session exists, else null.  Used
     * by /whoami's signed-in path.
     */
    getCurrentSession() {
      if (!session.isAuthenticated()) return null;
      const webid = session.webid;
      if (!webid) return null;
      return { webid };
    },

    /**
     * Diagnostic dump — used by /whoami when the logged-in gate
     * fails so the user sees why.
     */
    getRawSessionInfo() {
      const status = session.getStatus();
      return {
        sessionExists: !!session.accessToken,
        isLoggedIn:    !!status.authenticated,
        webId:         status.webid ?? null,
        sessionId:     session.clientId ?? null,
      };
    },

    /**
     * Clear the persisted session (used by /signout).  Mirrors web's
     * podAuth.signOut.
     */
    async signOut() {
      await session.clear?.();
    },
  };
}
