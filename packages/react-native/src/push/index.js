/**
 * @onderling/react-native/push — push opt-in substrate.
 *
 * Two layers:
 *   - `setupPush({agent, projectId, ...})` + `requestPushPermission()`
 *     — imperative API (lifted verbatim from apps/stoop-mobile).
 *   - `usePushOptIn({agent, ...})` — React hook for Settings-screen
 *     UX: permission rationale → request → registration → status.
 *
 * `MobilePushBridge` itself stays in `@onderling/react-native/transport`
 * (already there pre-lift); the helpers here just glue it to the OS
 * permission flow.
 */

export { setupPush, requestPushPermission } from './setupPush.js';
export { usePushOptIn }                     from './usePushOptIn.js';
export { presentLocalNotification, presentLocalWith } from './presentLocal.js';
export { createWakeNudges, readWakeNudgesPref, WAKE_NUDGES_KEY } from './wakeNudges.js';
