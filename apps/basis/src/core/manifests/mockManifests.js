/**
 * basis — slash-routing manifests for tasks-v0 / stoop / folio.
 *
 * NOTE: the "mock" prefix is HISTORICAL.  Post slices 1 / 2b / 4 of the
 * integration plan (2026-05-23), the SKILL HANDLERS for these three
 * apps are REAL — composed in-process by `realAgent.js` via each app's
 * `src/browser.js` factory.  These manifests are the chat-shell's
 * slash-command DECLARATIONS for those real agents (the real per-app
 * manifests in `apps/<app>/manifest.js` deliberately omit
 * `surfaces.slash` — slash is a chat-shell concern).
 *
 * Why split out from `mockAgent.js` (2026-05-23, slice-4 polish):
 *   - Three manifests dominated the file (~365 of 612 lines).
 *   - The real mock LIVES in `mockAgent.js` — household-only
 *     (`mockHouseholdManifest` + `createMockHouseholdAgent` are still
 *     used as a lightweight fixture in `mockAgent.test.js`).
 *   - Co-locating the three slash-binding manifests here makes it
 *     obvious what they actually do + makes future renames easier.
 *
 * If you're adding a new chat slash command for tasks/stoop/folio,
 * declare it here.  If you're adding the IMPLEMENTATION, register a
 * handler in the relevant `apps/<app>/src/browser.js`.
 *
 * Future rename candidates (not done in this slice): `mockTasksManifest`
 * → `tasksSlashManifest`, etc.  Deferred — names are load-bearing
 * across imports + the rename adds churn without behaviour change.
 */

/**
 * tasks-v0 manifest — Part G dissolve (2026-06-17).
 *
 * This file's former `mockTasksManifest` literal (the chat-shell slash/
 * gate surface for the REAL tasks-v0 circle skills) has been FOLDED INTO
 * the real `apps/tasks-v0/manifest.js`, which is now the ONE tasks
 * manifest (same move folio made — see the `mockFolioManifest`
 * re-export below).  We re-export it under the historical name so every
 * importer (circleGate.js, web/main.js's manifestsByOrigin, journeys
 * tests, navModel) keeps working unchanged.
 *
 * The merged manifest's `.app` is now `'tasks'` (NOT `'tasks-v0'`): the
 * catalogue (`manifestMerge.js`) keys ops by `m.app`, so dispatch now
 * routes the tasks circle under appOrigin `'tasks'` (realAgent.js's
 * callSkill matches `'tasks'`).  The vocab adapter bridges
 * (rejectTask reason→note, submitTask note-default) are removed — the
 * manifest declares the real `note` param directly. The claimTask
 * embed decl lives IN the real manifest now (no post-hoc patch here).
 */
import { tasksManifest } from '../../../../tasks-v0/manifest.js';

export const mockTasksManifest = tasksManifest;

