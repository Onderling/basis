// basis-mobile metro.config.js — mirrors stoop-mobile + folio-mobile.
//
// The @onderling/react-native metro-preset handles:
//   - NODE_BUILTINS shimming + `node:` prefix stripping
//   - util / path / ws shim routing
//   - `@onderling/react-native/platform/*` subpath resolution (Metro 52
//     disables unstable_enablePackageExports, so the package's
//     `exports` map for ./platform/polyfills etc. must be hand-resolved)
//   - generic @onderling/<pkg>/<subpath> resolver from each package's exports map
//
// basis-mobile's app-specific bits are:
//   - 5 sibling apps in watchFolders (basis + the 4 composed apps)
//   - extraNodeModules aliases for the workspace packages that are NOT
//     declared in package.json deps (e.g. @onderling/vault, pulled in
//     transitively by realAgent.js → secure-agent)
//   - extraSubpathResolvers for `@onderling-app/{tasks,stoop,folio}/browser`
//     (Trap 2 — overlapping `extraNodeModules` prefixes; shorter prefix
//     wins, so Metro would otherwise try apps/<app>/browser instead of
//     apps/<app>/src/browser.js)
//   - The same stoop /lib + /locales resolvers stoop-mobile uses, since
//     the realAgent.js chain transitively reaches stoop's app-internal
//     subpaths.

const path = require('path');
const { withOnderlingPreset } = require('@onderling/react-native/metro-preset');

const projectRoot = __dirname;
const repoRoot    = path.resolve(__dirname, '../..');

