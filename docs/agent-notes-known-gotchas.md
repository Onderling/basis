# Known gotchas — check here BEFORE debugging build/native issues

Agent-facing. These are traps that have already cost time in this repo and **will bite again**.
Several pass locally and only fail on device/CI, so they're easy to misdiagnose. Skim this list
before you start bisecting a build or native crash.

---

## A Vite alias pointing at `./node_modules/<pkg>` cannot resolve under a hoisted install

`apps/basis/vite.config.js` aliased the `events` polyfill to a path built with
`new URL('./node_modules/events/events.js', import.meta.url)`. That only exists when the dependency is
materialised **app-locally**. This repo installs hoisted — `apps/basis/node_modules/` holds nothing but
the workspace symlinks — so the file was absent and **Vite failed to start at all**: no dev server, no
Playwright run, no web shell. The error surfaces as an esbuild-optimizer `ENOENT` deep in a Vite stack,
which reads like a corrupt install rather than a config bug.

Use `createRequire(import.meta.url).resolve(...)` instead — it finds the package wherever the installer
put it, and keeps the single-module-instance property such aliases exist for.

**And resolve the FILE, not the bare specifier:** `require.resolve('events')` returns Node's **builtin**
`'events'`, not the npm polyfill, so the alias would silently point at a different module than intended.
`require.resolve('events/events.js')` gives the real path.

## `adb shell input keyevent 111` is ESCAPE — it cancels the modal, not the keyboard

Walking the join wizard on a device (2026-08-02), I sent `keyevent 111` after `input text` intending to
dismiss the soft keyboard. It dismissed the **wizard**, silently, back to the previous tab — three steps of
input gone with no error and no log line. The keyboard is `keyevent 4` (BACK) — which on an empty field has
its own trap already recorded below — or simply leave it open: it does not block a `tap` on a button that
is still on screen.

