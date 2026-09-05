/**
 * householdApp — the Household / "Lists" app dissolved onto the per-circle CircleItemStore (cluster L · L3),
 * PRESERVING its real ops + model (Frits 2026-06-30: re-home storage, don't re-invent functionality).
 *
 * Household's model, unchanged: typed lists `shopping`/`errand`/`repair`/`schedule` + `task`s, each an item
 * with `text` and `completedAt` (null = open); complete/remove/claim resolve a `match` by text. The ONLY
 * change vs the legacy household agent is WHERE the data lives — one per-circle `CircleItemStore` instead of
 * a per-app `HouseholdStore` — so the existing `household` manifest (ops + gate/slash/LLM surfaces) keeps
 * working unchanged; `app-origin` is now a capability tag, not the storage key.
 *
 * The list types are registered via `registerType` (third-party-style); `task` is canonical. Every op is a
 * pure function over the circle store — no agent, no own store. (REMAINING-WORK.md cluster L.)
 */
import {
  createCircleStores, memoryDataSource, createGenericAtomHandlers, resolutionRegistryFromManifests,
  param, PARAM_SCOPE, PARAM_KIND,
  // The canonical task functions — the household ops resolve a `match` and then delegate to these, so a
  // household claim/reassign/complete carries the SAME claim cluster (claimSeq, confirmation, CAS) as any
  // other task write. Aliased: household exposes its own match-based ops under the same names.
  addTasks, removeItems,
  claim as claimTask, reassign as reassignTask, markComplete as markCompleteItems,
} from '@onderling/item-store';
import { createRegistry, registerCanonicalTypes } from '@onderling/item-types';
import { dispatchCapability } from '@onderling/app-manifest';
import { householdManifest } from '../../../household/manifest.js';

export const LIST_TYPES = Object.freeze(['shopping', 'errand', 'repair', 'schedule']);
const COMPLETABLE = Object.freeze([...LIST_TYPES, 'task']);   // markComplete/removeItem search these (mirrors the manifest appliesTo)

const listTypeSchema = (t) => ({
  type: 'object',
  properties: { type: { const: t }, text: { type: 'string', minLength: 1 }, completedAt: { type: ['number', 'null'] } },
  required: ['type', 'text'],
});

/** Register household's list types onto a registry (`task` is canonical, already registered). */
export function registerHouseholdTypes(registry) {
  for (const t of LIST_TYPES) registry.registerType(t, listTypeSchema(t));
}

/** A registry: canonical types + household's list types. */
export function householdRegistry() {
  const reg = createRegistry();
  registerCanonicalTypes(reg);
  registerHouseholdTypes(reg);
  return reg;
}

// Parameter register (#36) — id-prefix match heuristic (scope:device, kind:internal). `param()` returns 6.
const MATCH_MIN_PREFIX_LEN = param({ key: 'household.matchMinPrefixLen', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 6 });   // id-prefix resolution only kicks in for reasonably long inputs

/**
 * Resolve ALL open (completedAt null) items matching `match`, among `types`, using the legacy skill's
 * resolution order: id-exact → id-prefix (≥6 chars) → text-contains (case-insensitive). Returns an array
 * so callers can distinguish 0 / 1 / >1 (the >1 case is the disambiguation prompt — never auto-act).
 */
async function findOpenMatches(store, match, types) {
  const m = String(match ?? '').trim();
  if (!m) return [];
  const open = [];
  for (const t of types) {
    for (const i of await store.listByType(t)) {
      if (i && i.completedAt == null) open.push(i);
    }
  }
  // 1) id exact
  const exact = open.find((i) => i.id === m);
  if (exact) return [exact];
  // 2) id-prefix (case-insensitive; only when the input is long enough to avoid false hits)
  if (m.length >= MATCH_MIN_PREFIX_LEN) {
    const upper = m.toUpperCase();
    const prefixHits = open.filter((i) => String(i.id ?? '').toUpperCase().startsWith(upper));
    if (prefixHits.length > 0) return prefixHits;
  }
  // 3) text-contains, case-insensitive
  const lower = m.toLowerCase();
  return open.filter((i) => String(i.text ?? '').toLowerCase().includes(lower));
}

