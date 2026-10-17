/**
 * UsageMetrics — re-export shim around `@onderling/notifier`.
 *
 * **2026-05-08:** the implementation lifted into the notifier
 * substrate (Tasks V1 = rule-of-two consumer per
 * `Project Files/Pinboard/migration-tasks-v1-lifts-2026-05-08.md`).
 * Existing `import { UsageMetrics } from '../lib/UsageMetrics.js'`
 * sites in Pinboard keep working.
 */

export { UsageMetrics } from '@onderling/notifier';
