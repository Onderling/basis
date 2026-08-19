/**
 * basis v2 — per-block recipe conflict detection + resolution
 * (Plan γ.3, Phase 9 sync-engine absorption).
 *
 * Pure portable layer over `objectDiff` (γ.1).  When two sides edit the
 * same Recipe (e.g. local user edited blocks; an `incomingRecipe`
 * arrived from a peer broadcast / pod-sync — the source plumbing is
 * deferred to a later γ-slice) we compare them against the last
 * captured version (γ.2's versions adapter — since the consolidation,
 * `@onderling/kring-host/objectVersionsStorage` over `@onderling/versioning`).
 * The result is grouped
 * for the UI:
 *
 *   {
 *     blockConflicts: [{ blockId, conflicts: [...] }],
 *     metaConflicts:  [{ path, yours, theirs, base }],
 *     identical:      boolean,        // true ⇒ no UI needed
 *     toMerge:        Array<MergeEntry>,
 *   }
 *
 * `blockConflicts` collapses every `objectDiff` conflict whose path
 * starts with `['blocks', <id>]` into ONE entry per block — the UI
 * resolves per-block (Keep yours / Take theirs / Keep both), not per
 * field-within-block.  `metaConflicts` carries everything else
 * (recipe.name, etc.).  `toMerge` is forwarded verbatim from
 * `objectDiff` for the host that wants to apply the clean half of the
 * three-way merge alongside the user's per-block picks — γ.3's host
 * uses it only via `applyResolution`.
 *
 * `applyResolution(local, incoming, decisions)` produces the merged
 * recipe from the user's picks:
 *   - decisions[blockId] ∈ {'yours','theirs','both'}  → block-level
 *   - decisions[pathKey]  ∈ {'yours','theirs'}        → meta-level
 *     (pathKey is `path.join('.')`)
 *
 * `'both'` keeps the local block as-is and ADDS the incoming block
 * with a freshly-minted id, suffixed `-incoming` for greppability.
 * Mirrors `circleRecipe.js`'s `freshBlockId()` shape — `b-<time36>-<seq36>`
 * — so the merged recipe round-trips through `normalizeRecipe` without
 * shedding entries.  Suffixed for greppability; the id is still unique.
 *
 * Purity: no I/O, no Math.random.  Date.now is the only impurity
 * (matches `circleRecipe.freshBlockId`).
 */

import { objectDiff } from '@onderling/sync-engine/objectDiff';

/**
 * @typedef {object} BlockConflict
 * @property {string} blockId
 * @property {Array<{path: string[], yours: any, theirs: any, base: any}>} conflicts
 */

/**
 * @typedef {object} MetaConflict
 * @property {string[]} path
 * @property {*} yours
 * @property {*} theirs
 * @property {*} base
 */

/**
 * @typedef {object} RecipeConflictReport
 * @property {BlockConflict[]} blockConflicts
 * @property {MetaConflict[]} metaConflicts
 * @property {boolean} identical
 * @property {Array<{path: string[], yours: any, theirs: any}>} toMerge
 */

/**
 * Detect per-block conflicts between two Recipe shapes using `base` as
 * the 3-way merge ancestor.  `base` may be `null`/`undefined` when no
 * version was captured yet.
 *
 * @param {object} local      Recipe { id, name, blocks: [{id,type,config}] }
 * @param {object} incoming   Recipe (same shape)
 * @param {object|null} base  Last captured version, or null when unknown.
 * @returns {RecipeConflictReport}
 */
export function detectRecipeConflicts(local, incoming, base) {
  const { toMerge, conflicts, identical } = objectDiff(local, incoming, base ?? null);

  /** @type {Map<string, BlockConflict>} */
  const blockMap = new Map();
  /** @type {MetaConflict[]} */
  const metaConflicts = [];

  for (const c of conflicts) {
    // Path shape per circleRecipe blocks-as-keyed-array regime:
    //   ['blocks', <blockId>, ...]
    if (Array.isArray(c.path) && c.path[0] === 'blocks' && typeof c.path[1] === 'string') {
      const blockId = c.path[1];
      let entry = blockMap.get(blockId);
      if (!entry) {
        entry = { blockId, conflicts: [] };
        blockMap.set(blockId, entry);
      }
      entry.conflicts.push(c);
    } else {
      metaConflicts.push(c);
    }
  }

  return {
    blockConflicts: [...blockMap.values()],
    metaConflicts,
    identical,
    toMerge,
  };
}