// ── household's ops, faithful, over the circle store (ctx.by = the acting member) ──────────────────────
export const addItem = (store, { type, text }, { by } = {}) => store.put({ type, text, completedAt: null }, { by });
// listOpen with a `type` filters that list-type; WITHOUT a type it returns every OPEN item across all
// list-types + tasks (the legacy household path allowed this "all open" call, e.g. `/list` with no arg
// and the /brief contributor). `contact` items (household members) are excluded — they aren't list rows.
export const listOpen = async (store, { type } = {}) => {
  const all = (type === undefined || type === null)
    ? (await store.list()).filter((i) => i && i.type !== 'contact')
    : await store.listByType(type);
  return all.filter((i) => i.completedAt == null);
};
// {match}-based mutating ops resolve candidates and NEVER act on an ambiguous match: 0 → not found,
// >1 → `{ ok:false, ambiguous:[…candidates] }` (the caller renders a disambiguation prompt), 1 → act.
// After resolution they DELEGATE to the canonical task functions instead of raw-putting the item, so a
// household mutation carries the same lifecycle semantics as any other task write: completions stamp
// `completedBy`, claims are CAS-guarded (a racing second claimer gets `already-claimed`, never a silent
// steal) and advance the claim cluster (`claimSeq` + confirmation), removals pass the removal gate.
export async function markComplete(store, { match }, { by } = {}) {
  const hits = await findOpenMatches(store, match, COMPLETABLE);
  if (hits.length === 0) return { ok: false, error: 'item not found' };
  if (hits.length > 1)   return { ok: false, ambiguous: hits };
  const [item] = await markCompleteItems(store, [{ id: hits[0].id }], { actor: by });
  return { ok: true, item };
}
export async function removeItem(store, { match }, { by } = {}) {
  const hits = await findOpenMatches(store, match, COMPLETABLE);
  if (hits.length === 0) return { ok: false, error: 'item not found' };
  if (hits.length > 1)   return { ok: false, ambiguous: hits };
  await removeItems(store, [{ id: hits[0].id }], { actor: by });
  // The item too, so the reply can say WHAT was removed (the walk showed "✓ removed: " with nothing after it).
  return { ok: true, removed: hits[0].id, item: hits[0] };
}
// addTask materialises through the canonical add (id, `addedBy`/`addedAt`, `master`, cycle check); a task
// created pre-assigned is add + an authoritative reassign, so the assignee holds a REAL claim (cluster set)
// rather than a bare `assignee` field no lifecycle op recognises.
export async function addTask(store, { text, assignee, dueAt }, { by } = {}) {
  const [task] = await addTasks(store, [{ text, ...(dueAt ? { dueAt } : {}) }], { actor: by });
  if (!assignee) return task;
  const res = await reassignTask(store, task.id, assignee, { actor: by });
  return res?.error ? task : res;   // a CAS conflict on the fresh task is near-impossible; fall back to the created task
}
export const listTasks = async (store) => (await store.listByType('task')).filter((i) => i.completedAt == null);
export async function claim(store, { match }, { by } = {}) {
  const hits = await findOpenMatches(store, match, ['task']);
  if (hits.length === 0) return { ok: false, error: 'item not found' };
  if (hits.length > 1)   return { ok: false, ambiguous: hits };
  const res = await claimTask(store, hits[0].id, { actor: by });
  if (res?.error) return { ok: false, error: res.error, current: res.current };
  return { ok: true, item: res };
}
export async function reassign(store, { match, assignee }, { by } = {}) {
  const hits = await findOpenMatches(store, match, ['task']);
  if (hits.length === 0) return { ok: false, error: 'item not found' };
  if (hits.length > 1)   return { ok: false, ambiguous: hits };
  const res = await reassignTask(store, hits[0].id, assignee, { actor: by });
  if (res?.error) return { ok: false, error: res.error, current: res.current };
  return { ok: true, item: res };
}

const OPS = { addItem, listOpen, markComplete, removeItem, addTask, listTasks, claim, reassign };

/**
 * createHouseholdService — the existing `household` ops callable via the standard callSkill shape, now backed
 * by the per-circle store. Additive: routes `callSkill('household', op, args, {circleId, by})` to the ops.
 * No-pod default = in-memory; a real boot injects a persistent/sealed DataSource. Retires the legacy agent
 * once this is the live path.
 */
export function createHouseholdService({ dataSource, registry, manifest = householdManifest, dataSourceFor } = {}) {
  // `dataSourceFor(circleId)` (cache-mode mirroring): a pod-backed circle may run over its OWN medium (a
  // cache-mode PseudoPod write-throughing to the pod) instead of the shared local backing. Absent → shared.
  // DECLARATION LAYER (#34) — the manifest's declared per-op field policies are injected DOWN into the per-circle
  // stores' resolution registry (invariant 5: app declares INTO the substrate). Layered over the safe default
  // floor, so the inbound merge dispatch enforces (task,assignee)→claim / (task,text)→content by declaration.
  const resolution = resolutionRegistryFromManifests(manifest);
  const stores = createCircleStores({ dataSource: dataSource || memoryDataSource(), registry: registry || householdRegistry(), resolution, dataSourceFor });
  const service = {
    async callSkill(op, args = {}, ctx = {}) {
      const circleId = ctx.circleId ?? args.circleId;
      if (!circleId) throw new Error('householdService.callSkill: a circleId is required (scope)');
      const fn = OPS[op];
      if (!fn) throw new Error(`householdService.callSkill: unknown op "${op}"`);
      return fn(stores.getStore(circleId), args, ctx);
    },
    /**
     * callCapability — the §1b atom-dispatch entry (PLAN-capability-arc §1b): invoke a capability by
     * `(atom × noun)` instead of a bespoke op-id. A caller that speaks the standard vocabulary (the LLM
     * interpreter, a recipe, a gate-driven affordance) says `('add','shopping')` without knowing `addItem`.
     *
     * Additive + bespoke-first: `dispatchCapability` routes to the app's own op when one implements the
     * pair (identical to `callSkill(opId,…)`), and ONLY falls back to the generic store-backed CRUD when
     * the manifest merely DECLARES the noun's atom with no op — so a new list-type declared in the
     * `household` manifest is operable immediately ("declare a noun → get CRUD free"), with zero handler
     * code. The bespoke `callSkill` path above is untouched (byte-identical for existing callers).
     */
    async callCapability(atom, noun, args = {}, ctx = {}) {
      const circleId = ctx.circleId ?? args.circleId;
      if (!circleId) throw new Error('householdService.callCapability: a circleId is required (scope)');
      const store = stores.getStore(circleId);
      // The noun IS the item type in household's model; make it explicit for the bespoke-op path
      // (addItem reads args.type) — the generic path overrides type with the noun regardless.
      const withType = args?.type == null ? { ...args, type: noun } : args;
      return dispatchCapability(
        manifest,
        { atom, noun, args: withType },
        { dispatch: (opId, a) => service.callSkill(opId, a, ctx), generic: createGenericAtomHandlers(store), ctx },
      );
    },
    stores,
  };
  return service;
}
