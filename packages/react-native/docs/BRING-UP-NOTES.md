# BRING-UP-NOTES — getting `@onderling` apps to bundle on React Native

**Audience:** anyone working on a `@onderling` RN app (Folio mobile, future
H5/H8/etc.) when the bundler hits a polyfill or resolution wall.

**Source:** verbatim notes from Folio.C2's mobile bring-up
(`apps/folio-mobile/docs/SOLID-RN-NOTES.md`, drafted 2026-04-30 against
the `track-H-folio` branch — the first time `apps/folio-mobile` ran on
a real device after C2 shipped).  Folded into this package on
2026-05-02 as the canonical RN-platform-layer reference; the Folio doc
remains as the source-of-truth historical record.

The 17 traps below are the ones Folio hit; new traps that surface in
future bring-ups should be appended here, not duplicated in app docs.

---

## ⚠ READ THIS FIRST — use the metro-preset, do not hand-roll

> If your `apps/<your-app>/metro.config.js` does **not** start with
> `withOnderlingPreset`, you are going to rediscover most of the traps
> below the hard way.

**Symptom that triggers this:** any of the trap errors below — most
commonly `node:crypto` failing to import, `Buffer.from of undefined`,
or `posix.join of undefined` — appearing on a fresh app's first
bundle attempt.

**Cause:** apps that copy mesh-demo's old hand-rolled `metro.config.js`
(or write their own from scratch) end up parallel-implementing the
NODE_BUILTINS map + the `node:`-prefix strip + the util / path / ws
shim wiring.  The preset handles all of these in one place; the
hand-rolled copy invariably misses something.

**Fix:** rewrite the app's `metro.config.js` to use the shared preset.
The minimum boilerplate is:

```js
const path = require('path');
const { withOnderlingPreset } = require('@onderling/react-native/metro-preset');

module.exports = withOnderlingPreset({
  projectRoot: __dirname,
  repoRoot:    path.resolve(__dirname, '../..'),

  // App-specific pins / aliases / watch folders go here.
  // pinToAppModules: ['react', 'react-native', ...],
  // extraNodeModules: { ... },
  // extraSubpathResolvers: [...],
  // extraBlockListRegExps: [...],
});
```

`apps/folio-mobile/metro.config.js` is the canonical example;
`apps/sdk-smoke/metro.config.js` was migrated 2026-05-04 after hitting
Trap 3 from a hand-rolled copy and is the second example.

**This is also the architectural rule per
[`Project Files/conventions/architectural-layering.md`](../../../docs/conventions/architectural-layering.md):**
the metro-preset is a substrate; apps compose it; apps MUST NOT
parallel-implement it.

Specifically, apps that hand-roll typically miss:

| Trap | What's missed | What you'll see |
|---|---|---|
| Trap 3 | `node:`-prefix stripping | `Cannot import "node:crypto"` |
| Trap 5 | `util` shim with `TextDecoder` / `TextEncoder` getters | `Cannot read property 'decode' of undefined` deep in `whatwg-url` |
| Trap 11 | `buffer` real polyfill + `globalThis.Buffer` | `Cannot read property 'from' of undefined` in `@inrupt/solid-client` |
| Trap 11.5 | `path` POSIX shim | `Cannot read property 'join' of undefined` at module-load time |
| Trap 4 | Real `events` polyfill | `class X extends EventEmitter {}` crashes |
| Trap 20 | Per-bundle `core.Agent` in a multi-scope app | Duplicate mDNS / relay registrations under one identity |

If you see any of those, **stop fixing the hand-rolled config** — you
will keep finding new traps. Migrate to the preset; the preset
already handles them all.

---

---

## TL;DR

Solid's Node-first ecosystem (`@inrupt/solid-client-authn-node`,
`whatwg-url`, etc.) bundles into RN with a long tail of polyfill needs.
Most of those Node libs are *bundled-but-never-invoked* on mobile because
folio-mobile uses RN-native alternatives (`expo-auth-session`,
`expo-crypto`, `expo-secure-store`).  But Metro still has to resolve
every import in the static dep graph — so bundle-time fails
even on dead-code paths.

Pattern:
- For Node modules that NEVER actually get invoked at runtime → empty shim
  is fine *but* use **lazy getters** for `globalThis` re-exports (Hermes
  installs `TextDecoder`/`URL` after user-bundle init).
