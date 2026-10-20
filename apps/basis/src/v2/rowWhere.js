/**
 * Where a row across circles comes from, in words: its circle's name. One of the person's own items (no circle — the
 * own store) says nothing: on their own page their own rows need no "you" (Frits, 2026-10-20). Both shells' block
 * painters tag a row with it.
 * @param {{circleName?: string, own?: boolean}} row
 * @returns {string}   '' when there is nothing to say (an own row, a circle's own view)
 */
export function whereTag(row) {
  return row?.circleName ?? '';
}
