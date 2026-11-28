/**
 * basisAuthHook — basis-mobile flavour of
 * `@onderling/oidc-session-rn/hook` (2026-05-26).
 *
 * Pre-binds the redirect scheme + `clientName: 'basis (mobile)'` so the redirect URI + DCR cache key are namespaced
 * per app — identical pattern to apps/pinboard-mobile/src/auth/pinboardAuthHook.js and
 * apps/folio-mobile/src/auth/folioAuthHook.js.
 *
 * The scheme is REVERSE-DOMAIN, the app's own package name (`org.onderling.basis://auth/callback`): a Community Solid
 * Server refuses a native client's plain custom scheme at registration (400 invalid_redirect_uri, "should use reverse
 * domain name based scheme"); Inrupt took `basis://`, which hid it. app.json and the Android manifest claim it
 * (schemesRegistered.test.js).
 */
import { useOidcSignIn } from '@onderling/oidc-session-rn/hook';

export function useBasisAuth(args = {}) {
  return useOidcSignIn({
    scheme:     'org.onderling.basis',
    clientName: 'basis (mobile)',
    ...args,
  });
}