const _cfg = withOnderlingPreset({
  projectRoot,
  repoRoot,

  // Composition shell — realAgent.js imports the browser factories of
  // tasks-v0 / stoop / folio + the calendar app barrel + basis's
  // own core/web sources via relative paths.  Each app's source dir
  // needs to be in the Metro watch graph.
  watchFolders: [
    path.resolve(repoRoot, 'apps/basis'),
    path.resolve(repoRoot, 'apps/tasks-v0'),
    path.resolve(repoRoot, 'apps/stoop'),
    path.resolve(repoRoot, 'apps/folio'),
    path.resolve(repoRoot, 'apps/calendar'),
    // M6 — the feedback bot: basis's feedbackSurface/feedbackMount consume the
    // SPLIT onderling-feedback repo ('onderling-feedback/public', a link: dep) — watch
    // the sibling checkout so Metro resolves + hot-reloads across the repo boundary.
    path.resolve(repoRoot, '../feedback'),
    // The `eld` language detector (feedback pipeline's lang.js, resolved by the eld/<size>
    // subpath resolver below) is hoisted to the ROOT node_modules and must be WATCHED or
    // Metro can't SHA-1 it → "Failed to get the SHA-1" once onderling-feedback/public resolves.
    path.resolve(repoRoot, 'node_modules/eld'),
    // Workspace packages the composed apps + secure-agent reach for.
    path.resolve(repoRoot, 'packages/vault'),
    path.resolve(repoRoot, 'packages/chat-p2p'),
    path.resolve(repoRoot, 'packages/identity-resolver'),
    path.resolve(repoRoot, 'packages/item-store'),
    path.resolve(repoRoot, 'packages/local-store'),
    path.resolve(repoRoot, 'packages/notifier'),
    path.resolve(repoRoot, 'packages/offering-match'),
    path.resolve(repoRoot, 'packages/manifest-host'),
    path.resolve(repoRoot, 'packages/app-manifest'),
    // @onderling/llm-client — the circle bot's NL→slash LLM client (ollama provider).
    path.resolve(repoRoot, 'packages/llm-client'),
  ],

  // Block apps/<app>/node_modules — server / CLI / web-only deps the
  // mobile bundle never reaches.
  //
  // Plus a NARROW block on RN / Expo entries in any packages/*/.pnpm
  // store — needed because basis-mobile's `file:` dep on
  // @onderling/react-native triggers an npm install pass inside that
  // package, which in turn lets pnpm hoist RN 0.85.3 into
  // packages/react-native/node_modules/.pnpm/.  Metro then follows
  // symlinks into that store and tries to compile RN 0.85.3 with our
  // RN 0.76 babel preset, exploding on the `match` TC39 syntax.
  // Blocking only the RN/Expo entries leaves legitimate symlinks (e.g.
  // @inrupt/solid-client in packages/core/node_modules/.pnpm) intact.
  extraBlockListRegExps: [
    new RegExp(
      `^(${['basis', 'tasks-v0', 'stoop', 'folio', 'calendar']
        .map((a) => path.resolve(repoRoot, `apps/${a}/node_modules`).replace(/[/\\]/g, '[/\\\\]'))
        .join('|')}).*`,
    ),
    new RegExp(
      `^${path.resolve(repoRoot, 'packages').replace(/[/\\]/g, '[/\\\\]')}[/\\\\][^/\\\\]+[/\\\\]node_modules[/\\\\]\\.pnpm[/\\\\](react-native|@react-native|expo|@expo|hermes)[^/\\\\]*[/\\\\].*`,
    ),
  ],

  // Pin React / RN / native modules to this app's node_modules so the
  // monorepo can't pull in conflicting versions.  Mirrors stoop-mobile.
  pinToAppModules: [
    'react',
    'react-native',
    '@react-native-async-storage/async-storage',
    'react-native-get-random-values',
    'react-native-safe-area-context',
    'react-native-screens',
    // expo-crypto: the app + the installed dev-client APK ship 14.0.2 (Expo SDK 52,
    // no native AES). packages/sync-engine carries a STRAY 56.0.3 whose module-load
    // requires a native `ExpoCryptoAES` the APK doesn't have → "Cannot find native
    // module 'ExpoCryptoAES'" runtime crash. sync-engine only needs digestStringAsync
    // (hashing), present in both, so pinning all expo-crypto to the app's 14.0.2 is safe.
    'expo-crypto',
  ],

  // App-specific module aliases (the preset already maps the @onderling/*
  // SDK packages declared in this app's package.json).  These are the
  // packages pulled in TRANSITIVELY by the composed apps that aren't
  // direct deps of basis-mobile.
  extraNodeModules: {
    // Direct: the 5 composed apps.  realAgent.js uses subpath imports
    // (/browser) — those go through extraSubpathResolvers below.
    '@onderling-app/basis': path.resolve(repoRoot, 'apps/basis'),
    '@onderling-app/tasks':    path.resolve(repoRoot, 'apps/tasks-v0'),
    '@onderling-app/stoop':       path.resolve(repoRoot, 'apps/stoop'),
    '@onderling-app/folio':       path.resolve(repoRoot, 'apps/folio'),
    '@onderling-app/calendar':    path.resolve(repoRoot, 'apps/calendar'),
    // realAgent.js's skill wiring (added 2026-07-09). Bare import → the `.` export (src/cores.js); the
    // /wireSkills + /defaultCatalogue subpaths go through extraSubpathResolvers (package-exports disabled).
    '@onderling-app/agents':      path.resolve(repoRoot, 'apps/agents'),

    // Transitive @onderling/* not declared in package.json deps.
    // @onderling/vault is reached via secure-agent + realAgent.js's
    // VaultMemory / VaultLocalStorage imports (VaultAsyncStorage
    // replaces VaultLocalStorage at boot — but the import resolves
    // unconditionally, so the module must still exist on disk).
    '@onderling/vault':             path.resolve(repoRoot, 'packages/vault'),
    '@onderling/chat-p2p':          path.resolve(repoRoot, 'packages/chat-p2p'),
    '@onderling/identity-resolver': path.resolve(repoRoot, 'packages/identity-resolver'),
    '@onderling/item-store':        path.resolve(repoRoot, 'packages/item-store'),
    '@onderling/notifier':          path.resolve(repoRoot, 'packages/notifier'),
    '@onderling/offering-match':       path.resolve(repoRoot, 'packages/offering-match'),
    '@onderling/manifest-host':     path.resolve(repoRoot, 'packages/manifest-host'),
    // @onderling/llm-client — bare import resolves via its package.json main (src/index.js); the
    // /providers/ollama subpath goes through extraSubpathResolvers (package-exports is disabled).
    '@onderling/llm-client':        path.resolve(repoRoot, 'packages/llm-client'),
    // Privacy-first logging facade (web ≡ mobile). Bare `.` export = src/index.js.
    '@onderling/logger':            path.resolve(repoRoot, 'packages/logger'),
  },

  // Subpath resolvers — Trap 2 escape hatch.
  //
  // `@onderling-app/{tasks,stoop,folio}/browser` resolve to
  // `apps/<app>/src/browser.js` per each app's package.json `exports`
  // map; Metro can't see those because the preset disables
  // unstable_enablePackageExports.
  //
  // The stoop /lib + /locales resolvers mirror stoop-mobile's config —
  // the realAgent chain transitively reaches those subpaths.
  extraSubpathResolvers: [
    (moduleName /*, repoRootArg */) => {
      // 1. /browser subpath for the three composed app bundles.
      const browserMatch = moduleName.match(
        /^@onderling-app\/(tasks|stoop|folio)\/browser$/,
      );
      if (browserMatch) {
        // The `tasks` package specifier still lives in the apps/tasks-v0
        // directory — the "-v0" codename was dropped from the package name,
        // but the folder rename is a separate step.
        const appDir = browserMatch[1] === 'tasks' ? 'tasks-v0' : browserMatch[1];
        return {
          filePath: path.resolve(repoRoot, 'apps', appDir, 'src/browser.js'),
          type:     'sourceFile',
        };
      }

      // 2. Stoop's @onderling-app/stoop/lib/* — real files live in src/lib/.
      if (moduleName.startsWith('@onderling-app/stoop/lib/')) {
        const sub = moduleName.slice('@onderling-app/stoop/lib/'.length);
        return {
          filePath: path.resolve(repoRoot, 'apps/stoop/src/lib', sub + '.js'),
          type:     'sourceFile',
        };
      }

      // 3. Stoop's locales — exports map points to apps/stoop/locales/{en,nl}.json.
      if (moduleName.startsWith('@onderling-app/stoop/locales/')) {
        const sub = moduleName.slice('@onderling-app/stoop/locales/'.length);
        return {
          filePath: path.resolve(repoRoot, 'apps/stoop/locales', sub + '.json'),
          type:     'sourceFile',
        };
      }

      // 4. M6 — eld language detector (feedback pipeline's lang.js). Package `exports` subpaths
      //    (eld/medium etc.); Metro has package-exports disabled, so map to the static entry.
      const eldMatch = moduleName.match(/^eld\/(medium|small|large|extrasmall)$/);
      if (eldMatch) {
        return {
          // eld is HOISTED to the monorepo root node_modules (not apps/feedback-pipeline's),
          // so resolve there — the old path pointed at a non-existent nested install.
          filePath: path.resolve(repoRoot, 'node_modules/eld/src/entries', `static.${eldMatch[1]}.js`),
          type:     'sourceFile',
        };
      }

      // 4b. @onderling-app/agents subpaths (realAgent.js skill wiring). exports map: ./wireSkills →
      //     src/wireSkills.js, ./defaultCatalogue → src/defaultCatalogue.js, ./cores → src/cores.js,
      //     ./manifest → manifest.js. Package-exports disabled, so map directly.
      const agentsMatch = moduleName.match(/^@onderling-app\/agents\/(wireSkills|defaultCatalogue|cores)$/);
      if (agentsMatch) {
        return { filePath: path.resolve(repoRoot, 'apps/agents/src', `${agentsMatch[1]}.js`), type: 'sourceFile' };
      }
      if (moduleName === '@onderling-app/agents/manifest') {
        return { filePath: path.resolve(repoRoot, 'apps/agents/manifest.js'), type: 'sourceFile' };
      }

      // 5. @onderling/llm-client provider subpaths (circle bot). Package-exports disabled → map directly.
      const llmMatch = moduleName.match(/^@onderling\/llm-client\/providers\/(ollama|mock)$/);
      if (llmMatch) {
        return {
          filePath: path.resolve(repoRoot, 'packages/llm-client/src/providers', `${llmMatch[1]}.js`),
          type:     'sourceFile',
        };
      }

      // 6. SHIM the Node-only Telegram bridge. It does `import { Telegraf } from 'telegraf'`
      //    + `class … extends Telegraf`; on Hermes telegraf doesn't load → the base is
      //    undefined → "Super expression must be null or a function" at module-eval → the
      //    whole agent boot fails. household/src re-exports it, so it lands in the RN bundle
      //    even though mobile never runs a Telegram bot. Resolve it to a no-op stub. (Mirror
      //    of the web vite alias.) Must be a subpath resolver, not extraShims — the preset's
      //    generic `@onderling/<pkg>/<subpath>` handler would otherwise resolve the real file first.
      if (moduleName === '@onderling/chat-agent/bridges/telegram') {
        return { filePath: path.resolve(__dirname, 'src/shims/telegramBridge.js'), type: 'sourceFile' };
      }

      return null;
    },
  ],
});

