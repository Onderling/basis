/**
 * THE FUNCTION MATRIX — alpha one's sixteen functions × the three shells, each cell the story that proves it.
 *
 * Alpha one ships sixteen functions, each TESTED (Frits 2026-10-30 + 2026-11-03): a function with no green story on a
 * shell is a promise nobody has walked there. This file declares, per function and shell, the story that covers it —
 * a test file (and, once pinned, the test's title) — or why the cell does not apply. `lint-function-matrix.mjs` prints
 * the matrix: green where the named story exists, red where a cell names nothing or names a story that is gone.
 *
 * THE RULE (Fable, 2026-11-03): a cell is a STORY that performs the function end to end ON THAT SHELL — web: a browser
 * spec; mobile: a Detox e2e or a test that boots the MOBILE composition (agentBundle); box: a relay test booting the
 * device-runner composition. A parity or unit test of shared code proves the shared code, not that the shell reaches
 * it — it is no cell.
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
    mobile: null,   // circleChatParity is a parity test, not a story on the phone
    box: P('apps/basis/test/botJoinsCircle.relay.test.js'),
  } },
  { id: 'nearby', name: 'Nearby', cells: {
    web: P('apps/basis/test-browser/nearby-level.spec.js'),
    mobile: null,   // circlesNearbyParity is a parity test
    box: NA('the box joins no Nearby room in alpha one (a venue room is later)'),
  } },
  { id: 'feedback', name: 'Feedback to the maker', cells: {
    web: P('apps/basis/test-browser/feedback-path-box.spec.js'),
    mobile: null,   // feedbackDoorMobile is a unit of the door
    box: P('apps/basis/test/alphaFeedbackPath.relay.test.js'),
  } },
  { id: 'personas', name: 'Personas', cells: {
    web: P('apps/basis/test-browser/persona-switcher.spec.js'),
    mobile: null,   // personaSwitcherParity is a parity test
    box: null,      // REQUIRED: a box enrolled with persona W keeps W's circle as W, never the general persona
  } },
  { id: 'pod-sync', name: 'Syncing through a pod', cells: {
    web: P('apps/basis/test-browser/walk-pod.spec.js'),
    mobile: null,   // circlePods is a unit
    box: NA('the box holds circles by relay and catch-up; its registry mirror is covered under restore and devices'),
  } },
  // REQUIRED on all three: a normal and a pod-only circle on each; the central pod on web (the CSS-gated test)
  { id: 'circle-types', name: 'Circle types (normal, central pod, pod-only)', cells: { web: null, mobile: null, box: null } },
  { id: 'assistant', name: 'Personal assistant / chat', cells: {
    web: P('apps/basis/test-browser/circle-view-bot.spec.js'),
    mobile: null,   // REQUIRED: the assistant on the phone
    box: P('apps/basis/test/botReplyLines.box.test.js'),
  } },
  // red on every shell until Frits says what he means by hopping (Fable asked; walk-transports is a transport walk, and
  // the social match-hop is not built — architecture.md, Reachability)
  { id: 'hopping', name: 'Hopping', cells: { web: null, mobile: null, box: null } },
  { id: 'task-sharing', name: 'Task sharing', cells: {
    web: null,      // REQUIRED: a claimed task crossing two browsers
    mobile: P('apps/basis-mobile/test/multiCircleSeparation.test.js'),
    box: P('apps/basis/test/choresOnTheBox.relay.test.js'),
  } },
  { id: 'asking', name: 'Asking questions', cells: {
    web: P('apps/basis/test-browser/walk-ask-matches.spec.js'),
    mobile: P('apps/basis-mobile/e2e/askMatches.test.js'),
    box: NA('the box is no person who asks or answers; the question items it carries are covered by task and list sync'),
  } },
  // ── the six that joined alpha one's tested set (Frits 2026-11-03) ───────────────────────────────────────────────
  { id: 'governance', name: 'Governance (proposals, votes, roles, removal, signed reports)', cells: {
    web: P('apps/basis/test-browser/walk-member-proposes-policy.spec.js'),
    mobile: null,   // adminRoleControlGreyed is a unit
    box: P('apps/basis/test-browser/screen-admin-box.spec.js'),
  } },
  { id: 'lists-agenda', name: 'Lists, agenda, reminders', cells: {
    web: P('apps/basis/test-browser/vandaag-lists-block.spec.js'),
    mobile: null,   // listsBlockOnThePhone is a unit of the block
    box: P('apps/basis/test/agendaLinkWalk.relay.test.js'),
  } },
  { id: 'attachments', name: 'Files and media as attachments (circles, contact threads)', cells: {
    web: P('apps/basis/test-browser/circle-attach-file.spec.js'),
    mobile: null,   // attachmentPicker is a unit
    box: NA('the box renders no files in alpha one; keeping attachments available is later'),
  } },
  { id: 'restore-devices', name: 'Restore and your devices (phrase, second device, revoke)', cells: {
    web: P('apps/basis/test-browser/walk-own-devices-follow.spec.js'),
    mobile: P('apps/basis-mobile/test/identityRecoveryJourney.test.js'),   // boots the mobile bundle: same identity, same addresses
    box: P('apps/basis/test/revokeTheBox.relay.test.js'),
  } },
  { id: 'help-onboarding', name: 'Help and onboarding', cells: {
    web: P('apps/basis/test-browser/walk-first-five-minutes.spec.js'),
    mobile: null,   // helpCircleOnboarding is a unit
    box: BOX_NO_SCREEN,
  } },
  { id: 'connected-screens', name: 'Connected screens', cells: {
    web: P('apps/basis/test-browser/screen-connect-box.spec.js'),
    mobile: null,   // REQUIRED: the phone approves a screen's code
    box: P('apps/basis/test/screenConnect.relay.test.js'),
  } },
]);
