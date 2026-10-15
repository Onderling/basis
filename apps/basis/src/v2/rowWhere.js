/**
 * Where a row across circles comes from, in words: its circle's name, or "jij" for one of the person's own items (no
 * circle — the own store). Both shells' block painters tag a row with it.
 * @param {{circleName?: string, own?: boolean}} row
 * @param {(k: string) => string} t
 * @returns {string}   '' when there is nothing to say (a circle's own view)
 */
export function whereTag(row, t) {
  if (row?.circleName) return row.circleName;
  return row?.own ? t('circle.vandaag.own_tag') : '';
}
