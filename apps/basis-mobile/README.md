# basis-mobile

Android RN composition shell that unifies tasks-v0 + stoop + folio +
household + calendar over a shared InternalBus, rendered with React
Native + `renderMobile(manifest) → NavModel`.

**Status:** well past the V0 skeleton (#222 of the mobile roadmap). The
portable composition core is wired + tested; the agent bundle boots a
**real** per-app agent (the V0 `agent-not-booted` stub fell away in V1);
and the RN shell is now a full multi-screen kring app — a launcher, a
manifest-projected tab bar and detail action-bar / kring ⋯ menu, and a
large set of circle screens (settings, folio, share, advisor, lists,
stream, my-data, …) — all rendering from `renderMobile` NavModels. The
vitest suite is green. The remaining tail is real on-device verification
(#249) and the `surfaces.page` RN side-panel sibling (#128). The
multi-slice parity arc with web basis is tracked in
`Project Files/basis/mobile-roadmap-2026-05-24.md`.

## Layout

```
src/
  core/                # portable — runs in vitest, web, AND React Native
    composeManifests.js  # merges all 5 app manifests via basis's mergeManifests
    navModel.js          # buildNavModels() → one renderMobile NavModel per app
    agentBundle.js       # boots a real per-app agent (basis realAgent); skillStub seam for tests
    localisation.js      # t() with {text, doc} unwrap (en + nl)
  screens/             # RN only — wraps the portable core
    ChatScreen.js        # the chat surface (boot state, per-app sections, slash FAB)
    v2/                  # the kring app — CircleLauncherScreen, CircleTabBar (projected tabs),
                         #   CircleDetail (projected action-bar), CircleShareScreen, CircleFolioScreen,
                         #   CircleSettingsScreen, CircleAdvisorScreen, … (30+ circle screens)
locales/
  en.json, nl.json     # {text, doc} leaves; convention enforced from day 1
App.js, index.js       # Expo entry; polyfills MUST be the first import
test/                  # vitest — bundle-boot smoke plus the JM-* journey + projection suites
```

## What works today

- ✅ `composeManifests()` merges all 5 app manifests; benign op-id
  collisions are aliased deterministically.
- ✅ `buildNavModels()` produces a `renderMobile` NavModel per app
  (basis, household, tasks-v0, stoop, folio, calendar) — every
  manifest projects to a JSON-serialisable NavModel.
- ✅ `bootAgentBundle()` boots a **real** per-app agent via
  basis's `realAgent` chain (the `opts.skillStub` seam is
  test-only; the V0 `agent-not-booted` stub is gone).
- ✅ **Nav chrome projects from the manifest.** The tab bar
  (`CircleTabBar` via `circleTabsMobile`) and the detail action-bar /
  kring ⋯ menu (`CircleLauncherScreen` via `circleActionsMobile`) read
  the SAME roster the web shell does — `renderMobile ≡ renderWeb` — so
  there is no hand-written mobile tab/action list to drift.
- ✅ Per-screen RN rendering of `renderMobile` NavModels: the launcher
  plus 30+ circle screens render from the projections.
- ✅ `t()` resolves localised strings with `{{param}}` interpolation;
  EN + NL bundles in sync.
- ✅ Vitest suite green (bundle-boot smoke + the JM-* journey +
  projection suites; the 3 baseline reds — nav order, native-push
  absence, podAuth token shape — were cleared 2026-07-08).

## What's stubbed / unverified

- ❌ Generic `surfaces.page` RN side-panel (**#128**) — mobile has the
  per-op page *header* projection, but the web `openPagePanel`
  side-panel renderer has no RN sibling yet.
- ⏳ NKN-on-RN mesh transport (**#223**) is **wired** (one NKN identity
  shared across screens; `NknTransport` + `podPeerAddr` NKN-on-pod
  wrappers). Cross-device journeys (JM-1/2/7/8/9) pass in the vitest
  journey spine, but end-to-end mesh over real radios is only confirmed
  on hardware as part of the #249 on-device run.
- ⏳ Android `expo run:android` first boot — see the **Running →
  Android** section for the exact command sequence. Pending a real
  on-device run (#249); structurally complete + Hermes-clean, but
  unverified on hardware.

## Running

Two workflows: **tests** (lightweight, runs today via a symlink to
basis's `node_modules`) and **Android** (real local install
+ native gradle build, mirrors stoop-mobile's setup). Pick one — they
share the same `node_modules/` slot, so flipping between them needs
an `rm` first.

### Tests (vitest, works today)

```sh
cd apps/basis-mobile
ln -sf ../basis/node_modules node_modules   # one-time (if not already a symlink)
pnpm exec vitest run
```

Why the symlink: the monorepo doesn't use `pnpm-workspace.yaml`;
each app has independent `node_modules`. basis-mobile's
vitest deps are a strict subset of basis's, so symlinking is
the cheapest path. The portable core uses relative imports into
sibling app directories so this works. **The symlink does NOT
include `expo` / RN native deps** — Android needs a real install
(below).

### Android (first boot — #249 on the priority list)

Prerequisites:

- A physical Android device (USB-debug on, `adb devices` shows the
  phone) **or** an Android Studio AVD.
- Java 17, Android SDK Platform-Tools.
- Same Expo 52 pin already set up for stoop-mobile.

```sh
cd apps/basis-mobile

# If node_modules is currently a symlink (from the tests workflow
# above), remove it first — npm install will refuse otherwise.
[ -L node_modules ] && rm node_modules

npm install --legacy-peer-deps                  # one-time, ~1-2 min

# First-time native build + install on the connected device.
# Takes 2-10 min on a clean tree.  DO NOT use `npx expo run:android`
# — npx may pull a newer Expo CLI (55+) that breaks our pin (52).
./node_modules/.bin/expo run:android            # OR `npm run android`
```

After the dev-client APK lands on the phone, subsequent JS-only
changes use the lighter `npm start` path:

```sh
cd apps/basis-mobile
npm start                                       # `expo start` against the local pin
# Press 'a' on the prompt to attach to the running dev-client.
```

### Switching back to the tests symlink

```sh
cd apps/basis-mobile
rm -rf node_modules
ln -sf ../basis/node_modules node_modules
pnpm exec vitest run
```

### Polyfill discipline

The Expo entry (`index.js`) imports the canonical polyfills FIRST
(`@onderling/react-native/platform/polyfills`) — Hermes resolves
crypto at module-load, so any later import that needs
`crypto.getRandomValues` / `globalThis.Buffer` / `Blob` would crash
otherwise. See `apps/stoop-mobile/index.js` for the canonical
comment. **Don't reorder the imports in `index.js`** — it's the
single most common Hermes footgun.

### What to verify on first Android boot (#249 checklist)

1. App cold-boots without a redbox.
2. ChatScreen shows "Booting agents…" → "Agents ready" → per-app
   section counts (basis, household, tasks-v0, stoop, folio,
   calendar — 6 NavModel rows).
3. The bottom-right "/" FAB is visible; tap → modal opens; typing
   `/` shows slash suggestions from the merged catalogue.
4. Kill + relaunch — VaultAsyncStorage + AsyncStoragePersist should
   restore identity + stoop's cached state (no second onboarding).
5. NknTransport's "Mesh transport ready" banner appears
   (`boot.transport_ready`).

Failures here surface either gradle/Hermes wiring or a real
substrate bug — both are valuable; capture the redbox + `adb
logcat` output and file under #249.

## Troubleshooting

### `Unable to resolve "@onderling/react-native/platform/polyfills"`

Metro 52 disables `unstable_enablePackageExports` by default, so the
package's `exports` map for `./platform/polyfills` is invisible.  The
canonical fix is the `@onderling/react-native/metro-preset`, used via
`metro.config.js`.  This app ships one — if it's missing, copy it
from `apps/stoop-mobile/metro.config.js` and adjust the watch folders
+ subpath resolvers.  Always re-run with the cache busted:

```sh
npm start -- --reset-cache
```

### `ENOSPC: System limit for number of file watchers reached`

Linux's default inotify watch limit (~8K) is too low for Metro
watching `node_modules`.  Bump it:

```sh
# temporary (until reboot)
sudo sysctl -w fs.inotify.max_user_watches=524288
sudo sysctl -w fs.inotify.max_user_instances=512

# permanent
echo 'fs.inotify.max_user_watches=524288' | sudo tee /etc/sysctl.d/99-watchers.conf
echo 'fs.inotify.max_user_instances=512'  | sudo tee -a /etc/sysctl.d/99-watchers.conf
sudo sysctl --system
```

The build itself succeeds before this triggers — the APK is already
on the phone; just re-run `npm start` after the bump.

### `npm audit` shows high-severity vulns

Almost all of these are in the **build toolchain** (Metro, `@expo/cli`,
walker, etc.) — they don't ship to the device.  `npm audit fix` can't
resolve them because the only "fix" is upgrading Expo 52 → 55+, which
breaks the canonical pin (stoop-mobile + tasks-mobile + this app all
share Expo 52).  Verify the runtime profile is clean:

```sh
npm audit --omit=dev
```

If that's clean, you're fine — these are local-toolchain CVEs, not
device-runtime ones.

## Conventions

- **No hardcoded strings** — every user-facing label via `t()` with
  a `{text, doc}` leaf in `locales/`.
- **Node-portable core** — anything in `src/core/` must work in
  vitest (no DOM, no RN, no Node-only deps).
- **Composition over re-implementation** — basis web's
  patterns (handlers, dispatcher, adapters) lift directly into
  `src/core/`. Don't rewrite features that already exist as
  substrate skills.
- **Polyfill discipline** — index.js's first import MUST be
  `@onderling/react-native/platform/polyfills`.

## See also

- `Project Files/basis/mobile-roadmap-2026-05-24.md` —
  full roadmap + 10 JM-* user journeys
- `apps/basis/docs/web-mobile-feature-matrix-2026-05-24.md` —
  audit that informed this slice
- `apps/basis/test/journeys-mobile.test.js` —
  vitest substrate spine for JM-1..JM-10