- For Node modules that ARE invoked at runtime → install a real polyfill
  package and let Metro resolve to it normally (don't shim).

---

## Pinned versions (working set as of 2026-04-30)

```
expo                              52.0.49
expo-modules-autolinking          2.0.8       (SDK 52 era; has the
                                                react-native-config
                                                autolinking subcommand)
react-native                      0.76.9
expo-auth-session                 6.0.3
expo-crypto                       14.0.2
react-native-get-random-values    1.11.0      (must be first import
                                                in index.js)
tweetnacl                         1.0.3
@scure/bip39                      2.2.0

# Polyfills installed solely to fix bundle/runtime issues:
util                              0.12.5      (browserify util)
events                            3.3.0       (browser-compat EventEmitter)
punycode                          2.3.1       (whatwg-url's punycode.ucs2.decode)
```

If `package.json` and `node_modules/expo/package.json` disagree on the
SDK version, you have a stale lockfile.  See "Trap 0" below.

---

## What broke, in the order it surfaced

### Trap 0 — `package.json` and lockfile drift

**Symptom:** after `rm -rf node_modules && npm install`, the installed
`expo` was 49.x even though `package.json` declared `^52.0.0`.

**Cause:** `package.json` had local uncommitted edits that mixed SDK 49
and SDK 55 versions (incoherent — no single SDK ever shipped that combo).
Probably a half-completed `npx expo install` from a prior session.  The
lockfile mirrored the broken state.

**Fix:**

```bash
git checkout -- apps/folio-mobile/package.json apps/folio-mobile/package-lock.json
rm -rf apps/folio-mobile/node_modules
cd apps/folio-mobile && npm install
```

**Verify:**

```bash
node -p "require('./node_modules/expo/package.json').version"                       # 52.x
node -p "require('./node_modules/expo-modules-autolinking/package.json').version"   # 2.x
```

### Trap 1 — Gradle "autolinkLibrariesFromCommand" failure

**Symptom:**

```
ERROR: autolinkLibrariesFromCommand: process node ... react-native-config ... exited with error code: 1
```

Gradle hides the real error.  Reproduce manually to surface it:

```bash
cd apps/folio-mobile
node --no-warnings --eval "require(require.resolve('expo-modules-autolinking', { paths: [require.resolve('expo/package.json')] }))(process.argv.slice(1))" react-native-config --json --platform android
```

**Cause (when SDK 49 is installed):** `expo-modules-autolinking@1.5.x`
doesn't have a `react-native-config` subcommand.  That subcommand
landed in 2.x with SDK 52.

**Fix:** the same as Trap 0 — get expo back to 52.x.

### Trap 2 — `Unable to resolve "@onderling-app/folio/rn/serviceFactory"`

**Symptom:** Metro fails on a dynamic `import()` of a workspace
sibling's subpath, even though `apps/folio/package.json` `exports`
declares `./rn/serviceFactory`.

**Cause:** `metro.config.js` has `unstable_enablePackageExports: false`
(deliberate — avoids a Hermes ESM/CJS issue per the comment in that
file).  With exports off, Metro falls back to "package name +
subpath" resolution.  The `extraNodeModules` map for
`@onderling-app/folio` points at `apps/folio` (workspace root), and
Metro appends `rn/serviceFactory.js` → `apps/folio/rn/serviceFactory.js`
→ doesn't exist (the real file is at `apps/folio/src/rn/...`).
Adding `'@onderling-app/folio/rn/serviceFactory'` as a separate
key in `extraNodeModules` doesn't help — Metro silently picks the
shorter prefix when both are present.

**Fix:** use the preset's `extraSubpathResolvers` hook (called BEFORE
Metro's default name-prefix resolution).  Each resolver is a
`(moduleName, repoRoot, projectRoot) → null | {filePath, type}`
function; return `null` to fall through to the next.

```js
module.exports = withOnderlingPreset({
  // ...
  extraSubpathResolvers: [
    (moduleName, repoRoot) => {
      if (moduleName.startsWith('@onderling-app/folio/rn/')) {
        const sub = moduleName.slice('@onderling-app/folio/rn/'.length);
        return {
          filePath: path.resolve(repoRoot, 'apps/folio/src/rn', sub + '.js'),
          type:     'sourceFile',
        };
      }
      return null;
    },
  ],
});
```

**Recurrence (2026-05-08, stoop-mobile Phase 40.7 / 40.10):** the
same trap bit `apps/stoop-mobile/metro.config.js` for two subpaths:

| Bare import                          | What we wanted                              | What Metro tried                        |
|--------------------------------------|---------------------------------------------|-----------------------------------------|
| `@onderling-app/stoop/lib/geo`        | `apps/stoop/src/lib/geo.js`                 | `apps/stoop/lib/geo` (404)              |
| `@onderling-app/stoop/locales/en`     | `apps/stoop/locales/en.json`                | `apps/stoop/locales/en` (404 — no .js)  |

Adding `@onderling-app/stoop/lib/geo` to `extraNodeModules` looked
correct but was silently shadowed by the parent-prefix
`@onderling-app/stoop` entry. Vitest didn't catch it (Vite's alias
engine respects exact-match keys); only the on-device Metro bundle
failed.

The `extraSubpathResolvers` hook in `apps/stoop-mobile/metro.config.js`
is the canonical fix; reuse the same pattern for any future
workspace-sibling subpath import.

### Trap 3 — `node:`-prefix imports

**Symptom:**

```
You attempted to import the Node standard library module "node:crypto"
from "../../packages/core/src/identity/Bootstrap.js".
```