// Wrap the preset's resolveRequest to intercept BEFORE its generic `@onderling/<pkg>/<subpath>`
// handler. The Telegram bridge is Node-only (`import { Telegraf } from 'telegraf'` →
// `class … extends Telegraf`); on Hermes telegraf doesn't load → the base is undefined →
// "Super expression must be null or a function" → agent boot fails. household/src re-exports
// it, so it lands in the RN bundle. extraSubpathResolvers run AFTER the generic @onderling
// handler (which resolves the REAL file first), so the shim must intercept here. Mirror of
// the web vite alias.
const _presetResolve = _cfg.resolver.resolveRequest;
_cfg.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@onderling/chat-agent/bridges/telegram') {
    return { filePath: path.resolve(__dirname, 'src/shims/telegramBridge.js'), type: 'sourceFile' };
  }
  // onderling-feedback (split repo, `link:` dep) — Metro has package-exports disabled, so the
  // package's `./public` + `./testing` exports subpaths must be hand-resolved to the sibling
  // checkout (~/expotest/feedback). Without this the whole mobile bundle 500s on feedbackSurface.
  if (moduleName === 'onderling-feedback/public') {
    return { filePath: path.resolve(repoRoot, '../feedback/src/public/index.js'), type: 'sourceFile' };
  }
  if (moduleName === 'onderling-feedback/testing') {
    return { filePath: path.resolve(repoRoot, '../feedback/test/helpers/mock-llm.js'), type: 'sourceFile' };
  }
  // react-native-webrtc: optional rendezvous (direct WebRTC) — native module not in this dev
  // APK; the loader's try/catch can't suppress the native error on Hermes (redbox). Stub it so
  // loadRendezvousRtcLib() returns null and the app runs over relay/nkn. (Install the native
  // dep + rebuild to enable direct WebRTC.)
  // react-native-ble-plx: the shared mesh builder's BleTransport import is LAZY (never executes —
  // basis is mDNS-only), but Metro resolves it statically; an absent package is a build failure
  // before any runtime check. Stub → the builder bundles, BLE stays honestly off (batch 7).
  if (moduleName === 'react-native-ble-plx') {
    return { filePath: path.resolve(__dirname, 'src/shims/bleAbsent.js'), type: 'sourceFile' };
  }
  if (moduleName === 'react-native-webrtc') {
    return { filePath: path.resolve(__dirname, 'src/shims/reactNativeWebrtc.js'), type: 'sourceFile' };
  }
  // expo-notifications / expo-device: named as prerequisites by src/v2/nativePush.js and never added
  // to package.json, so Metro cannot resolve them. nativePush already degrades ({supported:false}),
  // but Metro resolves require() statically — an absent module is a BUILD failure before any
  // try/catch runs. Stub both so the app bundles and reports honestly. (Add the deps + rebuild the
  // dev client to enable real push, then drop this entry.)
  if (moduleName === 'expo-notifications' || moduleName === 'expo-device') {
    return { filePath: path.resolve(__dirname, 'src/shims/expoNotificationsAbsent.js'), type: 'sourceFile' };
  }
  return _presetResolve
    ? _presetResolve(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = _cfg;
