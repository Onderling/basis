# Known gotchas — check here BEFORE debugging build/native issues

Agent-facing. These are traps that have already cost time in this repo and **will bite again**.
Several pass locally and only fail on device/CI, so they're easy to misdiagnose. Skim this list
before you start bisecting a build or native crash.

---

## Monorepo module resolution (npm workspaces + symlinks)

**Umbrella pattern.** Workspace packages are symlinked into `node_modules`. Anything that breaks
or bypasses those symlinks — a build step that strips them, a circular reference, a hoisting quirk
— makes module resolution fail. The tell is **"works locally, fails on EAS/CI"**, because the
local tree has the symlinks/`node_modules` and the build server doesn't.

- **EAS strips `node_modules` → Metro can't resolve `packages/core` deps.**
  EAS Build removes every `node_modules/` from the upload (to shrink transfer), then runs `npm ci`
  **only in the app directory**. So `packages/core/node_modules` never exists on the build server,
  and the moment Metro processes a file under `packages/core/src/` it fails to resolve the kernel's
  crypto deps (`tweetnacl`, `@scure/bip39`, `@noble/*`).
  **Fix:** add `packages/core/node_modules` to Metro's `resolver.nodeModulesPaths` as a fallback.
  **Caveat (important):** add *only* that path — it holds the kernel's crypto deps and nothing else.
  Do **NOT** add `packages/react-native/node_modules`; it contains React Native **native modules**,
  and putting those on `nodeModulesPaths` causes duplicate-native-module conflicts.
  **Generalizes:** if a future build hits this with another package, find which package's source
  triggered it and add *that* package's `node_modules` — provided it has no RN native modules.

- **New workspace dep needs its `node_modules` symlink materialized.**
  This repo has NO root hoisting: each package's `file:` deps live as symlinks in *its own*
  `node_modules`. Adding a `@onderling/*` dep to a package's `package.json` is not enough for a fresh
  checkout that doesn't re-run install — the symlink must exist. (2026-07-10) wired
  `@onderling/sync-engine` onto `@onderling/versioning` + `@onderling/pseudo-pod` (the `/node` fs backend for
  the retired `versions.js`); both are declared deps AND symlinked into
  `packages/sync-engine/node_modules/@onderling/{versioning,pseudo-pod}`. If sync-engine (or any Folio
  test that imports `SyncEngine`) suddenly can't resolve `@onderling/versioning` / `@onderling/pseudo-pod`,
  recreate those two symlinks (`ln -sf ../../../versioning versioning`, `ln -sf ../../../pseudo-pod
  pseudo-pod`).
  Same applies to `apps/sdk-journeys` (feat/sdk-journeys, 2026-07-16): its `@onderling/*` deps resolve via
  hand-materialized symlinks `apps/sdk-journeys/node_modules/@onderling/<p> → ../../../../packages/<p>`
  (sdk, core, vault, transports, pod-client, app-manifest, item-store, item-types, pseudo-pod,
  app-scaffold). node_modules is gitignored — recreate the links on a fresh checkout before `npm test`.
  Same applies to `@onderling/identity-resolver` → `@onderling/agent-registry` (skills fold-in, 2026-07-17:
  `skillsTaxonomy.json` moved to agent-registry; identity-resolver's `skillsMatch.js` imports it back via the
  literal-path subpath `@onderling/agent-registry/src/skillsTaxonomy.js` — literal so it resolves under BOTH
  Node's exports map (entry added to agent-registry `package.json`) and Metro's exports-OFF literal lookup).
  If skillsMatch/TAXONOMY resolution breaks: `ln -sfn ../../../agent-registry
  packages/identity-resolver/node_modules/@onderling/agent-registry`.

- **Recursive / self package references → solved with (workspace) symlinks.**
  A package that references itself or forms a dependency cycle has broken resolution here before;
  workspace symlinking is what fixed it. Same "symlink integrity" family as the EAS trap above —
  if resolution breaks, check that the workspace symlinks are intact first.

