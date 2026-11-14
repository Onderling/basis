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

const NA = (why) => ({ na: why });
const BOX_NO_SCREEN = NA('the box paints no screen: this function is a person\'s, on their own device');

export const FUNCTIONS = Object.freeze([
  // ── alpha one's ten (Frits 2026-10-30) ───────────────────────────────────────────────────────────────────────────
  { id: 'messaging', name: 'Messaging (circle chat, contact threads)', cells: {
    web: { file: 'apps/basis/test-browser/journeys.spec.js', test: 'fan-out — a message from A appears in B chat' },   // named by Fable 2026-11-03
    // a Detox walk on the emulator (the D form: run before each release, not in CI): join by invite, a circle line each
    // way, a contact thread each way, each side read from its own store (Fable's brief 2026-11-10)
    mobile: { file: 'apps/basis-mobile/e2e/messaging.test.js', test: "the phone's answer in the thread reaches Bram's stored thread" },
    box: { file: 'apps/basis/test/botJoinsCircle.relay.test.js', test: 'the circle door: a member who names it is answered' },
  } },
  { id: 'nearby', name: 'Nearby', cells: {
    web: null,      // nearby-level proves only that the level survives a reload; nobody meets anyone (Fable 2026-11-10)
    mobile: null,   // circlesNearbyParity is a parity test
    box: NA('the box joins no Nearby room in alpha one (a venue room is later)'),
  } },
  { id: 'feedback', name: 'Feedback to the maker', cells: {
    web: { file: 'apps/basis/test-browser/feedback-path-box.spec.js', test: 'a visitor writes to the maker' },
    mobile: { file: 'apps/basis-mobile/e2e/feedbackDoor.test.js', test: 'a note written there reaches the maker, and the answer shows in the thread' },
    box: { file: 'apps/basis/test/alphaFeedbackPath.relay.test.js', test: 'what the person writes lands on the box' },
  } },
  { id: 'personas', name: 'Personas', cells: {
    // a person joins another's circle as a persona chosen in the join wizard: the other member's roster and chat show the
    // persona, never the general name, also after a reload
    web: { file: 'apps/basis/test-browser/walk-persona-joins-a-circle.spec.js', test: 'a person joins a circle as a persona' },
    // the phone joins a circle as a new persona made in the join wizard; the other member's roster has the persona, its
    // lines arrive from it, and after a restart it still speaks there as the persona
    mobile: { file: 'apps/basis-mobile/e2e/personas.test.js', test: 'after a restart the phone still speaks in the circle as the persona' },
    // a box enrolled with persona W rejoins W's circle as W (never the general persona) and keeps it through a membership
    // change — named by Fable 2026-11-05
    box: { file: 'apps/basis/test/personaOnTheBox.relay.test.js', test: 'on its first start it rejoins Y AS W' },
  } },
  { id: 'pod-sync', name: 'Syncing through a pod', cells: {
    web: null,      // walk-pod only LOGS its findings and passes regardless — no proof (and no person can make a pod circle yet, L571)
    mobile: null,   // circlePods is a unit
    box: NA('the box holds circles by relay and catch-up; its registry mirror is covered under restore and devices'),
  } },
  // REQUIRED on all three: a normal and a pod-only circle on each; the central pod on web (the CSS-gated test).
  // Today no person can MAKE a central-pod or pod-only circle on any shell (the wizard sets no storage; a change after
  // creation is refused) — the scope is Frits's call (L571). ⓘ 'hybrid' is in circleDataPolicy's table but is not one of
  // the three types Frits named: outside the tested set, no cell.
  // web: apps/basis/test-browser/walk-circle-types-pod.spec.js walks all three through the wizard; normal is green, the
  // two pod types are fixme until a web pod sign-in can complete — so the cell stays red until they are green too.
  { id: 'circle-types', name: 'Circle types (normal, central pod, pod-only)', cells: { web: null, mobile: null, box: null } },
  { id: 'assistant', name: 'Personal assistant / chat', cells: {
    web: { file: 'apps/basis/test-browser/circle-view-bot.spec.js', test: '"@assistant add X" engages the bot' },
    mobile: null,   // REQUIRED: the assistant on the phone
    box: { file: 'apps/basis/test/botReplyLines.box.test.js', test: 'an add by the word rule is one Telegram line' },
  } },
  // hopping = a member carries for a member (Frits 2026-11-03). Its EVENTUAL half is the catch-up: a member only the
  // LAN reaches pulls a statement from the member who reaches both. The story's LAN is a second relay standing in for
  // mDNS, and it boots the shared agent composition rather than a browser or the device-runner — named for web and box
  // by Fable 2026-11-03 on that basis. The mobile cell (Fable's brief 2026-11-10): the same story with a PHONE as the
  // member who reaches both and serves — the phone's own bundle and inbound wiring (test/support/mobileNode.js). The live
  // mDNS hop between two phones stays a step of the two-phone walk. The LIVE push is not built.
  { id: 'hopping', name: 'Hopping', cells: {
    web: { file: 'apps/basis/test/lanCatchUpCarriesAStatement.relay.test.js', test: 'holds his statement after her catch-up with Anna' },
    mobile: { file: 'apps/basis-mobile/test/lanCatchUpCarriesAStatement.mobile.relay.test.js', test: "holds his statement after her catch-up with Anna's phone" },
    box: { file: 'apps/basis/test/lanCatchUpCarriesAStatement.relay.test.js', test: 'holds his statement after her catch-up with Anna' },
  } },
  { id: 'task-sharing', name: 'Task sharing', cells: {
    web: { file: 'apps/basis/test-browser/journeys.spec.js', test: 'task-handoff — A adds a task, B claims it' },   // named by Fable 2026-11-03
    mobile: { file: 'apps/basis-mobile/e2e/taskSharing.test.js', test: 'Bram claims it: the phone shows it as taken, no longer open to claim' },
    box: { file: 'apps/basis/test/choresOnTheBox.relay.test.js', test: 'Ann adds a chore; Bert claims it' },
  } },
  { id: 'asking', name: 'Asking questions', cells: {
    web: { file: 'apps/basis/test-browser/walk-ask-matches.spec.js', test: 'an ask shows the asker who offers it' },
    mobile: { file: 'apps/basis-mobile/e2e/askMatches.test.js', test: 'asks the board, and sees Bram under its own ask' },
    box: NA('the box is no person who asks or answers; the question items it carries are covered by task and list sync'),
  } },
  // ── the six that joined alpha one's tested set (Frits 2026-11-03) ───────────────────────────────────────────────
  { id: 'governance', name: 'Governance (proposals, votes, roles, removal, signed reports)', cells: {
    // the proposal half; roles, removal and signed reports come with the governance-by-role work
    web: { file: 'apps/basis/test-browser/walk-member-proposes-policy.spec.js', test: 'Save is a proposal; the admin' },
    // the phone as a member: its Save is a proposal, the admin (a real agent on the relay) says yes, the phone holds it
    // (its admin half: governanceAdmin.test.js, the phone removes a member and that member's device drops the circle; the
    // REPORT half waits on a surface question: the alpha trims the governance panel, the only place an admin sees a report)
    mobile: { file: 'apps/basis-mobile/e2e/governanceProposal.test.js', test: "Bram, the admin, says yes: the phone holds the circle's new settings" },
    // the box OBEYING the circle (screen-admin-box is the admin's screen, not the box) — Fable 2026-11-10
    box: { file: 'apps/basis/test/botJoinsCircle.relay.test.js', test: 'the box forgets the circle and its record of it goes' },
  } },
  { id: 'lists-agenda', name: 'Lists, agenda, reminders', cells: {
    // the item crossing to another member (vandaag-lists-block is one page) — Fable 2026-11-10; the reminder is its own story
    web: { file: 'apps/basis/test-browser/walk-attach-appointment.spec.js', test: 'an appointment made from it reaches the other member' },
    // the circle's lists on the phone's Vandaag, both ways with a real second person (the reminder is its own story)
    mobile: { file: 'apps/basis-mobile/e2e/listsAgenda.test.js', test: 'the phone ticks it off, and Bram has it no longer open' },
    box: { file: 'apps/basis/test/agendaLinkWalk.relay.test.js', test: 'the link carries the agenda' },
  } },
  { id: 'attachments', name: 'Files and media as attachments (circles, contact threads)', cells: {
    // a file crossing to someone (circle-attach-file is one page) — Fable 2026-11-10
    web: { file: 'apps/basis/test-browser/walk-dm-photo.spec.js', test: 'a camera-sized photo sent to a contact arrives' },
    // the phone's own "+" op (mountPhoneAppOps) sends a file into a contact thread; the other phone stores the same
    // bytes through its own wiring (Fable 2026-11-11). A CIRCLE file's bytes cannot cross yet on any shell: one
    // in-memory media bucket per session (the real bucket is not built); a plain circle offers no file entry at all.
    mobile: { file: 'apps/basis-mobile/test/attachmentsMobile.relay.test.js', test: "Anna's thread '+' sends a file; Bob's phone stores the same bytes in his thread with her" },
    box: NA('the box renders no files in alpha one; keeping attachments available is later'),
  } },
  { id: 'restore-devices', name: 'Restore and your devices (phrase, second device, revoke)', cells: {
    web: { file: 'apps/basis/test-browser/walk-own-devices-follow.spec.js', test: 'one person, two devices' },
    mobile: { file: 'apps/basis-mobile/test/identityRecoveryJourney.test.js', test: 'phrase → fresh install → restore' },   // boots the mobile bundle
    box: { file: 'apps/basis/test/revokeTheBox.relay.test.js', test: '3 · the ceremony' },
  } },
  { id: 'help-onboarding', name: 'Help and onboarding', cells: {
    web: { file: 'apps/basis/test-browser/walk-first-five-minutes.spec.js', test: 'first five minutes: onboarding, a handle' },
    // a Detox walk on the emulator (not in CI; run before each release and the two-phone walk): a fresh install's help
    // circle, a first circle from Today, its invite link joined by a real second person, a first message each way
    mobile: { file: 'apps/basis-mobile/e2e/firstFiveMinutes.test.js', test: 'a first message each way' },
    box: BOX_NO_SCREEN,
  } },
  { id: 'connected-screens', name: 'Connected screens', cells: {
    web: { file: 'apps/basis/test-browser/screen-connect-box.spec.js', test: 'the screen in a browser' },
    mobile: null,   // REQUIRED: the phone approves a screen's code
    box: { file: 'apps/basis/test/screenConnect.relay.test.js', test: '/scherm → a link' },
  } },
]);