**Cause:** `core` uses `import crypto from 'node:crypto'`.  The
`NODE_BUILTINS` set in `metro.config.js` listed `crypto` but not
`node:crypto`.  Different strings to Metro.

**Fix:** strip `node:` prefix in `resolveRequest`:

```js
const stripped = moduleName.startsWith('node:') ? moduleName.slice(5) : moduleName;
if (NODE_BUILTINS.has(stripped)) { return shim; }
// ...
if (moduleName.startsWith('node:')) {
  return context.resolveRequest(context, stripped, platform);
}
```

The second branch is needed when the stripped name is NOT in
`NODE_BUILTINS` (e.g. `node:events` → falls through to the real
`events` polyfill in node_modules).

### Trap 4 — empty shim breaks runtime when consumers actually use the module

**Symptom (after fixing Traps 1–3):**

```
TypeError: Cannot read property 'decode' of undefined
  at URLStateMachine (whatwg-url/lib/url-state-machine.js)
```

**Cause:** `whatwg-url/lib/url-state-machine.js` does
`const punycode = require('punycode')` and later
`punycode.ucs2.decode(...)`.  Our shim returned `{}`; `.ucs2` was
undefined; `.decode(...)` threw.

**Fix:** install the real polyfill, remove from the shim list:

```bash
npm install punycode
```

```js
// Drop 'punycode' from NODE_BUILTINS in metro.config.js
```

**Same pattern for `events`** (libraries doing `class X extends
EventEmitter {}` from `require('events')`):

```bash
npm install events
```

```js
// Drop 'events' from NODE_BUILTINS
```

### Trap 5 — `util` exports `inherits` but NOT `TextDecoder`

**Symptom:** even after installing `util` and removing it from the
shim list, `whatwg-url`'s
`const { TextDecoder } = require('util')` still got undefined.

**Cause:** the npm `util` browser polyfill (`util@^0.12`) implements
classic Node util (`inherits`, `format`, `inspect`, `types`) but
**not** `TextDecoder` / `TextEncoder`.  Those were added to Node's
`util` module later and aren't in the polyfill.

**Fix:** custom shim that wraps the polyfill and adds the codecs from
`globalThis` via lazy getters.  See `shims/util.js`:

```js
const realUtil = require('util/');   // trailing slash forces resolution to node_modules
module.exports = realUtil;
Object.defineProperties(module.exports, {
  TextDecoder: { get() { return globalThis.TextDecoder; }, enumerable: true, configurable: true },
  TextEncoder: { get() { return globalThis.TextEncoder; }, enumerable: true, configurable: true },
});
```

Wire `util` to this in `resolveRequest` (BEFORE the default
fallthrough):

```js
if (stripped === 'util') {
  return { filePath: path.resolve(__dirname, 'shims/util.js'), type: 'sourceFile' };
}
```

The `util/` (trailing slash) inside the shim forces Metro to resolve
the npm `util` package, NOT loop back through our `resolveRequest`.

### Trap 6 — globals are `undefined` at shim load time

**Symptom:** the empty shim's eager `URL: globalThis.URL`
captured `undefined` (RN installs URL on globalThis after user-bundle
init).

**Fix:** use lazy getters in `shims/node-builtins.js`:

```js
Object.defineProperties(module.exports, {
  TextDecoder:     { get: () => globalThis.TextDecoder,     enumerable: true },
  TextEncoder:     { get: () => globalThis.TextEncoder,     enumerable: true },
  URL:             { get: () => globalThis.URL,             enumerable: true },
  URLSearchParams: { get: () => globalThis.URLSearchParams, enumerable: true },
});
```

⚠️ **Caveat:** this only helps if the consumer reads `.TextDecoder`
LATER (e.g. inside a function body).  If the consumer destructures at
module-load time (`const { TextDecoder } = require('util')`), the
getter fires immediately — and if globalThis isn't ready yet, you
still capture `undefined`.  This is exactly why `whatwg-url` needed
the real `util` polyfill (Trap 5), not just the lazy-getter shim.

---

### Trap 7 — Inrupt's IdP rejects the redirect-URI-as-client-id pattern

**Symptom:** after the bundler is happy and sign-in is tappable,
Inrupt returns:

```json
{ "status": 401, "error": "invalid_client",
  "error_description": "Invalid client_id" }
```

**Cause:** `expo-auth-session` defaults `client_id` to the redirect URI
when none is provided.  For the web SDK that's a fetchable URL — Inrupt
fetches it as a Solid-OIDC client identifier doc and validates the
metadata.  For mobile the redirect URI is `folio://auth/callback` (a
custom scheme), which Inrupt cannot fetch, so it refuses.

**Fix:** Dynamic Client Registration (RFC 7591) before sign-in.  See
`apps/folio-mobile/src/auth/dcr.js`.  Each device POSTs once to the
issuer's `registration_endpoint`, gets a fresh `client_id`, persists it
to `expo-secure-store` keyed by issuer, and reuses it on every later
sign-in.  This is what `@inrupt/solid-client-authn-node` does
transparently for the desktop side.

