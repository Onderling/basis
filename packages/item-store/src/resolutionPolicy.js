/**
 * resolutionPolicy — THE DECLARATION LAYER (task #34): `(item-type, field) → resolution policy` + the
 * delivery-reliability tier it implies. This is the receiver-enforced home for "how do two concurrent writes
 * to the same item reconcile" (DESIGN-log-ordering-unification §5c/§6).
 *
 * ── Why a sibling of `entryKinds`, not a column ON it ────────────────────────────────────────────────────
 * `entryKinds` is keyed by KIND (chat-message / task / governance / …) and answers lane/wakes/retain/audit.
 * The resolution policy MUST distinguish `claimTask→assignee` (first-wins) from `editTask→text` (LWW) on the
 * SAME `task` type — so it is keyed by (item-type, FIELD), a finer key a by-kind table cannot express. It is
 * the same PATTERN as `entryKinds` (a frozen substrate table + accessors + a conservative default + a
 * registration seam), homed in this same substrate package, keyed differently — hence a sibling module.
 *
 * ── The three policies (a CRDT system, named — §5) ───────────────────────────────────────────────────────
 *   • content — LWW-register: the latest edit survives (posts, notes, task text). The conservative DEFAULT.
 *   • claim   — first-wins / immutable-once-set: first grab wins permanently (task assignee). Reconciled by
 *               `causalMerge.reconcileClaim` over the exported `CLAIM_FIELDS` cluster.
 *   • spine   — deny-wins meet-semilattice (membership / authority). Selected by ITEM-TYPE, NOT by this
 *               (type,field) table, and merged on a SEPARATE path (`@onderling/core` rosterFold / spine
 *               appender) — it never reaches `CircleItemStore.put`'s content/claim funnel. It appears here
 *               only as a named policy + delivery tier so a completeness guard can reason about it.
 *
 * ── Receiver-enforced, never sender-chosen (§6) ──────────────────────────────────────────────────────────
 * The policy is DECLARED per-op by an app manifest but ENFORCED by the receiver against this immutable
 * (item-type, field) table — so a sender cannot shape an item to dodge the intended merge (e.g. tag a
 * membership item LWW so a re-join overwrites an eviction). `CircleItemStore.put` consults the registry, not
 * the payload.
 *
 * ── The two layers, and the ONE that is the safe floor ───────────────────────────────────────────────────
 * `defaultResolutionRegistry()` is the code DEFAULT per type (§6 "code default per type — safe base"): it
 * declares task's whole claim cluster as `claim` and leaves everything else at the content default, so the
 * dispatch is behaviour-preserving even for a store composed WITHOUT a manifest (every existing test path).
 * An app then declares its ops' field-policies INTO a registry seeded from that floor
 * (`resolutionRegistryFromManifests`) — injected DOWN at composition (invariant 5: the app hands data to the
 * substrate registry; the substrate never up-imports the app). A completeness/agreement guard pins that the
 * manifest declarations agree with the floor, so the two layers cannot drift.
 */

import { CLAIM_FIELDS } from './causalMerge.js';

/** The resolution policies (the CRDT-system names — §5). */
export const RESOLUTION = Object.freeze({ CONTENT: 'content', CLAIM: 'claim', SPINE: 'spine' });

/** The delivery-reliability tiers (§5 — the policy IMPLIES a transport guarantee; declared together). */
export const DELIVERY = Object.freeze({
  BEST_EFFORT:   'best-effort',    // content — a dropped edit heals on the next merge
  AT_LEAST_ONCE: 'at-least-once',  // claim   — wants idempotent redelivery
  RELIABLE:      'reliable',       // spine   — a lost membership/key event leaves a lingering divergence
});

/**
 * The delivery tier a resolution policy implies. DERIVED from the policy (a projection), not a second table
 * to keep in sync — §5's "declared together" made concrete: pick the policy and the transport guarantee
 * follows. `deliveryOf(...)` is this over `resolutionOf(...)`.
 */
const DELIVERY_FOR = Object.freeze({
  [RESOLUTION.CONTENT]: DELIVERY.BEST_EFFORT,
  [RESOLUTION.CLAIM]:   DELIVERY.AT_LEAST_ONCE,
  [RESOLUTION.SPINE]:   DELIVERY.RELIABLE,
});
export function deliveryForResolution(resolution) {
  return DELIVERY_FOR[resolution] ?? DELIVERY.BEST_EFFORT;
}

/**
 * The conservative default for an UNREGISTERED (item-type, field): content-LWW. The safest reading — an
 * undeclared field heals on merge rather than being treated as a claim or a spine aspect (spine aspects,
 * being on a separate path, default to their own deny — never reachable as an accidental content merge here).
 */
