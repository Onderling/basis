/**
 * objectDiff — 3-way diff over arbitrary JSON-serializable objects.
 *
 * Sibling to file-oriented `diff.js`: same conceptual shape, but per-key
 * (recursively) over JSON blobs instead of per-relPath over scan results.
 *
 * Inputs
 *   local — what the user has right now (post-edit)
 *   pod   — what came back from the pod (after a fetch)
 *   base  — last common known state (the ancestor); `null` when unknown
 *
 * Output
 *   {
 *     toMerge:   Array<{ path: string[], yours, theirs }>
 *               // one-sided change → take it.  Exactly ONE of yours/theirs
 *               // carries the new value (the other side equals base).
 *               // For pod-only additions where base lacks the path,
 *               // `yours` is `undefined` and `theirs` is the new value.
 *               // For local-only additions, mirror: `theirs` is `undefined`.
 *     conflicts: Array<{ path: string[], yours, theirs, base }>
 *               // both sides changed AND ended up with different values.
 *     identical: boolean   // true when local deep-equals pod (skip merge).
 *   }
 *
 * Semantics (per leaf path)
 *   - local === pod                                     → no entry
 *   - local === base, pod !== base                      → toMerge {theirs: pod}
 *   - pod === base,   local !== base                    → toMerge {yours: local}
 *   - both !== base AND local !== pod                   → conflict
 *   - both !== base AND local === pod (same edit)       → no entry (already in agreement)
 *   - no base (or path missing from base):
 *       - local === pod                                 → no entry
 *       - one side undefined, other defined             → toMerge (one-sided add)
 *       - both defined and unequal                      → conflict
 *
 * "undefined vs missing key" — treated identically.  A key that disappeared
 * from base but was already absent on a side is not a no-op merge.
 *
 * Arrays
 *   - If every entry of an array on EITHER local or pod (and base when
 *     present) is a plain object with a string `id`, treat the array as
 *     a map keyed by id and recurse per-id.  Per-id 3-way diff applies
 *     to the entire entry value at path [...prefix, key, id].
 *   - Otherwise the array is opaque: compared by deep equality at the
 *     array level (whole-array change or no entry).  Order matters in
 *     opaque mode; order-only changes count as a change (whole-array
 *     replacement).
 *
 * Equality
 *   - Primitives, strings, numbers, booleans, null: `===`.
 *   - Arrays / plain objects: structural deep-equal.
 *   - Dates: deep-equal by `.getTime()` — but JSON blobs shouldn't carry
 *     Dates; treated as opaque leaves if they slip in.
 *
 * Purity: no I/O, no Date.now, no Math.random.
 */

/**
 * @typedef {object} MergeEntry
 * @property {string[]} path
 * @property {*} yours
 * @property {*} theirs
 */

/**
 * @typedef {object} ConflictEntry
 * @property {string[]} path
 * @property {*} yours
 * @property {*} theirs
 * @property {*} base
 */

/**
 * @param {*} local
 * @param {*} pod
 * @param {*} base  null/undefined when unknown
 * @returns {{ toMerge: MergeEntry[], conflicts: ConflictEntry[], identical: boolean }}
 */
export function objectDiff(local, pod, base) {
  const toMerge = [];
  const conflicts = [];
  const identical = deepEqual(local, pod);
  walk(local, pod, base, [], toMerge, conflicts);
  return { toMerge, conflicts, identical };
}

/**
 * Recursive walker.  At each step we decide:
 *   - If both sides agree at this node → no entry (skip).
 *   - If both sides are plain objects (and base is plain-object-or-missing),
 *     recurse per key.
 *   - If both sides are arrays-keyed-by-id (and base is keyed-by-id-or-missing),
 *     recurse per id.
 *   - Otherwise the node is a leaf for diff purposes → emit toMerge or
 *     conflict at this path.
 */