Implementation outline:

```js
// dcr.js — registerClient()
const body = {
  redirect_uris:              [redirectUri],
  client_name:                'Folio (mobile)',
  application_type:           'native',
  token_endpoint_auth_method: 'none',
  grant_types:                ['authorization_code', 'refresh_token'],
  response_types:             ['code'],
  scope:                      'openid webid offline_access',
};
const r = await fetch(discovery.registrationEndpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body:    JSON.stringify(body),
});
const { client_id } = await r.json();
```

`folioAuth.js`'s `useFolioAuth` hook now waits on both discovery AND
`resolvedClientId` before building the auth request.

### Trap 8 — `expo-secure-store` rejects `::` in keys

**Symptom:**

```
Invalid key provided to SecureStore.  Keys must not be empty and
contain only alphanumeric characters, ".", "-", and "_".
```

**Cause:** my first DCR commit used `KEY_PREFIX = 'folio-dcr-client-id::'`
and built keys like `folio-dcr-client-id::login.inrupt.com`.  The double
colon is not in `expo-secure-store`'s allowed character set.

**Fix:** stick to `[A-Za-z0-9._-]`.  Use `-` (single dash) as
separator.  See `dcr.js` `KEY_PREFIX`.

### Trap 9b — Pod root ≠ WebID origin

**Symptom:** after sign-in, the pod-root input shows
`https://id.inrupt.com/folio/` — the IdP host, not the user's actual
storage host.

**Cause:** the original `suggestPodRoot(webid)` just took the WebID
URL's origin and appended `/folio/`.  That works on Solid Community
Server (where WebID and storage share the same host) but **not on
Inrupt**, which separates `id.inrupt.com` (IdP, hosts WebID profiles)
from `storage.inrupt.com/<uuid>/` (the actual pod).  Generally you
cannot derive the pod URL from the WebID URL — the pod is *declared*
by the WebID profile, not encoded in its hostname.

**Fix:** **fetch the WebID profile** and read the `pim:storage`
predicate.  The W3C IRI is
`http://www.w3.org/ns/pim/space#storage` (often shortened as
`space:storage` or `pim:storage`); some servers emit `solid:storage`
too.  See `discoverPodRoot()` in `src/lib/podRootHelpers.js`.

UX detail: keep `suggestPodRoot()` as a synchronous fallback so the
input is never empty, then replace asynchronously when discovery
returns:

```js
if (tokens.webid) {
  setPodRootInput(suggestPodRoot(tokens.webid));        // instant
  discoverPodRoot(tokens.webid, { accessToken: tokens.accessToken })
    .then(real => { if (real) setPodRootInput(real + 'folio/'); });
}
```

The discovery uses plain `fetch` with `Accept: text/turtle,
application/ld+json`; passing the access token as a Bearer header
covers private profiles too.  Most Inrupt WebIDs are public, so the
unauth path works on the common case.

### Trap 9 — `useAuthRequest(null, discovery)` crashes

**Symptom:**

```
TypeError: Cannot read property 'scopes' of null
  in SignInScreen
```

**Cause:** when DCR is in flight (no `clientId` yet), I tried passing
`null` as the config to `expo-auth-session`'s `useAuthRequest`.  This
version reads `.scopes` on the config unconditionally — null crashes.

**Fix:** always pass a valid config; use the `redirectUri` as a
placeholder `clientId` until DCR completes.  The actual
`promptAsync()` call is gated on `resolvedClientId` in `signIn()`, so
the placeholder never reaches the IdP.

```js
const [request, , promptAsync] = AuthSession.useAuthRequest(
  {
    clientId: resolvedClientId ?? redirectUri,
    scopes,
    redirectUri,
    /* ... */
  },
  discovery,
);
```

---

### Trap 11.5 — `posix.join` of undefined at module load (path shim)

**Symptom:** during `await import('@onderling-app/folio/rn/serviceFactory')`
boot, sync engine init crashes with:

```
TypeError: Cannot read property 'join' of undefined
  (deep inside the asyncRequire chain — module-load time)
```

**Cause:** `apps/folio/src/PathMap.js` does:

```js
import { sep as pathSep, posix } from 'node:path';
// ...
export const joinRel = posix.join;   // ← top-level, runs at module init
```

The empty `path` shim in `node-builtins.js` returned no `posix`
property, so `posix` was `undefined`, and `posix.join` threw before
any user code ran.  Same root cause for the `sep` import in
`scanLocal.js` and `versions.js`, but `pathSep` is just used inside
function bodies, so those don't crash at load.

**Fix:** real POSIX `path` shim — `apps/folio-mobile/shims/path.js`.
Tiny pure-JS implementation of `sep`/`join`/`dirname`/`basename`/`extname`
plus a `posix.*` namespace mirror.  Wired in `metro.config.js`'s
`resolveRequest` (BEFORE the NODE_BUILTINS check):

```js
if (stripped === 'path') {
  return { filePath: path.resolve(__dirname, 'shims/path.js'), type: 'sourceFile' };
}
```