- **New `@onderling/*` workspace dep → its `node_modules` symlink must be materialized (or `pnpm install` re-run).**
  Adding a `@onderling/*` dep to a package's `package.json` — or repointing a raw-`src` reach-in onto a public
  `@onderling/<pkg>` specifier — only resolves once that package has `node_modules/@onderling/<pkg> →
  ../../../../packages/<pkg>`, which `pnpm install` creates from the declared dep. If you can't run a full install
  (the offline store is often incomplete here), materialize the link by hand, mirroring an existing one (e.g.
  `@onderling/redaction`). **Tell:** an import that resolves in one package but throws `ERR_MODULE_NOT_FOUND` in
  another. *Concrete (2026-07-08):* feedback-split F1 added `@onderling/{core,pod-client,pseudo-pod}` to
  `apps/feedback-pipeline`; links were materialized by hand pending the next install. *Concrete (2026-07-09):* the
  versioning/agents work hand-materialized `@onderling/versioning` into `apps/basis`, `apps/basis-mobile`,
  and `packages/substrate-stack`; `@onderling/substrate-stack` into `apps/{stoop,tasks-v0,household}`; and
  `@onderling-app/agents` + `@onderling/agent-registry` into `apps/basis` — all pending the next real install.
  *Concrete (2026-07-13):* the logging model added `@onderling/logger`; links hand-materialized into
  `apps/basis`, `apps/basis-mobile`, and the repo-root `node_modules`, plus a `metro.config.js`
  `extraNodeModules` alias (Metro has package-exports disabled, so `@onderling/*` MUST be aliased there).
  **Metro caches `metro.config.js` at STARTUP — a running Metro will NOT see a newly-added `extraNodeModules`
  alias (or a symlink created after it booted).** Tell: `Unable to resolve module @onderling/<pkg>` from a bundle
  even though the alias is on disk and the symlink exists. Fix: restart Metro (`--clear`). This is the resolution
  peer of the "restart Metro after editing shared `src/`" stale-bundle lesson.
  **Corollary (2026-07-13, hit repeatedly): Metro's file watcher reliably picks up edits to files INSIDE the
  app dir (`apps/basis-mobile/**`) but MISSES edits to `watchFolders` packages** (`apps/basis/src/**`,
  `packages/**`) — a re-request returns a byte-identical bundle without the change. Tell: you edit a shared
  `src/` or a `packages/*` file, request the bundle, and your new code isn't in it (grep the bundle for a
  marker string → 0 hits). Fix: restart Metro with `--clear` (a plain reload isn't enough). Confirm the fix
  landed by `grep -c <marker> <bundle>` before reloading the device — saves a wasted reload cycle.
  **Same family — a fresh `git worktree` has NO `node_modules`:** before running a worktree's tests, wire them by
  symlinking the main tree's root `node_modules` + each `apps/*/node_modules` & `packages/*/node_modules`. And note
  the Agent-tool `isolation: worktree` branches from stale `origin/master` here (local master is unpushed) — pin
  worktrees to local `HEAD` instead. (See the `worktree-base-stale-gotcha` agent memory.)

## Android 12+ instant crash on BLE / mDNS

**Root cause.** On Android 12+ (API 31+), BLE calls require runtime-granted `ACCESS_FINE_LOCATION`
+ `BLUETOOTH_SCAN` / `BLUETOOTH_ADVERTISE` / `BLUETOOTH_CONNECT`. If the app instantiates
`BleTransport` / `MdnsTransport` (Zeroconf) and touches the native module **before** those grants,
Android throws an **instant native crash** — blank white/black screen, no JS stack trace.

**Fix.** Request all needed permissions **first** (a `permissions.js` up front). If BLE is denied,
start the agent **mDNS-only** (non-fatal). Wrap the app in an **ErrorBoundary** so any *later* JS
error renders readable on-screen text instead of a blank crash you can't screenshot.

## Debugging native crashes (no Android Studio needed)

- **Dev build for Metro's red-box overlay** (full stack + hot reload):
  `npx expo start` + `eas build -p android --profile development`, then open with
  `exp+<app>://<laptop-ip>:<port>` or scan the QR.
- **adb logcat**, just the platform-tools zip:
  `adb logcat --pid=$(adb shell pidof <app.package>) | grep -E "Error|Fatal|FATAL|Exception"`.

## Cross-package RELATIVE imports in basis-mobile (Metro)

Some mobile modules import packages RELATIVELY (`../../../../packages/<pkg>/src/…`) when the package is not in
mobile's package.json — e.g. `src/core/mediaCardModel.js` → blob-gateway (2026-07-10), same pattern as the earlier
`rendezvousRtcLib` import. Works in vitest/Node; on-device Metro needs the path inside `nodeModulesPaths`/watchFolders
(check metro.config.js) or the dep declared + linked. **Tell:** green tests but a device-only "module not found".

## Cross-scope reference leaks in RN shell siblings → on-device `ReferenceError`

**Tell.** A screen opens fine in the old dev client but red-boxes on a *fresh* build with
`ReferenceError: Property '<name>' doesn't exist` — e.g. `bundle`, `onCircleControl`,
`circleTransport`. Green vitest, clean bundle, crash only on device.

**Root cause.** The big shell components are SEPARATE top-level functions, not nested. In
`CircleLauncherScreen.js`, `CircleDetail` is a *sibling* of `CircleLauncherScreen` — so the parent's
props/state (`bundle`, `onCircleControl`, `setView`, …) are **not** in `CircleDetail`'s scope. When
chat/command/feedback logic is moved into the sibling, references to the parent's scope compile fine
(they look like they'll resolve "from the outer function") but throw the instant the component's
render or a `useX` **dependency array** is evaluated. A *lazy* leak (a `() => catalog` getter, a
`c.inkSoft` inside a `<TextInput placeholderTextColor>`) survives longer — it only throws when the
closure runs — so it hides from a quick smoke test. The stale dev client masked all of these because
it was running old JS; the rebuild is what surfaced them (found 5 across 2 files, 2026-07-25).

**Fix.** Thread the parent value in as a **PROP** (e.g. `coreIdentity={bundle?.coreAgent?.identity}`,
`onCircleControl={onCircleControl}`), or move the declaration into the component. Reuse an existing
handler prop where one already wraps the parent action (`onSettings` = `() => setView('settings')`).

**Guard.** `npm run lint:scope` (`scripts/lint-scope-leaks.mjs`) is `no-undef` scoped to the RN shell
via real Babel scope analysis: any *referenced* identifier inside a shell component that resolves to
no binding in its scope chain (and isn't a runtime global) fails CI. `npm run test:scope` locks in
the clean tree. Add new runtime globals to `RUNTIME_GLOBALS` if a legit one is ever flagged.

## better-sqlite3 native binding not built → relay suite 5 failures (cold clone)

`packages/relay` uses **better-sqlite3** (Sqlite queue store + the blob-gate ACL store). It's a NATIVE
addon — a cold clone / fresh environment where it was never compiled shows **~5 relay test failures**
that look unrelated to your change (they're the SQLite-backed suites failing to load the binding).
**Fix:** `npm rebuild better-sqlite3` (from repo root) → true baseline restored. **Tell:** the failures
are all in the sqlite-store suites and mention a `.node` binding / `NODE_MODULE_VERSION`; non-sqlite relay
tests stay green. Not a regression — check this before bisecting a relay failure. (Found 2026-07-10 during
the blob-gate edge mount.)

**R-media (2nd tenant, 2026-07-10):** composing the media blob edge into companion-node added TWO new
hand-materialized `@onderling/*` symlinks in `apps/companion-node/node_modules/@onderling/`:
`blob-gateway → ../../../../packages/blob-gateway` (used by `src/mediaEdge.js` for the capability-verifier
adapter) and `pod-client → ../../../../packages/pod-client` (used by `test/companionMedia.test.js` for the
sealing `makeSealer`/`makeOpener`). Re-create with `ln -sfn ../../../../packages/<pkg> <pkg>` from that dir
if a fresh checkout drops them. **Tell:** `Cannot find package '@onderling/blob-gateway'` (or `pod-client`)
only when companion-node's media suite runs. NOTE: the SQLite native-binding trap above ALSO applies here —
the blob-gate ACL store defaults to a MemoryBlobAclStore (no sqlite), so companion-node's media suite itself
needs no rebuild, but a cold clone still needs `npm rebuild better-sqlite3` for the broader relay suite.

## companion-node hand-linked @onderling symlinks + relative-import-into-folio (R1)

`apps/companion-node` (Slice R1) follows the repo's no-hoist convention: its direct bare `@onderling/*`
imports resolve from **hand-materialized** symlinks in `apps/companion-node/node_modules/@onderling/`
(`core`, `transports`, `relay`, `vault`, `agent-registry` → `../../../../packages/<pkg>`). If you add a
new direct `@onderling/*` import to companion-node's own `src/`/`test/`, materialize its symlink too — a
missing one shows as `Cannot find package '@onderling/<x>'` only when companion-node runs (folio/agents are
unaffected because they resolve via their OWN node_modules). `vitest` resolves by walking up to the repo
root's `node_modules`, so it needs no app-local link.

companion-node **reuses folio verbatim by RELATIVE path into `apps/folio/src/`** (`../../folio/src/…` for
`wireSkills`, `registerFolioAgent`, `agentCores`, `autoShare`, `folioPodList`, `folioSearch`,
`cli/_podFactory`). Those folio files' transitive `@onderling/*` deps resolve via **folio's** node_modules,
NOT companion-node's — so companion-node does NOT need e.g. `@onderling/pseudo-pod`/`pod-search` links even
though the imported folio code uses them. **Tell:** if you see companion-node failing to resolve a package
that only the imported folio code imports, the fix is a missing symlink in `apps/folio/node_modules`, not
companion-node's. Do NOT edit `apps/folio/` to "fix" a companion-node import — R1 only consumes folio.
(Added 2026-07-10, companion-node R1.)

## basis-mobile now depends on @onderling/blob-gateway (hygiene pass)

`apps/basis-mobile/src/core/mediaCardModel.js` used to reach into
`../../../../packages/blob-gateway/src/openBlob.js` (a deep `/src/` reach-in on an **undeclared**
package — invariant #5). It now imports the bare barrel `@onderling/blob-gateway` (its `main`/`.` export
= `src/index.js`, which re-exports `openThumbnail`), matching how the app's other core files consume
`@onderling/*`. This added `@onderling/blob-gateway` to `apps/basis-mobile/package.json` deps, so the
no-hoist symlink must exist: `ln -sfn ../../../../packages/blob-gateway blob-gateway` from
`apps/basis-mobile/node_modules/@onderling/`. **Tell:** `Cannot find package '@onderling/blob-gateway'`
when the mobile app boots or its Vitest suite runs. RN-bundle-safe: the barrel pulls only
`uploadBlob`/`gatekeeper`/`ref`/`bytes`/`openBlob`, and `bytes.js`'s guarded `require('node:crypto')`
(behind `globalThis.crypto ||`) + `@onderling/pod-client/sealing` were already in the RN graph via the old
`openBlob.js` import — no NEW node-only dep enters the bundle. (Added 2026-07-11, code-quality hygiene pass.)

## Metro couldn't resolve `@onderling-app/agents/wireSkills` (mobile bundle broke since 2026-07-09)

`apps/basis/src/core/agent/realAgent.js` imports `@onderling-app/agents/{wireSkills,defaultCatalog}`
(added 2026-07-09). The web/vite build honors the `apps/agents` package `exports` map; **Metro has
`unstable_enablePackageExports` disabled**, so it couldn't resolve those subpaths — the whole mobile bundle
failed (`Unable to resolve "@onderling-app/agents/wireSkills"`). The mobile app had been un-bundleable via Metro
since then. **Fix (2026-07-13):** added `@onderling-app/agents` to `metro.config.js` `extraNodeModules` +
`extraSubpathResolvers` cases mapping `/wireSkills`→`apps/agents/src/wireSkills.js`, `/defaultCatalog`,
`/cores`, and `/manifest`→`apps/agents/manifest.js` (mirrors the existing stoop/llm-client subpath resolvers).
**Tell:** a bare `@onderling-app/<app>/<subpath>` import that resolves in vite/web but throws in Metro → it needs
an `extraSubpathResolvers` case (package-exports stays disabled). (Added 2026-07-13, mobile feedback parity.)

### New workspace dep into basis: `@onderling/attribute-charter` (2026-07-16, property-layer Phase 3)
`apps/basis/src/feedback/charterConsent.js` imports `@onderling/attribute-charter`. It's a pure-JS package
(`@noble/hashes` only), so it bundles fine — BUT the workspace edge wasn't in the lockfile, so materialize the
link: `apps/basis/node_modules/@onderling/attribute-charter -> ../../../../packages/attribute-charter`.
**Tell:** `Cannot find module '@onderling/attribute-charter'` from a basis test/build → the symlink is missing
(a fresh `pnpm install` after the lockfile picks it up also fixes it). Same pattern as the feedback-pipeline edge.

- **Cross-repo `link:` dep `onderling-feedback` (post-split, 2026-07-16).** basis + basis-mobile consume
  the SPLIT feedback repo via `"onderling-feedback": "link:../../../feedback"` (a sibling checkout at
  `~/expotest/feedback`) — imports are `'onderling-feedback/public'` / `'onderling-feedback/testing'`. The
  `node_modules/onderling-feedback` symlinks were **hand-materialized**; a fresh `pnpm install` should recreate them
  from the dep entries, but if resolution breaks: `ln -sfn ../../../../feedback apps/<app>/node_modules/onderling-feedback`.
  Metro watches `../feedback` (metro.config.js) so mobile hot-reload crosses the repo boundary. The e2e-journeys
  import it by relative path (`../../../../feedback/...`) with a soft-skip when absent. Replaced by versioned deps
  at the SDK publish swap.
- **Mobile bundle 500s on the feedback chain — TWO missing Metro resolvers (fixed 2026-07-25).** Surfaced when
  actually bundling for a device. (1) `onderling-feedback/public` had NO hand-resolver (Metro exports-off), so the
  bundle failed immediately — added `resolveRequest` cases mapping `onderling-feedback/{public,testing}` to the
  sibling checkout (`../feedback/src/public/index.js`, `../feedback/test/helpers/mock-llm.js`). (2) The `eld`
  language-detector resolver pointed at `apps/feedback-pipeline/node_modules/eld` (never installed there) — `eld`
  is HOISTED to the ROOT `node_modules/eld`; repointed the resolver + added `node_modules/eld` to `watchFolders`
  (else Metro "Failed to get the SHA-1"). With both, `apps/basis-mobile` bundles (2591 modules). Only THEN does the
  next layer show: the connected **dev-client APK is stale** — missing native modules (ExpoSecureStore →
  ExpoWebBrowser → expo-auth-session → …). Do NOT shim these one-by-one (cascade + degrades auth/secure-store);
  **rebuild the dev client** (`expo run:android`) so it carries the app's current native deps.

## mDNS: the native module gained a split — an old app binary silently cannot do ghost mode

`MdnsModule` (Android, `packages/react-native/android/src/main/java/com/canopy/mdns/MdnsModule.kt`) used to
expose one `start()` that registered the service AND began browsing. It now also exposes `startAdvertising` /
`stopAdvertising` / `startDiscovery` / `stopDiscovery`, and `MdnsTransport` feature-detects them via
`MdnsTransport.supportsSplit()`.

**The trap:** JS is bundled at runtime, native is not. Run the new JS against an app binary built before this
change and `supportsSplit()` is false — ghost mode falls back to advertising, `setDiscoverability('browse')`
returns `{ effective: 'browse+publish', degraded: true }`, and the device is discoverable when the UI may
suggest otherwise. That is deliberate (it is reported, not hidden), but it reads as a JS bug until you
remember the binary. **Rebuild the Android app** after taking this change.

`start()` / `stop()` are unchanged and still work, so nothing breaks — it degrades, loudly.

## ⚠ A partial `pnpm install --filter …` shreds workspace symlinks REPO-WIDE

**Found the hard way, 2026-07-27, adding one dependency.** This is the most expensive trap in this file:
the blast radius is nothing like the command you typed.

`.npmrc` sets `node-linker=hoisted` + per-app lockfiles. A filtered install that aborts partway — the usual
way is `ERR_PNPM_MISSING_HOISTED_LOCATIONS` — leaves the tree half-materialized:

- workspace packages become **copies instead of symlinks**, so their relative cross-package imports
  (`../../packages/sync-engine/…`) resolve against `node_modules/packages/…` and fail;
- sibling links get **pruned from packages you never filtered for**. Adding one dep to `basis-mobile` took
  out `packages/core`'s `@onderling/vault` + `@onderling/transports` devDep links, dropping its suite from
  1373 tests to 572 — *collection* failures, so the count silently shrinks rather than going red.

**Tell:** a flood of `Cannot find package '@onderling/…'` / `Could not resolve "@onderling/x" imported by
"@onderling/y"` in apps you did not touch, and suite TOTALS that drop. Check the totals, not just the
red/green — a suite that collects half its files still reports "all passed".

**Fix:** `node scripts/relink-workspace.mjs`. Re-running the install usually does NOT help (it is what
produced the state). Then `npm rebuild better-sqlite3` if the relay sqlite suites are red (separate,
documented above).

**Two second-order effects worth knowing:**

1. **Creating a `node_modules/` dir shadows Node's walk-up.** A package that had none resolved third-party
   deps from the repo root; give it one and it stops. This is how `ws` vanishes for `@onderling/relay`. The
   relink script handles it, but if you hand-materialize a link, materialize the third-party deps too.
2. **Symlinks expose undeclared deps that a hoisted tree hid.** `apps/basis` imports
   `@onderling/sync-engine` without declaring it; it worked only because the flat tree happened to contain
   it. Worth fixing properly, but do not be surprised when it surfaces.

**Prefer, for a new dependency:** edit `package.json` by hand and let the next full install pick it up, or
run the install and check the totals of the neighbouring suites immediately. And note the shells resolve
`file:` workspace deps as **symlinks** — verify with `ls -la apps/<app>/node_modules/@onderling/core`; a real
directory there means the tree is broken.

*(A silver lining: running the relink also fixed pre-existing breakage — `apps/stoop-mobile` went from 3
failing test files to 940/940, and it had been that way for a while.)*

## Mobile screens have NO test coverage — `vitest` excludes `src/screens/**`

`apps/basis-mobile` (and the other RN shells) exclude `src/screens/**` from vitest: there is no JSX loader
and no RN runtime, and the config's tagline is that a stray `import 'react-native'` should fail loud. That
is a reasonable trade, but be clear about what it costs:

**A typo in a screen is not caught by anything.** Not a test, not a linter, not a type checker — only by
reading, or by running the app. Two real cases in the Nearby work (2026-07-27): `setTab(...)` and
`circleAgent` / `openCircle`, all identifiers that simply do not exist in those files. Both were found by
grepping before commit; nothing else would have.

**So when you touch a `src/screens/**` file:**

1. grep every identifier you introduce against the file you put it in — especially state setters and
   navigation helpers, which are the ones that read plausibly and are named differently per screen;
2. push the logic OUT of the screen into a non-JSX module and test THAT (the convention this repo already
   follows — see `nearbyRow.test.js` and `nearbyScreenSeams.test.js`, which test the seam a screen consumes
   rather than the screen);
3. treat the screen file as a projector: if it contains a decision, that decision has no test.

The web side does not have this gap — `apps/basis/web/**` is testable under happy-dom (`*.dom.test.js`), so
a web renderer CAN be covered. Prefer putting a shared rule in a module both consume, and cover it there.

