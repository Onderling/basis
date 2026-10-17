/**
 * Settings — Pinboard's settings module.
 *
 * **2026-05-08:** the implementation lifted into the
 * `@onderling/local-store` substrate (Tasks V1 = rule-of-two
 * consumer per
 * `Project Files/Pinboard/migration-tasks-v1-lifts-2026-05-08.md`).
 * This file is now a thin wrapper: it calls the substrate's
 * `createSettingsModule({appId: 'pinboard', ...})` factory with
 * Pinboard's field partition + defaults baked in, then re-exports the
 * resulting bundle.
 *
 * Path prefix: `mem://pinboard/settings/...` (unchanged from before
 * the lift; the substrate uses `mem://<appId>/settings/...`).
 *
 * Field partition (unchanged):
 *   shared:   broadcastable, defaultShareLocation
 *   device:   pollIntervalMs, onlineWindow, allowHopThrough
 */

import { createSettingsModule } from '@onderling/local-store';

/** Default settings.  Conservative — opt-in for everything privacy/battery-relevant. */
const DEFAULT_SETTINGS_RAW = {
  // ── Per-device ────────────────────────────────────────────────────
  pollIntervalMs: 2_000,
  onlineWindow:   { everyMinutes: null, durationSec: null },
  allowHopThrough: false,

  // ── User-portable ─────────────────────────────────────────────────
  broadcastable: true,
  defaultShareLocation: false,
};

/**
 * Pinboard-specific per-field validator: mirrors the original
 * `mergeWithDefaults` from before the lift, including the
 * `pollIntervalMs >= 100` guard, the nested onlineWindow guards, and
 * the `=== false` / `=== true` strict-bool reads for the
 * privacy/share toggles.
 */
function pinboardFieldValidator(value, fieldName, def) {
  switch (fieldName) {
    case 'pollIntervalMs':
      return typeof value === 'number' && value >= 100 ? value : def;
    case 'onlineWindow':
      return {
        everyMinutes:
          typeof value?.everyMinutes === 'number' && value.everyMinutes > 0
            ? value.everyMinutes : null,
        durationSec:
          typeof value?.durationSec === 'number' && value.durationSec > 0
            ? value.durationSec : null,
      };
    case 'broadcastable':
      return value === false ? false : true;
    case 'allowHopThrough':
      return value === true;
    case 'defaultShareLocation':
      return value === true;
    default:
      return value ?? def;
  }
}

const settingsModule = createSettingsModule({
  appId:        'pinboard',
  sharedFields: ['broadcastable', 'defaultShareLocation'],
  deviceFields: ['pollIntervalMs', 'onlineWindow', 'allowHopThrough'],
  defaults:     DEFAULT_SETTINGS_RAW,
  fieldValidator: pinboardFieldValidator,
});

export const {
  loadSettings,
  saveSettings,
  updateSettings,
  DEFAULT_SETTINGS,
  SETTINGS_SHARED_PATH,
  SETTINGS_LEGACY_PATH,
  SETTINGS_MIGRATION_MARKER,
  SETTINGS_DEVICE_PATH_PREFIX,
} = settingsModule;

/** @deprecated since Phase 33 — use `SETTINGS_SHARED_PATH`. */
export const SETTINGS_STORAGE_PATH = SETTINGS_SHARED_PATH;
