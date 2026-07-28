# Changelog — @onderling/react-native

All notable changes to the package.  Versioning per
`Project Files/Substrates/policies.md`: minor for additive changes,
major for breaking changes.

## [Unreleased]

### Added

- **hub-discovery** sub-path (Phase 51.6). Android Hub install
  detection via `createHubDiscovery({nativeModule})`. Surface:
  `check()` (cached `PackageManager.queryIntentServices` query) +
  `watch(cb)` (broadcast subscription for `ACTION_PACKAGE_ADDED` /
  `ACTION_PACKAGE_REMOVED`) + `invalidate()`. JS-side complete; the
  Kotlin native module ships in a follow-up. 19 tests.

- **hub-binding** sub-path (Phases 51.7 – 51.9). Promise-based
  wrapper around the Hub AIDL binder.
  - `bind({nativeModule, manifest, intentAction?, clientVersions?})`
    runs the full bind → version-negotiate → register flow; returns
    an `IHubBinding`.
  - `IHubBinding` exposes the V1 method surface (`fetchResource`,
    `writeResource`, `publishEnvelope`, `declareCapabilities`,
    `onIncomingEnvelope`, `close`) plus V2-gated methods
    (`registerInterface`, `lookupInterface`, `orchestrateProtocol`)
    that throw `VERSION_UNSUPPORTED` on V1 bindings.
  - `negotiateVersion({clientVersions, hubVersions})` exposed as a
    pure helper.
  - AIDL interface files committed at `android/aidl/com/onderling/hub/`:
    `IHub_V1.aidl`, `IHub_V2.aidl` (direction-only), `IIncomingCallback.aidl`.
  - Native module + build integration documented in
    `android/HUB-BINDING-BUILD.md`.
  - 34 tests pass.

- **pseudo-pod-adapter** sub-path (Phases 51.1 – 51.4). RN-side
  `StorageBackend` implementations for `@onderling/pseudo-pod`:
  - `createAsBackend({AsyncStorage, scope})` — AsyncStorage-backed.
  - `createFsBackend({FileSystem, rootDir, scope})` —
    expo-file-system-backed; atomic writes via `.tmp` + moveAsync.
  - `createBackend({...})` — composite that picks AS for small
    payloads, FS for large (default threshold 4 KB); supports
    cross-backend migration on update.
  Importable as `@onderling/react-native/pseudo-pod-adapter`.
- **Persistent dirty-set** (Phase 51.5) on all three adapters.
  `_markDirty(key)` / `_markClean(key)` / `listDirty()` now write
  through to backend storage, so pseudo-pod V1's write-through queue
  re-discovers pending entries on agent boot.
  - AsBackend: dirty markers under `<scope>:__dirty__:<key>`.
  - FsBackend: marker files under `<scopeDir>__dirty__/<encoded-key>`.
  - createBackend: delegates to the holding backend for known keys;
    routes unknown keys to AS.
  44 tests pass (35 from 51.1–51.4 + 9 new for Phase 51.5).

## [0.2.0] — 2026-05-02

### Added

- **Platform layer** (cross-cutting RN plumbing).  This package
  expands beyond its original "RN-specific SDK adapters" scope to
  also serve as the RN platform layer that every `@onderling` app
  on phone consumes.  See
  `Project Files/Substrates/L0-react-native.md` for the layer
  sketch.

- **Documentation** under `./docs/`:
  - `BRING-UP-NOTES.md` — folded in from
    `apps/folio-mobile/docs/SOLID-RN-NOTES.md` (verbatim trap
    catalogue, 17 traps from Folio's 2026-04-30 mobile bring-up).
  - `VERSION-MATRIX.md` — pinned versions for the RN stack
    (Expo 52 / RN 0.76.9 / React 18.3.1 / rn-webrtc 124.0.7,
    plus polyfill packages).
  - `PER-SUBSTRATE-CHECKLIST.md` — guidance for substrate authors
    adding RN variants.

- **`metro-preset.cjs`** — exported reusable Metro preset.  Apps
  consume via:
  ```js
  const { withOnderlingPreset } = require('@onderling/react-native/metro-preset');
  module.exports = withOnderlingPreset({ projectRoot: __dirname, repoRoot: '...' });
  ```
  Encapsulates: NODE_BUILTINS shim list, `node:` prefix stripping,
  `util` / `path` / `ws` shim routing, monorepo subpath handling,
  `unstable_enablePackageExports: false`.  App-specific bits
  (Folio's `@onderling-app/folio/rn/*` subpath, app-specific
  `extraNodeModules`) come in via options.

- **Subpath exports** under `./platform/...`:
  - `./platform/polyfills` — side-effect import; idempotent on Node
    (no-op variant) and RN (loads `react-native-get-random-values`).
  - `./platform/service-factory` — `selectPlatform({rn, default})`
    helper for substrate authors.
  - `./platform/shims/{node-builtins, path, util, ws}` — re-usable
    shims migrated from `apps/folio-mobile/shims/`.

### Unchanged

- The existing `@onderling/react-native` barrel
  (`KeychainVault`, `BleTransport`, `MdnsTransport`,
  `MobilePushBridge`, `createMeshAgent`, `requestMeshPermissions`,
  `attachIdentityToAgent`, `AsyncStorageAdapter`, `PushAdapter`)
  is preserved.  Existing consumers (Folio mobile) require no
  changes.

### Notes for consumers

- Folio mobile keeps its own `metro.config.js` for now; the preset
  is available but the migration is a separate work item.  See
  `Project Files/Substrates/L0-react-native.md` § "V0 deliverable"
  for the migration plan.
- New apps starting on RN should consume the preset directly:
  - `apps/<my-app>/metro.config.js` → `withOnderlingPreset(...)`
  - `apps/<my-app>/index.js` → `import '@onderling/react-native/platform/polyfills';` first.
- BRING-UP-NOTES.md is the canonical reference for new mobile
  bring-ups; append new traps here, don't duplicate in app docs.

## [0.1.0]

Initial scope.  RN-specific SDK adapters: BLE transport, mDNS
transport, Keychain vault, AsyncStorage adapter, mobile push
bridge, Expo notifications adapter, mesh agent factory.
