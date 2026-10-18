# `@onderling/local-store`

> **Layer:** substrate. Cross-platform.
> Lifted from `apps/pinboard/src/lib/{CachingDataSource, SyncCadence, Settings}.js`
> on 2026-05-08 as Tasks V1 = the rule-of-two consumer (per
> `Project Files/Pinboard/migration-tasks-v1-lifts-2026-05-08.md`).

Local-first storage for agent-SDK apps. Three exports:

## `CachingDataSource`

A `DataSource` (per `@onderling/core`) that wraps an optional inner
(pod-backed) DataSource:

- Reads check the local Map first; fall back to the inner.
- Writes always succeed locally; queue for the inner; flush
  best-effort.
- `attachInner(pod)` — swap inner mid-flight; bulk-syncs queued
  writes.
- `localOnlyPrefixes` — paths matching any prefix never sync to
  the inner (Pinboard V2.5 uses this for per-device settings).

Events: `online`, `offline`, `queued`, `flushed`, `pulled`,
`error`, `bulk-sync-started`, `bulk-sync-progress`,
`bulk-sync-finished`.

## `SyncCadence`

Foreground-only periodic ticker. Apps wire `setForeground(true)` to
start the timer; `setForeground(false)` pauses. Default tick
intervals are configurable.

## `createSettingsModule({appId, sharedFields, deviceFields, defaults, fieldValidator?})`

Per-app factory for the shared/device-split settings pattern (per
[`Project Files/conventions/cross-app-settings.md`](../../docs/conventions/cross-app-settings.md)).

```js
import { createSettingsModule } from '@onderling/local-store';

const m = createSettingsModule({
  appId:        'pinboard',
  sharedFields: ['broadcastable', 'defaultShareLocation'],
  deviceFields: ['pollIntervalMs', 'onlineWindow', 'allowHopThrough'],
  defaults:     { /* ... */ },
  fieldValidator: (value, name, def) => /* per-field validation */,
});

export const {
  loadSettings, saveSettings, updateSettings,
  DEFAULT_SETTINGS,
  SETTINGS_SHARED_PATH, SETTINGS_LEGACY_PATH,
  SETTINGS_MIGRATION_MARKER, SETTINGS_DEVICE_PATH_PREFIX,
} = m;
```

Returns app-bound functions:
- Path prefix: `mem://<appId>/settings/...`.
- `loadSettings({dataSource, deviceId})` reads shared.json + the
  device blob and merges (device wins on overlap).
- `saveSettings`, `updateSettings({patch, scope?})` partition writes
  by field name.
- One-shot legacy migration from `mem://<appId>/settings.json` →
  shared.json + devices/<deviceId>.json. Idempotent (marker key).

The `fieldValidator(value, fieldName, def)` callback runs on every
field at merge-with-defaults time. The default validator does a
simple `typeof === typeof def` check; apps with rich rules (e.g.
"`pollIntervalMs >= 100`") supply a custom one.

## Origins

Pinboard V1 Phase 4 invented `CachingDataSource` and `SyncCadence`.
Pinboard V2.5 Phase 23.5 added `Settings`. Phase 33 split it into the
shared/device shape. Tasks V1 implementation needs the same three
primitives (per
`Tasks App/coding-plan-2026-05-07.md`
Phase 1), so the rule-of-two trigger fires and the substrate is
extracted here. Pinboard's three lib files become re-export shims.

## Tests

```bash
cd packages/local-store
npm test
```

Substrate-side tests cover the factory's contract; Pinboard's existing
phase23/phase33/phase34 tests in `apps/pinboard/test/` exercise the
end-to-end behaviour against the lifted code.
