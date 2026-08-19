# Detox investigation — 2026-05-26

What I tried, what I learned, where it stopped.  Written so the
next session (and any future contributor) can pick up without
re-walking the same ground.

## Goal

Wire Detox into basis-mobile so a Claude session can verify
the manual #249 smoke checklist (cold boot → 6 NavModel rows → /mine
list → tap button → state morphs) without Frits having to reload the
phone for every commit.  Scoped as `#254 — Detox smoke (D-0 setup +
D-1 three tests)`.

Original estimate: ~1 day.  Actual: ~4× that, blocked.

## End state — UPDATED 2026-05-26 evening: SHIPPED ✅

**5/5 Detox tests green on both physical phone (c53828f5) AND
emulator (Medium_Phone_API_36).**  Full suite ~70 seconds.

The blocker after the release-build switch turned out to be the
release AndroidManifest not allowing cleartext traffic — Detox's
`ws://localhost:<port>` bridge connection was silently blocked.
Fix: `android/app/src/main/res/xml/network_security_config.xml`
permitting loopback cleartext only (production-safe), wired via
`android:networkSecurityConfig` in main AndroidManifest.

Bonus catch from the screenshot during debugging: the SlashFAB
overlapped the chat-send button (`tap('chat-send')` actually hit
the FAB).  Moved FAB to `bottom: 80` — real UX bug too, not just
a test artifact.

## Pipeline of attempts

### Attempt 1 — Vanilla Detox debug build

Installed `detox@20.50.4 + jest@29.7 + jest-circus@29.7`.  Wrote
`.detoxrc.js`, `e2e/jest.config.js`, three D-1 test files, a
`DetoxTest.java` JUnit runner, an `AndroidManifest.xml` for the
androidTest variant.