Why not the npm `path-browserify`?  Two reasons:
- We only need POSIX semantics — RN FS is always `/`-separated.  No need
  for the win32 branch.
- Folio already has `pathPosix.js` for the same purpose; this shim is
  the same idea on the import boundary instead of the call boundary.

**Pattern recap:** `path` joins the family of "real implementation
needed at module-load time" — `util`, `events`, `punycode`, `buffer`,
and now `path`.  The empty-shim approach is reserved for modules
whose code paths are truly never reached at runtime (`fs`,
`child_process`, `tls`, etc.) — code that's bundled-but-dead.

### Trap 11 — `Buffer.from` of undefined inside `@inrupt/solid-client`

**Symptom:** after sign-in succeeds and `adoptTokens` boots the
service, the first pod read/write triggers:

```
TypeError: Cannot read property 'from' of undefined
  (mentions SolidPodSource.js)
```

**Cause:** `@inrupt/solid-client` does `Buffer.from(...)` internally
(it actually nests its own `buffer` polyfill in
`node_modules/@inrupt/solid-client/node_modules/buffer/`).  Our metro
shim list had `'buffer'`, so every `require('buffer')` from anywhere
got redirected to the empty shim — turning `Buffer` into `undefined`
and `.from(...)` into the crash above.

**Fix:** install the polyfill, remove from `NODE_BUILTINS`, AND install
`Buffer` on `globalThis` early in `index.js`:

```bash
npm install buffer
```

```js
// metro.config.js — drop 'buffer' from NODE_BUILTINS
```

```js
// index.js — must run before any code that synthesizes Buffer
import { Buffer } from 'buffer';
if (typeof globalThis.Buffer === 'undefined') globalThis.Buffer = Buffer;
```

The first two steps make `require('buffer')` resolve to a real
implementation; the third is the one that's easy to miss.  Many libs
reference `Buffer` as a free identifier (the way Node makes it global)
without ever doing `require('buffer')` themselves — so resolving the
module isn't enough.

This is the same pattern as `events`, `util`, `punycode` — but
**buffer is special** because it's also expected as a global, not just
a module export.  The other three don't have that wrinkle.

Recap of the broader pattern: when a real-runtime call site reaches
into a Node-builtin name, the empty shim is the wrong answer — install
the polyfill and let Metro find it normally.  Then check if the lib
uses the name as a free identifier (Buffer, process) and if so, also
install it on globalThis.

---

### Trap 12 — `Blob.arrayBuffer / Blob.text` missing on RN

**Symptom:** after the engine boots cleanly and a sync attempt actually
runs, the first pod file fetch crashes:

```
TypeError: blob.arrayBuffer is not a function (it is undefined)
```

**Cause:** `@inrupt/solid-client`'s `getFile` returns a Web `Blob`, and
the call site reads its bytes with `blob.arrayBuffer()` / `blob.text()`.
Both methods are part of the modern Blob spec but **RN's Blob doesn't
implement them** — it has only the legacy `slice()` etc.

**Fix:** monkey-patch them in `index.js` using `FileReader` (which RN
DOES implement):

```js
if (typeof Blob !== 'undefined') {
  if (typeof Blob.prototype.arrayBuffer !== 'function') {
    Blob.prototype.arrayBuffer = function () {
      return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload  = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.readAsArrayBuffer(this);
      });
    };
  }
  if (typeof Blob.prototype.text !== 'function') {
    Blob.prototype.text = function () {
      return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload  = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.readAsText(this);
      });
    };
  }
}
```

This is a runtime polyfill (lives in `index.js`), not a Metro-resolution
shim — Blob is a global, not a module.  Pattern: **when RN's
implementation of a Web API is incomplete, monkey-patch on globalThis
in `index.js` early.**  Examples seen so far: `globalThis.Buffer`
(Node global, trap 11), `Blob.prototype.arrayBuffer/text` (Web API,
this trap).

---

### Trap 13 — `new Blob([uint8Array], ...)` rejected by RN

**Symptom:** uploads to the pod fail with:

```
NetworkError: Creating blobs from 'ArrayBuffer' and 'ArrayBufferView'
              are not supported
```

**Cause:** RN's Blob constructor only accepts strings and other Blobs.
The Web spec accepts `ArrayBuffer` and `ArrayBufferView` (e.g.
`Uint8Array`), but RN never implemented those.  `@inrupt/solid-client`
does `new Blob([content], { type })` where `content` is whatever
`fs.readFile` returned — and Folio's RN fs adapter (`fsRN.js`) returns
`Uint8Array` (via base64 → bytes from `expo-file-system`).

**Fix:** monkey-patch the Blob constructor to UTF-8-decode binary
parts into strings before delegating to the original.  In `index.js`:

