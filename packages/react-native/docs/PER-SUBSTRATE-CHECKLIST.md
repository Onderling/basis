# PER-SUBSTRATE-CHECKLIST — adding RN support to a substrate

Guidance for substrate authors (L1a sync-engine, L1d agent-ui, L1e
skill-match, L1f notifier, L1g oauth-vault, L1i pod-search) when
adding an RN variant.

The substrate plan in `Project Files/Substrates/` flags six
substrates that need RN variants.  This checklist standardises the
pattern so each one doesn't reinvent the bring-up.

---

## Before you start

1. **Read [`./BRING-UP-NOTES.md`](./BRING-UP-NOTES.md)** end-to-end
   at least once.  The 17 traps cover most of what you'll hit; if
   you skip the read, expect to discover them again.
2. **Read [`./VERSION-MATRIX.md`](./VERSION-MATRIX.md).**  Pin to
   the matrix; don't introduce new RN-related dependencies without
   updating the matrix.
3. **Identify the substrate's RN-specific surface.**  What needs to
   differ between Node and RN?  Common cases:
   - File-system access (`fs` vs `expo-file-system`)
   - Crypto (`crypto` vs `expo-crypto`)
   - SQLite (`better-sqlite3` vs `expo-sqlite`)
   - Secure storage (`node-keytar` vs `react-native-keychain`)
   - Push (Node serverless vs APNs/FCM via E2c)
   - Transport adapters (already in `@onderling/react-native/adapters`)

---

## The pattern

### Naming convention

For each module that has a platform-specific implementation:

```
src/
  MyModule.js           ← Node + web variant (default resolution)
  MyModule.rn.js        ← React Native variant
```

Metro's RN bundler auto-resolves `*.rn.js` when bundling for
React Native.  Other bundlers see only `*.js`.

### Service factory

When the choice between Node and RN can't be expressed by Metro
file-resolution alone (e.g. dynamic decision at runtime), use the
service-factory helper from `@onderling/react-native/platform`:

```js
import { selectPlatform } from '@onderling/react-native/platform/service-factory';

const Service = selectPlatform({
  rn:      () => require('./MyModule.rn.js'),
  default: () => require('./MyModule.js'),
});
```

### Polyfills entry point

Every RN app must import polyfills before any other `@onderling`
substrate.  The substrate itself does NOT import polyfills — that's
the app's responsibility (the app's `index.js`).  Document this in
the substrate's README.

```js
// in the consuming app's index.js
import '@onderling/react-native/platform/polyfills';   // FIRST
import 'react-native-get-random-values';              // SECOND
// ... rest of the app
```

### Metro preset

Apps consuming the substrate are responsible for their `metro.config.js`.
Recommend using the shared preset:

```js
const { withOnderlingPreset } = require('@onderling/react-native/metro-preset');
module.exports = withOnderlingPreset({
  // app-specific overrides
});
```

The preset handles the trap fixes (NODE_BUILTINS shimming, `node:`-
prefix stripping, util/path/ws shims, monorepo subpath handling).

---

## Checklist for adding RN support to a new substrate

- [ ] Audit the substrate's deps: which Node-only modules does it
  pull in?  Each one is a candidate for an `*.rn.js` variant or a
  Metro-config shim.
- [ ] Identify your secure-storage / file-system / SQLite needs —
  pick the corresponding RN equivalent from VERSION-MATRIX.md.
- [ ] For each platform-specific module:
  - [ ] Implement `MyModule.js` (Node).
  - [ ] Implement `MyModule.rn.js` (RN, using `expo-*` packages).
  - [ ] Match the public API exactly — consumers should be unaware
    of which variant runs.
- [ ] Test the substrate on Node (Vitest) — covers the default path.
- [ ] Test the substrate on RN — see "Testing on RN" below.
- [ ] Update the substrate's README to declare its RN variant, the
  RN-specific peer-deps it adds, and any traps the consuming app
  needs to know about.
- [ ] If your substrate adds a new RN-specific peer-dep that's not
  in VERSION-MATRIX.md: open a discussion before pinning.

---

## Testing on RN

Two layers:

### Layer 1 — Vitest stub mode

Run unit tests against the Node variant + a stub of any RN-specific
modules.  Catches API-shape mismatches.  Standard practice.

### Layer 2 — Real-device validation

Before declaring the RN variant "shipped":

1. Wire the substrate into a smoke project (typically
   `apps/folio-mobile` since it's already validated).
2. Run on a real device — simulator hides some traps (Trap 8
   `expo-secure-store::` rejection, Trap 11 `posix.join undefined`
   are real-device-only).
3. Confirm the trap behaviour against BRING-UP-NOTES.md — if a
   new trap surfaces, append it.

---

## Common pitfalls

| Pitfall | Mitigation |
|---|---|
| Importing `node:fs` directly | Use `expo-file-system` in `*.rn.js` variant |
| Subpath imports (`@scope/pkg/sub`) silently failing | Add to Metro preset's explicit subpath map |
| Modules using `globalThis.URL` / `TextDecoder` at module-load time | Lazy-load via getter (Trap 6); see `shims/util.js` |
| Hermes preferring CJS over ESM unexpectedly | Set `unstable_enablePackageExports: false` in Metro (the preset does this) |
| `Buffer.from(undefined)` crashes | Trap 11 — patches in BRING-UP-NOTES.md |

---

## When the platform layer needs an extension

If your substrate hits a trap that BRING-UP-NOTES.md doesn't
cover, OR needs a polyfill / Metro-config tweak that other
substrates would also benefit from:

1. **Don't add it to your substrate.**  Add it to
   `@onderling/react-native` (this package).
2. **Document the new trap** in BRING-UP-NOTES.md.
3. **Update the Metro preset** if the fix is config-shaped.
4. **Bump the platform-layer minor version.**  Per
   `Project Files/Substrates/policies.md`, additions are minor
   bumps; breaking changes (rare) are major.

---

## See also

- [`./BRING-UP-NOTES.md`](./BRING-UP-NOTES.md) — the trap catalogue.
- [`./VERSION-MATRIX.md`](./VERSION-MATRIX.md) — pinned versions.
- `Project Files/Substrates/L0-react-native.md` — the layer sketch.
- `Project Files/Substrates/policies.md` — the project-level rules.
