/**
 * Merge all the app manifests canopy-chat-mobile composes (same set as
 * canopy-chat web — see apps/canopy-chat/src/web/realAgent.js for
 * the web parallel).  Portable: zero DOM, zero RN, runs in vitest.
 *
 * The merged manifest feeds the projector (renderMobile) + the
 * slash-command parser shared with canopy-chat web.
 */
// Relative imports into the sibling canopy-chat workspace.  Using
// the workspace package name would be cleaner but pnpm self-resolve
// for `@canopy-app/canopy-chat` from a NEW workspace pkg needs a
// `pnpm install` cycle to land — and a previous attempt 404'd on a
// pre-existing `@canopy/webid-discovery` dep.  Relative imports
// sidestep that, work today, and keep #221.5's lifted core layer
// as the single source of truth.
import { mergeManifests, canopyChatManifest } from '../../../canopy-chat/src/index.js';
import {
  mockTasksManifest, mockStoopManifest, mockFolioManifest,
} from '../../../canopy-chat/src/core/manifests/mockManifests.js';
import { mockHouseholdManifest } from '../../../canopy-chat/src/core/agent/mockAgent.js';
import { calendarManifest } from '../../../calendar/manifest.js';

/**
 * Single source of truth for the per-app manifest list — used by
 * composeManifests (dispatch catalog), buildManifestsByOrigin
 * (renderReply opts), and indirectly by buildNavModels.  See
 * docs/manifest-pipeline.md for the rationale + the dual-truth
 * pitfall the household-missing bug surfaced 2026-05-26.
 */
function manifestList({ householdManifest } = {}) {
  return [
    canopyChatManifest,
    householdManifest ?? mockHouseholdManifest,
    mockTasksManifest,
    mockStoopManifest,
    mockFolioManifest,
    calendarManifest,
  ];
}

/**
 * @param {object} extras
 * @param {object} [extras.householdManifest]  override the default
 *                                             mockHouseholdManifest
 *                                             (e.g. when the real
 *                                             agent bundle has booted)
 * @returns {object}  raw merged catalog
 */
export function composeManifests({ householdManifest, extraSources = [] } = {}) {
  const entries = [
    ...manifestList({ householdManifest }).map((manifest) => ({ manifest })),
    ...extraSources,   // extension-mapping sources (feedback-extension P2) — merged at the same waist
  ];
  // runtime:'browser' matches what canopy-chat web passes — the
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