```js
const OrigBlob = globalThis.Blob;
function PatchedBlob(parts, options) {
  if (Array.isArray(parts) && globalThis.TextDecoder) {
    const td = new globalThis.TextDecoder('utf-8');
    parts = parts.map((p) => {
      if (p instanceof ArrayBuffer)  return td.decode(p);
      if (ArrayBuffer.isView?.(p))   return td.decode(p);
      return p;
    });
  }
  return new OrigBlob(parts, options);
}
PatchedBlob.prototype = OrigBlob.prototype;
globalThis.Blob = PatchedBlob;
```

⚠️ **This is text-correct, not binary-correct.**  Folio v0 writes
utf8 text (markdown, plain text) so the decode is lossless.  When
Folio mobile starts writing TRULY binary content (images,
attachments), this polyfill will corrupt the bytes because UTF-8
decoding mangles non-text byte sequences.  Revisit then — the proper
fix is to take the base64 round-trip via a `data:` URI or use a
native blob bridge package.  Until then, we lean on "Folio = text".

### Trap 14b — Token expiry + closure-captured bearer

**Symptom:** sync works fresh after sign-in.  An hour later, every
write fails with `[401] UNAUTHORIZED`.  Signing out and back in
doesn't help — the engine keeps using the old (expired) token.

**Cause (two compounding):**

1. **No automatic token refresh.**  `OidcSessionRN.getAuthenticatedFetch`
   originally captured the access token by value and sent it forever.
   The Inrupt access token TTL is ~1 hour; after that, every write
   401s.  The original code even acknowledged this:
   `"v0 uses sign-in-again on lapse; future versions can layer refresh"`.

2. **Closure capture means re-login doesn't update the engine.**
   The original wrapper:
   ```js
   const token = this.#accessToken;
   return async (input, init) => {
     headers.set('Authorization', `Bearer ${token}`);
     ...
   };
   ```
   captured `token` ONCE when `getAuthenticatedFetch()` was called.
   The engine cached the wrapper.  Even after the user re-signs-in
   and `adoptTokens` updates `this.#accessToken`, the wrapper still
   uses the stale variable.

**Fix:**

1. Read `this.#accessToken` AT CALL TIME (in the inner arrow function),
   not at `getAuthenticatedFetch()` time.
2. Add `OidcSessionRN.refresh()` — POSTs to the issuer's
   `token_endpoint` with `grant_type=refresh_token`, the stored
   refresh_token, and the DCR-issued `client_id`.  Honours
   refresh-token rotation.  Persists new tokens to secure-store.
3. The fetch wrapper calls `refresh()` pro-actively when
   `expiresAt` has passed AND we have a refresh token.  Also
   reactively on 401 (one retry).

The refresh body is plain OIDC-spec form-encoded:

```
grant_type=refresh_token
refresh_token=<stored>
client_id=<dcr-issued>
```

Public clients (`token_endpoint_auth_method: 'none'` from DCR) don't
send a client_secret.

⚠️ **Engine-cached fetch wrappers are dangerous more broadly.**  Any
auth code path that holds a token reference in a closure will have
this bug.  When in doubt: closures must read mutable session state
through the session object, not through captured locals.

### Trap 14 — 412 noise from `createContainer`

**Symptom:** logcat full of:

```
[engine.error ensure-container https://storage.inrupt.com/<uuid>/notes/]
ConflictError: ... [412] Precondition Failed
```

**Cause:** Inrupt's `createContainerAt` sends `If-None-Match: *`.  When
the container ALREADY exists (which is the common case after first
sync), the server returns 412.  The engine's `ensure-container` step
catches but emits an `error` event, generating noise.  Sync continues
correctly — it's just confusing during debugging.

**Fix (deferred):** patch the engine's `ensure-container` block to
treat `err.code === 'CONFLICT'` / `status === 412` as success.  Not
done yet because it touches `apps/folio/src/SyncEngine.js` (shared
with desktop) and the error is just noise, not blocking.

---

### Trap 18 — `Default FirebaseApp is not initialized` on Android push registration

**Symptom (sdk-smoke S11, 2026-05-04, Android local dev build):**

```
[expo-notifications] Default FirebaseApp is not initialized in
  org.onderling.sdksmoke. Make sure to call FirebaseApp.initializeApp(Context)
  first.
```

…thrown from `bridge.register({projectId})` → `ExpoNotificationsAdapter.register`
→ `Notifications.getExpoPushTokenAsync(...)`.

