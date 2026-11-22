/**
 * What the circle launcher paints for its list: the loading line, the empty state, the list, or the boot failure.
 *
 * "No circles yet." is a claim about the account, so it is made only on an answer: the boot retry loop has
 * SETTLED (a load returned circles, or the tries ran out). Before that an empty list means "not known yet" —
 * the pinboard store hydrates after the agent bundle, and the gaps between retries used to paint the empty state
 * for an account that had circles. Circles already on screen are never swapped for the loading line: a reload
 * repaints in place (React Native drops a press whose row unmounts mid-tap).
 *
 * THE KEPT PICTURE (`keptPicture.js`): before the list is read, the circles of the last caught-up list (`keptCount`)
 * stand in for the loading line, marked as refreshing; once the list is read its answer is the truth, empty or not.
 *
 * @param {{ loading: boolean, settled: boolean, count: number, bootError?: unknown, keptCount?: number }} state
 * @returns {'boot-failed'|'list'|'kept'|'loading'|'empty'}
 */
export function launcherListPaint({ loading, settled, count, bootError = null, keptCount = 0 }) {
  if (bootError) return 'boot-failed';
  if (count > 0) return 'list';
  if (!settled && keptCount > 0) return 'kept';
  if (loading || !settled) return 'loading';
  return 'empty';
}