/**
 * stoop manifest — Part G dissolve (2026-06-17).
 *
 * This file's former `mockStoopManifest` literal (the chat-shell slash/
 * gate surface for the REAL stoop NeighbourhoodAgent skills) has been
 * FOLDED INTO the real `apps/stoop/manifest.js`, which is now the ONE
 * stoop manifest (same move folio + tasks already made).  We re-export
 * it under the historical name so every importer (circleGate.js, web/
 * main.js's manifestsByOrigin, journeys tests) keeps working unchanged.
 *
 * The merged manifest's `.app` is `'stoop'` on BOTH sides — NO app-origin
 * migration (unlike tasks-v0→tasks).  All dispatch strings stay 'stoop'.
 *
 * Slash collisions reconciled in the real manifest (richer gate wins,
 * real-skill param vocab):
 *   - /post → postRequest: param `intent` (real); richer mock gate
 *     (more verbs + dropTrailing) kept.  The substrate's
 *     intentToCanonicalDraft(intent, kind) is the value-map.
 *   - /lend-return → markReturned: param `requestId` (real) — the
 *     former realAgent itemId→requestId bridge is REMOVED.
 *   - /reveal: COLLISION (real setPeerReveal vs mock revealPeer alias).
 *     Kept ONE op `setPeerReveal` (richer flags gate); the `revealPeer`
 *     op + its STOOP_OP_ALIAS entry are DROPPED.  adaptStoopReply now
 *     keys its reveal branch on `setPeerReveal`.
 *   - /report, /lend-assign, /skills, /leave-group, /tree, /sign-out,
 *     /respond, /bulletin: merged to one op each, real params.
 *
 * The thin ALIASED ops (listFeed /feed, getStoopProfile /stoop-profile)
 * carry distinct commands from their real targets and dispatch via
 * STOOP_OP_ALIAS — KEPT.  getBulletin has NO manifest op (it's a
 * circleContent source op aliased to listOpen); its STOOP_OP_ALIAS entry
 * STAYS.  The mock-only ops (holiday-mode, contacts, wizards, groups,
 * share-qr, startDm) carry real handlers + are relocated into the real
 * manifest.  The realAgent stoop adapter (reply-shape + semantic aliases
 * + EN→NL trust / on-off→boolean / peer→peerWebid / min-trust→minTrust /
 * trust→trustOffer transforms) is KEPT — legitimate presentation→storage
 * mapping, NOT drift.
 *
 * The brief/search decls below still attach to `listFeed`.
 */
import { stoopManifest } from '../../../../stoop/manifest.js';

export const mockStoopManifest = stoopManifest;

/**
 * Folio manifest — Part G dissolve (2026-06-11).
 *
 * This file's former `mockFolioManifest` (the chat-shell slash/gate
 * surface for the REAL folio skills) has been FOLDED INTO the real
 * `apps/folio/manifest.js`, which is now the ONE folio manifest (the
 * calendar-style target).  We re-export it under the historical name so
 * every importer (circleGate.js, composeManifests, navModel) keeps
 * working unchanged.
 *
 * The merged manifest carries the chat-shell ops (readNote, shareFolder,
 * syncOnce, watchStart, getFileSnapshot, downloadFile, saveToMyPod,
 * folioStatus, listFiles) WITH their slash/chat/gate surfaces, plus
 * folio's own destructive ops (deleteFromPod, deleteLocally, forceRepush)
 * which DELIBERATELY carry no `surfaces.chat` so the circle LLM can never
 * propose deleting a shared file. The decls below
 * (brief / search / embed) still attach to readNote / shareFolder.
 */
import { folioManifest } from '../../../../folio/manifest.js';

export const mockFolioManifest = folioManifest;

// v0.7 — brief-summary decls on each app's list op. /brief fans
// across these to produce the morning brief. Household's decl
// lives in `mockAgent.js`.
mockStoopManifest.operations.find((o) => o.id === 'listFeed')
  .surfaces.chat.brief = { summarySkill: 'briefSummary', order: 30, label: 'Circle' };
mockFolioManifest.operations.find((o) => o.id === 'readNote')
  .surfaces.chat.brief = { summarySkill: 'briefSummary', order: 20, label: 'Folio' };

// v0.7.5 — search decls. Each app declares a text-search skill
// so /find can fan across them.
mockStoopManifest.operations.find((o) => o.id === 'listFeed')
  .surfaces.chat.search = { searchSkill: 'searchPosts' };
mockFolioManifest.operations.find((o) => o.id === 'readNote')
  .surfaces.chat.search = { searchSkill: 'searchFiles' };

// v0.7.13 — cardSnapshotSkill on shareFolder (the user-visible
// 'share a file' moment).  /embed-file --path=<existing> looks up
// the file via getFileSnapshot before building the embed envelope.
mockFolioManifest.operations.find((o) => o.id === 'shareFolder')
  .surfaces.chat.embed = { cardSnapshotSkill: 'getFileSnapshot' };