function walk(local, pod, base, path, toMerge, conflicts) {
  // Treat `undefined` and "missing key" identically; nothing to emit
  // when both sides agree and base agrees (or is unknown).
  if (deepEqual(local, pod)) {
    return;
  }

  // Recurse into plain objects when both sides are plain objects.
  // (base may be missing/undefined — we treat it as `{}` for descent.)
  if (isPlainObject(local) && isPlainObject(pod) &&
      (base === undefined || base === null || isPlainObject(base))) {
    const baseObj = isPlainObject(base) ? base : {};
    const keys = new Set([
      ...Object.keys(local),
      ...Object.keys(pod),
      ...Object.keys(baseObj),
    ]);
    for (const k of keys) {
      walk(local[k], pod[k], baseObj[k], path.concat(k), toMerge, conflicts);
    }
    return;
  }

  // Recurse into arrays-keyed-by-id when local AND pod look keyed-by-id.
  // base is allowed to be missing or keyed-by-id (an array that became a
  // non-keyed array on one side falls back to opaque treatment).
  if (isKeyedArray(local) && isKeyedArray(pod) &&
      (base === undefined || base === null || isKeyedArray(base))) {
    const baseArr = isKeyedArray(base) ? base : [];
    const lMap = arrayById(local);
    const pMap = arrayById(pod);
    const bMap = arrayById(baseArr);
    const ids = new Set([...lMap.keys(), ...pMap.keys(), ...bMap.keys()]);
    for (const id of ids) {
      walk(lMap.get(id), pMap.get(id), bMap.get(id), path.concat(id), toMerge, conflicts);
    }
    return;
  }

  // Leaf decision.  At least one of local/pod is a primitive, array
  // (opaque), or a non-recursable shape — and they're not equal.
  const baseHere = base; // may be undefined
  const localChanged = !deepEqual(local, baseHere);
  const podChanged   = !deepEqual(pod,   baseHere);

  // `side` names WHICH side diverged from base. Both directions are auto-mergeable, but they resolve to
  // OPPOSITE values, and without this a consumer cannot tell them apart from the entry shape alone — which
  // let a stale replica silently REVERT a fresher local edit (the caller took `theirs` for every toMerge).
  // Additive: existing consumers that ignore it are unaffected.
  if (localChanged && !podChanged) {
    // local edited; pod stayed at base (which may itself be missing) → resolving to `yours` keeps the edit.
    toMerge.push({ path, yours: local, theirs: pod, side: 'local' });
    return;
  }
  if (podChanged && !localChanged) {
    // pod edited; local stayed at base → resolving to `theirs` takes the incoming change.
    toMerge.push({ path, yours: local, theirs: pod, side: 'incoming' });
    return;
  }
  // Both changed (or no base, and they differ) → conflict.
  // `deepEqual(local, pod)` was already false (guard at top), so we
  // truly diverge here.
  conflicts.push({ path, yours: local, theirs: pod, base: baseHere });
}

/**
 * Plain-object check: an object literal / Record, not Array, not Date,
 * not null, not a class instance like Map/Set.  Cheap & sufficient for
 * JSON-blob diffing.
 */
export function isPlainObject(v) {
  if (v === null || typeof v !== 'object') return false;
  if (Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * Is `v` an array whose every entry is a plain object with a string `id`?
 * Empty arrays count (vacuously true) so an empty list of blocks can
 * coexist with a populated one on the other side without falling out of
 * the keyed-by-id regime.
 */
export function isKeyedArray(v) {
  if (!Array.isArray(v)) return false;
  for (const item of v) {
    if (!isPlainObject(item)) return false;
    if (typeof item.id !== 'string') return false;
  }
  return true;
}

/**
 * Build a Map<id, entry> from a keyed-by-id array.  Last-write-wins on
 * duplicate ids (shouldn't occur in well-formed data; defensive).
 */
export function arrayById(arr) {
  const out = new Map();
  if (!Array.isArray(arr)) return out;
  for (const item of arr) {
    if (isPlainObject(item) && typeof item.id === 'string') {
      out.set(item.id, item);
    }
  }
  return out;
}

/**
 * Structural deep equality for JSON-blob values.
 * - Treats `undefined` and missing-key identically (caller-side concern).
 * - `null === null`.
 * - Arrays: same length and per-index deep-equal.
 * - Plain objects: same key set and per-key deep-equal.
 * - Dates: same `.getTime()`.
 * - Everything else: `===`.
 */
export function deepEqual(a, b) {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false; // primitives — `===` already ruled equal out
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }
  const aIsArr = Array.isArray(a);
  const bIsArr = Array.isArray(b);
  if (aIsArr !== bIsArr) return false;
  if (aIsArr) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  // Plain objects (or object-like).  Compare own enumerable keys.
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual(a[k], b[k])) return false;
  }
  return true;
}