**Cause:** Expo SDK 49+ uses **FCM** (Firebase Cloud Messaging) for
Android push.  The native Firebase Android SDK refuses to mint a token
without a `google-services.json` baked into the APK at build time.
Custom dev builds (anything that isn't Expo Go) require this file —
Expo Go has a shared one provided by Expo, but our app has its own
package id (`org.onderling.sdksmoke`) so we must provide our own.

**Fix:**

This is real Firebase setup, ~10 minutes:

1. **Create a Firebase project** at <https://console.firebase.google.com/>
   (free tier is fine; "sdk-smoke-dev" or similar).
2. **Add an Android app** to the project. Package name MUST match
   `app.json` `expo.android.package` exactly (`org.onderling.sdksmoke`).
3. **Download `google-services.json`** when prompted; place at
   `apps/<app>/google-services.json`.
4. **Wire it into `app.json`** under the `android` block:
   ```json
   "android": {
     "package": "org.onderling.sdksmoke",
     "googleServicesFile": "./google-services.json",
     ...
   }
   ```
5. **Rebuild the dev client.** `npx expo run:android` regenerates the
   native project picking up `googleServicesFile` automatically.  EAS
   Build does the same on `eas build`.
6. **For Expo's push proxy to actually deliver to your FCM project**
   (i.e. for the `https://exp.host/--/api/v2/push/send` call from
   `ExpoPushSender` to land on the device), Expo also needs the FCM v1
   server-side service-account JSON registered for your EAS project:
   - Firebase console → Project Settings → Service accounts →
     **Generate new private key**.  Save as e.g.
     `apps/<app>/firebase-service-account.json` (gitignore this).
   - From the app dir: `npx eas credentials → Android → push notifications →
     FCM V1 → upload`.
   - Or via the Expo dashboard: project → Credentials → Push
     Notifications → upload the service-account JSON.

**`google-services.json` is gitignored** in `.gitignore` already if the
repo follows Expo conventions; the firebase service-account JSON
should also be gitignored.  Both contain credentials.

**Verify:**

```bash
# Inside the dev build, expo-notifications should be able to mint a token:
adb logcat | grep -E "ExpoPushTokenAsync|FirebaseApp"
```

A successful run prints `[expo-notifications] Got token: ExponentPushToken[...]`.

**Pattern recap:** Expo Go on Android works without `google-services.json`
because Expo provides a shared Firebase config baked into Expo Go itself.
Every custom dev build (and every production build) of every app that
uses `expo-notifications` MUST provide its own.  This is per-app, not
per-monorepo — sibling apps need their own Firebase apps + JSON files
since each one's package id is distinct.

---

### Trap 19 — `Unable to resolve "@onderling/relay" / "web-push"` from Stoop barrel

**Symptom (Stoop V3 mobile Phase 40.23, 2026-05-08):**

```
Android Bundling failed 8041ms index.js (2063 modules)
Unable to resolve "@onderling/relay" from "../stoop/src/lib/WebPushSender.js"
```

**Cause:** `apps/stoop/src/Agent.js` does a **dynamic** `import()` of
`./lib/WebPushSender.js` only when VAPID keys are configured.  At
runtime the branch never fires on mobile (we use native Expo push).
But Metro's static analyser walks dynamic `import()` calls during
bundling and follows the chain into `WebPushSender.js` →
`@onderling/relay` → `web-push`.  Both are Node-only server packages.

**Fix:** add the two packages to the preset's `extraNodeModules`
shim list (alongside `@inrupt/solid-client-authn-node`, `chokidar`,
`express`, `systray2`).

```js
// packages/react-native/metro-preset.cjs (already applied)
extraNodeModules: {
  // ...
  '@onderling/relay': SHIM_PATHS.nodeBuiltins,
  'web-push':        SHIM_PATHS.nodeBuiltins,
}
```

Mobile apps that compose `@onderling-app/stoop` (the platform-shell
exception per the layering rule) inherit this fix automatically — no
per-app metro config needed.

**Pattern recap:** when a desktop app dynamically imports a
Node-only server package gated by config (push keys, VAPID keys,
relay creds, ...), Metro still has to *resolve* the import even
though it'll never *run*.  Shim every such transitive Node-only
package in the preset's `extraNodeModules`.  Same fix as Traps 11
(Inrupt) + the chokidar / express / systray2 cluster.

### Trap 20 — Per-bundle `core.Agent` (multi-group RN apps)

**Symptom (Stoop V3 mobile, 2026-05-08):**

When the user has N joined groups, the relay broker logs:

```
[relay] registered   <pubkey>…
[relay] registered   <pubkey>…
[relay] registered   <pubkey>…    (× N)
```

…all under the same identity. Mobile logs show duplicate `inbound
connection: out_1` from MdnsTransport, multiple `peer-discovered`
events for the same peer, and skill calls round-tripping through
the relay because routing thinks self is a remote peer (one of the
N agents).

**Cause:** the app's bundle factory calls `buildMeshAgent()` (or
equivalent) **once per joined group**. Each call constructs a fresh
`core.Agent` with its own InternalTransport / MdnsTransport /
RelayTransport stack. N groups → N agents under one identity → N
mDNS service registrations / N WebSocket connections to the relay.

**Fix:** project-wide single-agent rule —
[`Project Files/conventions/single-agent.md`](../../../docs/conventions/single-agent.md).
The service-context owns ONE `core.Agent`. Per-group state
(`ItemStore`, `MemberMap`, `SkillMatch`, mirror) lives in a
group-scoped factory (`buildGroupState({meshAgent, ...})` for
Stoop) on top of the shared agent. Skills register on the agent
ONCE with a `getBundle(args, ctx)` resolver that picks the right
group from `args.groupId` / pubsub topic.

