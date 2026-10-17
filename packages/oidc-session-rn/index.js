/**
 * @onderling/oidc-session-rn — Solid OIDC sign-in for React Native.
 *
 * **Layer: SDK foundation (RN-specific).** The cross-platform
 * Solid OIDC story lives in `apps/folio/src/auth/OidcSession.js`
 * (using `@inrupt/solid-client-authn-node`); this package is the
 * RN-specific equivalent.
 *
 * **Public surface — split for bundler hygiene:**
 *
 *   - The default export (this file) ships ONLY the pure-JS pieces
 *     that have no Expo or React peer deps: `OidcSessionRN`,
 *     `completeSignIn`, `extractWebIdFromIdToken`, the DCR helpers,
 *     and key constants. Importers under unit-test runners (vitest +
 *     vite) don't have to satisfy expo-auth-session's TypeScript at
 *     parse time.
 *
 *   - The hook (`useOidcSignIn`) lives at the `/hook` subpath
 *     (`@onderling/oidc-session-rn/hook`). It pulls
 *     `expo-auth-session`, `expo-web-browser`, `expo-secure-store`,
 *     and `react` at module load. Apps that need the hook import
 *     from the subpath; substrates / pure tests use the default.
 *
 * Lifted from `apps/folio-mobile/src/auth/{OidcSessionRN, folioAuth, dcr}.js`
 * 2026-05-08 (Pinboard V3 Phase 40.3, rule-of-two consumer).
 */

export {
  OidcSessionRN,
  buildSecureStoreKeys,
  DEFAULT_APP_ID,
} from './src/OidcSessionRN.js';

export {
  completeSignIn,
  extractWebIdFromIdToken,
  DEFAULT_INRUPT_ISSUER,
  DEFAULT_SCOPES,
  _setDiscoveryFn,
  _setExchangeFn,
} from './src/completeSignIn.js';

export {
  loadOrRegisterClient,
  registerClient,
  buildRegistrationBody,
  clearStoredClient,
  _internal as _dcrInternal,
} from './src/dcr.js';

// Phase 52.15.1 (2026-05-14) — multi-issuer support. Mirrored from
// `@onderling/oidc-session/src/issuers.js`; keep both copies in sync.
export {
  KNOWN_ISSUERS,
  DEFAULT_ISSUER_ID,
  DEFAULT_ISSUER,
  resolveIssuer,
} from './src/issuers.js';
