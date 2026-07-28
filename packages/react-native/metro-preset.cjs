// metro-preset — reusable Metro configuration for `@onderling` apps
// running on React Native.
//
// This preset captures the cross-cutting Metro setup that every
// `@onderling` RN app needs: NODE_BUILTINS shimming, `node:`-prefix
// stripping, util/path/ws shim routing, monorepo subpath handling,
// `unstable_enablePackageExports: false`.  See ./docs/BRING-UP-NOTES.md
// for the trap catalogue this is mitigating.
//
// Usage in an app's metro.config.js:
//
//   const path = require('path');
//   const { withOnderlingPreset } =
//     require('@onderling/react-native/metro-preset');
//
//   module.exports = withOnderlingPreset({
//     projectRoot: __dirname,
//     repoRoot:    path.resolve(__dirname, '../..'),
//     // optional app-specific extras:
//     watchFolders:      [path.resolve(__dirname, '../my-app-package')],
//     extraNodeModules:  { '@my-org/foo': path.resolve(__dirname, '../foo') },
//     extraBlockListRegExps: [],
//     extraSubpathResolvers: [
//       (moduleName, repoRoot) => {
//         if (moduleName.startsWith('@my-org/foo/rn/')) {
//           const sub = moduleName.slice('@my-org/foo/rn/'.length);
//           return { filePath: path.resolve(repoRoot, 'apps/foo/src/rn', sub + '.js'), type: 'sourceFile' };
//         }
//         return null;
//       },
//     ],
//     pinToAppModules: ['react', 'react-native'],   // packages to pin to app's node_modules
//   });

const path = require('path');
const fs = require('fs');

// `expo/metro-config` is a peer-dep of the consuming app — resolve it
// from the app's `projectRoot`, not from this preset's own location.
// Symlinked-package installs (file: deps in monorepos) place this
// preset inside `apps/<x>/node_modules/@onderling/react-native/` as a
// symlink to `packages/react-native/`; Node's CJS resolver walks up
// from the symlink target by default and won't find expo at the repo
// root.  Resolving with `paths: [projectRoot]` walks from the app's
// own node_modules instead.
function loadExpoMetroConfig(projectRoot) {
  const resolved = require.resolve('expo/metro-config', { paths: [projectRoot] });
  return require(resolved);
}

// ── Path to this package's own files. ───────────────────────────────
//
// The preset itself is at:  packages/react-native/metro-preset.cjs
// The shims are at:         packages/react-native/src/platform/shims/*.js
// The platform helpers at:  packages/react-native/src/platform/*.{js,rn.js}
const PRESET_DIR  = __dirname;
const PLATFORM_DIR = path.resolve(PRESET_DIR, 'src/platform');
const SHIMS_DIR    = path.resolve(PLATFORM_DIR, 'shims');
const SHIM_PATHS = {
  nodeBuiltins: path.resolve(SHIMS_DIR, 'node-builtins.js'),
  util:         path.resolve(SHIMS_DIR, 'util.js'),
  path:         path.resolve(SHIMS_DIR, 'path.js'),
  ws:           path.resolve(SHIMS_DIR, 'ws.js'),
};

// Platform helpers that ship a `.rn.js` variant alongside the default
// `.js`.  Metro's auto-`*.rn.js` selection only kicks in for the
// default file-system resolution path; with `unstable_enablePackageExports`
// off, subpath imports go through this preset's resolveRequest, so
// we route them explicitly.  Add new RN-variant helpers here.
const PLATFORM_RN_VARIANTS = new Set(['polyfills']);

