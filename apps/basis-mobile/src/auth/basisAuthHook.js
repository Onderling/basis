/**
 * basisAuthHook — basis-mobile flavour of
 * `@onderling/oidc-session-rn/hook` (2026-05-26).
 *
 * Pre-binds `scheme: 'basis'` + `clientName: 'basis
 * (mobile)'` so the redirect URI + DCR cache key are namespaced
 * per app — identical pattern to apps/pinboard-mobile/src/auth/
 * pinboardAuthHook.js and apps/folio-mobile/src/auth/folioAuthHook.js.
 *
 * The `'basis'` scheme matches app.json's `expo.scheme`, so the
 * deep link `basis://auth/callback` is what `expo-auth-session`
 * uses for the OAuth round-trip.
 */
import { useOidcSignIn } from '@onderling/oidc-session-rn/hook';

export function useBasisAuth(args = {}) {
  return useOidcSignIn({
    scheme:     'basis',
    clientName: 'basis (mobile)',
    ...args,
  });
}
