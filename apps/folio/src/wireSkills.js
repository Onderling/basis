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
 * RESOLUTION / BROWSER-BOUNDARY: `wireSkill` is imported by RELATIVE PATH
 * from `@onderling/sdk`'s source rather than the bare `@onderling/sdk` barrel.
 * Two reasons: (1) `browser.js` (which imports this module) is composed
 * into basis's BROWSER bundle and must stay node-free — the barrel
 * re-exports `@onderling/transports` etc. which carry node deps; `wireSkill.js`
 * + its only import `connectSkill.js` are a zero-dependency, node-free
 * 2-file closure.  (2) folio's isolated `node_modules` has no
 * `@onderling/sdk`.  Same rationale as `apps/agents/test/*`'s relative import.
 */
import { buildSkillsFromManifest } from '@onderling/sdk';

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