// ── Generic `exports`-map subpath resolver. ─────────────────────────
//
// `unstable_enablePackageExports: false` (set below) makes Metro
// ignore every workspace package's `exports` map, so each declared
// subpath import (`@onderling/<pkg>/<sub>`) must be hand-resolved in
// resolveRequest.  Rather than maintain per-package hardcoded lists
// that silently drift from package.json (the class of omission that
// broke `@onderling/react-native/theme`, then `@onderling/sync-engine-rn/
// react`, for stoop-mobile 2026-05-16 — one rebuild surfaced the next
// each time), resolve through each package's own `exports` map: the
// single source of truth.
//
// Supports exact subpath keys, Node `*` subpath patterns (e.g.
// sync-engine's `"./adapters/*": "./src/adapters/*.js"`), and
// conditional targets (`{ "react-native": …, "default": … }` — the
// `.rn.js` variant is picked on non-web platforms).  Returns an
// absolute file path, or null when the subpath isn't declared (the
// caller then falls through to default Metro resolution).
function resolveExportsSubpath(exportsMap, pkgDir, subpath, platform) {
  if (!exportsMap || typeof exportsMap === 'string') return null;
  const key = subpath === '' ? '.' : './' + subpath;
  const pick = (val) => {
    if (typeof val === 'string') return val;
    if (val && typeof val === 'object') {
      if (platform !== 'web' && typeof val['react-native'] === 'string') return val['react-native'];
      if (typeof val.default === 'string') return val.default;
      if (typeof val.node === 'string') return val.node;
    }
    return null;
  };
  // 1. Exact subpath key.
  if (Object.prototype.hasOwnProperty.call(exportsMap, key)) {
    const rel = pick(exportsMap[key]);
    return rel ? path.resolve(pkgDir, rel) : null;
  }
  // 2. `*` subpath pattern — longest matching prefix wins (per Node).
  let best = null;
  for (const pat of Object.keys(exportsMap)) {
    const star = pat.indexOf('*');
    if (star === -1) continue;
    const pre = pat.slice(0, star);
    const post = pat.slice(star + 1);
    if (key.length < pre.length + post.length) continue;
    if (!key.startsWith(pre) || !key.endsWith(post)) continue;
    if (!best || pre.length > best.pre.length) {
      best = { pat, pre, post, cap: key.slice(pre.length, key.length - post.length) };
    }
  }
  if (best) {
    const rel = pick(exportsMap[best.pat]);
    return rel ? path.resolve(pkgDir, rel.replace('*', best.cap)) : null;
  }
  return null;
}

// ── Node built-ins shimmed to a near-empty object. ──────────────────
//
// These appear in server-side SDK + app code (CLI factories, Inrupt's
// Node-only auth, chokidar/express/systray, etc.) but are never
// actually invoked on mobile.  Metro resolves dynamic imports at
// bundle time, so missing them = bundle failure even on dead-code
// paths.  Shimming to an empty-ish object lets the bundle complete.
//
// `util`, `events`, `punycode`, `buffer`, `path` are NOT in this set —
// they have real polyfill packages (`util`, `events`, `punycode`,
// `buffer`) that libraries actually invoke at runtime.  `path` has its
// own dedicated shim (SHIM_PATHS.path).
const NODE_BUILTINS = new Set([
  'http', 'https', 'net', 'tls', 'fs', 'fs/promises',
  'os', 'stream', 'zlib', 'dns', 'dgram',
  'child_process', 'cluster', 'worker_threads',
  'readline', 'repl', 'vm', 'module', 'perf_hooks',
  'assert', 'constants', 'domain', 'sys',
  'timers', 'string_decoder', 'v8',
  // Required by ws internals (sender.js, websocket-server.js)
  'crypto',
  // Required by @inrupt/solid-client-authn-node bundling chain
  'url', 'querystring', 'tty',
]);

/**
 * Build the Metro config for a `@onderling` RN app.
 *
 * @param {object} options
 * @param {string} options.projectRoot                      Absolute path of the app's root.
 * @param {string} options.repoRoot                         Absolute path of the monorepo root.
 * @param {string[]} [options.watchFolders=[]]              Extra watch folders the app needs.
 * @param {Record<string, string>} [options.extraNodeModules={}]   App-specific module aliases.
 * @param {RegExp[]} [options.extraBlockListRegExps=[]]     App-specific block-list entries.
 * @param {string[]} [options.extraNodeModulesPaths=[]]     App-specific extra node_modules search paths.
 * @param {Array<(moduleName: string, repoRoot: string, projectRoot: string) => null | {filePath: string, type: 'sourceFile'}>} [options.extraSubpathResolvers=[]]
 *   Custom subpath resolvers (return null to fall through to next).
 * @param {string[]} [options.pinToAppModules=[]]           Packages to pin to the app's own node_modules
 *   (avoids conflicting versions in monorepo node_modules).
 * @param {object} [options.extraShims={}]                  Module-name → file-path map; replaces
 *   resolution for the listed module names.  Use sparingly.
 * @returns {object}                                         Metro config object.
 */
