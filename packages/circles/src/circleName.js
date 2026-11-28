/**
 * A CIRCLE'S NAME — the one read, for every place that shows or carries it.
 *
 * The name lives in the circle's RULES DOC (`rules.name`): the maker writes it there (createGroupV2), a rules change
 * keeps it, a rename is a rules change under the circle's own rules, and the doc travels to every member and folds by
 * version on the rules lane. A rules head's `text` follows it.
 *
 * The name is the highest-version head that CARRIES one, so a head without a name never hides an older one. A head
 * names the circle by `rules.name`; a head from before the name moved into the doc names it by its text, unless
 * that text is the circle's key or the placeholder a joiner's copy holds (`isPlaceholder`). Version is the head's
 * own (`source.version`, else `source.rules.version`); between equal versions the later row wins (addedAt, then id).
 *
 * Measured 2026-11-28: a rules change wrote a v2 head whose text was the circle's KEY, and the read took the FIRST
 * row, so a real rename would never have shown and a nameless newer head would have shown the key.
 */

const versionOf = (it) => Number.parseInt(it?.source?.version ?? it?.source?.rules?.version ?? 0, 10) || 0;
const newer = (a, b) => {   // is a newer than b
  const va = versionOf(a); const vb = versionOf(b);
  if (va !== vb) return va > vb;
  const ta = a?.addedAt ?? 0; const tb = b?.addedAt ?? 0;
  if (ta !== tb) return ta > tb;
  return String(a?.id ?? '') > String(b?.id ?? '');
};

/** The name one rules head gives its circle, or null. */
function nameOfRulesHead(it, { isPlaceholder = () => false } = {}) {
  const gid = it?.source?.groupId;
  const own = it?.source?.rules?.name;
  if (typeof own === 'string' && own.trim() && own.trim() !== gid) return own.trim();
  const label = typeof it?.text === 'string' ? it.text.trim() : '';
  if (!label || label === gid || isPlaceholder(label, gid)) return null;
  return label;
}

/**
 * groupId → name, over a circle's rules rows (any order, any mix of circles).
 * @param {Array<object>} rows   `group-rules` rows
 * @param {{isPlaceholder?: (label: string, groupId: string) => boolean}} [o]
 * @returns {Map<string, string>}
 */
export function circleNamesFromRules(rows, o = {}) {
  const best = new Map();
  for (const it of Array.isArray(rows) ? rows : []) {
    const gid = it?.source?.groupId;
    if (typeof gid !== 'string' || !gid) continue;
    if (!nameOfRulesHead(it, o)) continue;
    const cur = best.get(gid);
    if (!cur || newer(it, cur)) best.set(gid, it);
  }
  const names = new Map();
  for (const [gid, it] of best) names.set(gid, nameOfRulesHead(it, o));
  return names;
}
