/**
 * containerOps — the COMPOSABLE-OP engine over a `CircleItemStore` + `containment`.
 *
 * Two pieces:
 *   1. `addChildTo` — the primitive: create a typed child *inside* a container (put it in the same circle
 *      store, then -`contain` it = ref + back-ref). "add ‹childType› to ‹container›".
 *   2. `resolveContainerAdd` — the K0-deferred NATURAL-VERB resolution: a bare "add X" in a container picks
 *      WHICH child type to create from the container type's declared `accepts` policy (a list → a list-item
 *      or a task; a task → a subtask). Pure; the dispatch layer feeds it the active container + its policy.
 *
 * The `accepts` policy is declared by the container TYPE (in its manifest, later — the surfacing step); here
 * it's injected, so the engine is pure + testable and identical web≡mobile.
 */
import { contain } from './containment.js';

/**
 * Create a typed child item inside `containerId` and contain it. The child lives in the SAME circle store
 * (inherits the circle's scope seal —: containment never crosses stores by copy). Returns the new child.
 *
 * @param {object} store           a CircleItemStore (get/put/delete/list)
 * @param {string} containerId
 * @param {object} childItem       `{ type, … }` — validated + id-assigned by the store on `put`
 * @returns {Promise<object>} the stored child (with its id + `containedBy:[containerId]`)
 */
export async function addChildTo(store, containerId, childItem) {
  if (!childItem || typeof childItem.type !== 'string' || !childItem.type) {
    throw new Error('addChildTo: childItem.type is required');
  }
  const container = await store.get(containerId);
  if (!container) throw new Error(`addChildTo: container "${containerId}" not found`);
  const child = await store.put({ ...childItem });        // store validates the type + assigns the id
  await contain(store, containerId, child.id);            // ref + back-ref
  return await store.get(child.id);                       // re-read so the returned child carries containedBy
}

/**
 * Resolve a bare "add X" inside a container to ONE child `{ type, op }`, from the container type's `accepts`.
 * Precedence: an explicit `hint` (the user named the type) › a single accepted type › a `default:true` ›
 * else `{ ambiguous:[…] }` (the caller asks which). Returns `null` when the container accepts nothing
 * (i.e. not composable here → fall back to the normal add).
 *
 * @param {object} args
 * @param {Array<{type:string, op:string, default?:boolean}>} args.accepts  the container type's accept-list
 * @param {string} [args.hint]  an explicitly-named child type (e.g. parsed from "add a TASK …")
 * @returns {{type:string, op:string} | {ambiguous:Array<{type:string,op:string}>} | null}
 */
export function resolveContainerAdd({ accepts, hint } = {}) {
  const list = (Array.isArray(accepts) ? accepts : []).filter((a) => a && a.type && a.op);
  if (list.length === 0) return null;
  if (hint) {
    const named = list.find((a) => a.type === hint);
    if (named) return { type: named.type, op: named.op };
  }
  if (list.length === 1) return { type: list[0].type, op: list[0].op };
  const def = list.find((a) => a.default);
  if (def) return { type: def.type, op: def.op };
  return { ambiguous: list.map((a) => ({ type: a.type, op: a.op })) };
}

/**
 * buildAcceptsPolicy — assemble the container-`accepts` policy from manifests (the SURFACING contract).
 *
 * Each manifest declares `accepts: { <containerType>: [{ type, op, default? }, …] }` — "a function in this
 * app can add child items of these types to a container of this type". Manifests MERGE per container type
 * (concatenated, deduped by child type, first-declarer wins on collision) — so each app independently
 * extends what a container accepts (the dissolve-friendly, composable extensibility: the tasks app declares
 * "a list accepts tasks", a notes app declares "a list accepts notes", without either knowing the other).
 *
 * @param {Array<{accepts?:object}>} manifests
 * @returns {{ acceptsFor: (containerType:string) => Array<{type:string,op:string,default?:boolean}> }}
 */
export function buildAcceptsPolicy(manifests) {
  const byContainer = new Map();   // containerType → [{type, op, default}]
  for (const m of (Array.isArray(manifests) ? manifests : [])) {
    const decl = m && m.accepts;
    if (!decl || typeof decl !== 'object') continue;
    for (const [containerType, entries] of Object.entries(decl)) {
      const cur = byContainer.get(containerType) || [];
      for (const e of (Array.isArray(entries) ? entries : [])) {
        if (!e || !e.type || !e.op) continue;
        if (cur.some((x) => x.type === e.type)) continue;     // first declarer of a child type wins
        cur.push({ type: e.type, op: e.op, ...(e.default ? { default: true } : {}) });
      }
      byContainer.set(containerType, cur);
    }
  }
  return { acceptsFor: (containerType) => byContainer.get(containerType) || [] };
}

/** Strip a leading child-TYPE word from an "add X" body when it names an accepted type. */
function parseTypeHint(body, accepts) {
  const m = String(body || '').trim().match(/^(\S+)\s+(.*)$/);
  if (m) {
    const word = m[1].toLowerCase();
    if (accepts.some((a) => a.type === word)) return { hint: word, rest: m[2] };
  }
  return { hint: undefined, rest: body };
}

/**
 * resolveAddInContainer — the DISPATCH bridge (surfacing). Given the ACTIVE container item,
 * the accepts-policy, and the raw "add X" body, resolve a bare "add" to the child-creating op — the
 * K0-deferred natural-verb context resolution made dispatchable.
 *   - `{ op, type, body }`        → run that op to create the child (the body has the type word stripped)
 *   - `{ ambiguous:[{type,op}…] }`→ ask the user which child type
 *   - `null`                      → the container accepts nothing (not composable here → normal add)
 *
 * @param {object} args
 * @param {{type:string, defaultChild?:string}} args.container  the active container item (its own default child, if any)
 * @param {(containerType:string)=>Array} args.acceptsFor  from `buildAcceptsPolicy`
 * @param {string} [args.body]                   the "add X" text
 */
export function resolveAddInContainer({ container, acceptsFor, body = '' } = {}) {
  if (!container || typeof container.type !== 'string') return null;
  const accepts = (typeof acceptsFor === 'function' ? acceptsFor(container.type) : acceptsFor) || [];
  if (!accepts.length) return null;
  const { hint, rest } = parseTypeHint(body, accepts);
  // No kind named: the container's OWN default child (a chores list makes tasks), else its type's default. A
  // `defaultChild` the type does not accept matches nothing in `accepts`, so it cannot widen what is allowed.
  const r = resolveContainerAdd({ accepts, hint: hint ?? (typeof container.defaultChild === 'string' ? container.defaultChild : undefined) });
  if (!r) return null;
  if (r.ambiguous) return r;
  return { op: r.op, type: r.type, body: rest };
}
