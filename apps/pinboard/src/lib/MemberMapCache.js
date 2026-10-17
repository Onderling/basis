/**
 * MemberMapCache — re-export shim around `@onderling/identity-resolver`.
 *
 * **2026-05-08:** the implementation lifted into the identity-resolver
 * substrate (Tasks V1 = rule-of-two consumer per
 * `Project Files/Pinboard/migration-tasks-v1-lifts-2026-05-08.md`).
 * Storage path layout (`<root>members/<webid-encoded>.json`) is
 * preserved.
 */

export { MemberMapCache } from '@onderling/identity-resolver';
