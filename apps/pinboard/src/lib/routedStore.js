/**
 * Pinboard's store when a host hands it the circles' own stores: a POST lives in its circle's store (the one store a
 * circle owns, the one its members sync), everything else stays in pinboard's own pile until it has a home of its own.
 *
 * The skills keep the task-store verbs they always called (listOpen · addItems · getById · update · claim ·
 * markComplete · removeItems · ingestItems); this decides where each one lands. A post names its circle by `groupId`;
 * one that names none goes to each of its author's circles under the same id, as the noticeboard always carried it.
 * Reads take the union over every circle on this device and keep the first row per id: the skills filter by circle
 * themselves.
 */
import { createTaskStore, ulid } from '@onderling/item-store';
import { isNoticeboardPostType, NOTICEBOARD_POST_TYPES } from '@onderling/item-types';
import { isLaneCarriedItem } from '@onderling/circles';

// What a circle holds of pinboard's rows: the noticeboard POSTS, and the rows that are this device's own VIEW of the
// circle, each carried by its own lane, never by the store's generic one — the ROSTER TRAIL (a member's admission and
// proven addresses: the membership lane) and the RULES HEAD (the rules lane's admin-checked rules-update).
const LOCAL_TYPES = Object.freeze(['membership-redemption', 'group-rules']);
const CIRCLE_TYPES = Object.freeze([...NOTICEBOARD_POST_TYPES, ...LOCAL_TYPES]);
// What is the person's own, not the circle's: the invite code (the admin's secret, no circle member may hold it) and who
// answered my post. With a host own store they live there, written as the self the person is in that circle (the
// actor, for the answers), so each rides that self's own-devices lane only.
const OWN_TYPES = Object.freeze(['membership-code', 'post-answers']);

// where a pinboard row names its circle (the same reading the skills' `itemCircleOf` does)
const circleOf = (it) => it?.source?.groupId
  ?? (Array.isArray(it?.source?.targets) ? it.source.targets.find((t) => t?.kind === 'group' && typeof t.groupId === 'string')?.groupId : null)
  ?? (typeof it?.groupId === 'string' && it.groupId ? it.groupId : null);

/** The circle store needs the canonical base fields and a `body`; pinboard writes `text`. */
function asCirclePost(item, from) {
  const createdAt = typeof item.createdAt === 'string' ? item.createdAt
    : (typeof item.addedAt === 'number' ? new Date(item.addedAt).toISOString() : new Date().toISOString());
  return {
    ...item,
    body:      typeof item.body === 'string' && item.body ? item.body : (item.text ?? ''),
    createdAt,
    createdBy: typeof item.createdBy === 'string' && item.createdBy ? item.createdBy : from,
    source:    { ...(item.source ?? {}), from: item.source?.from ?? from },
  };
}

/** A trail row in a circle store: its own fields, with the base the store's registry requires. */
function asCircleRow(item, from) {
  const createdAt = typeof item.createdAt === 'string' ? item.createdAt
    : (typeof item.addedAt === 'number' ? new Date(item.addedAt).toISOString() : new Date().toISOString());
  return { ...item, createdAt, createdBy: typeof item.createdBy === 'string' && item.createdBy ? item.createdBy : from };
}

/**
 * @param {object} a
 * @param {object} a.pile                               pinboard's own task store (what is not a post)
 * @param {object} a.hostCircles                        the host's circles:
 * @param {(circleId: string, o: {write: boolean}) => object|null|Promise<object|null>} a.hostCircles.storeFor  the circle's
 *                                                  own CircleItemStore; on a read only if it is open (null otherwise)
 * @param {(actor: string|null) => Promise<string[]>|string[]} a.hostCircles.circlesOf  the circles an actor is in (where a
 *                                                  post that names no circle goes)
 * @param {() => string[]} [a.hostCircles.openCircles]  the circles whose store is open on this device: what a READ looks
 *                                                  at (a read never opens one, so nothing else can hold a post)
 * @param {(circleId: string, actor: string|null) => string|null} [a.hostCircles.writerIn]  who writes in that circle (the
 *                                                  self this device is there: a persona in a persona's circle)
 * @param {() => object|Promise<object>} [a.hostCircles.ownStore]  the host's own-devices store (a CircleItemStore):
 *                                                  where the admin's own rows (OWN_TYPES) live
 * @param {string|null} [a.homeCircle]                 pinboard's own home group (where a post goes when no circle is
 *                                                  active): always read, though no membership names it
 * @param {(item: object) => boolean} [a.isPost]       which rows are posts (the canonical post types)
 */