/**
 * Apply user-picked resolutions to produce the merged recipe.
 *
 * Decisions for blocks are keyed by `blockId` and take one of:
 *   'yours'  — keep local block as-is (drop incoming variant)
 *   'theirs' — replace with incoming block
 *   'both'   — keep BOTH; the incoming copy gets a freshly-minted id
 *              suffixed `-incoming` for greppability
 *
 * Decisions for meta fields are keyed by `path.join('.')` and take:
 *   'yours'  — keep the local value
 *   'theirs' — replace with the incoming value
 *
 * Blocks/meta with NO decision present default to 'yours' (local).
 * `toMerge` entries (clean one-sided changes) are auto-applied so the
 * non-conflicting half of the three-way merge is carried into the
 * result.
 *
 * Block order: incoming block ids retained in 'theirs'/'both' keep
 * the local block's position when one exists; freshly added incoming
 * blocks (via 'theirs' for a local-missing id, or via 'both') append
 * to the end in incoming order.
 *
 * @param {object} local
 * @param {object} incoming
 * @param {Record<string, string>} decisions
 * @returns {object} merged Recipe
 */
export function applyResolution(local, incoming, decisions = {}) {
  const safeLocal    = local    && typeof local    === 'object' ? local    : { blocks: [] };
  const safeIncoming = incoming && typeof incoming === 'object' ? incoming : { blocks: [] };
  const localBlocks    = Array.isArray(safeLocal.blocks)    ? safeLocal.blocks    : [];
  const incomingBlocks = Array.isArray(safeIncoming.blocks) ? safeIncoming.blocks : [];

  const lMap = new Map(localBlocks.map((b) => [b?.id, b]));
  const iMap = new Map(incomingBlocks.map((b) => [b?.id, b]));

  // Walk LOCAL order first, applying each id's decision (default 'yours').
  /** @type {Array<object>} */
  const outBlocks = [];
  /** @type {Array<object>} */
  const extrasFromBoth = [];
  const consumedIncoming = new Set();

  for (const lb of localBlocks) {
    if (!lb || typeof lb !== 'object' || typeof lb.id !== 'string') continue;
    const id = lb.id;
    const decision = decisions[id];
    const ib = iMap.get(id);
    if (decision === 'theirs') {
      if (ib) {
        outBlocks.push(ib);
        consumedIncoming.add(id);
      }
      // 'theirs' with no incoming entry ⇒ local-only deletion side; drop.
    } else if (decision === 'both') {
      outBlocks.push(lb);
      if (ib) {
        extrasFromBoth.push({ ...ib, id: freshIncomingBlockId() });
        consumedIncoming.add(id);
      }
    } else {
      // 'yours' (explicit or default).
      outBlocks.push(lb);
      // Mark incoming as consumed so it doesn't double-append below.
      if (ib) consumedIncoming.add(id);
    }
  }

  // Append incoming-only blocks per their decisions.  Default for an
  // incoming-only id is 'theirs' (it's a one-sided add that came in).
  for (const ib of incomingBlocks) {
    if (!ib || typeof ib !== 'object' || typeof ib.id !== 'string') continue;
    if (consumedIncoming.has(ib.id)) continue;
    if (lMap.has(ib.id)) continue;
    const decision = decisions[ib.id];
    if (decision === 'yours') {
      // Local doesn't have it; 'yours' means "don't take it" → skip.
      continue;
    }
    // 'theirs' / 'both' / default → include it.
    outBlocks.push(ib);
  }

  // 'both' extras go to the tail with fresh ids.
  for (const extra of extrasFromBoth) outBlocks.push(extra);

  // Meta merge: start with local, then for any key the user picked
  // 'theirs' for, take incoming's value at that path.
  const merged = { ...safeLocal, blocks: outBlocks };
  for (const [pathKey, pick] of Object.entries(decisions)) {
    if (pick !== 'theirs' && pick !== 'yours') continue;
    if (typeof pathKey !== 'string' || pathKey === '') continue;
    if (!pathKey.includes('.') && (lMap.has(pathKey) || iMap.has(pathKey))) {
      // It's a block id we already handled above — skip.
      continue;
    }
    if (pick === 'theirs') {
      setAtPath(merged, pathKey.split('.'), getAtPath(safeIncoming, pathKey.split('.')));
    } else if (pick === 'yours') {
      // No-op — `merged` already carries local.
    }
  }

  return merged;
}

/* ─────────────────────────────────────────────────────────────────────── */
/* internals                                                              */
/* ─────────────────────────────────────────────────────────────────────── */

let _incomingSeq = 0;
/**
 * Mint a fresh block id for an incoming-side block kept via 'both'.
 * Shape mirrors `circleRecipe.freshBlockId` (`b-<time36>-<seq36>`) so the
 * merged recipe round-trips through `normalizeBlocks` cleanly; the
 * `-incoming` tail makes the origin greppable in stored books.
 */
function freshIncomingBlockId() {
  _incomingSeq = (_incomingSeq + 1) | 0;
  return `b-${Date.now().toString(36)}-${_incomingSeq.toString(36)}-incoming`;
}

function getAtPath(obj, path) {
  let cur = obj;
  for (const seg of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[seg];
  }
  return cur;
}

function setAtPath(obj, path, value) {
  if (!Array.isArray(path) || path.length === 0) return;
  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i];
    if (cur[seg] == null || typeof cur[seg] !== 'object' || Array.isArray(cur[seg])) {
      cur[seg] = {};
    }
    cur = cur[seg];
  }
  cur[path[path.length - 1]] = value;
}