function withOnderlingPreset(options) {
  const {
    projectRoot,
    repoRoot,
    watchFolders          = [],
    extraNodeModules      = {},
    extraBlockListRegExps = [],
    extraNodeModulesPaths = [],
    extraSubpathResolvers = [],
    pinToAppModules       = [],
    extraShims            = {},
  } = options;

  if (!projectRoot) {
    throw new Error('[withOnderlingPreset] projectRoot is required');
  }
  if (!repoRoot) {
    throw new Error('[withOnderlingPreset] repoRoot is required');
  }

  const APP_MODULES = path.resolve(projectRoot, 'node_modules');

  // Helper: pin a list of package names to APP_MODULES.
  const pinToApp = (names) =>
    Object.fromEntries(names.map((n) => [n, path.resolve(APP_MODULES, n)]));

  // ── Auto-discover `@onderling/*` workspace packages. ─────────────────
  //
  // The repo has ~30 `file:` workspace packages and the standardisation
  // work keeps extracting more out of `@onderling/core` (theme, vault,
  // online-cadence, …).  A hand-maintained alias list silently drifts
  // and breaks the RN bundle one package at a time (every device-pass
  // rebuild surfaced the next missing one: 2026-05-16).  Derive the
  // list from `packages/*/package.json` instead — the single source of
  // truth — so newly-extracted packages just work.
  //
  // Each package needs BOTH an `extraNodeModules` alias (so Metro can
  // resolve the bare `@onderling/<x>` import under
  // `unstable_enablePackageExports: false`) AND a `watchFolders` entry
  // (Metro rejects files outside projectRoot/watchFolders even when
  // resolved).  Node-only canopy packages (e.g. `@onderling/relay`) stay
  // shimmed: their explicit `SHIM_PATHS.nodeBuiltins` entries appear
  // LATER in the `extraNodeModules` object literal below and therefore
  // override the directory alias produced here.
  const CANOPY_PACKAGES_DIR = path.resolve(repoRoot, 'packages');
  const canopyWorkspaceAliases = {};
  const canopyWorkspaceDirs = [];
  const canopyPkgMeta = {}; // name -> { dir, exports } for subpath resolution
  for (const entry of fs.readdirSync(CANOPY_PACKAGES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgDir = path.resolve(CANOPY_PACKAGES_DIR, entry.name);
    let pkgJson;
    try {
      pkgJson = require(path.join(pkgDir, 'package.json'));
    } catch {
      continue; // no/invalid package.json — not a workspace package
    }
    const name = pkgJson.name;
    if (typeof name !== 'string' || !name.startsWith('@onderling/')) continue;
    canopyWorkspaceAliases[name] = pkgDir;
    canopyWorkspaceDirs.push(pkgDir);
    canopyPkgMeta[name] = { dir: pkgDir, exports: pkgJson.exports };
  }

  // ── Start from Expo's default config. ─────────────────────────────
  const { getDefaultConfig } = loadExpoMetroConfig(projectRoot);
  const config = getDefaultConfig(projectRoot);

  // ── Watch folders (preset's monorepo defaults + app's extras). ────
  config.watchFolders = [
    ...(config.watchFolders ?? []),
    ...canopyWorkspaceDirs,
    ...watchFolders,
  ];

  // ── Block list — surgical per-subtree block inside each watched
  //    workspace package's `node_modules`.
  //
  //    `watchFolders` now spans all auto-discovered `@onderling/*`
  //    packages and Metro crawls the node_modules tree of every
  //    watched folder on startup.  This repo has NO root hoisting, so
  //    each substrate package keeps its real npm deps in its OWN
  //    `node_modules` — those MUST stay resolvable (e.g. `ajv-formats`
  //    for `@onderling/item-types`, `@inrupt/solid-client` for core).
  //    So we do NOT block whole package node_modules (an earlier
  //    blanket block broke exactly those deps, 2026-05-16); instead we
  //    block only the two concrete crash classes:
  //
  //      • Duplicate framework copies — `react`, `react-dom`,
  //        `react-native`, `@react-native*`.  React/RN must be a
  //        singleton from the app (pinned via `pinToApp`); a dup copy
  //        either crashes at runtime ("Invalid hook call") or fails to
  //        transform (`packages/oidc-session-rn/node_modules/
  //        react-native/.../VirtualView.js`: newer `match (x){` syntax
  //        the app's Babel can't parse — surfaced 2026-05-16).
  //      • `chokidar` / `readdirp` — the documented fs-shim crawl
  //        crash: Metro crawling them runs `util.promisify(
  //        fs.readdir)` under the empty `fs` shim → throws.  The bare
  //        `chokidar` import is separately aliased to the shim in
  //        `extraNodeModules` below, so blocking the crawl is safe.
  //      • The whole Expo / React-Native ecosystem (`react`,
  //        `react-dom`, `react-native`, `react-native-*`, `expo`,
  //        `expo-*`, `@expo/*`, `@react-native*`).  These carry the
  //        native side that is autolinked into the app binary from the
  //        APP's pinned copy and MUST be a single version shared by JS
  //        and native.  Several `@onderling/*` packages declare them as
  //        loose (`"*"` / `^`) peer/deps, so with no root hoisting npm
  //        installed a whole LATEST Expo-SDK-55 / RN-0.85 tree into
  //        `packages/oidc-session-rn` (+ `packages/react-native`)
  //        while the app is on Expo-SDK-52 / RN-0.76.  JS then resolves
  //        the dup and calls a native interface the binary doesn't
  //        expose → runtime `Cannot find native module 'ExpoCryptoAES'`
  //        / `native module is null cannot access legacy storage`
  //        (surfaced 2026-05-16; a correct scan found 40 such split
  //        dups).  Matched by PREFIX FAMILY (not a hand-list, which
  //        drifts and needs an entry per package) so any current or
  //        future Expo/RN dep is forced onto the app singleton.
  //
  //    Everything else in every package's node_modules resolves and
  //    crawls normally (plain JS libs are harmless to index).  Built
  //    from `canopyWorkspaceDirs` so it stays drift-proof alongside
  //    the auto-discovery.  Substrate Expo/RN deps are peerDeps the
  //    host app provides; the app (a full Expo app) carries the whole
  //    SDK set, so forcing its copy is correct (a missing one would be
  //    a real host-dep bug worth surfacing, not masking).
  const ECOSYSTEM_ALT =
    '@react-native[^/\\\\]*|@expo|expo(?:-[^/\\\\]+)?|' +
    'react-native(?:-[^/\\\\]+)?|react-dom|react|chokidar|readdirp';
  const blockedSubtreeRegExps = canopyWorkspaceDirs.map((d) => {
    const esc = path.resolve(d, 'node_modules').replace(/[/\\]/g, '[/\\\\]');
    return new RegExp(`^${esc}[/\\\\](?:${ECOSYSTEM_ALT})[/\\\\]`);
  });
  const existingBlockList = config.resolver?.blockList;
  const blockListEntries = existingBlockList
    ? (Array.isArray(existingBlockList) ? existingBlockList : [existingBlockList])
    : [];
  config.resolver = config.resolver ?? {};
  config.resolver.blockList = [
    ...blockListEntries,
    ...blockedSubtreeRegExps,
    ...extraBlockListRegExps,
  ];

  // ── Resolver — extraNodeModules, nodeModulesPaths, resolveRequest. ─
  config.resolver = {
    ...config.resolver,

    // Forcing exports-resolution OFF avoids Hermes' "property 'require'
    // doesn't exist" at startup when an ESM file is preferred for a
    // CJS-shaped consumer.  See BRING-UP-NOTES.md for the saga.
    unstable_enablePackageExports: false,

    extraNodeModules: {
      ...(config.resolver?.extraNodeModules ?? {}),

      // Local `@onderling/*` SDK packages — auto-discovered from
      // `packages/*` above (drift-proof; Node-only ones like
      // `@onderling/relay` are re-shimmed by the explicit entries below,
      // which win as later keys in this object literal).
      ...canopyWorkspaceAliases,

      // ws is Node-only; RN has globalThis.WebSocket built in.
      'ws': SHIM_PATHS.ws,

      // Inrupt's Node-only auth lib + CLI/server-only deps that mobile
      // never invokes at runtime.  Shim to an empty-ish module so the
      // bundle completes.
      '@inrupt/solid-client-authn-node': SHIM_PATHS.nodeBuiltins,
      'chokidar':                         SHIM_PATHS.nodeBuiltins,
      'express':                          SHIM_PATHS.nodeBuiltins,
      'systray2':                         SHIM_PATHS.nodeBuiltins,
      // `@onderling/relay` is the Node-side relay server (Web Push
      // sender, mDNS discovery, the local-UI HTTP shim).  Stoop's
      // `apps/stoop/src/lib/WebPushSender.js` does a dynamic import
      // of `@onderling/relay` when VAPID keys are configured — Metro
      // statically follows the dynamic `import()` and would fail
      // without this shim.  Mobile uses native Expo push instead;
      // the dynamic-import branch never fires at runtime.
      // Stoop V3 mobile Phase 40.23 trap (2026-05-08).
      '@onderling/relay':                  SHIM_PATHS.nodeBuiltins,
      // Same trap class: `web-push` is the Node Web-Push library
      // pulled by `WebPushSender`.  Mobile never reaches it.
      'web-push':                         SHIM_PATHS.nodeBuiltins,

      // Pin core React / RN packages to the app's node_modules to
      // avoid conflicting copies pulled in via monorepo hoisting.
      ...pinToApp(pinToAppModules),

      // App-defined module aliases override / extend the preset.
      ...extraNodeModules,

      // App-defined explicit shims (replace resolution for given names).
      ...extraShims,
    },

    nodeModulesPaths: [
      APP_MODULES,
      path.resolve(repoRoot, 'packages/core/node_modules'),
      path.resolve(repoRoot, 'packages/pod-client/node_modules'),
      ...extraNodeModulesPaths,
    ],

    resolveRequest: (context, moduleName, platform) => {
      // Strip `node:` prefix for builtin lookups.
      const stripped = moduleName.startsWith('node:') ? moduleName.slice(5) : moduleName;

      // 1. Node built-ins → empty-ish shim.
      if (NODE_BUILTINS.has(stripped)) {
        return { filePath: SHIM_PATHS.nodeBuiltins, type: 'sourceFile' };
      }

      // 2. `util` → util shim (real polyfill + TextDecoder/TextEncoder top-up).
      if (stripped === 'util') {
        return { filePath: SHIM_PATHS.util, type: 'sourceFile' };
      }

      // 3. `path` → POSIX path shim (PathMap.js destructures `posix.join` at module load).
      if (stripped === 'path') {
        return { filePath: SHIM_PATHS.path, type: 'sourceFile' };
      }

      // 4. `ws` (and subpaths) → ws shim (RN has globalThis.WebSocket).
      if (moduleName === 'ws' || moduleName.startsWith('ws/')) {
        return { filePath: SHIM_PATHS.ws, type: 'sourceFile' };
      }

      // 5. `@onderling/react-native/platform/*` — substrate's platform
      //    helpers.  With `unstable_enablePackageExports: false` (set
      //    above), the package.json `exports` field is ignored and
      //    subpath imports must be resolved here.  Metro's `*.rn.js`
      //    auto-selection also doesn't apply when we hand-resolve, so
      //    we pick the variant manually based on platform.
      if (moduleName.startsWith('@onderling/react-native/platform/')) {
        const sub = moduleName.slice('@onderling/react-native/platform/'.length);
        const useRn = platform !== 'web' && PLATFORM_RN_VARIANTS.has(sub);
        return {
          filePath: path.resolve(PLATFORM_DIR, sub + (useRn ? '.rn.js' : '.js')),
          type: 'sourceFile',
        };
      }

      // 5b. Generalized `@onderling/<workspace-pkg>/<subpath>` resolution
      //     via the target package's own `exports` map (drift-proof;
      //     subsumes the former hand-rolled per-package sync-engine +
      //     react-native subpath special-cases — every workspace
      //     package's declared subpaths now resolve from the single
      //     source of truth, so a newly-extracted package just works).
      //     `@onderling/react-native/platform/*` keeps its dedicated
      //     rule 5 above (authoritative for the platform `.rn.js`
      //     selection) and is intercepted before it reaches here.
      //     Node-only deps reached through these subpaths (e.g.
      //     `chokidar` via sync-engine's adapters/watcherNode) stay
      //     aliased to the empty shim in `extraNodeModules` above.
      if (moduleName.startsWith('@onderling/')) {
        const rest = moduleName.slice('@onderling/'.length);
        const slash = rest.indexOf('/');
        if (slash !== -1) {
          const pkg = '@onderling/' + rest.slice(0, slash);
          const meta = canopyPkgMeta[pkg];
          if (meta) {
            const resolved = resolveExportsSubpath(
              meta.exports, meta.dir, rest.slice(slash + 1), platform,
            );
            if (resolved) return { filePath: resolved, type: 'sourceFile' };
            // Declared workspace pkg but undeclared subpath → fall
            // through to default resolution (matches Node behaviour).
          }
        }
      }

      // 6. App-defined custom subpath resolvers.
      for (const resolver of extraSubpathResolvers) {
        const result = resolver(moduleName, repoRoot, projectRoot);
        if (result) return result;
      }

      // 7. `node:`-prefixed import that wasn't a builtin → fall through to
      //    normal resolution with the prefix stripped (lets `node:events`
      //    find the real `events` polyfill in node_modules).
      if (moduleName.startsWith('node:')) {
        return context.resolveRequest(context, stripped, platform);
      }

      // 8. Default Metro resolution.
      return context.resolveRequest(context, moduleName, platform);
    },
  };

  return config;
}

// `withCanopyPreset` is the legacy alias (naming decision 2026-07-28: no new "canopy" identifiers);
// existing metro configs keep working, new ones use `withOnderlingPreset`.
module.exports = { withOnderlingPreset, withCanopyPreset: withOnderlingPreset, NODE_BUILTINS };
