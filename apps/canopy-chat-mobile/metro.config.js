// canopy-chat-mobile metro.config.js — mirrors stoop-mobile + folio-mobile.
//
// The @canopy/react-native metro-preset handles:
//   - NODE_BUILTINS shimming + `node:` prefix stripping
//   - util / path / ws shim routing
//   - `@canopy/react-native/platform/*` subpath resolution (Metro 52
//     disables unstable_enablePackageExports, so the package's
//     `exports` map for ./platform/polyfills etc. must be hand-resolved)
//   - generic @canopy/<pkg>/<subpath> resolver from each package's exports map
//
// canopy-chat-mobile's app-specific bits are:
//   - 5 sibling apps in watchFolders (canopy-chat + the 4 composed apps)
//   - extraNodeModules aliases for the workspace packages that are NOT
//     declared in package.json deps (e.g. @canopy/vault, pulled in
//     transitively by realAgent.js → secure-agent)
//   - extraSubpathResolvers for `@canopy-app/{tasks-v0,stoop,folio}/browser`
//     (Trap 2 — overlapping `extraNodeModules` prefixes; shorter prefix
//     wins, so Metro would otherwise try apps/<app>/browser instead of
//     apps/<app>/src/browser.js)
//   - The same stoop /lib + /locales resolvers stoop-mobile uses, since
//     the realAgent.js chain transitively reaches stoop's app-internal
//     subpaths.

const path = require('path');
const { withCanopyPreset } = require('@canopy/react-native/metro-preset');

const projectRoot = __dirname;
const repoRoot    = path.resolve(__dirname, '../..');

