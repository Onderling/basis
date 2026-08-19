/**
 * Merge all the app manifests basis-mobile composes (same set as
 * basis web — see apps/basis/src/web/realAgent.js for
 * the web parallel).  Portable: zero DOM, zero RN, runs in vitest.
 *
 * The merged manifest feeds the projector (renderMobile) + the
 * slash-command parser shared with basis web.
 */
// Relative imports into the sibling basis workspace.  Using
// the workspace package name would be cleaner but pnpm self-resolve
// for `@onderling-app/basis` from a NEW workspace pkg needs a
// `pnpm install` cycle to land — and a previous attempt 404'd on a
// pre-existing `@onderling/webid-discovery` dep.  Relative imports
// sidestep that, work today, and keep 's lifted core layer
// as the single source of truth.
import { mergeManifests, basisManifest } from '../../../basis/src/index.js';
import {
  mockTasksManifest, mockStoopManifest, mockFolioManifest,
} from '../../../basis/src/core/manifests/mockManifests.js';
// Part G (2026-06-17) — the REAL `apps/household` manifest (item/task vocab)
// is the household catalogue source of truth, replacing the chore-vocab mock.
import { householdManifest as realHouseholdManifest } from '../../../household/manifest.js';
import { calendarManifest } from '../../../calendar/manifest.js';
// agents (2026-07-09) — the read-only "your agents" surface. Relative import for
// the same pnpm-cycle reason as above; manifest.js is import-free so this pulls
// in no dependency chain.  Handlers are composed in-process by realAgent.js
// (the 'agents' branch of callSkill) — same split as tasks/stoop/folio.
import { agentsManifest } from '../../../agents/manifest.js';

/**
 * Single source of truth for the per-app manifest list — used by
 * composeManifests (dispatch catalogue), buildManifestsByOrigin
 * (renderReply opts), and indirectly by buildNavModels.  See
 * docs/manifest-pipeline.md for the rationale + the dual-truth
 * pitfall the household-missing bug surfaced 2026-05-26.
 */
function manifestList({ householdManifest } = {}) {
  return [
    basisManifest,
    // tasks-v0 BEFORE household: colliding bare op-ids (notably `addTask`, declared by both) must resolve
    // to tasks-v0, not household chores — matching the circle GATE which excludes household ("household
    // shadowed by tasks"). Without this, "@assistant add X" landed in the household circle while the
    // complete-resolver (tasks-v0) found nothing → "couldn't find X" on `done X` (#49, web≡mobile).
    mockTasksManifest,
    householdManifest ?? realHouseholdManifest,
    mockStoopManifest,
    mockFolioManifest,
    calendarManifest,
    // agents LAST (2026-07-09): listAgents/viewAgent are collision-free today;
    // last-in-order means any future op-id collision resolves to the earlier,
    // established app.  Mirrors the web list (circleApp.js baseSources) — the
    // two lists must stay in the same order (docs/manifest-pipeline.md).
    agentsManifest,
  ];
}

/**
 * @param {object} extras
 * @param {object} [extras.householdManifest]  override the default real
 *                                             householdManifest (e.g. when
 *                                             the agent bundle injects its
 *                                             own manifest instance)
 * @returns {object}  raw merged catalogue
 */
export function composeManifests({ householdManifest, extraSources = [] } = {}) {
  const entries = [
    ...manifestList({ householdManifest }).map((manifest) => ({ manifest })),
    ...extraSources,   // extension-mapping sources (feedback-extension) — merged at the same waist
  ];
  // runtime:'browser' matches what basis web passes — the
  // manifest validator uses it to gate browser-only ops.  RN is
  // closer to browser than to Node for these purposes (fetch,
  // WebSocket, IndexedDB-via-AsyncStorage adapter), so we keep the
  // same flag.  When a true RN-only runtime path lands, add 'rn'
  // to mergeManifests's runtime allowlist.
  return mergeManifests(entries, { runtime: 'browser' });
}

/**
 * Build the `{appOrigin → manifest}` map that `renderReply` needs in
 * its opts to compute per-row inline-keyboard buttons via
 * `renderChat.inlineKeyboardFor`.  Without this map, list bubbles
 * come out button-less (regression captured in
 * test/chatRender.test.js 2026-05-26).
 *
 * @param {object} extras
 * @param {object} [extras.householdManifest]  same override semantics
 *                                             as composeManifests
 * @returns {Object<string, object>}  appOrigin → manifest
 */
export function buildManifestsByOrigin({ householdManifest } = {}) {
  const result = {};
  for (const m of manifestList({ householdManifest })) {
    result[m.app] = m;
  }
  return result;
}

// Internal export for buildNavModels — same single source so the
// dual-truth gap that hid the household bug can't reopen.
export { manifestList as _internalManifestList };
