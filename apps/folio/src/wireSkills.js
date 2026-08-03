/**
 * buildFolioSkills — the WIRE route for folio's pod-file ops
 * (PLAN-folio-as-file-agent.md). The folio sibling of
 * `apps/agents/src/wireSkills.js#buildAgentSkills`.
 *
 * Wraps each pure core in `FOLIO_CORES` with `wireSkill(coreFn, op,
 * { storeFor })` — so the folioManifest op stays the single contract and
 * the `defineSkill`-shaped handler is DERIVED from it, not hand-rolled.
 * The set is manifest-derived: EVERY folioManifest op tagged
 * `runtime:'browser'` (the relocatable pod-file set) must have a core, and
 * every core must map to such an op — the fitness test fails CI otherwise.
 *
 * Returns `[{ id, handler, visibility }]` — register each on a `core.Agent`
 * via `agent.register(id, handler)` (folio's handlers carry no explicit
 * visibility today, so callers may drop it).
 *
 * RESOLUTION / BROWSER-BOUNDARY: imported via the `@onderling/sdk/skills`
 * SUBPATH, never the bare barrel. `browser.js` (which imports this module) is
 * composed into basis's BROWSER bundle and must stay node-free — the barrel
 * re-exports `@onderling/transports` etc., which carry node deps. The subpath
 * resolves to `buildSkillsFromManifest.js` → `wireSkill.js` → `connectSkill.js`,
 * a zero-dependency node-free 3-file closure.
 *
 * ⚠ HISTORY, because this line has now been wrong in BOTH directions: it began as
 * a relative reach into the sdk's src (node-free, but bypassing the package
 * surface — flagged by the dep-boundary guard); on 2026-08-03 a sweep "fixed" it
 * to the bare barrel — satisfying the guard and silently pulling node transports
 * into the browser bundle, against this very header. The subpath is the form that
 * satisfies both constraints. If you change this import, you are choosing between
 * them: read both reasons first.
 */
import { buildSkillsFromManifest } from '@onderling/sdk/skills';

import { folioManifest } from '../manifest.js';
import { FOLIO_CORES } from './agentCores.js';

/**
 * @param {object} args
 * @param {object} args.store  the injected folio backend (see agentCores.js) —
 *   `{ files, identity, podRoot?, mintShareToken, simulateSync, listPodFolio,
 *      getPodSource, ensureNoteSearch, searchFolioNotes }`.  Resolved for
 *   every ctx (folio is a single-user browser surface).
 * @returns {Array<{ id: string, handler: Function, visibility?: string }>}
 */
export function buildFolioSkills({ store } = {}) {
  if (!store || !Array.isArray(store.files)) {
    throw new TypeError('buildFolioSkills: store with a `files` index required');
  }
  // folio ops declare no manifest `visibility`; the shared helper defaults to
  // `op.visibility` (undefined here) so registration matches the pre-1b
  // hand-rolled `agent.register(id, h)`.
  return buildSkillsFromManifest({
    operations: folioManifest.operations.filter((op) => op.runtime === 'browser'),
    cores:      FOLIO_CORES,
    storeFor:   () => store,
    label:      'buildFolioSkills',
  });
}
