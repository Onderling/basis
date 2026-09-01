/**
 * circleLists — the composable LISTS feature over the substrate (the container UI).
 *
 * A `list` CONTAINER whose entries are `list-item` CHILDREN (containment), and — since the child type is
 * now POLICY-DRIVEN (`buildAcceptsPolicy` + `resolveAddInContainer`, not a hardcoded `list`→`list-item`) — a
 * `list-item` is itself a container that accepts SUB-items: the offer→list→tasks→subtasks nesting made real.
 * One per-circle `CircleItemStore`; the panel (web `openListsPanel` / RN `CircleListsScreen`) renders a list
 * via `projectContainer` + the per-platform container card. PERSISTENT (web IDB / mobile AsyncStorage); the
 * `accepts` policy is the SURFACING contract other apps extend (a notes app could declare "a list accepts
 * notes" without this module knowing). web≡mobile: both shells reuse this module.
 */
import {
  createCircleStores, memoryDataSource, addChildTo, projectContainer,
  buildAcceptsPolicy, resolveAddInContainer,
} from '@onderling/item-store';
import { createRegistry, registerCanonicalTypes } from '@onderling/item-types';
import { TASKS_ACCEPTS_MANIFEST } from './tasksInLists.js';

// Re-export so a shell importing from circleLists gets the tasks-in-lists declaration alongside the module.
export { TASKS_ACCEPTS_MANIFEST } from './tasksInLists.js';

// The three container schemas are CANONICAL types now (`@onderling/item-types`), not this module's own.
// They had to be: a type the circle's shared store must hold is a shared noun, and registering them on a
// private registry is what gave lists a second store per circle — the thing the architecture calls a
// defect ("two stores for one circle is a defect, not a design").

/**
 * The lists feature's manifest-style `accepts` declaration (surfacing): a `list` CONTAINS
 * `list-item`s; a `list-item` CONTAINS sub-items (the composable nesting). `buildAcceptsPolicy` merges this
 * with any other apps' declarations, so what a container accepts is EXTENSIBLE, not baked into this module.
 */
export const LISTS_ACCEPTS_MANIFEST = Object.freeze({
  app: 'lists',
  accepts: {
    list:        [{ type: 'list-item', op: 'addItem', default: true }],
    'list-item': [{ type: 'list-item', op: 'addItem', default: true }],   // sub-items → arbitrary nesting
    // A board accepts an item OR a sub-list, NO default → the ambiguous case (the type picker fires).
    board:       [{ type: 'list-item', op: 'addItem' }, { type: 'list', op: 'addItem' }],
  },
});

/**
 * A self-contained lists service: per-circle store + policy-driven create/add/complete/remove + render tree.
 *
 * `rootPrefix` (optional) is the logical root the per-circle stores namespace under. It's the seam for the
 * L1b pod tier: pass `podGroupPrefix(podRoot)` (`<podRoot>/group/`) alongside a sealed pod DataSource so the
 * store's physical keys BE the canonical `resourceUriFor` pod URIs (`<podRoot>/group/<circleId>/items/<id>.json`).
 * Omitted → `createCircleStores`' `mem://circles/` default (the no-pod memory/IDB path).
 */