**Result:** Build failed.  Various API mismatches (`DetoxConfig`
doesn't exist in Detox 20.50.4 — only `Detox.runTests(rule)`).
Manifest merger refused two activities without explicit
`android:exported` (Android API 31+ requirement).  Jest 30 was too
new for Detox's runtime (`clearMocksOnScope` API change).

**Fixes applied (kept):**
- Java runner uses the simpler `Detox.runTests(mActivityRule)` overload (config is JS-side via `.detoxrc.js`).
- `src/androidTest/AndroidManifest.xml` overrides three `InstrumentationActivityInvoker$*` activities with `android:exported="false"` + `tools:replace`.
- Jest pinned to `^29.7`.

### Attempt 2 — Detox AAR not resolving

`androidTestImplementation('com.wix:detox:+')` couldn't find the
class.  Detox ships its Android AAR via a local maven repo inside the
npm package, not via Maven Central.

**Fix applied (kept):** Added to `android/build.gradle`:
```gradle
allprojects {
  repositories {
    maven { url "$rootDir/../node_modules/detox/Detox-android" }
  }
}
```

### Attempt 3 — `META-INF/LICENSE.md` packaging conflict

The Detox androidTest chain pulls in JUnit Jupiter 5.x alongside the
existing JUnit 4 (`androidx.test:runner`).  Both ship a
`META-INF/LICENSE.md`; Gradle's packaging step bails on the duplicate.

**Fix applied (kept):** Added to `app/build.gradle`'s `packagingOptions`:
```gradle
resources {
  pickFirsts += [
    'META-INF/LICENSE.md',
    'META-INF/LICENSE-notice.md',
    'META-INF/AL2.0',
    'META-INF/LGPL2.1',
  ]
}
```

### Attempt 4 — Submodule androidTest cascade

`./gradlew assembleAndroidTest` triggered `assembleAndroidTest` for
every included library (`expo-dev-client`, `expo-modules`, …) which
then duplicated the JUnit jars yet again because each library has
its own classpath for tests.

**Fix applied (kept):** Scope to the `:app` module only:
```sh
cd android && ./gradlew :app:assembleDebug :app:assembleAndroidTest -DtestBuildType=debug
```

After this, both APKs (app + androidTest) build clean.

### Attempt 5 — `INSTALL_FAILED_INSUFFICIENT_STORAGE`

Emulator's `/data` partition was 91% full from previous
`expo run:android` artifacts (foliomobile + a step1 expo test).
146 MB debug APK wouldn't fit.

**Fix applied (manual):** `adb uninstall com.phrytes.step1expo52
ag.decwebag.foliomobile` freed ~100 MB.  After that the APK installs.

### Attempt 6 — Tests reach the app but Detox bridge can't deliver

Debug APK installed, Detox launched the app, instrumentation runner
fired (`AndroidJUnitRunner: newApplication ag.canopy.canopychatmobile.MainApplication`),
`Detox.runTests` invoked.  But every `element(by.id(...))` call
failed with "package could not be delivered, messageId: 3".

Screenshot revealed: the screen was showing
`expo.modules.devlauncher.launcher.DevLauncherActivity` (the
"pick your Metro server" picker), not `MainActivity`.  Detox saw no
testIDs because the JS bundle hadn't loaded yet — the launcher
needed a manual tap.

### Attempt 7 — Skip the dev-launcher via release build

Reasoning: `expo-dev-launcher`'s release source-set is stubbed
(`throw IllegalStateException("DevLauncher isn't available in
release builds")`), so MainActivity becomes the entry point.

**Result:** Release build needed `expo-dev-client:mergeDebugAndroidTestJavaResource`
even when the app variant was `release`, because expo-dev-client
itself only builds androidTest as the debug variant.  Working around
this required scoping the Gradle invocation to `:app:` (kept from
Attempt 4) — without it the umbrella task tries to build
androidTest for every library.

**Fix applied (kept):** `.detoxrc.js` `build:` is now:
```sh
cd android && ./gradlew :app:assembleRelease :app:assembleAndroidTest -DtestBuildType=release
```

Release APK + androidTest APK now build cleanly.  The release APK is
self-contained: `assets/index.android.bundle` is 8.4 MB embedded.

### Attempt 8 — Deep-link launch to bypass the picker (then abandoned)

While exploring this I discovered that `am start -d
'exp+basis-mobile://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A8081'`
launches the dev-client directly into Metro-load mode, bypassing the
picker.  This is what `expo run:android` does internally.

**A SCREENSHOT confirmed this works end-to-end on debug builds:**
the app showed "Agents ready — 6 apps ▶" + the chat UI.

But Detox's `device.launchApp({ url: ... })` passes the URL via an
intent-VIEW path that bypasses `am instrument`, which means the
test runner (`DetoxTest.java`) never runs and no bridge is
established.  Confirmed via `adb logcat` — no `AndroidJUnitRunner` or
`TestRunner` lines after the URL-launch attempt.

**Conclusion:** deep-link launch and Detox-instrumentation launch are
mutually exclusive in expo-dev-client.  The release build is the
correct architectural path (no dev-launcher in release source-set →
`am instrument` lands directly on MainActivity).

### Attempt 9 — `device.disableSynchronization()` ordering

First placement: BEFORE `launchApp`.  Detox failed instantly because
the bridge has to exist before sync commands route through.

**Fix applied (kept):** Move `disableSynchronization()` AFTER
`launchApp({ newInstance: true })`.  Detox falls back to polling for
visible elements (necessary because our app has perpetual background
work — NknTransport reconnect loop, periodic catch-up timers — that
never lets the JS thread go idle).

### Attempt 10 — Release run with disableSynchronization (final)

All previous fixes applied.  Detox successfully:
- Built the release APK
- Installed it
- Invoked `am instrument` (test runner ran, the bridge connection got
  past messageId 1 — no fast-fail).
- Waited for `chat-screen` testID for the 60s timeout.

**But:** never found the testID.  After the run, the emulator showed
an UNRELATED Google sign-in screen — meaning the release APK launched,
crashed silently, and Android fell through to a system flow.

This is where I stopped.

## Likely root cause of the final block

The release APK crashes silently before the React tree mounts.
Hermes-only crashes are the canonical suspect.  Candidates:

1. **`VaultLocalStorage` accesses `globalThis.localStorage`** —
   the polyfill stubs it as `undefined`, the secure-agent factory's
   guards may not catch the empty path.  This is the
   `boot.agent_wiring_failed` route in `agentBundle.js`.  In debug
   mode with Metro the JS reloads from source could be masking
   something.
2. **`__DEV__`-gated code that flips behaviour** — devLog defaults
   to ON in `__DEV__`; in release `__DEV__ === false`.  Could cascade
   into something that assumed the dev path.
3. **ProGuard / minification breaking** something — release builds
   in this app use the default `enableProguardInReleaseBuilds` (likely
   off), but `shrinkResources` and other release-only steps might
   still touch the bundle.

## Next session checklist (precise)

In order:

1. **Capture the actual crash.** Boot the emulator, run
   `npm run detox:test` while tailing logcat:
   ```sh
   adb logcat -d -t 1000 | grep -iE 'FATAL|AndroidRuntime|ReactNative|canopychatmobile.*Error'
   ```
   The FATAL line gives the exact JS-side throw or Hermes assertion.

2. **If it's `VaultLocalStorage`:** the fix is to pass `chatVault: new
   VaultMemory()` (or VaultAsyncStorage) explicitly in
   `bootAgentBundle()` for release builds.  Currently the test code
   relies on the default path.  Easy fix once confirmed.

3. **If it's `__DEV__` flipping a path:** grep the bundled
   `assets/index.android.bundle` for `__DEV__` references that
   appear in user code (most should be from RN internals).

4. **If it's a ProGuard issue:** check
   `apps/basis-mobile/android/app/proguard-rules.pro` for any
   missing keep-rules around `@onderling/secure-agent`,
   `@onderling/manifest-host`, or the `nkn-sdk` types.  Add keep rules
   if classes are being stripped.

5. **Once the app renders in release mode:** the three D-1 tests
   should pass as written.  Their assertions only use stable testIDs
   (chat-header-status, chat-debug-toggle, chat-app-row-*, chat-input,
   chat-send, list-row-*, list-row-btn-*).

## Lessons learned (apply elsewhere)

- **Expo + Detox 2026 integration is meaningfully harder than vanilla
  RN + Detox.**  Estimate 2× for first-time setup in an Expo project.
- **Debug builds with `expo-dev-client` cannot be Detox'd via the
  standard path.**  Either use release builds (canonical) or write a
  custom launch sequence that taps through the picker (brittle).
- **`disableSynchronization()` is mandatory** for any app with
  perpetual background work.  Default sync waits for idle which never
  happens.  Must be called AFTER `launchApp()`.
- **Scope Gradle test tasks to `:app:`** in multi-module Expo
  projects.  The umbrella `assembleAndroidTest` triggers test builds
  for every library which then collide on JUnit packaging.
- **The dev-launcher deep-link** (`exp+<scheme>://expo-development-client/?url=...`)
  is genuinely useful for manual debugging — bypasses the picker,
  loads Metro.  Just doesn't compose with Detox's
  instrumentation-runner launch.

## Files that survived (all commit-quality)

- `apps/basis-mobile/package.json` — Detox + Jest deps, scripts
- `apps/basis-mobile/.detoxrc.js` — release-mode config
- `apps/basis-mobile/e2e/{jest.config.js, README.md, _hello.test.js, coldBoot.test.js, slashRoundtrip.test.js, restartSurvival.test.js}`
- `apps/basis-mobile/android/app/build.gradle` — testBuildType, androidTest deps, packagingOptions.resources.pickFirsts
- `apps/basis-mobile/android/build.gradle` — Detox maven repo
- `apps/basis-mobile/android/app/src/androidTest/` — DetoxTest.java + AndroidManifest.xml
- `apps/basis-mobile/src/screens/ChatScreen.js` — testID props

## See also

- `Project Files/basis/post-2026-05-24-priority.md` — Bundle D
- `apps/basis-mobile/e2e/README.md` — how to run (once D-1 lights up)
- TaskList #254 — task with the precise resume state
