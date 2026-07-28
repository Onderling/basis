// Tasks-mobile metro.config.js — mirrors apps/stoop-mobile's setup.
//
// The @onderling/react-native metro-preset handles the cross-cutting
// bring-up plumbing (NODE_BUILTINS shimming, node: prefix, util/path/ws
// shim routing, packages/core / pod-client / react-native subpath maps,
// Inrupt-Node-auth + chokidar + express + systray2 shimming,
// unstable_enablePackageExports: false).
//
// Tasks-mobile's app-specific bits come in via options below.

const path = require('path');
const { withOnderlingPreset } = require('@onderling/react-native/metro-preset');

const projectRoot = __dirname;
const repoRoot    = path.resolve(__dirname, '../..');

module.exports = withOnderlingPreset({
  projectRoot,
  repoRoot,

  // Tasks-mobile imports the @onderling-app/tasks barrel for the
  // single-agent factories (buildMeshAgent, wireSkills,
  // bundleResolver, createCircleAgent) — same platform-shell pattern
  // as stoop-mobile + folio-mobile, documented in
  // Project Files/conventions/architectural-layering.md.
  watchFolders: [
    path.resolve(repoRoot, 'apps/tasks-v0'),
    path.resolve(repoRoot, 'packages/chat-p2p'),
    path.resolve(repoRoot, 'packages/identity-resolver'),
    path.resolve(repoRoot, 'packages/item-store'),
    path.resolve(repoRoot, 'packages/local-store'),
    path.resolve(repoRoot, 'packages/notifier'),
    path.resolve(repoRoot, 'packages/oidc-session-rn'),
    path.resolve(repoRoot, 'packages/online-cadence'),
    path.resolve(repoRoot, 'packages/offering-match'),
    path.resolve(repoRoot, 'packages/sync-engine-rn'),
  ],

  // Block apps/tasks-v0/node_modules (server / CLI / web-only deps
  // mobile never reaches) + every per-package Gradle build dir.
  // Without the build-dir exclusions Metro's file-watcher tries to
  // walk every `node_modules/expo-*/android/build/intermediates/...`
  // tree as Gradle generates them, which blows past Linux's default
  // `fs.inotify.max_user_watches` ceiling (8192) on the very first
  // `expo run:android`.
  extraBlockListRegExps: [
    new RegExp(
      `^${path.resolve(repoRoot, 'apps/tasks-v0/node_modules').replace(/[/\\]/g, '[/\\\\]')}.*`,
    ),
    // packages/sync-engine-rn/node_modules holds a stray `react`
    // devDep (added so the substrate's vitest suite can run); the
    // preset's default block list misses it, and Metro picks the
    // stray up — causing "Two copies of React" / `useState of null`
    // crashes on first render. Block it here.
    new RegExp(
      `^${path.resolve(repoRoot, 'packages/sync-engine-rn/node_modules').replace(/[/\\]/g, '[/\\\\]')}.*`,
    ),
    // packages/online-cadence/node_modules — same shape, same risk
    // (vitest devDep hoisting).
    new RegExp(
      `^${path.resolve(repoRoot, 'packages/online-cadence/node_modules').replace(/[/\\]/g, '[/\\\\]')}.*`,
    ),
    // packages/identity-resolver / item-store / notifier / chat-p2p /
    // local-store / skill-match — none have a stray react today, but
    // the same hazard exists if a vitest devDep ever lands. Belt-and-
    // braces so we don't fight this again.
    new RegExp(
      `^${path.resolve(repoRoot, 'packages/identity-resolver/node_modules').replace(/[/\\]/g, '[/\\\\]')}.*`,
    ),
    new RegExp(
      `^${path.resolve(repoRoot, 'packages/item-store/node_modules').replace(/[/\\]/g, '[/\\\\]')}.*`,
    ),
    new RegExp(
      `^${path.resolve(repoRoot, 'packages/notifier/node_modules').replace(/[/\\]/g, '[/\\\\]')}.*`,
    ),
    new RegExp(
      `^${path.resolve(repoRoot, 'packages/chat-p2p/node_modules').replace(/[/\\]/g, '[/\\\\]')}.*`,
    ),
    new RegExp(
      `^${path.resolve(repoRoot, 'packages/local-store/node_modules').replace(/[/\\]/g, '[/\\\\]')}.*`,
    ),
    new RegExp(
      `^${path.resolve(repoRoot, 'packages/offering-match/node_modules').replace(/[/\\]/g, '[/\\\\]')}.*`,
    ),
    new RegExp(
      `^${path.resolve(repoRoot, 'packages/oidc-session-rn/node_modules').replace(/[/\\]/g, '[/\\\\]')}.*`,
    ),
    // Per-package Gradle build artifacts (the actual ENOSPC source
    // — node_modules/<pkg>/android/build/intermediates emit thousands
    // of files during a debug build).
    /[/\\]node_modules[/\\][^/\\]+[/\\]android[/\\]build[/\\].*/,
    // App-level Android build dir + iOS build dir.
    /[/\\]android[/\\]app[/\\]build[/\\].*/,
    /[/\\]android[/\\]\.gradle[/\\].*/,
    /[/\\]ios[/\\]build[/\\].*/,
    /[/\\]ios[/\\]Pods[/\\].*/,
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

  // Tasks-specific module aliases (the preset already maps the @onderling/*
  // SDK packages). Same `extraNodeModules` Trap-2 caveat as stoop-mobile:
  // overlapping prefixes go via `extraSubpathResolvers` below.
  extraNodeModules: {
    '@onderling-app/tasks':      path.resolve(repoRoot, 'apps/tasks-v0'),

    '@onderling/chat-p2p':          path.resolve(repoRoot, 'packages/chat-p2p'),
    '@onderling/local-store':       path.resolve(repoRoot, 'packages/local-store'),
    '@onderling/identity-resolver': path.resolve(repoRoot, 'packages/identity-resolver'),
    '@onderling/item-store':        path.resolve(repoRoot, 'packages/item-store'),
    '@onderling/notifier':          path.resolve(repoRoot, 'packages/notifier'),
    '@onderling/online-cadence':    path.resolve(repoRoot, 'packages/online-cadence'),
    '@onderling/offering-match':       path.resolve(repoRoot, 'packages/offering-match'),
    '@onderling/sync-engine-rn':    path.resolve(repoRoot, 'packages/sync-engine-rn'),
    '@onderling/oidc-session-rn':   path.resolve(repoRoot, 'packages/oidc-session-rn'),

    '@scure/bip39/wordlists/english': path.resolve(
      projectRoot, 'node_modules/@scure/bip39/wordlists/english.js',
    ),

    '@noble/hashes/crypto':    path.resolve(repoRoot, 'packages/core/node_modules/@noble/hashes/crypto.js'),
    '@noble/hashes/crypto.js': path.resolve(repoRoot, 'packages/core/node_modules/@noble/hashes/crypto.js'),
  },

  // Subpath resolvers for `@onderling-app/tasks/<sub>` imports —
  // metro's enablePackageExports stays off (per the preset), so the
  // app's `package.json#exports` field is ignored. Same pattern as
  // stoop-mobile's `@onderling-app/stoop/{lib,locales}/*` resolvers.
  extraSubpathResolvers: [
    (moduleName, repoRoot) => {
      if (moduleName.startsWith('@onderling-app/tasks/locales/shared/')) {
        // Shared locale bundle (Phase 41.18 follow-up — see
        // Project Files/conventions/architectural-layering.md §
        // "Shared UI-glue helpers between platform shells").
        const sub = moduleName.slice('@onderling-app/tasks/locales/shared/'.length);
        return {
          filePath: path.resolve(repoRoot, 'apps/tasks-v0/locales/shared', sub + '.json'),
          type:     'sourceFile',
        };
      }
      if (moduleName.startsWith('@onderling-app/tasks/locales/')) {
        const sub = moduleName.slice('@onderling-app/tasks/locales/'.length);
        return {
          filePath: path.resolve(repoRoot, 'apps/tasks-v0/locales', sub + '.json'),
          type:     'sourceFile',
        };
      }
      if (moduleName.startsWith('@onderling-app/tasks/MeshAgent')) {
        return {
          filePath: path.resolve(repoRoot, 'apps/tasks-v0/src/MeshAgent.js'),
          type:     'sourceFile',
        };
      }
      if (moduleName.startsWith('@onderling-app/tasks/wireSkills')) {
        return {
          filePath: path.resolve(repoRoot, 'apps/tasks-v0/src/wireSkills.js'),
          type:     'sourceFile',
        };
      }
      if (moduleName.startsWith('@onderling-app/tasks/bundleResolver')) {
        return {
          filePath: path.resolve(repoRoot, 'apps/tasks-v0/src/bundleResolver.js'),
          type:     'sourceFile',
        };
      }
      if (moduleName.startsWith('@onderling-app/tasks/Circle')) {
        return {
          filePath: path.resolve(repoRoot, 'apps/tasks-v0/src/Circle.js'),
          type:     'sourceFile',
        };
      }
      // M1-S3 substrate helpers + M2-S8 multi-circle onboarding —
      // shared device-independent paths (platform parity, NOT mobile
      // forks). The deeper `/lib/substrateStack` MUST precede `/lib`
      // so the longest prefix wins (same trap as the vitest aliases).
      if (moduleName.startsWith('@onderling-app/tasks/lib/substrateStack')) {
        return {
          filePath: path.resolve(repoRoot, 'apps/tasks-v0/src/lib/substrateStack.js'),
          type:     'sourceFile',
        };
      }
      if (moduleName.startsWith('@onderling-app/tasks/substrateMirror')) {
        return {
          filePath: path.resolve(repoRoot, 'apps/tasks-v0/src/substrateMirror.js'),
          type:     'sourceFile',
        };
      }
      if (moduleName.startsWith('@onderling-app/tasks/multiCircleOnboarding')) {
        return {
          filePath: path.resolve(repoRoot, 'apps/tasks-v0/src/skills/multiCircleOnboarding.js'),
          type:     'sourceFile',
        };
      }
      if (moduleName.startsWith('@onderling-app/tasks/lib/')) {
        const sub = moduleName.slice('@onderling-app/tasks/lib/'.length);
        return {
          filePath: path.resolve(repoRoot, 'apps/tasks-v0/src/lib', sub + '.js'),
          type:     'sourceFile',
        };
      }

      // 41.18 follow-up — shared UI helpers live in apps/tasks-v0/src/ui/
      // per `Project Files/conventions/architectural-layering.md` §
      // "Shared UI-glue helpers between platform shells". Both the
      // desktop's web/app.js AND the mobile screens import from here.
      if (moduleName.startsWith('@onderling-app/tasks/ui/')) {
        const sub = moduleName.slice('@onderling-app/tasks/ui/'.length);
        return {
          filePath: path.resolve(repoRoot, 'apps/tasks-v0/src/ui', sub + '.js'),
          type:     'sourceFile',
        };
      }

      // ── Phase 41.0 + 41.0.b substrate subpaths ────────────────────
      // The preset only auto-handles `@onderling/react-native/platform/*`
      // and `@onderling/sync-engine/*`. Everything we lifted in Phase 41.0
      // (picker, qr, mnemonic, push, localisation) + 41.0.b (identity, storage,
      // deepLinks, theme, components) needs explicit resolvers because
      // unstable_enablePackageExports stays off.

      // @onderling/react-native/qr/view — JSX file, separate from the
      // package's pure-JS index (so test envs that don't load
      // react-native-qrcode-svg still parse the index).
      if (moduleName === '@onderling/react-native/qr/view') {
        return {
          filePath: path.resolve(repoRoot, 'packages/react-native/src/qr/QrCodeView.jsx'),
          type:     'sourceFile',
        };
      }
      // @onderling/react-native/mnemonic/view — same JSX-split pattern.
      if (moduleName === '@onderling/react-native/mnemonic/view') {
        return {
          filePath: path.resolve(repoRoot, 'packages/react-native/src/mnemonic/MnemonicView.jsx'),
          type:     'sourceFile',
        };
      }
      // @onderling/react-native/identity/bootstrap — deep subpath for
      // the bootstrap helper (avoids loading KeychainVault.js eagerly).
      if (moduleName === '@onderling/react-native/identity/bootstrap') {
        return {
          filePath: path.resolve(repoRoot, 'packages/react-native/src/identity/bootstrapIdentity.js'),
          type:     'sourceFile',
        };
      }
      // @onderling/react-native/<sub> → packages/react-native/src/<sub>/index.js
      // for every remaining substrate submodule.
      const RN_SUBS = new Set([
        'identity', 'storage', 'picker', 'qr', 'mnemonic',
        'push', 'localisation', 'deepLinks', 'theme', 'components',
      ]);
      if (moduleName.startsWith('@onderling/react-native/')) {
        const sub = moduleName.slice('@onderling/react-native/'.length);
        if (RN_SUBS.has(sub)) {
          return {
            filePath: path.resolve(repoRoot, `packages/react-native/src/${sub}/index.js`),
            type:     'sourceFile',
          };
        }
      }

      // @onderling/sync-engine-rn/react — the Phase 41.0 L1 lift target.
      // Distinct from `@onderling/sync-engine/...` (preset handles that).
      if (moduleName === '@onderling/sync-engine-rn/react') {
        return {
          filePath: path.resolve(repoRoot, 'packages/sync-engine-rn/src/react/index.js'),
          type:     'sourceFile',
        };
      }

      // @onderling/identity-resolver/{display,skills} — Phase 41.0.b A1+A2 lifts.
      if (moduleName === '@onderling/identity-resolver/display') {
        return {
          filePath: path.resolve(repoRoot, 'packages/identity-resolver/src/display.js'),
          type:     'sourceFile',
        };
      }
      if (moduleName === '@onderling/identity-resolver/skills') {
        return {
          filePath: path.resolve(repoRoot, 'packages/identity-resolver/src/skills.js'),
          type:     'sourceFile',
        };
      }

      return null;
    },
  ],
});
