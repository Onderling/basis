# VERSION-MATRIX — pinned versions for the `@onderling` RN platform layer

The matrix below is what Folio's mobile bring-up landed on
2026-04-30.  Apps consuming `@onderling/react-native` should pin to
the same versions until the matrix is intentionally bumped.

The full rationale per version (and the saga of why these specific
ones) lives in [`./BRING-UP-NOTES.md`](./BRING-UP-NOTES.md).

---

## Working set (as of 2026-05-02)

```
expo                              ^52.0.0     (52.0.49 tested)
expo-modules-autolinking          ^2.0.0      (2.0.8 tested — SDK 52 era)
react-native                       0.76.9
react                              18.3.1
react-native-webrtc               ^124.0.7

# Auth + crypto on RN
expo-auth-session                  ~6.0.3
expo-crypto                        ~14.0.2
react-native-get-random-values    ^1.11.0     (must be first import in app entry)
tweetnacl                         ^1.0.3
@scure/bip39                      ^2.2.0      (^2.0.1 in some apps; both fine)

# Polyfills installed solely to fix bundle/runtime issues
util                              ^0.12.5     (browserify util)
events                            ^3.3.0      (browser-compat EventEmitter)
punycode                          ^2.3.1      (whatwg-url's punycode.ucs2.decode)

# Storage / secure storage
expo-secure-store                  ~14.0.1
expo-file-system                   ~18.0.12
@react-native-async-storage/async-storage  ^1.24.0

# Native modules
react-native-libsodium              1.7.0       (EXACT pin: the phone's Ed25519 check over JSI; ships libsodium 1.0.21
                                              PREBUILT in libsodium/build.tgz, unpacked by its postinstall — an accepted
                                              risk for the alpha; a public release builds libsodium in CI from the signed
                                              source with the package's build.sh. Measured 2026-11-12 on a Samsung A33:
                                              ~0.07 ms a check vs ~59 ms tweetnacl; +2.26 MB native libs over 4 ABIs)
react-native-ble-plx              ^3.5.1
react-native-keychain             ^10.0.0
react-native-screens               ~3.34.0
react-native-safe-area-context     ~4.12.0
```

---

## Why these specific versions

### Expo 52 / RN 0.76.9 / React 18.3.1

The Folio.C2 bring-up downgraded from a half-broken Expo 49 +
mid-cycle SDK 55 mix landed during a prior session.  Expo 52 is
the most recent SDK that the WebRTC stack
(`react-native-webrtc@^124.0.7`) is known to bundle and run on a
real device against.  Confirmed working on the bench phone
2026-04-30.

**Don't bump without an explicit ask.**  Per CLAUDE.md, the
mesh-demo + folio-mobile stacks are pinned and bumping without
discussion has caused regressions.

### `react-native-webrtc@^124.0.7`

Pinned at exactly 124.0.7 in mesh-demo's locked-stack notes.
Newer versions exist; none have been validated against this SDK.

### `react-native-get-random-values@^1.11.0`

Per recent commit `1ae7a79`: this version is needed for RN 0.76
compat; older `^1.10.0` line had a runtime issue.  Must be the
**first** import in the app's `index.js` because it patches
`crypto.getRandomValues` at module-load time.

### `expo-auth-session@~6.0.3` (NOT `@inrupt/solid-client-authn-node`)

The Inrupt Node-only auth lib pulls in too many Node built-ins to
bundle reasonably.  Folio uses `expo-auth-session` directly for
the OIDC flow on mobile.  See BRING-UP-NOTES.md "Why we don't use
@inrupt/solid-client-authn-node on mobile."

### Polyfill packages (`util`, `events`, `punycode`)

These are real npm packages (not shims) installed because libraries
actually invoke them at runtime — `whatwg-url` calls
`punycode.ucs2.decode`, EventEmitter subclassing in `ws` /
`@inrupt/*` runs through `events`, etc.  Empty shims would crash at
runtime; real polyfills don't.

---

## When to bump

Bump triggers (in priority order):

1. **Security CVE in any pinned package** — patch immediately.
2. **Native module incompatibility with target Android/iOS** —
   forced bump if a target OS version drops support.
3. **Expo SDK end-of-life** — Expo SDKs are supported for ~1 year;
   plan a bump cycle ~6 months before EOL.
4. **A new `@onderling` substrate needs an API only available in a
   newer RN version** — coordinate the bump with the substrate's
   release.

When bumping:

1. **Change one variable at a time.**  Bumping Expo + RN + React
   together makes attribution impossible when something breaks.
2. **Re-validate against Folio mobile on a real device** before
   shipping the new pin.  The traps are real-device traps; the
   simulator hides some of them.
3. **Update this file with the new pinned versions + a dated
   "bump notes" subsection** explaining what changed and why.
4. **Update [`./BRING-UP-NOTES.md`](./BRING-UP-NOTES.md)** if any
   trap gets resolved or any new trap surfaces.
5. **Tag the package version with a major bump** (per
   `Project Files/Substrates/policies.md` — RN platform layer is
   a pinned-peer-dep package, so any pin change is visible to
   consumers).

---

## Bump history

(empty — first matrix lock 2026-05-02)
