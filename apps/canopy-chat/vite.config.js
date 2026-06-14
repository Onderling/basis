/**
 * canopy-chat — Vite config for the v0.1.4 static web demo.
 *
 * Build pipeline (sub-slice 1.12): outputs to `dist/` for deploy to
 * any static host (or the user's pod once that flow exists in v0.6).
 *
 * Dev server: `pnpm --filter @canopy-app/canopy-chat dev` boots Vite
 * on port 5173 with hot reload.
 */

import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const empty       = fileURLToPath(new URL('./src/web/shims/empty.js',       import.meta.url));
const oidcSession = fileURLToPath(new URL('./src/web/shims/oidcSession.js', import.meta.url));
// `node:*` shims with the NAMED exports the static-import call sites
// reference (sync-engine fsNode/hashNode/PathMap/versions, pseudo-pod
// NodeFsBackend, core PodExporter + A2ATransport + reference-manifest,
// pod-client FileTombstones, stoop + tasks-v0 FilePersist).  Rollup
// fails the production build without proper named exports (the previous
// empty-default shim for `node:crypto` was a known leak that the per-
// file lazy-load workarounds papered over).  Methods throw at runtime
// so a browser caller hitting the unreachable path surfaces the wiring
// bug instead of silently no-oping.  See `node/*.js` for module docs.
const nodeFs      = fileURLToPath(new URL('./src/web/shims/node/fs.js',     import.meta.url));
const nodePath    = fileURLToPath(new URL('./src/web/shims/node/path.js',   import.meta.url));
const nodeCrypto  = fileURLToPath(new URL('./src/web/shims/node/crypto.js', import.meta.url));
const nodeOs      = fileURLToPath(new URL('./src/web/shims/node/os.js',     import.meta.url));
const nodeHttp    = fileURLToPath(new URL('./src/web/shims/node/http.js',   import.meta.url));
const wsShim      = fileURLToPath(new URL('./src/web/shims/wsShim.js',      import.meta.url));
const relayShim   = fileURLToPath(new URL('./src/web/shims/relayShim.js',   import.meta.url));
// Resolve the npm `events` polyfill once, by absolute path.  Transitive
// importers (packages/webid-discovery, etc.) lose the bare-specifier
// resolution chain when they're served as source under pnpm hoisting;
// pinning to one absolute file keeps every `node:events` import on the
// same module instance.
const eventsShim  = fileURLToPath(new URL(
  './node_modules/events/events.js', import.meta.url,
));

