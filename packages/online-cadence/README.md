# `@onderling/online-cadence`

> **Layer:** SDK foundation (RN-flavored cadence helpers).
> **Convention:** RN-specific substrates live in their own packages — see
> [`docs/conventions/architectural-layering.md`](../../docs/conventions/architectural-layering.md#mobile-substrates-live-in-their-own-packages-locked-2026-05-08).

Foreground/background cadence helpers for React Native agents:

- `createActiveCadence({runOnce, getPollIntervalMs, AppState, onError})` —
  pure-JS ticker that drives a `runOnce()` pass at a configurable
  interval while the app is foreground; pauses when backgrounded.
- `attachAppStateBridge({bundle, getPollIntervalMs, AppState})` —
  wires the cadence helper to a live agent bundle: drives
  `bundle.cache.setOnline(true|false)` on AppState transitions and
  ticks `bundle.skillMatch.tick()` on each foreground pass. Returns
  a cleanup callback.
- Re-exports of the bg-fetch helpers from `@onderling/sync-engine-rn`
  (`setBgRunOnce`, `clearBgRunOnce`, `bgRunOnce`,
  `registerBackgroundTask`, `defineBackgroundTask`,
  `registerBackgroundFetch`, `unregisterBackgroundFetch`,
  `statusBackgroundFetch`, `DEFAULT_BACKGROUND_FETCH_INTERVAL_S`) so
  apps can import the whole cadence + bg-task surface from one
  module.

## Origins

Extracted from `apps/pinboard-mobile`'s cadence helpers once a second
app needed them; pinboard-mobile's copies are now thin re-exports
through this substrate. The bg-fetch helpers live in
`@onderling/sync-engine-rn`; this package re-exports them for
ergonomic colocation.

## Example

```js
import {
  attachAppStateBridge,
  setBgRunOnce,
  registerBackgroundTask,
} from '@onderling/online-cadence';
import { AppState } from 'react-native';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';

// Attach foreground cadence after the bundle is built:
const detach = attachAppStateBridge({
  bundle,
  getPollIntervalMs: () => settings.get().pollIntervalMs,
  AppState,
});

// And the bg-fetch bridge at JS-bundle load:
registerBackgroundTask({
  taskName:    'my-app-sync-background',
  defineTask:  TaskManager.defineTask,
  results:     BackgroundFetch.BackgroundFetchResult,
});
setBgRunOnce(() => engine.runOnce());
```

## Tests

```sh
npm test
```
