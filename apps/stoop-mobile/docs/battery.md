# Stoop-mobile — battery measurements

> Captured during Phase 40.23 real-device pass. Fill in the per-
> device rows as you measure. Numbers are rough — the goal is to
> catch order-of-magnitude regressions, not Joule-level precision.
>
> Document `device / Android version / battery capacity` once per
> tester so the numbers contextualize.

## Measurement protocol

1. Fully charge the device.
2. Disable everything except Stoop-mobile (turn off background
   updates for other apps; airplane mode → re-enable Wi-Fi only).
3. Record battery % via `adb shell dumpsys battery | grep level`.
4. Run the workload (see scenarios below).
5. Record battery % again. Subtract.
6. Note any OS-side throttling events from `adb logcat | grep -i
   doze` over the same window.

## Scenarios

### Scenario A — 8-hour idle (foreground app suspended)

App is launched but suspended (home-button-out). No active
journeys. Background fetch on default settings.

| Device | Android | Capacity | Start % | End % | Δ% / 8h | Notes |
|---|---|---|---|---|---|---|
| | | | | | | |

**Expectation:** ≤ 5% over 8h. If higher, look for:
- mDNS background broadcast (BLE / Wi-Fi)
- expo-task-manager wake frequency
- Push subscription keep-alives

### Scenario B — 1-hour active session

Foreground active. Walk J1-J7 from the smoke checklist.
Includes ~5 posts, ~10 chat messages, ~3 photos, GPS-acquire
once.

| Device | Android | Capacity | Start % | End % | Δ% / 1h | Notes |
|---|---|---|---|---|---|---|
| | | | | | | |

**Expectation:** ≤ 10% over 1h of active use. Photo capture +
upload is the biggest single hit; expect a spike during J4.

### Scenario C — Background fetch cadence comparison

Run three 4-hour windows back-to-back with
`onlineWindow.everyMinutes` set to:

| Cadence | Start % | End % | Δ% / 4h | Push count received |
|---|---|---|---|---|
| 15 min | | | | |
| 30 min | | | | |
| 60 min | | | | |

**Expectation:** monotone — 15 min uses more battery than 60 min.
If 30 min is mysteriously cheaper than 60 min, suspect Doze
clamping the 30-min schedule to the same window as 60-min.

## Push round-trip latency

Test push from another device → Stoop-mobile push handler fires.
Capture wall-clock seconds between send and receive (use a
stopwatch app on a third device for visual sync).

| Test | Latency (s) | Notes |
|---|---|---|
| Foreground | | |
| Background (≤ 1 min) | | |
| Background (> 10 min, post-Doze entry) | | |
| Screen off | | |

**Expectation:** foreground < 2s; background (pre-Doze) < 5s;
post-Doze can be tens of seconds (Android's normal behaviour).

## Known throttles to watch for

- **Doze mode** triggers ~30 min after the screen goes off + no
  recent user activity. Push delivery + background fetch get
  batched in the next "maintenance window" (typically every
  ~60 min, can be hours).
- **App standby buckets** — if Stoop-mobile lands in the
  `restricted` bucket, push + background-fetch get serialised
  hard. Look at `adb shell am get-standby-bucket
  org.onderling.stoop` to verify.
- **Battery saver** (system) — clamps background work
  aggressively. Numbers from a battery-saver-enabled device
  shouldn't be compared to a normal-mode device.

## Action thresholds

If any scenario's Δ% exceeds the expectation by 2× or more, file
an issue + investigate before promoting to closed-beta.

If push round-trip in foreground is > 5s, suspect the push token
registration with `MobilePushBridge` — verify the token landed
in `circleConfig.pushTokens` on the sender side.
