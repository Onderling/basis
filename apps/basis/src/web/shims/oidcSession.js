/**
 * Browser shim for `@onderling/oidc-session`.
 *
 * The real package pulls in `@inrupt/solid-client-authn-node` + the
 * Node-only `openid-client`.  basis v0.1 ships pre-signed-in
 * (per OQ-1.A) and never touches the OIDC code path; a future
 * cleanup should split @onderling/oidc-session into a browser-compat
 * + Node-only entry point.
 *
 * Until then this shim provides stub named exports matching
 * @onderling/oidc-session's `index.js` so esbuild (Vite's dep
 * pre-bundler in dev mode) can resolve the `import { SolidVault }`
 * in @onderling/core's `src/index.js`.  Stubs throw at use-time so a
 * mistaken call surfaces visibly rather than failing silently.
 */

function notImplemented(name) {
  return () => {
    throw new Error(
      `${name} is not available in the browser bundle. ` +
      `OIDC handoff lands in basis v0.6 via J6 (see ` +
      `/DESIGN-basis.md § Phase v0.6).`,
    );
  };
}

export const SolidVault         = notImplemented('SolidVault');
export const _setSessionFactory = notImplemented('_setSessionFactory');
export const KNOWN_ISSUERS      = {};
export const DEFAULT_ISSUER_ID  = null;
export const DEFAULT_ISSUER     = null;
export const resolveIssuer      = notImplemented('resolveIssuer');

// Phase 52.15.2 substrate (createSolidAuthNode + helpers).  Added to
// the shim 2026-05-23 because pinboard's `src/lib/podSignIn.js`
// statically imports these via the new `@onderling-app/pinboard/browser`
// composition path (slice-2b integration).  Pinboard only INVOKES them
// when signing into a pod (deferred until pod creds land); for
// the smoke they just need to resolve at module-load time.
export const createSolidAuthNode             = notImplemented('createSolidAuthNode');
export const OIDC_VAULT_KEYS                 = {};
export const _setSolidAuthNodeSessionFactory = notImplemented('_setSolidAuthNodeSessionFactory');
export const getIssuerPickerHtml             = notImplemented('getIssuerPickerHtml');