export function makeCircleLists({ storeFor, dataSource, manifests, rootPrefix } = {}) {
  // WHICH STORE. A composition that has one — every production shell — passes `storeFor`, the circle's
  // own `CircleItemStore`, and lists then live where every other item lives: one store per circle, on the
  // one fan-out path, obeying the circle's data-move branch (fan-out · pod-signal · pod-only · ref+blob)
  // like a task or a message. That is the whole sharing story, and it is not this module's to invent.
  //
  // `dataSource` stays for tests and for a composition with no circle stores: it builds a private
  // registry + stores exactly as before. It is the fallback, not the path.
  const own = storeFor ? null : (() => {
    const registry = createRegistry();
    registerCanonicalTypes(registry);   // the container types are canonical now — no private registration
    return createCircleStores({ dataSource: dataSource || memoryDataSource(), registry, rootPrefix });
  })();
  const s = (circleId) => {
    if (!storeFor) return own.getStore(circleId);
    const store = storeFor(circleId);
    // A composition that promised a store and cannot produce one is a wiring fault, and it must SAY so:
    // silently falling back to a private store is how this feature came to have two of them.
    if (!store) throw new Error(`circleLists: no store for circle "${circleId}" — the composition wired storeFor but it returned nothing`);
    return store;
  };
  const CONTAINER_TYPES = ['list', 'board'];   // heterogeneous containers rendered by the panel (no row-actions)

  // The accepts policy: the lists declaration + the tasks-in-lists declaration (a list/list-item ALSO accepts
  // a `task` child — the nesting made real) + any injected extras (other apps extending what a list holds).
  // Order matters: LISTS first so `list-item` stays the DEFAULT child; TASKS adds `task` as a non-default
  // alternative the picker offers. (buildAcceptsPolicy is first-declarer-per-child-type wins.)
  const policy = buildAcceptsPolicy([
    LISTS_ACCEPTS_MANIFEST, TASKS_ACCEPTS_MANIFEST, ...(Array.isArray(manifests) ? manifests : []),
  ]);

  // Render shape per type — a node can-add iff its type accepts ≥1 child type (policy-driven, not hardcoded).
  const renderFor = (item) => {
    const canAdd = policy.acceptsFor(item.type).length > 0;
    if (CONTAINER_TYPES.includes(item.type)) return { label: item.text, canAdd };   // list/board = container, no row-actions
    const done = item.completedAt != null;
    return {
      label: `${done ? '✓ ' : ''}${item.text}`,
      rowActions: done ? ['removeItem'] : ['markComplete', 'removeItem'],
      canAdd,
    };
  };

  return {
    // The per-circle store registry, exposed so the app-level cross-circle SHARE op (`circleShare.js`)
    // threads shareIntoAudience / resolveSharedRef through the SAME stores this service persists to.
    // With `storeFor` injected there is no registry of our own to hand out — the caller already holds
    // the circle's stores, which is the point — so this is the private-registry case only.
    stores: own,
    /** The circle's store, however this service was composed. One place that answers "which store". */
    storeFor: s,
    createList:  (circleId, text, by) => s(circleId).put({ type: 'list', text }, { by }),
    createBoard: (circleId, text, by) => s(circleId).put({ type: 'board', text }, { by }),   // multi-type container
    /**
     * Add a child to a container — the child TYPE is resolved from the container type's `accepts` (not fixed).
     * `opts.hint` names a specific accepted child type (e.g. a UI picker for an ambiguous container). Returns
     * the created child, or null when the container isn't found / accepts nothing / the type is ambiguous.
     */
    async addItem(circleId, containerId, text, by, { hint } = {}) {
      const store = s(circleId);
      const container = await store.get(containerId);
      if (!container) return null;
      const r = resolveAddInContainer({ container, acceptsFor: policy.acceptsFor, body: hint ? `${hint} ${text}` : text });
      if (!r) return null;                                  // container accepts nothing
      if (r.ambiguous) return { ambiguous: r.ambiguous };  // ≥2 accepted types, no default → the shell shows a type
                                                           // picker, then re-calls addItem(…, { hint: <chosen type> })
      const childText = (r.body && r.body.trim()) ? r.body.trim() : text;
      return addChildTo(store, containerId, { type: r.type, text: childText, completedAt: null, createdBy: by });
    },
    async markDone(circleId, itemId, by) {
      const it = await s(circleId).get(itemId);
      return it ? s(circleId).put({ ...it, completedAt: Date.now() }, { by }) : null;
    },
    remove:    (circleId, itemId) => s(circleId).delete(itemId),
    listLists: (circleId) => s(circleId).listByType('list'),
    /** Every top-level CONTAINER in the circle (lists + boards), each tagged with its `type`. */
    async listContainers(circleId) {
      const all = await s(circleId).list();
      return all.filter((i) => CONTAINER_TYPES.includes(i.type));
    },
    tree:      (circleId, listId) => projectContainer(s(circleId), listId, { renderFor }),
    /** The accepted child kinds for a container type, and whether the choice is AMBIGUOUS (≥2, no default). */
    addKinds(containerType) {
      const kinds = policy.acceptsFor(containerType);
      return { kinds, ambiguous: kinds.length > 1 && !kinds.some((k) => k.default) };
    },
    acceptsFor: policy.acceptsFor,   // exposed so a shell can offer a type picker when a container is ambiguous
  };
}
