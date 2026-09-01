/**
 * attachEntries — what the composer's "+" offers HERE.
 *
 * Three places were answering this and each had its own version: the web host filtered the projected
 * menu, the mobile composer filtered it again, and the journey that checks the answer reimplemented
 * the filter to have something to check. Three readings of one question is how the menu came to render
 * nothing on one shell and something on another.
 *
 * The answer is a composition of things that already exist:
 *   · `renderAttachments(manifest)` — the projected entries, per app, from `surfaces.attach`;
 *   · `opAvailability` — is this op composed here (apps only — the DEVICE is not an app the circle
 *     composes), is its feature on, may this member do it;
 *   · and the shell's own honesty check: an entry whose dispatch path is not wired is not painted.
 *     Frits, 2026-09-01: *"We should never offer functions that actually don't work."*
 *
 * Pure. The shells paint what this returns and dispatch `{appOrigin, opId}` through the waist.
 */
import { renderAttachments } from '@onderling/app-manifest';

/**
 * @param {object} a
 * @param {Record<string, object>} a.manifestsByOrigin  `{appOrigin → manifest}` — every composed app,
 *   plus basis. An app that declares no `surfaces.attach` simply contributes nothing.
 * @param {{of: (opId: string) => {state: string}}|null} [a.availability]  the circle's three-rung answer
 * @param {boolean} [a.mediaWired]  does this circle have a sealed-media composition? The FILE entry
 *   (`via: 'media'`) never reaches the waist — it rides the media pipeline — so the catalogue has no
 *   say over it and this is the only question that decides whether it can work.
 * @returns {Array<{opId:string, appOrigin:string, label:string, params?:Array, itemType?:string, group?:string, via?:string}>}
 */
export function attachEntriesFor({ manifestsByOrigin = {}, availability = null, mediaWired = false } = {}) {
  const out = [];
  for (const [appOrigin, manifest] of Object.entries(manifestsByOrigin ?? {})) {
    if (!manifest || !Array.isArray(manifest.operations)) continue;
    for (const entry of renderAttachments(manifest).attachMenu) {
      // The dispatch address, carried: an op id alone is not one, since two apps may declare the same
      // id. The shells used to know it only because the menu came from a single manifest.
      out.push({ ...entry, appOrigin });
    }
  }
  return out
    .filter((e) => (e.via === 'media' ? mediaWired : true))
    .filter((e) => !availability || availability.of(e.opId).state !== 'hidden');
}

export default attachEntriesFor;