**Related, from the same walk:** an `onderling-invite://…` URI can be delivered straight to a running app
with `adb shell am start -a android.intent.action.VIEW -d "<uri>"`. That is by far the most reliable way to
walk the join flow — no QR, no typing, and it exercises the real deep-link receiver rather than a shortcut.
`am start` reports *"Activity not started, intent has been delivered to currently running top-most
instance"*, which is success, not a warning to chase.

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
  *Concrete (2026-08-06):* the `sa.audit` retention derivation added `@onderling/item-store` to
  `packages/secure-agent` (it now reads the shared `entryKinds` retention window); hand-materialized
  `packages/secure-agent/node_modules/@onderling/item-store → ../../../item-store` (mirroring `core`/`vault`),
  pending the next real install. Tell: `Failed to load url @onderling/item-store` from a secure-agent test.
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
render or a `useX` **dependency array** is evaluated. A *lazy* leak (a `() => catalogue` getter, a
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

`apps/basis/src/core/agent/realAgent.js` imports `@onderling-app/agents/{wireSkills,defaultCatalogue}`
(added 2026-07-09). The web/vite build honours the `apps/agents` package `exports` map; **Metro has
`unstable_enablePackageExports` disabled**, so it couldn't resolve those subpaths — the whole mobile bundle
failed (`Unable to resolve "@onderling-app/agents/wireSkills"`). The mobile app had been un-bundleable via Metro
since then. **Fix (2026-07-13):** added `@onderling-app/agents` to `metro.config.js` `extraNodeModules` +
`extraSubpathResolvers` cases mapping `/wireSkills`→`apps/agents/src/wireSkills.js`, `/defaultCatalogue`,
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

`MdnsModule` (Android, `packages/react-native/android/src/main/java/com/onderling/mdns/MdnsModule.kt`) used to
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

## Scripted file edits: `open(path, 'w')` TRUNCATES before your write can fail

Real incident (2026-07-28): a Python heredoc doing search-replace had a syntax slip that made
`write()` throw — but `open(path, 'w')` had already truncated the file, leaving `circleInvite.js` EMPTY.
Recovered from git in one command, but only because the file was committed.

**Rules for scripted edits:**
1. Do every replace (with `assert old in s`) FIRST, write LAST — never interleave.
2. On any assert failure, nothing has been written; on a write failure after asserts, re-run — but check
   `grep -c "" <file>` (0 lines = truncated) before assuming the file survived.
3. Never scripted-edit an uncommitted file this way; stage or commit first so recovery is `git checkout`.


## Metro's ESM→CJS interop makes a MISSING named export `undefined`, not a load error

Real incident (2026-07-28): the RN launcher imported `adoptExistingRelay` + `asyncStorageConnectionPointsIo`
(and `CircleRulesScreen` imported `decisionsForMerges`) from `@onderling-app/basis`, but the index never
exported them. Node ESM would refuse to link; **Metro/Babel interop silently binds `undefined`**, so the app
boots fine and the crash happens only when the affected screen/path is opened on a device — invisible to the
whole test suite because `src/screens/**` has no JSX loader.

**Rules:**
1. When a screen imports from `'@onderling-app/basis'`, check the name is actually exported by
   `apps/basis/src/index.js` — being exported from its own module is not enough.
2. The guard `apps/basis-mobile/test/basisIndexExports.test.js` pins every v2-screen import against the
   entry's export list (static parse, no JSX needed). If you add a screen import, that test is the fast
   check; if you add a new import SOURCE (another package entry), extend the guard the same way.

## Invite fields must be added in TWO places: the builder AND the encoder whitelist

Real incident (2026-07-28): `buildCircleInviteUri` put `podBacked`/`podUrl` on the invite object, but
`encodeMembershipCodeUrl` (createGroupState.js) builds the wire payload from an explicit field WHITELIST —
so the fields never rode a real `onderling-invite://` URI. Tests that pass the invite as an OBJECT bypass the
encoder (decodeInvite has an object fast-path) and stay green while the real QR/paste flow drops the field.
When adding an invite field: add it to BOTH, and pin it with a round-trip test through the ENCODED URI.

## `uiautomator dump` tears down the React Native dev-client (device walks)

Driving the app over adb with `uiautomator dump` to read the screen **intermittently destroys and recreates
the RN context**: the dump launcher raises an accessibility event, and the log shows
`AppContext was destroyed` → `AppContext was initialized` a moment later. Any open modal is gone, and the
app lands back on its default tab.

It presents as "the app randomly dismissed my wizard halfway through", which sends you hunting for a
backdrop-tap or a stray BACK/ESC keyevent. (Both of *those* also dismiss a modal, so it is easy to convince
yourself you found it.) What pins it: an idle control run with no dumps and no edits — 90 seconds, zero
reloads — versus a reload arriving within a second of each dump. Look for
`Calling main entry com.android.commands.uiautomator.Launcher` immediately before the teardown.

Consequences for anything multi-step on a dev-client build:

- Read the screen **once**, then drive the whole sequence from that one dump's coordinates. Dumping between
  every tap is what makes it flaky.
- Don't use `input keyevent 4` (BACK) or `111` (ESC) to dismiss a keyboard inside a modal — both close the
  modal itself.
- **Editing any source file mid-walk also reloads the app** (Metro fast refresh), losing the state you were
  mid-journey in. Walk first, fix afterwards.
- When the logic under test lives in shared `src/` — which, per invariant 1, is most of it — driving it
  headlessly is both faster and a permanent regression test. Save the device for what only a device shows.

## Drive the dev-client by DEEP LINK, not by tapping its launcher

Tapping "Reload" (or a development-server row) in the expo-dev-client launcher is unreliable when you are
also reading the screen with `uiautomator dump` — the dump's accessibility event re-opens the developer
menu, so each dump undoes the tap you just made, and the app never loads any JS. It looks exactly like a
broken or stale build: no red box, no bundling error, zero `ReactNativeJS` lines.

Skip the UI entirely:

```bash
adb reverse tcp:8081 tcp:8081        # so the phone's localhost is your machine
adb shell am start -a android.intent.action.VIEW \
  -d "org.onderling.basis://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"
```

Watch `adb logcat | grep ReactNativeJS` for `Running "main"` — that is the app actually starting, and it
is the only reliable signal. Expect ~10s on a warm Metro; a cold `--clear` start is much longer, because
the dev bundle is ~44 MB.

**Before blaming the build**, check Metro can serve at all. The entry point is virtual on SDK 50+, so the
legacy `/index.bundle` path 404s with a confusing "Unable to resolve module ./index from
`<monorepo-root>/.`" — which reads like a broken Metro config and is not:

```bash
curl -s -o /dev/null -w '%{http_code} %{size_download}\n' \
  'http://localhost:8081/.expo/.virtual-metro-entry.bundle?platform=android&dev=true'
```

200 plus tens of MB means Metro is healthy and the problem is on the device side.

## `expo.scheme` in app.json does NOT reach the device — `prebuild` writes AndroidManifest, and nobody re-ran it

**Symptom.** `adb shell am start -a android.intent.action.VIEW -d "onderling-invite://<payload>" org.onderling.basis`
answers `Error: Activity not started, unable to resolve Intent`, even though `app.json` clearly lists the
scheme. `adb shell dumpsys package org.onderling.basis | grep Scheme:` shows only the old set.

**Cause.** `expo.scheme` is a build *input*. It is copied into
`android/app/src/main/AndroidManifest.xml` by `expo prebuild`, and this repo keeps `android/` checked in — so
editing app.json changes nothing until a prebuild (or a hand-edit of the manifest) plus a **native rebuild**.
A JS reload cannot fix it; the intent filter lives in the APK.

**Check, in order** — each answers a different layer, and they were disagreeing:
```bash
grep -A3 '"scheme"' apps/basis-mobile/app.json                                    # the intent
grep android:scheme apps/basis-mobile/android/app/src/main/AndroidManifest.xml    # what will be built
adb shell dumpsys package org.onderling.basis | grep -i 'Scheme:'                 # what IS installed
```

**Fix.** Add `<data android:scheme="…"/>` to the VIEW `intent-filter` (exactly what prebuild emits — safer
than running prebuild, which regenerates all of `android/` and can clobber hand-edits noted elsewhere in this
file), then `cd apps/basis-mobile/android && ./gradlew assembleDebug` and reinstall.

**Guard.** `apps/basis-mobile/test/schemesRegistered.test.js` now checks the native manifest against
`OS_REGISTERED_SCHEMES`, not just app.json. It passed for days while links were dead on device, because it
only knew about the layer above the break.

**The nastier half.** A registered scheme with no listener is *worse* than an unregistered one: the OS opens
the app, so the link looks like it worked. `basis-mobile` had no `Linking` reference anywhere — schemes,
registry, parser and guard all existed and nothing ever received a URL. Same test file now asserts both
`getInitialURL` (cold start) and `addEventListener('url', …)` (warm) exist.

## `adb shell input text` with a long string RELOADS the JS context (device walks)

Typing a ~250-char invite payload into a TextInput reliably blanked the screen and re-booted the whole JS
context — same pid, fresh `[cc/boot]` — which reads exactly like a crash and sent an hour into the wrong
place. Short strings (`abcdefg`) are fine; the reload tracks length, not any particular character (`r`, and
the `://` in a URL, were both ruled out by bisecting).

Consequence for walks: **do not drive long text through `input text`.** Use a deep link
(`adb shell am start -a android.intent.action.VIEW -d '<uri>' <pkg>`) — see the entry above for making the
scheme resolvable first. Keep `input text` for short values (a circle name, a handle).

Also: `adb shell input keyevent 67` (DEL) on an already-empty field falls through to **back navigation** and
closes the sheet you are working in, so a "clear the field" loop silently walks you out of the flow. Re-open
the sheet for a clean field instead of clearing it.

## A "dead button" in a screen is usually a RENDER error, not a dead handler

Three `ReferenceError`s in one render made opening any circle impossible on 2026-07-30, and the symptom was
indistinguishable from a Pressable that does nothing: the press handler ran, its skills fired
(`listGroupRoster`, `listOpen` in logcat), and then the render those state updates caused threw. Nothing
appeared, and nothing in the log looked wrong.

**Diagnose it in this order** — do not start by suspecting the touch target:
1. `adb exec-out screencap -p` right after the tap. A dev-build **redbox may be minimised**, so the crash is
   on screen but not obvious — the earlier screenshots looked like an unresponsive list.
2. `adb logcat -d | grep -iE "doesn't exist|Render Error|ReferenceError"`. This is the fast answer.
3. Only then instrument the handler (`onPressIn={() => console.log(...)}`) to prove the press arrives.

They come in threes because the first crash hides the rest: fix one, re-run, get the next. The guard
`apps/basis-mobile/test/screensNoUndefinedIdentifiers.test.js` now finds them all at once with real scope
analysis over `src/screens/**` (`@babel/parser` + `@babel/traverse`, already in the tree) — that directory is
excluded from vitest, and this repo has no ESLint, so `no-undef` had no home until now. Run it before blaming
a tap.

The two shapes it catches, both of which read as perfectly plausible code in the file they sit in:
- a prop `App.js` passes that the screen never destructured (`onAcceptFallback`), and
- a value belonging to a SIBLING component in the same file (`selectedPolicy` where the local prop is
  `policy`; `bundle` where only the parent has it). **Optional chaining does not save an undeclared name** —
  `bundle?.peerGraph` still throws when `bundle` is unbound.

Companion guard: `test/screenPropsDestructured.test.js` compares what `App.js` passes against what each screen
destructures. It found a dead `getPodWriter` prop within seconds of being written.

## Relay registration is CHALLENGE-FIRST since 2026-07-31 — pipelined frames and stale relays break

Registering with a relay used to be one frame (`{type:'register', address}` → `registered`). It is now
two round trips: the relay answers with a `challenge` carrying a nonce, the client signs it with the key
behind the address, and only the `register-proof` frame produces a `registered`. Three traps come with
that, and all three look like something else:

1. **A frame sent immediately after `register` can arrive too early.** Anything that requires a
   completed registration — `register-push-token` is the one in the tree — now needs the `registered`
   ack first, because the registration is one round trip further away than it used to be. The symptom is
   `register-push-token requires register first` on a client that plainly did register. Real clients wait
   on the transport's connect promise and are unaffected; hand-written WebSocket fixtures are not.
2. **A relay process left running from before the change refuses every client** — correctly, because a
   compliant client refuses a relay that does not demand proof. A long-lived dev relay on `:8787` is the
   likely one. Restart it before concluding the client is broken; the error names the url and the reason.
3. **A test that registers `'alice'` cannot work any more.** An address IS a public key
   (`deriveCircleAddress` → `AgentIdentity.pubKeyFromSeed`), so registration is verified against the
   address itself. Use `packages/relay/test/helpers/provenClient.js` (`addr('alice')` mints a real key
   and the client answers challenges automatically) rather than inventing another fixture.

Registering a per-circle ALIAS additionally needs its own signer — a different circle is a different key
— via `addAddress(address, { sign: circleAddressSigner(profileSeed, circleId) })`. Without one the bind
is refused locally with a named reason rather than silently never completing.
Background: `plans/DESIGN-boundary-authentication.md` §7.

## basis-mobile vitest: the `@onderling-app/basis` node_modules COPY is incomplete (2026-08-05)

> **✅ FIXED 2026-08-07 — the whole mobile suite now runs (703/704, 0 fail; was 100% unrunnable).** Two parts:
> 1. **Durable (version-controlled):** in `apps/basis-mobile/vitest.config.js`, alias
>    `'@onderling-app/basis' → path.resolve(__dirname, '../basis')`. This points vitest at the LIVE workspace
>    `apps/basis` instead of the stale node_modules COPY, so (a) basis's transitive `@onderling/*` resolve from
>    the complete `apps/basis/node_modules`, (b) vite transforms basis src (the `.json` import-attribute error
>    goes away), and (c) mobile's `@onderling-app/basis` imports and its direct `../../../basis/src/*` relative
>    imports DEDUPE to ONE module tree (fixes "same selector, no fork" identity failures + singleton drift).
> 2. **Install state:** the 12 `@onderling/*` symlinks below are still needed for the handful of mobile tests
>    that import those packages DIRECTLY — materialise them per the pattern below. They persist with the
>    hand-accreted install (which you never wipe anyway).
> A single `deps.inline` also works for (1b) but leaves the dual-tree (part 1c) broken — prefer the alias.
> The original diagnosis is kept below for context.


`apps/basis-mobile/node_modules/@onderling-app/basis` is a real-directory COPY (not a symlink), and it is
missing transitive deps under vitest — so importing anything that reaches `@onderling-app/basis/src/index.js`
fails one dep at a time: first `@onderling-app/stoop`, then `@onderling-app/folio` (missing app symlinks
under `@onderling-app/`), then `@onderling/pod-routing` (a missing package dep of the copy). This is the
"tree does not survive" fragility (see CLAUDE.md "NEVER rm -rf node_modules"), NOT a code problem — a mobile
change can be correct-by-parity and parse-clean while its vitest still cannot load.
- **Partial fix applied:** `ln -s ../../../stoop` and `ln -s ../../../folio` under
  `apps/basis-mobile/node_modules/@onderling-app/`. `@onderling/pod-routing` (and likely more) still missing.
- **Do not** `rm -rf` / reinstall to fix this — it will expose latent version conflicts and not come back.
  Either symlink each missing dep from the source, or run the equivalent test on the `apps/basis` (web) side
  where the same shared modules ARE resolvable (mobile parity code reuses `apps/basis/src/v2/*` verbatim).
- **The EXACT gap (enumerated 2026-08-07):** 12 `@onderling/*` are present+linked under
  `apps/basis/node_modules` but MISSING under `apps/basis-mobile/node_modules/@onderling/`:
  `pod-routing · pod-onboarding · pod-search · item-types · sync-engine · relay · sdk · logger · llm-client ·
  chat-nav · recipe-loader · attribute-charter`. Materialising them (`ln -s ../../../../packages/<pkg>` each,
  the sanctioned per-package pattern) MIGHT unblock mobile vitest — but may cascade or surface the version
  splits above, so timebox + be ready to revert. The proper fix is the scheduled workspace-protocol migration.

---

## New workspace dep needs its `node_modules` link materialised by hand (2026-08-09)

Adding a `@onderling/*` dep to an app's `package.json` does NOT create the `node_modules` symlink on its own
here (no clean reinstall — see CLAUDE.md "NEVER rm -rf node_modules"). Symptom: `Cannot find package
'@onderling/<pkg>'` from that app even though the dep line is present.

- **Fix (sanctioned per-package pattern):** `ln -sfn ../../../../packages/<pkg>
  apps/<app>/node_modules/@onderling/<pkg>`.
- **Worked example:** wiring the parameter register's value routing (#36) added
  `@onderling/local-store` to `apps/basis`; materialised with
  `ln -sfn ../../../../packages/local-store apps/basis/node_modules/@onderling/local-store`. `local-store`
  is dependency-free, so no transitive links were needed — verify with
  `node -e "import('@onderling/<pkg>').then(m=>console.log(Object.keys(m)))"` from the app dir.

## basis-mobile background-fetch deps are hand-materialized (2026-08-11, the tasks-mobile salvage)

`expo-background-fetch` + `expo-task-manager` were COPIED into `apps/basis-mobile/node_modules/` from
tasks-mobile's tree at its retirement (real dirs, not symlinks — the source app is deleted), and
`@onderling/sync-engine-rn` is the standard workspace symlink. All three are declared in package.json,
but remember this tree never survives a clean reinstall (see CLAUDE.md) — if one of these goes missing,
re-materialize it the same way, don't reinstall. The NATIVE halves need a fresh dev-client build before
they exist on device; until then `wireBackgroundSync` wires the JS side and reports `registered:false`
(by design — vitest and stale dev clients stay green). The bundle-load task definition lives in
`apps/basis-mobile/index.js` (`BASIS_BG_TASK_NAME`) and MUST stay at module load per Expo's TaskManager.

## `file:../pkg` internal deps break a STANDALONE (Docker) install — the image builds, then dies at boot (2026-08-22)

Found while bringing the relay up for a real VPS deploy: `deploy/relay/Dockerfile` **built fine**
and the container **crashed on start** with
`ERR_MODULE_NOT_FOUND: Cannot find package '@onderling/params' imported from
/app/packages/relay/node_modules/@onderling/core/src/params.js`.

**Why.** With `"@onderling/core": "file:../core"`, pnpm **copies** the package into the dependent's
`node_modules` instead of symlinking it. The copy has no `node_modules` of its own, so Node's
upward resolution from inside the copy never reaches `packages/core/node_modules/@onderling/params`
— the dep core genuinely needs at runtime. In the DEV tree this is invisible: the flat hoisted
layout puts everything within reach, so `file:` and `workspace:` behave identically there and only a
focused/standalone install exposes the difference.

**Fix (applied to the relay's runtime subtree only):** declare internal deps with
`"workspace:*"`, which pnpm SYMLINKS — resolution then walks into the real package and finds its
own `node_modules`. Changed: `packages/relay` (its runtime deps `core`/`vault`/`blob-gateway` also
moved out of `peerDependencies`/`devDependencies` into `dependencies` — a deployable service must
DECLARE what it runs on) and `packages/blob-gateway`. ~25 other packages still use `file:` for
internal deps; converting them all is the scheduled workspace-protocol migration, not a drive-by.

**The rule this implies:** any package that must run OUTSIDE the dev tree (a Docker image, a
published tarball, a standalone host) needs `workspace:*` internal deps + its runtime deps in
`dependencies`. Verify by BOOTING the image, never by building it — the build cannot catch this.

**Also caught in the same pass:** `deploy/smoke/smoke.mjs` still spoke the pre-2026-07-31
unauthenticated `register` handshake (see the challenge-first gotcha above) and sent envelopes with
no `_from`, so it timed out against a current relay and looked like "the deployment is broken". It
now generates real ed25519 identities (node:crypto — the one-dep promise holds), answers the
`challenge` with a `register-proof`, and binds `_from`. Its header also claimed `ws` "resolves from
the root" — this workspace installs per package and has NO root `node_modules`; run it from a
package that has `ws` (`cd packages/relay && node ../../deploy/smoke/smoke.mjs <url>`).

## Metro won't start: `open: <root>/node_modules/eld` — a `link:` dep's own dependency, missing at the hoisted root

`npx expo start` in `apps/basis-mobile` exits (code 7) before it ever serves:

```
Error: std::system_error: open: <repo>/node_modules/eld: No such file or directory
```

With watchman off `PATH` the same failure appears as a plain Node ENOENT carrying `path:` / `filename:` —
which is the honest form of it.

**Cause.** `apps/basis-mobile/package.json` has `"onderling-feedback": "link:../../../feedback"` (the
split-out repo, and `metro.config.js` maps `onderling-feedback/public` + `/testing` deliberately). That repo
declares `eld` among its OWN dependencies. Under this repo's flat/hoisted layout Metro resolves a linked
package's deps at the **monorepo root**, where `eld` was never installed — the only copy is
`~/expotest/feedback/node_modules/eld`.

**Fix** — the single-package symlink this repo already prescribes; do NOT reinstall anything:

```sh
ln -s ../../feedback/node_modules/eld node_modules/eld
```

Then `expo start` serves. The other eight feedback deps look "missing at the root" too but resolve per-app
(`@onderling/*` are workspace links, `zod` etc. come from the app's own tree) — only a plain npm dep that
nothing else in the monorepo depends on falls through to the root lookup. Don't pre-emptively symlink them.

**Two traps inside the trap:**

- **The watchman error is a messenger, not the cause.** It names the missing path because Metro asked it
  about that path. `watchman watch-del` + `shutdown-server` does not help, and a manual `watch-project` +
  `query` on the same root succeeds — that success is the tell that watchman is healthy and the missing
  file is real. (Two restarts were spent on this before the plain-ENOENT form gave it away.)
- **Metro's server root here is the WORKSPACE root, not the app.** The bundle URL is
  `/apps/basis-mobile/index.bundle?platform=android&dev=true`; plain `/index.bundle` 404s with *"Unable to
  resolve module ./index from `<repo>/.`"*, which reads like a broken entry point and is not one.

**You can prove the mobile harness without a phone:** with Metro up,
`curl -o /dev/null -w '%{http_code} %{size_download}' "http://127.0.0.1:8081/apps/basis-mobile/index.bundle?platform=android&dev=true"`
→ `200 47679663` in ~74 s cold. That separates "the bundle is broken" from "the device isn't connecting"
before you touch a device.

