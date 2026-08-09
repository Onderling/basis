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
import { createCircleStores, memoryDataSource, createGenericAtomHandlers, resolutionRegistryFromManifests } from '@onderling/item-store';
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

const MATCH_MIN_PREFIX_LEN = 6;   // id-prefix resolution only kicks in for reasonably long inputs

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
export async function markComplete(store, { match }, { by } = {}) {
  const hits = await findOpenMatches(store, match, COMPLETABLE);
  if (hits.length === 0) return { ok: false, error: 'item not found' };
  if (hits.length > 1)   return { ok: false, ambiguous: hits };
  return { ok: true, item: await store.put({ ...hits[0], completedAt: Date.now() }, { by }) };
}
export async function removeItem(store, { match }) {
  const hits = await findOpenMatches(store, match, COMPLETABLE);
  if (hits.length === 0) return { ok: false, error: 'item not found' };
  if (hits.length > 1)   return { ok: false, ambiguous: hits };
  await store.delete(hits[0].id);
  return { ok: true, removed: hits[0].id };
}
export const addTask = (store, { text, assignee, dueAt }, { by } = {}) =>
  store.put({ type: 'task', text, completedAt: null, ...(assignee ? { assignee } : {}), ...(dueAt ? { dueAt } : {}) }, { by });
export const listTasks = async (store) => (await store.listByType('task')).filter((i) => i.completedAt == null);
export async function claim(store, { match }, { by } = {}) {
  const hits = await findOpenMatches(store, match, ['task']);
  if (hits.length === 0) return { ok: false, error: 'item not found' };
  if (hits.length > 1)   return { ok: false, ambiguous: hits };
  return { ok: true, item: await store.put({ ...hits[0], assignee: by }, { by }) };
}
export async function reassign(store, { match, assignee }, { by } = {}) {
  const hits = await findOpenMatches(store, match, ['task']);
  if (hits.length === 0) return { ok: false, error: 'item not found' };
  if (hits.length > 1)   return { ok: false, ambiguous: hits };
  return { ok: true, item: await store.put({ ...hits[0], assignee }, { by }) };
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