module.exports = withCanopyPreset({
  projectRoot,
  repoRoot,

  // Composition shell — realAgent.js imports the browser factories of
  // tasks-v0 / stoop / folio + the calendar app barrel + canopy-chat's
  // own core/web sources via relative paths.  Each app's source dir
  // needs to be in the Metro watch graph.
  watchFolders: [
    path.resolve(repoRoot, 'apps/canopy-chat'),
    path.resolve(repoRoot, 'apps/tasks-v0'),
    path.resolve(repoRoot, 'apps/stoop'),
    path.resolve(repoRoot, 'apps/folio'),
    path.resolve(repoRoot, 'apps/calendar'),
    // M6 — the feedback bot: canopy-chat's feedbackSurface/feedbackMount reach into
    // apps/feedback-pipeline (channel bridges + dispatcher + pod + config + ollama).
    path.resolve(repoRoot, 'apps/feedback-pipeline'),
    // Workspace packages the composed apps + secure-agent reach for.
    path.resolve(repoRoot, 'packages/vault'),
    path.resolve(repoRoot, 'packages/chat-p2p'),
    path.resolve(repoRoot, 'packages/identity-resolver'),
    path.resolve(repoRoot, 'packages/item-store'),
    path.resolve(repoRoot, 'packages/local-store'),
    path.resolve(repoRoot, 'packages/notifier'),
    path.resolve(repoRoot, 'packages/skill-match'),
    path.resolve(repoRoot, 'packages/manifest-host'),
    path.resolve(repoRoot, 'packages/app-manifest'),
    // @canopy/llm-client — the circle bot's NL→slash LLM client (ollama provider).
    path.resolve(repoRoot, 'packages/llm-client'),
  ],

  // Block apps/<app>/node_modules — server / CLI / web-only deps the
  // mobile bundle never reaches.
  //
  // Plus a NARROW block on RN / Expo entries in any packages/*/.pnpm
  // store — needed because canopy-chat-mobile's `file:` dep on
  // @canopy/react-native triggers an npm install pass inside that
  // package, which in turn lets pnpm hoist RN 0.85.3 into
  // packages/react-native/node_modules/.pnpm/.  Metro then follows
  // symlinks into that store and tries to compile RN 0.85.3 with our
  // RN 0.76 babel preset, exploding on the `match` TC39 syntax.
  // Blocking only the RN/Expo entries leaves legitimate symlinks (e.g.
  // @inrupt/solid-client in packages/core/node_modules/.pnpm) intact.
  extraBlockListRegExps: [
    new RegExp(
      `^(${['canopy-chat', 'tasks-v0', 'stoop', 'folio', 'calendar']
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
  ],

  // App-specific module aliases (the preset already maps the @canopy/*
  // SDK packages declared in this app's package.json).  These are the
  // packages pulled in TRANSITIVELY by the composed apps that aren't
  // direct deps of canopy-chat-mobile.
  extraNodeModules: {
    // Direct: the 5 composed apps.  realAgent.js uses subpath imports
    // (/browser) — those go through extraSubpathResolvers below.
    '@canopy-app/canopy-chat': path.resolve(repoRoot, 'apps/canopy-chat'),
    '@canopy-app/tasks-v0':    path.resolve(repoRoot, 'apps/tasks-v0'),
    '@canopy-app/stoop':       path.resolve(repoRoot, 'apps/stoop'),
    '@canopy-app/folio':       path.resolve(repoRoot, 'apps/folio'),
    '@canopy-app/calendar':    path.resolve(repoRoot, 'apps/calendar'),

    // Transitive @canopy/* not declared in package.json deps.
    // @canopy/vault is reached via secure-agent + realAgent.js's
    // VaultMemory / VaultLocalStorage imports (VaultAsyncStorage
    // replaces VaultLocalStorage at boot — but the import resolves
    // unconditionally, so the module must still exist on disk).
    '@canopy/vault':             path.resolve(repoRoot, 'packages/vault'),
    '@canopy/chat-p2p':          path.resolve(repoRoot, 'packages/chat-p2p'),
    '@canopy/identity-resolver': path.resolve(repoRoot, 'packages/identity-resolver'),
    '@canopy/item-store':        path.resolve(repoRoot, 'packages/item-store'),
    '@canopy/notifier':          path.resolve(repoRoot, 'packages/notifier'),
    '@canopy/skill-match':       path.resolve(repoRoot, 'packages/skill-match'),
    '@canopy/manifest-host':     path.resolve(repoRoot, 'packages/manifest-host'),
    // @canopy/llm-client — bare import resolves via its package.json main (src/index.js); the
    // /providers/ollama subpath goes through extraSubpathResolvers (package-exports is disabled).
    '@canopy/llm-client':        path.resolve(repoRoot, 'packages/llm-client'),
  },

  // Subpath resolvers — Trap 2 escape hatch.
  //
  // `@canopy-app/{tasks-v0,stoop,folio}/browser` resolve to
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
        /^@canopy-app\/(tasks-v0|stoop|folio)\/browser$/,
      );
      if (browserMatch) {
        return {
          filePath: path.resolve(repoRoot, 'apps', browserMatch[1], 'src/browser.js'),
          type:     'sourceFile',
        };
      }

      // 2. Stoop's @canopy-app/stoop/lib/* — real files live in src/lib/.
      if (moduleName.startsWith('@canopy-app/stoop/lib/')) {
        const sub = moduleName.slice('@canopy-app/stoop/lib/'.length);
        return {
          filePath: path.resolve(repoRoot, 'apps/stoop/src/lib', sub + '.js'),
          type:     'sourceFile',
        };
      }

      // 3. Stoop's locales — exports map points to apps/stoop/locales/{en,nl}.json.
      if (moduleName.startsWith('@canopy-app/stoop/locales/')) {
        const sub = moduleName.slice('@canopy-app/stoop/locales/'.length);
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
          filePath: path.resolve(repoRoot, 'apps/feedback-pipeline/node_modules/eld/src/entries', `static.${eldMatch[1]}.js`),
          type:     'sourceFile',
        };
      }

      // 5. @canopy/llm-client provider subpaths (circle bot). Package-exports disabled → map directly.
      const llmMatch = moduleName.match(/^@canopy\/llm-client\/providers\/(ollama|mock)$/);
      if (llmMatch) {
        return {
          filePath: path.resolve(repoRoot, 'packages/llm-client/src/providers', `${llmMatch[1]}.js`),
          type:     'sourceFile',
        };
      }

      return null;
    },
  ],
});
