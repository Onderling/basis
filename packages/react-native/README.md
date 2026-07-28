# `@onderling/react-native`

> **Layer:** Platform layer (the RN side of the SDK).
> **Convention:** Platform-glue substrates aggregate here; standalone
> behaviors with a clear non-RN core live in their own packages.

React Native platform layer + adapters for the onderling agent SDK.

## Submodules

- `./platform/*` — polyfills + service-factory + Node-builtin shims
  for the metro bundler.
- `./identity/*` — `KeychainVault` (`react-native-keychain`-backed
  vault that stores the agent identity at-rest).
- `./storage/*` — `AsyncStorageAdapter` (small data) and
  `FileSystemAdapter` (large data — `expo-file-system`).
- `./transport/*` — `MdnsTransport`, `BleTransport`,
  `MobilePushBridge`, `ExpoNotificationsAdapter`.
- `./permissions` — `requestMeshPermissions` (BLE + location +
  notifications + nearby-devices, all gated behind a single
  permission-rationale callback).
- `./createMeshAgent` — opinionated one-call factory that wires the
  identity vault + transports + adapters above into a single
  `core.Agent`.
- `./picker/*` — image-picker substrate. `pickAndResize({mode,
  preset, max})` over `expo-image-picker` + `expo-image-manipulator`,
  generic `DELIVERABLE_PRESET` + `AVATAR_PRESET`. Lifted from
  `apps/stoop-mobile/src/lib/imagePicker.js` 2026-05-09 — Phase 41.0
  L3, Tasks-mobile is the second consumer.
- `./qr/*` — QR substrate. `classifyQrPayload(text, classifiers)` is
  a pure-fn plug-in dispatcher; `<QrCodeView>` (subpath import
  `./qr/view`) wraps `react-native-qrcode-svg`. Lifted from
  `apps/stoop-mobile/src/lib/qrScanner.js` + `components/QrCode.js`
  2026-05-09 — Phase 41.0 L4.
- `./mnemonic/*` — recovery-phrase substrate. Pure helpers
  (`normaliseMnemonic`, `looksLikeMnemonic`, `statusFor`,
  `BIP39_WORD_COUNTS`), `useMnemonicReveal({useSkill})` hook, and
  `<MnemonicView>` (subpath `./mnemonic/view`). Lifted from
  `apps/stoop-mobile/src/lib/mnemonic.js` 2026-05-09 — Phase 41.0 L5;
  the hook + view are new substrate UI for Tasks-mobile.
- `./push/*` — push opt-in substrate. `setupPush` +
  `requestPushPermission` (imperative — lifted from
  `apps/stoop-mobile/src/lib/push.js`) plus the new
  `usePushOptIn({agent, ...})` hook for Settings-screen UX. Lifted
  2026-05-09 — Phase 41.0 L6.
- `./localisation/*` — locale resolver substrate. `loadLocale({bundles,
  defaultLang})` returns a `{t, format, setLang, currentLang,
  initLocalisation, isInitialised}` instance. Lifted from
  `apps/stoop-mobile/src/lib/localisation.js` 2026-05-09 — Phase 41.0 L7.
  Apps now pass their own locale bundles instead of the substrate
  hardcoding Stoop's.

## Origins

The platform layer was extracted in earlier phases (see
Stoop V3 Phase 40.x
+ Tasks-mobile Phase 41.0).
The Phase 41.0 lifts (L3 + L4 + L5 + L6 + L7) added `./picker`,
`./qr`, `./mnemonic`, `./push`, `./localisation` as submodules of the same
package — locked decision (2026-05-08) to keep the package count
flat instead of fanning out into one micro-package per submodule.

## Tests

```sh
npm test
```

Two tests fail at the time of the Phase 41.0 lift —
`test/BleTransport.test.js` + `test/MdnsTransport.test.js`. Both are
pre-existing (parser errors against TS-shipped peer deps); they were
red before Phase 41.0 too. Track separately.