export default defineConfig({
  root: 'web',
  // Allow imports from outside `web/`.  '../..' reaches the monorepo
  // root so `packages/*` and other apps' node_modules trees (pnpm
  // hoists per-app copies under `apps/<x>/node_modules/.pnpm/...`)
  // can be served as source.  Required when `optimizeDeps.exclude`
  // bypasses the per-package .vite/deps bundle.
  server: {
    fs: { allow: ['..', '../..'] },
    // Dev-only same-origin proxy for a LOCAL OpenAI-compatible LLM (a Privatemode proxy or Ollama), so
    // the BROWSER circle bot / feedback bot avoid cross-origin CORS (a local model server usually doesn't
    // send Access-Control-Allow-Origin). Point `VITE_CIRCLE_LLM_BASEURL=/llm` (and/or
    // `VITE_FEEDBACK_LLM_BASEURL=/llm`) and run the model server on `LLM_PROXY_TARGET`
    // (default the Privatemode proxy at :8080; set `LLM_PROXY_TARGET=http://localhost:11434` for Ollama).
    // The provider appends `/v1/chat/completions`, so `/llm/v1/chat/completions` → `<target>/v1/chat/completions`.
    proxy: {
      '/llm': {
        target: process.env.LLM_PROXY_TARGET || 'http://localhost:8080',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/llm/, ''),
      },
    },
  },
  // Skip esbuild pre-bundling for `@canopy/core`: its index.js uses
  // the renamed re-export form `export { encode as b64encode } from
  // './crypto/b64.js'`, which esbuild's pre-bundler drops when
  // applied to pnpm workspace deps (file:../packages/core).  Symptom:
  // `Uncaught SyntaxError: doesn't provide an export named: b64encode`
  // at runtime even though the source file does export b64encode.
  // Serving core's source directly bypasses the bad bundle.  Other
  // workspace deps don't use the same export form + pre-bundle fine.
  // See slice-4 smoke fix (2026-05-23).
  optimizeDeps: {
    exclude: ['@canopy/core'],
    // `@canopy/core` is served as SOURCE (excluded above), so Vite resolves its
    // transitive CJS crypto deps (tweetnacl/ed2curve, imported by AgentIdentity)
    // at request time. When they resolve to a workspace copy OUTSIDE the app root
    // (served raw via `@fs/`), a `default` import fails — "doesn't provide an
    // export named default". Force-optimizing them applies the CJS→ESM interop
    // (the synthetic default), independent of which copy resolves.
    include: ['tweetnacl', 'ed2curve'],
  },
  // OQ-1.C resolution: @canopy/core transports use runtime detection
  // (`typeof WebSocket !== 'undefined'` etc.) and fall back to Node-
  // only packages via `await import('ws' | 'mqtt' | …)`.  In the
  // browser those fallback branches NEVER execute, but Rollup still
  // walks the dynamic-import targets at bundle time and fails if it
  // can't resolve them.  Aliasing to an empty module makes the build
  // clean without changing runtime behaviour.  The transports we
  // actually USE in the browser (RelayTransport via globalThis.WebSocket,
  // InternalTransport, NknTransport via its browser SDK if loaded) all
  // take a different branch and don't hit these shims.
  resolve: {
    alias: {
      // `ws` is Node-only; the relay's WsServerTransport statically
      // imports `WebSocketServer` from it.  Shim carries the named
      // export so Rollup is happy; classes throw at construction if
      // a browser caller hits the code path (today none do).
      'ws':              wsShim,
      'mqtt':            empty,
      // v0.7.P3b 2026-05-23 — 'nkn-sdk' kept shimmed.  The real lib
      // arrives via the CDN <script> tag in index.html (window.nkn).
      // Vite's dynamic-import resolution still needs SOMETHING to
      // resolve the bare 'nkn-sdk' specifier; the empty shim does
      // exactly that (the dynamic-import path in NknTransport never
      // executes when window.nkn is supplied as opts.nknLib).
      'nkn-sdk':         empty,
      'js-yaml':         empty,
      'node-datachannel': empty,
      // N5 — @canopy/pod-client's barrel statically re-exports every
      // TombstoneStore adapter, incl. the RN-only AsyncStorageTombstones
      // (imports @react-native-async-storage/async-storage).  The web
      // bundle never uses it — PodClient defaults to MemoryTombstones —
      // so the bare specifier just needs to resolve.
      '@react-native-async-storage/async-storage': empty,
      // Node-builtin shims — one stub per module, all carrying the
      // NAMED exports the static-import call sites reference.  This
      // replaces the previous mix of:
      //   - empty-default shim for `node:crypto` (silently broken if
      //     Rollup ever walked into a `createHash` static import)
      //   - per-file `await import('node:X')` lazy-loads in core
      //     A2ATransport + PodExporter (which worked but pessimised
      //     the bundle with one async boundary per call site)
      //
      // Call sites that hit these in the browser are wiring bugs —
      // each stub throws with a clear message naming the missing
      // adapter.  Browser-native equivalents are delegated where they
      // exist (crypto.randomUUID / crypto.subtle via globalThis.crypto;
      // path.* as a real POSIX implementation since it's pure-string).
      //
      // `node:fs` + `node:fs/promises` share one shim with both shapes
      // of named exports (the `promises.readFile` form AND the bare
      // `readFile` named form).
      'node:fs/promises': nodeFs,
      'node:fs':          nodeFs,
      'node:path':        nodePath,
      'node:crypto':      nodeCrypto,
      'node:os':          nodeOs,
      'node:http':        nodeHttp,
      'http':             nodeHttp,
      // 'node:events' has a real browser polyfill (`events`); some
      // substrates (SolidVault, WebIdCache) statically import it.
      // We don't EXECUTE those code paths in v0.1, but they're in the
      // import graph so they need to resolve.
      'node:events': eventsShim,
      'events':      eventsShim,   // some packages import the bare specifier
      // OIDC chain — @canopy/core re-exports SolidVault from
      // @canopy/oidc-session, which pulls in Inrupt's Node-only auth
      // package + openid-client (which uses node:crypto, node:http,
      // node:util, ...).  canopy-chat v0.1 ships PRE-SIGNED-IN per
      // OQ-1.A; OIDC handoff lands in v0.6 via J6.  Until then we stub
      // the whole OIDC tree.  A future cleanup should split
      // @canopy/oidc-session into browser-compat + Node-only entry
      // points (existing @canopy/oidc-session-rn shows the pattern).
      //
      // The OIDC shim provides NAMED exports matching the real
      // package's index.js (SolidVault, KNOWN_ISSUERS, …) because
      // esbuild (Vite's dep pre-bundler in dev mode) is stricter
      // than rollup about named-export resolution.  The other
      // entries point at the bare empty module because their
      // imports happen via dynamic-import (never executed).
      '@canopy/oidc-session':                 oidcSession,
      '@inrupt/solid-client-authn-node':      empty,
      // v0.7.P1 — DON'T shim '@inrupt/solid-client-authn-core'.  We
      // now compose '@inrupt/solid-client-authn-browser' for real
      // OIDC; the browser package depends on the core package's
      // type/util exports (e.g. determineSigningAlg).  Stubbing it
      // breaks the build with 'X is not exported by empty.js'.  The
      // Node auth package stays shimmed (separate name).
      'openid-client':                        empty,
      // `@canopy/relay` is a Node-only HTTP server package; stoop's
      // Agent.js dynamic-imports WebPushSender which pulls in
      // `PushSender` from relay.  Browser code never instantiates
      // WebPushSender (no VAPID keys are passed in the browser
      // bundle), so aliasing the whole relay package to empty cuts
      // the import graph at the boundary.  Without this, Rollup
      // walks transitively into `relay/src/server.js` which static-
      // imports node:http, node:https, ws, better-sqlite3, … none
      // of which belong in a browser bundle (#303).
      '@canopy/relay':                        relayShim,
      // VaultNodeFs is Node-only by design — VaultMemory is what we
      // use in v0.1.  Stubbing keeps the @canopy/vault index re-export
      // happy.
      // (No alias needed — VaultNodeFs guards its `fs` import at use-
      // time, but the static `node:fs` import would still trip Rollup.
      // Vite's externalized-for-browser warning above is fine because
      // VaultNodeFs's code path is never invoked in browsers.)
    },
  },
  build:  {
    outDir:      '../dist',
    emptyOutDir: true,
    target:      'es2022',
    rollupOptions: {
      // Multi-page: the v2 circle app is now the default landing
      // (index.html); the classic shell is kept reachable at classic.html.
      input: {
        main:    'web/index.html',   // v2 circle app (default)
        classic: 'web/classic.html', // legacy chat shell (reference)
      },
    },
  },
});
