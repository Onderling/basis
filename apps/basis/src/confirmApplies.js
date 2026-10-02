/**
 * Does an op's declared confirm ask for THIS call? Always, unless it names the values it asks for (`when`): a setting
 * that changes it for everyone asks only for the changes that take something away ("names none", "reminders off").
 * One rule for every surface — the dispatch's gate and a screen that calls the op directly.
 *
 * @param {object|null} confirm  the op's `surfaces.ui.confirm`
 * @param {object} [args]        the call's args (`when` is matched against `change`, or the slash's argline `_match`)
 */
export function confirmApplies(confirm, args = {}) {
  if (!confirm) return false;
  if (!Array.isArray(confirm.when)) return true;
  return confirm.when.includes(String(args?.change ?? args?._match ?? '').trim().toLowerCase());
}
