/**
 * THE FUNCTION MATRIX — alpha one's sixteen functions × the three shells, each cell the story that proves it.
 *
 * Alpha one ships sixteen functions, each TESTED (Frits 2026-10-30 + 2026-11-03): a function with no green story on a
 * shell is a promise nobody has walked there. This file declares, per function and shell, the story that covers it —
 * a test file (and, once pinned, the test's title) — or why the cell does not apply. `lint-function-matrix.mjs` prints
 * the matrix: green where the named story exists, red where a cell names nothing or names a story that is gone.
 *
 * Who fills it: the cells are NAMED BY FABLE (L529); the generator came first. A cell marked `proposed: true` is a
 * story the generator's author found by name and believes covers the cell — not yet confirmed. Confirming one means
 * deleting `proposed` (and, ideally, pinning `test` to the title that proves it).
 *
 *   story: { file: 'repo-relative path', test?: 'a substring of the test title', proposed?: true }
 *   not applicable: { na: 'why this function has no meaning on this shell' }
 *   unnamed: null  (red — nobody has said which story proves it)
 */

export const SHELLS = Object.freeze(['web', 'mobile', 'box']);

const P = (file, test = null) => ({ file, ...(test ? { test } : {}), proposed: true });
const NA = (why) => ({ na: why });
const BOX_NO_SCREEN = NA('the box paints no screen: this function is a person\'s, on their own device');

export const FUNCTIONS = Object.freeze([
  // ── alpha one's ten (Frits 2026-10-30) ───────────────────────────────────────────────────────────────────────────
  { id: 'messaging', name: 'Messaging (circle chat, contact threads)', cells: {
    web: P('apps/basis/test-browser/twopeer.spec.js'),
    mobile: P('apps/basis-mobile/test/circleChatParity.test.js'),
    box: P('apps/basis/test/botJoinsCircle.relay.test.js'),
  } },
  { id: 'nearby', name: 'Nearby', cells: {
    web: P('apps/basis/test-browser/nearby-level.spec.js'),
    mobile: P('apps/basis-mobile/test/circlesNearbyParity.test.js'),
    box: null,
  } },
  { id: 'feedback', name: 'Feedback to the maker', cells: {
    web: P('apps/basis/test-browser/feedback-path-box.spec.js'),
    mobile: P('apps/basis-mobile/test/feedbackDoorMobile.test.js'),
    box: P('apps/basis/test/alphaFeedbackPath.relay.test.js'),
  } },
  { id: 'personas', name: 'Personas', cells: {
    web: P('apps/basis/test-browser/persona-switcher.spec.js'),
    mobile: P('apps/basis-mobile/test/personaSwitcherParity.test.js'),
    box: null,
  } },
  { id: 'pod-sync', name: 'Syncing through a pod', cells: {
    web: P('apps/basis/test-browser/walk-pod.spec.js'),
    mobile: P('apps/basis-mobile/test/circlePods.test.js'),
    box: null,
  } },
  { id: 'circle-types', name: 'Circle types (normal, central pod, pod-only)', cells: { web: null, mobile: null, box: null } },
  { id: 'assistant', name: 'Personal assistant / chat', cells: {
    web: P('apps/basis/test-browser/circle-view-bot.spec.js'),
    mobile: null,
    box: P('apps/basis/test/botReplyLines.box.test.js'),
  } },
  { id: 'hopping', name: 'Hopping', cells: {
    web: P('apps/basis/test-browser/walk-transports.spec.js'),
    mobile: null,
    box: null,
  } },
  { id: 'task-sharing', name: 'Task sharing', cells: {
    web: null,
    mobile: P('apps/basis-mobile/test/circleTasksTab.test.js'),
    box: P('apps/basis/test/choresOnTheBox.relay.test.js'),
  } },
  { id: 'asking', name: 'Asking questions', cells: {
    web: P('apps/basis/test-browser/walk-ask-matches.spec.js'),
    mobile: P('apps/basis-mobile/e2e/askMatches.test.js'),
    box: null,
  } },
  // ── the six that joined alpha one's tested set (Frits 2026-11-03) ───────────────────────────────────────────────
  { id: 'governance', name: 'Governance (proposals, votes, roles, removal, signed reports)', cells: {
    web: P('apps/basis/test-browser/walk-member-proposes-policy.spec.js'),
    mobile: P('apps/basis-mobile/test/adminRoleControlGreyed.test.js'),
    box: P('apps/basis/test-browser/screen-admin-box.spec.js'),
  } },
  { id: 'lists-agenda', name: 'Lists, agenda, reminders', cells: {
    web: P('apps/basis/test-browser/vandaag-lists-block.spec.js'),
    mobile: P('apps/basis-mobile/test/listsBlockOnThePhone.test.js'),
    box: P('apps/basis/test/agendaLinkWalk.relay.test.js'),
  } },
  { id: 'attachments', name: 'Files and media as attachments (circles, contact threads)', cells: {
    web: P('apps/basis/test-browser/circle-attach-file.spec.js'),
    mobile: P('apps/basis-mobile/test/attachmentPicker.test.js'),
    box: null,
  } },
  { id: 'restore-devices', name: 'Restore and your devices (phrase, second device, revoke)', cells: {
    web: P('apps/basis/test-browser/walk-own-devices-follow.spec.js'),
    mobile: P('apps/basis-mobile/test/restoreFromMnemonic.test.js'),
    box: P('apps/basis/test/revokeTheBox.relay.test.js'),
  } },
  { id: 'help-onboarding', name: 'Help and onboarding', cells: {
    web: P('apps/basis/test-browser/walk-first-five-minutes.spec.js'),
    mobile: P('apps/basis-mobile/test/helpCircleOnboarding.test.js'),
    box: BOX_NO_SCREEN,
  } },
  { id: 'connected-screens', name: 'Connected screens', cells: {
    web: P('apps/basis/test-browser/screen-connect-box.spec.js'),
    mobile: null,
    box: P('apps/basis/test/screenConnect.relay.test.js'),
  } },
]);