export const DEFAULT_RESOLUTION = RESOLUTION.CONTENT;

const isResolution = (p) => p === RESOLUTION.CONTENT || p === RESOLUTION.CLAIM || p === RESOLUTION.SPINE;

/**
 * A mutable (item-type, field) → resolution registry with `resolutionOf` / `deliveryOf` accessors (mirrors
 * `entryKinds`' `retentionOf` / `kindWakes`) plus the `hasChannel` selector the put dispatch reads. Start
 * from `defaultResolutionRegistry()` (or `createResolutionRegistry()` for an empty one) and `declare(...)`
 * onto it.
 */
export function createResolutionRegistry() {
  const table = new Map();   // itemType -> Map(field -> resolution)

  const api = {
    /** Declare `(itemType, field) → resolution`. Last declaration wins; returns `this` for chaining. */
    declare(itemType, field, resolution) {
      if (typeof itemType !== 'string' || !itemType) throw new Error('resolutionRegistry.declare: itemType (string) required');
      if (typeof field !== 'string' || !field) throw new Error('resolutionRegistry.declare: field (string) required');
      if (!isResolution(resolution)) throw new Error(`resolutionRegistry.declare: unknown resolution "${resolution}"`);
      let m = table.get(itemType);
      if (!m) { m = new Map(); table.set(itemType, m); }
      m.set(field, resolution);
      return api;
    },

    /** The declared resolution for `(itemType, field)`, or the conservative content default. */
    resolutionOf(itemType, field) {
      return table.get(itemType)?.get(field) ?? DEFAULT_RESOLUTION;
    },

    /** The delivery tier implied by `(itemType, field)`'s resolution (derived — §5). */
    deliveryOf(itemType, field) {
      return deliveryForResolution(api.resolutionOf(itemType, field));
    },

    /**
     * Does this item-type declare ANY field with the given resolution channel? — the put dispatch selector.
     * `hasChannel(type, 'claim')` decides whether the receive funnel runs the claim reconciliation for a
     * type at all; the field-level cluster it then merges is `causalMerge`'s own `CLAIM_FIELDS`.
     */
    hasChannel(itemType, resolution) {
      const m = table.get(itemType);
      if (!m) return false;
      for (const p of m.values()) if (p === resolution) return true;
      return false;
    },

    /** Introspection for the guards/agreement: the declared field→resolution map for a type (a copy). */
    fieldsOf(itemType) { return new Map(table.get(itemType) ?? []); },
    /** Every declared item-type. */
    types() { return [...table.keys()]; },
  };
  return api;
}

/**
 * The built-in SAFE DEFAULT registry — the "code default per type" (§6). Behaviour-preserving: task's whole
 * claim cluster (`CLAIM_FIELDS`) resolves `claim` (first-wins), everything else falls to the content default.
 * Reuses `causalMerge`'s `CLAIM_FIELDS` so there is no second definition of what the claim cluster is.
 */
export function defaultResolutionRegistry() {
  const r = createResolutionRegistry();
  for (const f of CLAIM_FIELDS) r.declare('task', f, RESOLUTION.CLAIM);
  return r;
}

/**
 * Normalise `appliesTo.type` (a string, an array, or absent) to a list of item-types.
 */
function normalizeTypes(t) {
  if (Array.isArray(t)) return t.filter((x) => typeof x === 'string' && x);
  return (typeof t === 'string' && t) ? [t] : [];
}

/**
 * Populate a registry from an app manifest's DECLARED per-op field policies (the DI seam — invariant 5: the
 * app declares its policy INTO the substrate registry, never an up-import). Reads
 * `operations[{ appliesTo.type, resolves: [{ field, policy }] }]`. An op with no `resolves` declares nothing.
 */
export function declareManifestPolicies(registry, manifest) {
  const ops = manifest && Array.isArray(manifest.operations) ? manifest.operations : [];
  for (const op of ops) {
    const decls = op && Array.isArray(op.resolves) ? op.resolves : [];
    if (decls.length === 0) continue;
    const types = normalizeTypes(op.appliesTo && op.appliesTo.type);
    for (const t of types) {
      for (const d of decls) {
        if (d && typeof d.field === 'string' && d.field && typeof d.policy === 'string') {
          registry.declare(t, d.field, d.policy);
        }
      }
    }
  }
  return registry;
}

/**
 * Build the effective registry for one or more app manifests: the safe default floor
 * (`defaultResolutionRegistry`) with each manifest's declarations layered on. This is what a composition root
 * injects into `createCircleStores({ resolution })`.
 */
export function resolutionRegistryFromManifests(...manifests) {
  const r = defaultResolutionRegistry();
  for (const m of manifests.flat()) if (m) declareManifestPolicies(r, m);
  return r;
}
