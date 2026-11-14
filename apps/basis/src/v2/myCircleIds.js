/**
 * THE CIRCLES THIS DEVICE IS IN, AS IDS. pinboard's `listMyCircles` answers `{ circles: [groupId, ...] }`: plain strings.
 * The shells' pod read-back (on coming back to the front), its boot kick and the phone's background slot each mapped
 * that list as if it held objects (`b?.groupId ?? b?.id`), which turned every id into nothing: those three read no
 * circle at all, on web and on the phone (found 2026-11-14 writing the phone's pod-sync story; only opening a circle,
 * which names its id directly, read the pod). One reader, so the shape is read in one place; it takes an object row
 * too, as other callers of the op have done.
 */

/**
 * @param {{circles?: Array<string|{groupId?: string, id?: string}>}|null|undefined} result  `listMyCircles`'s answer
 * @returns {string[]}
 */
export function circleIdsFrom(result) {
  const rows = Array.isArray(result?.circles) ? result.circles : [];
  return rows.map((c) => (typeof c === 'string' ? c : (c?.groupId ?? c?.id ?? null)))
    .filter((c) => typeof c === 'string' && c);
}

/**
 * The circle ids this device is in, read through the waist (a failing read is no circles).
 * @param {(app: string, op: string, args: object) => Promise<any>} callSkill  the 3-argument, app-targeted waist
 * @returns {Promise<string[]>}
 */
export async function myCircleIds(callSkill) {
  if (typeof callSkill !== 'function') return [];
  try { return circleIdsFrom(await callSkill('pinboard', 'listMyCircles', {})); } catch { return []; }
}
