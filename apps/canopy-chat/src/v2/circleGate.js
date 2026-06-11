// circleGate.js — the circle bot's deterministic pre-LLM gate, DERIVED FROM THE MANIFEST.
//
// Replaces the hand-written circleGateRules.js. "add X" / "done X" / "claim X" now come from the task
// ops' `surfaces.slash.match` declarations (mockManifests.js) via `renderGate` — the SAME projection
// household's TG-bot uses (`renderSlash`). So the deterministic gate, the slash surface, and the LLM
// tool surface (`renderChat`) all read one source of truth instead of a parallel hand-written copy.
//
// Relative import of the substrate (not the '@canopy/app-manifest' alias) so the same module resolves
// under both vite (web) and metro (mobile imports this file from canopy-chat/src/v2).
//
// v1 projects the tasks manifest (the verbs the circle bot already acted on). Lighting up more apps is
// `renderGate([mockTasksManifest, mockStoopManifest, …])` once their match arg-shapes are verified.

import { renderGate } from '../../../../packages/app-manifest/src/renderGate.js';
import { mockTasksManifest } from '../core/manifests/mockManifests.js';

/** Token-gate rules for the circle bot, projected from the manifest. */
export function circleGateRules() {
  return renderGate([mockTasksManifest]);
}
