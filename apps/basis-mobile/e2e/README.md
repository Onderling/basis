# Detox E2E tests (#254 — D-1)

Runs on a real Android emulator (or attached device) and asserts
on the rendered UI of basis-mobile.  Parallel to vitest:
vitest is for substrate logic, Detox is for the device runtime.

## Prerequisites

- Android emulator AVD `Medium_Phone_API_36` (or change `.detoxrc.js`).
- `~/Android/Sdk/emulator/emulator` on `PATH` so Detox can boot the AVD.
- The Metro bundler does **not** need to be running — the test
  build embeds the JS bundle.

## Running

```sh
# One-time per app/source change:
pnpm exec detox build --configuration android.emu.debug
# or: npm run detox:build

# Per-run:
pnpm exec detox test --configuration android.emu.debug
# or: npm run detox:test
```

Target the physical phone (`c53828f5`) instead:

```sh
npm run detox:test:attached
```

## What's covered (D-1)

| Test | Replaces manual step |
|---|---|
| `coldBoot.test.js` | #249 boot screen + 6 NavModel rows |
| `slashRoundtrip.test.js` | #253 step 2 — /mine + list bubble with button |
| `restartSurvival.test.js` | #249 vault + cache persistence on relaunch |

## What's NOT covered (D-2+, tracked in #224 Phase B)

- State-morphing assertion (tap → row vanishes from origin bubble)
- Cross-device JM scenarios (paired emulators)
- Native-only journeys: JM-3 push, JM-4 BLE, JM-5 camera, JM-6 voice
- "Mesh transport ready" runtime assertion (needs nknLib in test env)
- #253 step 4 special-case buttons ([Help with], [Start DM], [Download])

## TestID convention

The shell sprinkles stable `testID="..."` props on:

- `chat-screen` — root container
- `chat-header-status` — "Agents ready — N apps ▶"
- `chat-debug-toggle` — tap target to expand/collapse the boot debug
- `chat-debug-list` — container around the per-app rows when open
- `chat-app-row-<appOrigin>` — one per app
- `chat-input` — bottom TextInput
- `chat-send` — bottom Send button
- `bubble-user-<msgId>` — user message bubbles
- `bubble-bot-list-<msgId>` — bot list bubbles (text/error variants
  don't have testIDs yet — add when a test needs them)
- `list-row-<itemId>` — per-row container in a list bubble
- `list-row-btn-<opId>-<itemId>` — per-button inside a row

When adding new screens / surfaces, follow the same `<role>-<context>`
pattern so the Detox selectors stay greppable.

## See also

- `../docs/manifest-pipeline.md` — pipeline that lands on screen
- `Project Files/basis/post-2026-05-24-priority.md` —
  Bundle D test-pyramid + coverage matrix

## Use this before hand-driving anything

`npm run detox:build` once per source change, then `npm run detox:test` — or `detox:test:attached` for a
physical phone. The suites are `coldBoot`, `allWizards`, `circleScreens`, `restartSurvival`, driven by
`testID`s against a real emulator or attached device.

**Hand-driving with `adb input tap` + `screencap` is a last resort, not the default.** Pixel coordinates and
`input text` have their own traps (→ `docs/agent-notes-known-gotchas.md`; `adb shell input keyevent 111` is
ESCAPE, which silently cancels a wizard mid-flow). A whole afternoon went into those on 2026-07-30 while
this suite sat unused.

**If a journey is not expressible here, that is a gap in the harness worth closing** — extend the suite
rather than reaching for `adb`, so the next person inherits a harness instead of a transcript.