/**
 * Pinboard's rows in one circle store, through its type index: a read never scans the circle's tasks, lists or chat —
 * only the post and trail types. Writes and single reads go to the store itself.
 */
export function circleRowsView(cs, types = CIRCLE_TYPES) {
  return {
    list:   async () => (await Promise.all(types.map((t) => cs.listByType(t)))).flat(),
    get:    (id, ...r) => cs.get(id, ...r),
    put:    (item, ...r) => cs.put(item, ...r),
    // the lifecycle verbs' compare-and-set (claim, approve): a claim on a post is a race between members
    putIfMatch: (item, ...r) => cs.putIfMatch(item, ...r),
    delete: (id, ...r) => cs.delete(id, ...r),
  };
}
/** Could a read with this filter return a circle row? A filter on another type cannot: the circles are not asked. */
const mayBeInCircles = (filter) => !filter?.type || CIRCLE_TYPES.includes(filter.type);
const mayBeOwn = (filter) => !filter?.type || OWN_TYPES.includes(filter.type);

export function createRoutedStore({ pile, hostCircles, homeCircle = null, isPost = isNoticeboardPostType }) {
  // a trail row names its circle always; one that does not stays where it was written
  const isCircleRow = (it) => isPost(it) || (isLaneCarriedItem(it) && !!circleOf(it));
  const { storeFor: circleStoreFor, circlesOf: knownCircles, openCircles = null, heldCircles = null, peekFor = null, localStoreFor = null, writerIn = (_c, actor) => actor, ownStore: ownStoreFor = null } = hostCircles ?? {};
  if (!pile || typeof circleStoreFor !== 'function' || typeof knownCircles !== 'function') {
    throw new Error('createRoutedStore: pile and hostCircles { storeFor, circlesOf } are required');
  }
  const taskStores = new Map();
  // the admin's own rows, on the host's own store (absent → they stay in the pile, as before)
  const isOwnRow = (it) => typeof ownStoreFor === 'function' && OWN_TYPES.includes(it?.type);
  let ownTask = null;
  const ownTaskStore = async () => {
    if (typeof ownStoreFor !== 'function') return null;
    if (!ownTask) {
      const st = await Promise.resolve(ownStoreFor()).catch(() => null);
      if (!st) return null;
      ownTask = { raw: st, tasks: createTaskStore(circleRowsView(st, OWN_TYPES)) };
    }
    return ownTask;
  };
  // THE TRAIL AND THE RULES HEAD ARE THIS DEVICE'S OWN VIEW (rosterTrail.js: every device holds its own row for each
  // member, patched by announce; and the rules at the version it last applied), so when the host keeps them apart
  // (`localStoreFor`: the circle's root on the device's local backing) they never sit on a medium other devices write
  // too — a pod-backed circle's pod is every member's. The circle's own store then holds its posts only.
  const keepLocalApart = typeof localStoreFor === 'function';
  const SHARED_TYPES = keepLocalApart ? NOTICEBOARD_POST_TYPES : CIRCLE_TYPES;
  const localStores = new Map();
  const localStoreOf = async (circleId) => {
    if (!keepLocalApart) return null;
    if (!localStores.has(circleId)) {
      const cs = await Promise.resolve(localStoreFor(circleId)).catch(() => null);
      if (!cs) return null;
      localStores.set(circleId, createTaskStore(circleRowsView(cs, LOCAL_TYPES)));
    }
    return localStores.get(circleId);
  };
  // the host may open a circle on first ask (its sync wired before anything is written), so this awaits
  // a READ takes the circle's store only if the host has it open; it never opens one (opening wires the circle's sync,
  // which a join does in its own order). A write opens it (`{ write: true }`).
  const taskStoreOf = async (circleId) => {
    if (!taskStores.has(circleId)) {
      const cs = await Promise.resolve(circleStoreFor(circleId, { write: false })).catch(() => null);
      if (!cs) return null;   // not open yet: asked again next time
      taskStores.set(circleId, createTaskStore(circleRowsView(cs, SHARED_TYPES)));
    }
    return taskStores.get(circleId);
  };
  // A circle that holds rows here but is not open yet (after a restart, before its sync is wired) is READ through the
  // host's peek — not cached, and refusing writes: a write opens the circle (`writeStoreOf`).
  const refuse = () => { throw new Error('routedStore: a peeked circle is read-only — a write opens the circle'); };
  const readStoreOf = async (circleId) => {
    const open = await taskStoreOf(circleId);
    if (open || typeof peekFor !== 'function') return open;
    const cs = await Promise.resolve(peekFor(circleId)).catch(() => null);
    return cs ? createTaskStore({ ...circleRowsView(cs, SHARED_TYPES), put: refuse, putIfMatch: refuse, delete: refuse }) : null;
  };
  const writeStoreOf = async (circleId) => {
    const open = await taskStoreOf(circleId);
    if (open) return open;
    const cs = await Promise.resolve(circleStoreFor(circleId, { write: true })).catch(() => null);
    if (!cs) return null;
    taskStores.set(circleId, createTaskStore(circleRowsView(cs, SHARED_TYPES)));
    return taskStores.get(circleId);
  };
  // the circles that hold rows here, listed once a run (a listing of the backing): what opens later is in `openCircles`.
  // Only circles on the SHARED local backing are listed: a circle on its own backing (a pod-backed circle) is read once open.
  let held = null;
  const heldHere = async () => {
    if (typeof heldCircles !== 'function') return [];
    if (!held) held = Promise.resolve(heldCircles()).then((ids) => ids ?? []).catch(() => { held = null; return []; });
    return held;
  };
  // the circles a row was put in by this store (this run), read beside the memberships: a post may name a circle no
  // membership lists yet (the home group, a circle being joined), and a trail row lands without opening its circle
  const written = new Set(homeCircle ? [homeCircle] : []);
  const circlesFor = async (filter, actor = null) => {
    const one = typeof filter?.groupId === 'string' && filter.groupId ? filter.groupId : null;
    if (one) return [one];
    if (actor) return [...new Set((await knownCircles(actor)) ?? [])];
    // a read: the circles open here (cheap, and complete: a post is only ever in an open store) — else the memberships
    const open = typeof openCircles === 'function' ? openCircles() : await knownCircles(null);
    return [...new Set([...(open ?? []), ...(await heldHere()), ...written])];
  };
  const unionById = (lists) => {
    const seen = new Set(); const out = [];
    for (const list of lists) for (const it of list ?? []) { if (it?.id && !seen.has(it.id)) { seen.add(it.id); out.push(it); } }
    return out;
  };
  /** The circle stores that hold this id (a post may sit in several of the author's circles under one id). */
  const circleHolders = async (id) => {
    const out = [];
    const own = await ownTaskStore();
    if (own && await own.tasks.getById(id).catch(() => null)) return [own.tasks];
    for (const c of await circlesFor(null)) {
      const tr = await localStoreOf(c);
      if (tr && await tr.getById(id).catch(() => null)) { out.push(tr); continue; }
      const ts = await readStoreOf(c);
      if (!ts || !(await ts.getById(id).catch(() => null))) continue;
      const w = await writeStoreOf(c);
      if (w) out.push(w);
    }
    return out;
  };
  // THE POSTER'S OWN KNOWLEDGE — who answered my post (`source.responders`, recorded from 1:1 answers) — is never put on
  // the circle's store, which syncs to every member and would tell them all who answered. It is a `post-answers` row per
  // post on the person's own store (the pile when the host hands none), folded back into the post on every read of it.
  const PRIVATE_SOURCE = ['responders'];
  const ANSWERS = 'post-answers';
  const answersStore = async () => (await ownTaskStore())?.tasks ?? pile;
  const answersRowOf = async (itemId) => ((await (await answersStore()).listOpen({ type: ANSWERS })) ?? []).find((r) => r?.source?.itemId === itemId) ?? null;
  const keepPrivate = async (itemId, priv, ctx) => {
    const st = await answersStore();
    const row = await answersRowOf(itemId);
    if (row) return st.update(row.id, { source: { ...row.source, ...priv } }, ctx);
    return st.addItems([{ type: ANSWERS, text: 'post-answers', source: { itemId, ...priv } }], ctx);
  };
  const withPrivate = async (rows) => {
    const posts = rows.filter((r) => isPost(r));
    if (posts.length === 0) return rows;
    const byItem = new Map(((await (await answersStore()).listOpen({ type: ANSWERS })) ?? []).map((r) => [r?.source?.itemId, r.source]));
    return rows.map((r) => {
      const priv = isPost(r) ? byItem.get(r.id) : null;
      if (!priv) return r;
      const extra = Object.fromEntries(PRIVATE_SOURCE.filter((k) => priv[k] !== undefined).map((k) => [k, priv[k]]));
      return { ...r, source: { ...(r.source ?? {}), ...extra } };
    });
  };
  /** Split a patch for a circle post: what may sync, and what stays with the poster. */
  const splitPatch = (patch) => {
    const src = patch?.source;
    if (!src || typeof src !== 'object') return { shared: patch, priv: null };
    const priv = Object.fromEntries(PRIVATE_SOURCE.filter((k) => src[k] !== undefined).map((k) => [k, src[k]]));
    if (Object.keys(priv).length === 0) return { shared: patch, priv: null };
    const rest = Object.fromEntries(Object.entries(src).filter(([k]) => !PRIVATE_SOURCE.includes(k)));
    return { shared: { ...patch, source: rest }, priv };
  };

  const read = (verb) => async (filter) => {
    // the pile's rows as they are: what is not a post, and a post no circle could hold (a device with no circle yet)
    const lists = [(await pile[verb](filter)) ?? []];
    const own = mayBeOwn(filter) ? await ownTaskStore() : null;
    if (own) lists.push(((await own.tasks[verb](filter)) ?? []).filter((it) => OWN_TYPES.includes(it?.type)));
    if (!mayBeInCircles(filter)) return unionById(lists).filter((r) => r?.type !== ANSWERS);
    for (const c of await circlesFor(filter)) {
      for (const ts of [await readStoreOf(c), await localStoreOf(c)]) {
        if (ts) lists.push(((await ts[verb](filter)) ?? []).filter((it) => isCircleRow(it)));
      }
    }
    // the answers row is this device's own bookkeeping, not an item a reader lists
    return withPrivate(unionById(lists).filter((r) => r?.type !== ANSWERS));
  };
  const notFound = (err) => err?.name === 'ItemNotFoundError' || err?.code === 'ITEM_NOT_FOUND' || /not found/i.test(String(err?.message ?? ''));
  /**
   * A write goes to the pile FIRST and as it always did — no lookup ahead of it, so a pile row's read-modify-write keeps
   * its timing exactly. Only an id the pile does not hold is a post, and is written in each circle that holds it.
   */
  const onEach = (verb) => async (id, ...rest) => {
    try { return await pile[verb](id, ...rest); }
    catch (err) {
      if (!notFound(err)) throw err;
      const hs = await circleHolders(id);
      if (hs.length === 0) throw err;
      let args = rest;
      if (verb === 'update') {
        const [patch, ctx] = rest;
        const { shared, priv } = splitPatch(patch);
        if (priv) {
          // kept as the self this device is in the post's circle: who answered a persona's post is the persona's to know
          const post = await hs[0].getById(id).catch(() => null);
          const c = circleOf(post);
          await keepPrivate(id, priv, { ...(ctx ?? {}), actor: (c ? writerIn(c, ctx?.actor ?? null) : null) ?? ctx?.actor ?? null });
        }
        args = [shared, ctx];
      }
      let first;
      for (const st of hs) { const r = await st[verb](id, ...args); if (first === undefined) first = r; }
      return verb === 'update' ? (await withPrivate([first]))[0] : first;
    }
  };
  /** markComplete / removeItems take refs: each ref to the pile when it holds the id, else to the circles that do. */
  const onRefs = (verb) => async (refs, ctx) => {
    const list = Array.isArray(refs) ? refs : [refs];
    const out = [];
    for (const ref of list) {
      const id = typeof ref === 'string' ? ref : ref?.id;
      const inPile = id ? !!(await pile.getById(id).catch(() => null)) : true;
      const targets = inPile ? [pile] : await circleHolders(id);
      let first = null;
      for (const st of (targets.length ? targets : [pile])) { const r = await st[verb]([ref], ctx); if (first === null) first = r; }
      out.push(...(first ?? []));
    }
    return out;
  };

  return {
    listOpen:   read('listOpen'),
    listClosed: read('listClosed'),
    getById: async (id) => {
      const hit = await pile.getById(id).catch(() => null);
      if (hit) return hit;
      const own = await ownTaskStore();
      const mine = own ? await own.tasks.getById(id).catch(() => null) : null;
      if (mine) return mine;
      for (const c of await circlesFor(null)) {
        for (const ts of [await localStoreOf(c), await readStoreOf(c)]) {
          const row = ts ? await ts.getById(id).catch(() => null) : null;
          if (row) return (await withPrivate([row]))[0];
        }
      }
      return null;
    },
    addItems: async (partials, ctx = {}) => {
      const created = [];
      for (const p of partials ?? []) {
        if (isOwnRow(p)) {
          const own = await ownTaskStore();
          if (own) {
            const actor = ctx?.actor ?? p.addedBy ?? null;
            const by = (circleOf(p) ? writerIn(circleOf(p), actor) : null) ?? actor;
            const id = (typeof p.id === 'string' && p.id) ? p.id : ulid();
            const row = await own.raw.put({ ...asCircleRow(p, by), id, addedBy: p.addedBy ?? by, addedAt: p.addedAt ?? Date.now() }, { by });
            try { pile.emit?.('item-added', row); } catch { /* a listener never breaks a write */ }
            created.push(row);
            continue;
          }
        }
        if (!isCircleRow(p)) { created.push(...((await pile.addItems([p], ctx)) ?? [])); continue; }
        const actor = ctx?.actor ?? p.addedBy ?? null;
        const circles = circleOf(p) ? [circleOf(p)] : await circlesFor(null, actor);
        // the circle store's own put, as the noticeboard carry wrote it: the task store's add keeps a fixed field set
        // (no `body`, no tags) and the store's registry requires the post's own fields
        const id = (typeof p.id === 'string' && p.id) ? p.id : ulid();
        let first = null;
        for (const c of circles) {
          const cs = (keepLocalApart && isLaneCarriedItem(p))
            ? await Promise.resolve(localStoreFor(c)).catch(() => null)
            : await Promise.resolve(circleStoreFor(c, { write: true })).catch(() => null);
          if (!cs) continue;
          const by = writerIn(c, actor) ?? actor;
          const shaped = isPost(p) ? asCirclePost(p, by) : asCircleRow(p, by);
          const body = { ...shaped, id, addedBy: p.addedBy ?? by, addedAt: p.addedAt ?? Date.now() };
          const row = await cs.put(body, { by });
          written.add(c);
          if (row && !first) first = row;
        }
        if (first) { try { pile.emit?.('item-added', first); } catch { /* a listener never breaks a write */ } }
        // a post nobody's circle can hold stays where it was written, as before (a device with no circle yet)
        if (!first) { created.push(...((await pile.addItems([p], ctx)) ?? [])); continue; }
        created.push(first);
      }
      return created;
    },
    // an ingest (the roster seed between a person's own devices) puts each trail row in its circle's store, the rest
    // in the pile; what landed is said on the store's own event, as the pile's ingest says it
    ingestItems: async (items, ctx) => {
      const list = Array.isArray(items) ? items : [];
      const toPile = list.filter((it) => !isCircleRow(it));
      const out = { ingested: [], skipped: [] };
      if (toPile.length) { const r = (await pile.ingestItems(toPile, ctx)) ?? {}; out.ingested.push(...(r.ingested ?? [])); out.skipped.push(...(r.skipped ?? [])); }
      for (const it of list.filter((x) => isCircleRow(x))) {
        const ts = keepLocalApart ? await localStoreOf(circleOf(it))
          : await (async () => { const cs = await Promise.resolve(circleStoreFor(circleOf(it), { write: true })).catch(() => null); return cs ? createTaskStore(circleRowsView(cs, SHARED_TYPES)) : null; })();
        if (!ts) { const r = (await pile.ingestItems([it], ctx)) ?? {}; out.ingested.push(...(r.ingested ?? [])); out.skipped.push(...(r.skipped ?? [])); continue; }
        const r = (await ts.ingestItems([it], ctx)) ?? {};
        written.add(circleOf(it));   // read beside the open circles from now on (a seed's circle may never open here)
        out.ingested.push(...(r.ingested ?? [])); out.skipped.push(...(r.skipped ?? []));
        if ((r.ingested ?? []).length) { try { pile.emit?.('item-added', (await ts.getById(it.id)) ?? it); } catch { /* a listener never breaks an ingest */ } }
      }
      return out;
    },
    update:       onEach('update'),
    claim:        onEach('claim'),
    markComplete: onRefs('markComplete'),
    removeItems:  onRefs('removeItems'),
    on:   (...a) => pile.on?.(...a),
    off:  (...a) => pile.off?.(...a),
    once: (...a) => pile.once?.(...a),
    emit: (...a) => pile.emit?.(...a),
  };
}
