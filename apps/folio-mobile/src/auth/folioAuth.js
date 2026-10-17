/**
 * folioAuth — pure-helpers shim around `@onderling/oidc-session-rn`.
 *
 * **2026-05-08:** the implementation moved to the
 * `@onderling/oidc-session-rn` substrate (Pinboard V3 Phase 40.3 — rule
 * of two consumer).
 *
 * This shim re-exports ONLY the pure helpers (no `expo-auth-session`
 * on the import chain). For the React hook (`useFolioAuth`) consumers
 * import from `./folioAuthHook.js` instead — it pulls
 * `expo-auth-session` at module load, which is fine at runtime but
 * fails vitest's transform when the test only needs the pure
 * `completeSignIn` path.
 */

import {
  completeSignIn as substrateCompleteSignIn,
  extractWebIdFromIdToken as substrateExtractWebIdFromIdToken,
  DEFAULT_INRUPT_ISSUER as SUBSTRATE_DEFAULT_INRUPT_ISSUER,
  DEFAULT_SCOPES as SUBSTRATE_DEFAULT_SCOPES,
  _setDiscoveryFn,
  _setExchangeFn,
} from '@onderling/oidc-session-rn';

export const DEFAULT_INRUPT_ISSUER = SUBSTRATE_DEFAULT_INRUPT_ISSUER;
export const DEFAULT_SCOPES        = SUBSTRATE_DEFAULT_SCOPES;
export const completeSignIn          = substrateCompleteSignIn;
export const extractWebIdFromIdToken = substrateExtractWebIdFromIdToken;

export { _setDiscoveryFn, _setExchangeFn };
