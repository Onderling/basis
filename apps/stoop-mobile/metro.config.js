// Stoop mobile metro.config.js — mirrors apps/folio-mobile's setup.
//
// The @onderling/react-native metro-preset handles the cross-cutting
// bring-up plumbing (NODE_BUILTINS shimming, node: prefix, util/path/ws
// shim routing, packages/core / pod-client / react-native subpath maps,
// Inrupt-Node-auth + chokidar + express + systray2 shimming,
// unstable_enablePackageExports: false).
//
// Stoop's app-specific bits (the @onderling-app/stoop barrel for skill
// builders + groupMirror + Agent factory; @scure/bip39 + @noble/hashes
// pinning; app-side react/RN pin set) come in via options below.

const path = require('path');
const { withOnderlingPreset } = require('@onderling/react-native/metro-preset');

const projectRoot = __dirname;
const repoRoot    = path.resolve(__dirname, '../..');

module.exports = withOnderlingPreset({
  projectRoot,
  repoRoot,

  // Stoop-specific watch folder (the preset already adds packages/core,
  // packages/pod-client, packages/react-native).  Stoop-mobile imports
  // the Stoop app barrel for the skill-builder factory + groupMirror +
  // Agent.js — same platform-shell pattern as folio + folio-mobile.
  watchFolders: [
    path.resolve(repoRoot, 'apps/stoop'),
    path.resolve(repoRoot, 'packages/chat-p2p'),
    path.resolve(repoRoot, 'packages/identity-resolver'),
    path.resolve(repoRoot, 'packages/item-store'),
    path.resolve(repoRoot, 'packages/local-store'),
    path.resolve(repoRoot, 'packages/notifier'),
    path.resolve(repoRoot, 'packages/oidc-session-rn'),
    path.resolve(repoRoot, 'packages/offering-match'),
    path.resolve(repoRoot, 'packages/sync-engine-rn'),
  ],

  // Block apps/stoop/node_modules (server / CLI / web-only deps mobile
  // never reaches).  The preset already blocks
  // packages/react-native/node_modules.
  extraBlockListRegExps: [
    new RegExp(
      `^${path.resolve(repoRoot, 'apps/stoop/node_modules').replace(/[/\\]/g, '[/\\\\]')}.*`,
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
    'react-native-svg',
  ],

  // Stoop-specific module aliases (the preset already maps the @onderling/*
  // SDK packages).
  extraNodeModules: {
    // Stoop app package — stoop-mobile's only cross-app dep (the
    // skill-builder factory, groupMirror, Agent.js; same
    // platform-shell pattern as folio + folio-mobile, documented in
    // Project Files/conventions/architectural-layering.md).
    //
    // NOTE: `@onderling-app/stoop/lib/geo` and `/locales/*` subpaths
    // are NOT entries here — Metro silently picks the shorter prefix
    // when overlapping `extraNodeModules` keys exist (BRING-UP-NOTES
    // Trap 2).  Use `extraSubpathResolvers` below for those.
    '@onderling-app/stoop':         path.resolve(repoRoot, 'apps/stoop'),

    // SDK packages lifted from Stoop in the 2026-05-08 substrate sweep.
    '@onderling/chat-p2p':          path.resolve(repoRoot, 'packages/chat-p2p'),
    '@onderling/local-store':       path.resolve(repoRoot, 'packages/local-store'),
    '@onderling/identity-resolver': path.resolve(repoRoot, 'packages/identity-resolver'),
    '@onderling/item-store':        path.resolve(repoRoot, 'packages/item-store'),
    '@onderling/notifier':          path.resolve(repoRoot, 'packages/notifier'),
    '@onderling/offering-match':       path.resolve(repoRoot, 'packages/offering-match'),
    '@onderling/sync-engine-rn':    path.resolve(repoRoot, 'packages/sync-engine-rn'),
    '@onderling/oidc-session-rn':   path.resolve(repoRoot, 'packages/oidc-session-rn'),

    // @scure/bip39 wordlist (subpath; same exports-OFF reason as folio-mobile).
    '@scure/bip39/wordlists/english': path.resolve(
      projectRoot, 'node_modules/@scure/bip39/wordlists/english.js',
    ),

    // @noble/hashes: pin /crypto to the CJS browser variant.
    '@noble/hashes/crypto':    path.resolve(repoRoot, 'packages/core/node_modules/@noble/hashes/crypto.js'),
    '@noble/hashes/crypto.js': path.resolve(repoRoot, 'packages/core/node_modules/@noble/hashes/crypto.js'),
  },

  // ── Subpath resolvers ────────────────────────────────────────────
  //
  // Stoop's `package.json` has `exports` for `./lib/geo` and
  // `./locales/{en,nl}`, but the preset disables
  // `unstable_enablePackageExports`, so Metro ignores the exports
  // field.  We can't add these to `extraNodeModules` either (Trap 2
  // — overlapping prefixes; the shorter `@onderling-app/stoop` wins
  // and Metro then tries `apps/stoop/lib/geo` which doesn't exist —
  // the real file is at `apps/stoop/src/lib/geo.js`).
  //
  // The preset exposes `extraSubpathResolvers` as the documented
  // escape hatch.  Each resolver runs before Metro's default lookup;
  // returning `null` falls through to the next resolver / default.
  extraSubpathResolvers: [
    (moduleName, repoRoot) => {
      if (moduleName.startsWith('@onderling-app/stoop/lib/')) {
        const sub = moduleName.slice('@onderling-app/stoop/lib/'.length);
        return {
          filePath: path.resolve(repoRoot, 'apps/stoop/src/lib', sub + '.js'),
          type:     'sourceFile',
        };
      }
      if (moduleName.startsWith('@onderling-app/stoop/locales/')) {
        const sub = moduleName.slice('@onderling-app/stoop/locales/'.length);
        return {
          filePath: path.resolve(repoRoot, 'apps/stoop/locales', sub + '.json'),
          type:     'sourceFile',
        };
      }
      return null;
    },
  ],
});