Reference implementation:
- `apps/stoop-mobile/src/lib/agentBundle.js` —
  `buildMeshAgent()` (one) + `buildGroupState({meshAgent, ...})`
  (per-group, no agent inside).
- `apps/stoop-mobile/src/ServiceContext.js` — boots one agent,
  registers `buildSkills({getBundle})` once, builds GroupStates
  for each joined group.
- `apps/stoop/src/Agent.js`'s `createNeighborhoodAgent({
  registerSkills: false })` opt-out for the per-group registration
  path.

Tasks-mobile (when it lands) inherits this pattern — see the
"Tasks-app fix propagation" section in
`Project Files/Stoop/single-agent-refactor-2026-05-08.md`.

---

## Audit checklist (do this BEFORE running the bundler)

When pulling new SDK code or bumping a Node-shaped Solid lib, run
this before debugging blind:

```bash
# 1. node:-prefix imports in our source
grep -rEn "from ['\"]node:|require\(['\"]node:" packages/core/src \
  packages/pod-client/src packages/react-native apps/folio/src/rn \
  apps/folio-mobile/src

# 2. Plain node-builtin imports (rarer; we standardised on node:-prefix)
grep -rEn "from ['\"](events|stream|util|fs|path|crypto|http|url|querystring|buffer|punycode)['\"]" \
  packages/*/src apps/folio/src/rn apps/folio-mobile/src

# 3. extends EventEmitter / Stream — these need the REAL events polyfill
grep -rEn "extends\s+(EventEmitter|Readable|Writable|Transform|Duplex|Stream)\b" \
  packages/*/src apps/folio/src

# 4. Then check transitive deps that ACTUALLY get bundled.
#    Especially whatwg-url / @inrupt / any auth chain:
ls apps/folio-mobile/node_modules/whatwg-url/lib 2>/dev/null && \
  grep -E "require\(['\"](punycode|tr46|webidl-conversions|util)['\"]\)" \
  apps/folio-mobile/node_modules/whatwg-url/lib/*.js

# 5. Check installed expo + autolinking versions match SDK 52
node -p "require('./apps/folio-mobile/node_modules/expo/package.json').version"
node -p "require('./apps/folio-mobile/node_modules/expo-modules-autolinking/package.json').version"
```

For each match in (1)/(2): is it in a hot path (gets called at runtime
on mobile) or dead code (server/CLI only, never invoked)?  Hot path →
real polyfill.  Dead code → empty-ish shim is OK.

---

## Why we don't use `@inrupt/solid-client-authn-node` on mobile

It bundles for two reasons: (a) it's a transitive dep of `@onderling/core`,
(b) Metro can't tree-shake it because of CommonJS-shaped re-exports.
But folio-mobile uses **`expo-auth-session`** (RN-native) for auth
instead.  See `apps/folio-mobile/src/auth/folioAuth.js`.

So `@inrupt/solid-client-authn-node` is bundled-but-never-invoked.  Any
crash from inside it would mean we've accidentally wired up a real
runtime call to it.  Don't fix that by polyfilling; instead find which
call site is reaching for it and route to the expo-* path.

This applies more broadly: when you bump a Solid lib and a new
runtime crash appears in `@inrupt/...`, the real fix is *not* to
polyfill harder — it's to confirm the mobile code path is using the
RN-native equivalent.

---

## When polyfills aren't enough — the architectural escape hatch

If the polyfill cost spirals (DPoP, refresh-token rotation, sealed
envelopes, multi-pod auth), **the architectural alternative is
mobile-as-thin-client to the desktop agent**:

- Folio web (`apps/folio/src/server/`) is already a Node agent at
  `127.0.0.1:8888` with all Solid auth + pod sync working.
- Mobile would speak REST/WS to that agent instead of bundling
  `@onderling/core`'s server-shape paths.
- Phone holds local cache for offline reads; writes queue to agent
  → pod.

This matches `Architectural Design/Architecture Plan.md` (private
server pattern) and Tracks E (mobile-push-relay) + G (reachability).

Not pulled the trigger as of 2026-04-30 — sign-in finally rendered on
the phone after the polyfill round above, so we're continuing to
explore the native-RN path.  But this doc exists partly because the
escape hatch is worth keeping in mind.

---

## File map for cross-reference

```
apps/folio-mobile/
  index.js                   ← `react-native-get-random-values` MUST be first
  metro.config.js            ← NODE_BUILTINS set, resolveRequest hooks,
                                node:-prefix strip, util/ws aliasing
  shims/
    node-builtins.js         ← empty-ish shim with lazy getters for globals
    util.js                  ← wraps real util + adds TextDecoder/TextEncoder
    ws.js                    ← shim for the `ws` package (WebSocket)
  src/
    auth/folioAuth.js        ← expo-auth-session flow (NOT inrupt-node)
    auth/OidcSessionRN.js    ← expo-secure-store-backed session
    ServiceContext.js        ← imports the C1 RN serviceFactory dynamically
```
