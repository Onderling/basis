// Folio mobile metro.config.js — refactored 2026-05-02 to consume
// the @onderling/react-native metro-preset.
//
// The preset handles all the cross-cutting bring-up plumbing:
// NODE_BUILTINS shimming, `node:` prefix stripping, util/path/ws shim
// routing, packages/core + packages/pod-client + packages/react-native
// subpath maps, Inrupt-Node-auth + chokidar + express + systray2
// shimming, `unstable_enablePackageExports: false`.
//
// Folio's app-specific bits (`@onderling-app/folio` + its rn/*
// subpaths, @scure/bip39 + @noble/hashes pinning, app-side react/RN
// pin set) come in via options below.
//
// Detailed trap rationale + version pinning:
//   ./docs/SOLID-RN-NOTES.md       (Folio's own bring-up notes — kept)
//   packages/react-native/docs/    (folded into the substrate)

const path = require('path');
const { withOnderlingPreset } = require('@onderling/react-native/metro-preset');

const projectRoot = __dirname;
const repoRoot    = path.resolve(__dirname, '../..');

module.exports = withOnderlingPreset({
  projectRoot,
  repoRoot,

  // Folio-specific watch folder (the preset already adds
  // packages/core, packages/pod-client, packages/react-native).
  watchFolders: [
    path.resolve(repoRoot, 'apps/folio'),
  ],

  // Block apps/folio/node_modules (CLI-only deps mobile never reaches).
  // The preset already blocks packages/react-native/node_modules.
  extraBlockListRegExps: [
    new RegExp(
      `^${path.resolve(repoRoot, 'apps/folio/node_modules').replace(/[/\\]/g, '[/\\\\]')}.*`,
    ),
  ],

  // Pin React/RN/native modules to this app's node_modules so monorepo
  // hoisting can't pull in conflicting versions.
  pinToAppModules: [
    'react',
    'react-native',
    '@react-native-async-storage/async-storage',
    'react-native-ble-plx',
    'react-native-keychain',
    'react-native-screens',
    'react-native-safe-area-context',
  ],

  // Folio-specific module aliases (the preset already maps the @onderling/*
  // SDK packages).
  extraNodeModules: {
    // Folio app package — folio-mobile's only remaining cross-app
    // dep (the `SyncEngine` subclass, used in src/lib/serviceBuilder.js).
    // The /rn/* subpath imports moved to @onderling/sync-engine-rn
    // 2026-05-08 (Phase 40.2 follow-up); see Phase 40.2's substrate
    // and the platform-shell exception in
    // Project Files/conventions/architectural-layering.md.
    '@onderling-app/folio': path.resolve(repoRoot, 'apps/folio'),

    // @scure/bip39 wordlist (subpath; same exports-OFF reason).
    '@scure/bip39/wordlists/english': path.resolve(
      projectRoot, 'node_modules/@scure/bip39/wordlists/english.js',
    ),

    // @noble/hashes: pin /crypto to the CJS browser variant.
    '@noble/hashes/crypto':    path.resolve(repoRoot, 'packages/core/node_modules/@noble/hashes/crypto.js'),
    '@noble/hashes/crypto.js': path.resolve(repoRoot, 'packages/core/node_modules/@noble/hashes/crypto.js'),
  },
});
