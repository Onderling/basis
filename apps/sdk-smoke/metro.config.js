// sdk-smoke metro.config.js — refactored 2026-05-04 to consume the
// @onderling/react-native metro-preset.
//
// Background: the previous hand-rolled metro.config.js missed several
// of the bring-up traps documented in
// `packages/react-native/docs/BRING-UP-NOTES.md` — specifically:
//   - Trap 3   `node:`-prefix not stripped (caused `node:crypto` import failure)
//   - Trap 5   `util` not topped up with TextDecoder/TextEncoder
//   - Trap 11  `Buffer`/`buffer` not on globalThis at module-load
//   - Trap 11.5 `path.posix.join` undefined at module-load
//
// All of those are handled by the shared preset.  Apps that hand-roll
// metro.config.js will keep rediscovering them — per the architectural
// layering rule, sdk-smoke should compose the preset, not parallel-
// implement it.
//
// `unstable_enablePackageExports: false`, NODE_BUILTINS shimming, ws
// shim, monorepo subpath handling come from the preset.  The bits below
// are sdk-smoke-specific.

const path = require('path');
const { withOnderlingPreset } = require('@onderling/react-native/metro-preset');

const projectRoot = __dirname;
const repoRoot    = path.resolve(__dirname, '../..');

module.exports = withOnderlingPreset({
  projectRoot,
  repoRoot,

  // Pin React/RN/native modules to this app's node_modules so monorepo
  // hoisting can't pull in conflicting versions.  Same set as folio-mobile.
  pinToAppModules: [
    'react',
    'react-native',
    '@react-native-async-storage/async-storage',
    'react-native-ble-plx',
    'react-native-keychain',
    'react-native-screens',
    'react-native-safe-area-context',
  ],

  // sdk-smoke-specific aliases (the preset already maps @onderling/* SDK
  // packages — core, pod-client, react-native, sync-engine).
  extraNodeModules: {
    // @scure/bip39 wordlist subpath — package.json `exports` is ignored
    // because the preset sets `unstable_enablePackageExports: false`.
    '@scure/bip39/wordlists/english': path.resolve(
      projectRoot, 'node_modules/@scure/bip39/wordlists/english.js',
    ),

    // @noble/hashes: pin /crypto to the CJS browser variant nested under
    // packages/core's own node_modules.
    '@noble/hashes/crypto':    path.resolve(repoRoot, 'packages/core/node_modules/@noble/hashes/crypto.js'),
    '@noble/hashes/crypto.js': path.resolve(repoRoot, 'packages/core/node_modules/@noble/hashes/crypto.js'),
  },
});
