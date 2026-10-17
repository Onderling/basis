# `@onderling/oidc-session-rn`

> **Layer:** SDK foundation (RN-specific).
> **Cross-platform sibling:** desktop OIDC lives in
> [`@onderling/oidc-session`](../oidc-session/) via `createSolidAuthNode()`.
> **Convention:** RN-specific substrates live in their own packages — see
> [`docs/conventions/architectural-layering.md`](../../docs/conventions/architectural-layering.md#mobile-substrates-live-in-their-own-packages-locked-2026-05-08).

Solid OIDC sign-in for React Native:

- `OidcSessionRN` — token persistence to a `SecureStore`-shaped store
  (`expo-secure-store` is canonical), bearer-fetch wrapper, transparent
  refresh-on-401, pro-active refresh on expiry. Compatible with
  `@onderling/pod-client`'s `SolidOidcAuth` interface.
- `useOidcSignIn` — React hook around `expo-auth-session` (PKCE
  authorize → `<scheme>://auth/callback` redirect → token exchange).
- `completeSignIn` — pure post-prompt code-exchange path; testable
  without React.
- DCR helpers (`loadOrRegisterClient`, `registerClient`,
  `buildRegistrationBody`, `clearStoredClient`) for the RFC 7591
  bootstrap that Solid OIDC requires.

**Multi-issuer support:**

- `KNOWN_ISSUERS`, `DEFAULT_ISSUER_ID`, `resolveIssuer()` — curated
  multi-issuer list mirrored from `@onderling/oidc-session`. Lets RN
  apps accept Inrupt + community + self-hosted Solid servers without
  hardcoding URLs.
- `<IssuerPicker>` at the `/picker` subpath
  (`@onderling/oidc-session-rn/picker`) — drop-in component for
  Sign-In screens. Renders the curated list as radio tiles +
  expandable "Custom URL" option. Adopted by folio-mobile /
  pinboard-mobile / tasks-mobile.

## Origins

Extracted from `apps/folio-mobile`'s auth code once a second app
needed the same sign-in flow; folio-mobile now consumes this package
via re-export shims under `apps/folio-mobile/src/auth/`. The
multi-issuer exports and picker are shared with the Node sibling
`@onderling/oidc-session`, so the Solid sign-in UX is the same
across the RN and web apps.

## Installation

```jsonc
// apps/<your-rn-app>/package.json
{
  "dependencies": {
    "@onderling/oidc-session-rn": "file:../../packages/oidc-session-rn",
    "expo-auth-session": "~6.0.3",
    "expo-secure-store": "~14.0.1",
    "expo-web-browser":  "~14.0.2",
    "react":             "18.3.1"
  }
}
```

## Per-app key prefix

Each app provides its own `appId` so a single device running both a
Folio install and a Pinboard install doesn't share secure-store keys
or DCR-cached `client_id` values:

```js
import { OidcSessionRN } from '@onderling/oidc-session-rn';

const session = new OidcSessionRN({
  store: SecureStore,
  appId: 'folio',     // → secure-store keys: folio-oidc-access-token, …
  // appId: 'pinboard',  // → secure-store keys: pinboard-oidc-access-token, …
});
```

The same prefix flows through DCR via `useOidcSignIn({ scheme })` —
the scheme value also serves as the DCR key prefix, so each app's
DCR-cached `client_id` is independent.

## Hook usage

```js
import { useOidcSignIn, OidcSessionRN } from '@onderling/oidc-session-rn';
import * as SecureStore from 'expo-secure-store';

function SignInScreen({ issuer = 'https://login.inrupt.com' }) {
  const { ready, signIn, lastError } = useOidcSignIn({
    issuer,
    scheme: 'pinboard',                 // matches app.json's URL scheme
    onWarning: (msg) => console.warn(msg),
  });

  return (
    <Button
      onPress={async () => {
        const tokens = await signIn();
        const session = new OidcSessionRN({ store: SecureStore, appId: 'pinboard' });
        await session.adoptTokens(tokens);
        // hand `session` to the app's ServiceContext / bundle config
      }}
      disabled={!ready}
    />
  );
}
```

## API surface

```js
export {
  OidcSessionRN,
  buildSecureStoreKeys,    // factory for per-appId key constants
  DEFAULT_APP_ID,          // 'oidc'
};

export {
  useOidcSignIn,
  completeSignIn,          // pure post-prompt path; for tests
  extractWebIdFromIdToken, // unverified id-token decode
  DEFAULT_INRUPT_ISSUER,   // 'https://login.inrupt.com'
  DEFAULT_SCOPES,          // ['openid', 'webid', 'offline_access']
  _setDiscoveryFn,         // test seam
  _setExchangeFn,          // test seam
};

export {
  loadOrRegisterClient,
  registerClient,
  buildRegistrationBody,
  clearStoredClient,
  _dcrInternal,            // { issuerKey, resolveKeyPrefix, DEFAULT_KEY_PREFIX }
};
```

## Testing

```bash
cd packages/oidc-session-rn
npm test
```

Tests use vitest with no RN runtime. The `useOidcSignIn` hook is not
exercised in unit tests (it requires React + expo-auth-session); the
pure `completeSignIn` path + `OidcSessionRN` token-lifecycle + DCR
helpers all are.
