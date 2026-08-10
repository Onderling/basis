/**
 * entryKindDeclarations — which signed LOG-ENTRY kinds an add-on's ops may append, DECLARED in the manifest
 * and enforced at the rail's two chokepoints (append + verify-on-ingest).
 *
 * The third sibling in the declaration family: `entryKinds` answers lane/wake/retention per entry TYPE,
 * `resolutionPolicy` answers how concurrent writes to an ITEM's fields merge, and THIS table answers which
 * statement kinds a LANE of the device log carries at all. Same pattern throughout: the manifest DECLARES
 * (`operations[{ appends: [{ lane, kind }] }]`), the declaration is injected DOWN at composition (the app
 * hands data to the substrate registry — never an up-import), and the RECEIVER enforces — an undeclared kind
 * is refused loudly at the append (a misconfigured add-on fails at its own write) and at the ingest (a
 * malicious peer cannot invent kinds). The rail (`circleEntryRail`) consults this at both ends.
 */

/** A mutable `lane → Set(kind)` registry with the declare/read accessors the rail consults. */
export function createEntryKindRegistry() {
  const table = new Map();   // lane -> Set(kind)

  const api = {
    /** Declare that `lane` carries statement kind `kind`. Idempotent; returns `this` for chaining. */
    declare(lane, kind) {
      if (typeof lane !== 'string' || !lane) throw new Error('entryKindRegistry.declare: lane (string) required');
      if (typeof kind !== 'string' || !kind) throw new Error('entryKindRegistry.declare: kind (string) required');
      let set = table.get(lane);
      if (!set) { set = new Set(); table.set(lane, set); }
      set.add(kind);
      return api;
    },
    /** The declared kinds for a lane (a copy, stable order) — what the rail passes as `declaredKinds`. */
    kindsFor(lane) { return [...(table.get(lane) ?? [])].sort(); },
    /** Is `(lane, kind)` declared? — the refusal test at append + ingest. */
    has(lane, kind) { return table.get(lane)?.has(kind) ?? false; },
    /** Every declared lane. */
    lanes() { return [...table.keys()]; },
  };
  return api;
}

/**
 * Populate a registry from an app manifest's DECLARED appends (the DI seam — the app declares INTO the
 * substrate registry). Reads `operations[{ appends: [{ lane, kind }] }]`. An op with no `appends` declares
 * nothing; malformed rows are skipped (the rail's loud gate catches an op appending an undeclared kind).
 */
export function declareManifestEntryKinds(registry, manifest) {
  const ops = manifest && Array.isArray(manifest.operations) ? manifest.operations : [];
  for (const op of ops) {
    const decls = op && Array.isArray(op.appends) ? op.appends : [];
    for (const d of decls) {
      if (d && typeof d.lane === 'string' && d.lane && typeof d.kind === 'string' && d.kind) {
        registry.declare(d.lane, d.kind);
      }
    }
  }
  return registry;
}

/** Build the effective registry for one or more manifests — what a composition root hands the rail(s). */
export function entryKindRegistryFromManifests(...manifests) {
  const r = createEntryKindRegistry();
  for (const m of manifests.flat()) if (m) declareManifestEntryKinds(r, m);
  return r;
}
