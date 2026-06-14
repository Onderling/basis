/**
 * Extension install/uninstall + the PLAIN consent-card model (feedback-extension P2c-3).
 *
 * The receive flow (DESIGN §1.5, web-first): a link carries a Mapping → we run
 * the sandbox check (`verifyMapping`) → if it fails we REFUSE ("needs
 * capabilities not available here"); if it passes we show a **plain consent
 * card** (the commands it adds, what each invokes, the atoms it needs, the
 * scope, and "what if I deny?") → on Add we `writeMapping` to the store and the
 * boot merge picks it up; on Remove we `removeMapping`.
 *
 * `buildConsentModel` is pure (testable, dep-free of the store). The install/
 * uninstall helpers wrap `@canopy/pod-routing` write/remove over whatever store
 * is injected (localStorage V0 today; a real pseudo-pod once the web pod layer
 * — P3 3.3c — lands).
 */

import { writeMapping, removeMapping } from '@canopy/pod-routing/mappings';
import { verifyMapping } from '../mappings.js';

const WHAT_IF_DENY = 'Nothing is added or changed — you can open the link again later.';

/**
 * Build the plain consent-card model from a mapping, AFTER the sandbox check.
 * If the mapping references opIds not in the catalog it is refused (`ok:false`
 * + the missing refs); otherwise the card enumerates exactly what it can do.
 *
 * @param {import('@canopy/pod-routing').Mapping} mapping
 * @param {{ opsById: Map<string, object> }} catalog
 * @returns {{ ok: boolean, missing: string[], card: object|null }}
 */
export function buildConsentModel(mapping, catalog) {
  const { ok, missing } = verifyMapping(mapping, catalog);
  if (!ok) return { ok: false, missing, card: null };

  const commands = (mapping?.ops ?? []).map((op) => ({
    command: op?.surfaces?.slash?.command ?? op?.id,
    // what this command actually invokes — the existing ops it composes (the atoms it touches)
    invokes: Array.isArray(op?.steps) ? op.steps.map((s) => `${s.appOrigin}/${s.opId}`) : [],
  }));

  return {
    ok: true,
    missing: [],
    card: {
      id:        mapping.id,
      title:     mapping.title ?? mapping.id,
      scope:     mapping.scope === 'circle' ? 'circle' : 'app',
      needs:     [...(mapping.needs ?? [])],
      commands,
      whatIfDeny: WHAT_IF_DENY,
    },
  };
}

/**
 * Install (the "Add" action): re-checks the sandbox gate, then writes the
 * mapping into the store. Returns `{ok:false, missing}` if it would be unsafe.
 *
 * @returns {Promise<{ ok: boolean, missing?: string[], uri?: string }>}
 */
export async function installMapping({ store, deviceId, mapping, catalog }) {
  const { ok, missing } = verifyMapping(mapping, catalog);
  if (!ok) return { ok: false, missing };
  const res = await writeMapping({ pseudoPod: store, deviceId, mapping });
  return { ok: true, uri: res.uri };
}

/** Uninstall (the "Remove" action): delete the mapping from the store. */
export async function uninstallMapping({ store, deviceId, id }) {
  await removeMapping({ pseudoPod: store, deviceId, id });
  return { ok: true, id };
}
