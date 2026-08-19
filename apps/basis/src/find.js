/**
 * basis — `/find` search aggregator (v0.7.5).
 *
 * Per user resolution (2026-05-23): cache-first.  Each app's
 * searchSkill queries ITS OWN cached/existing items (instant +
 * works offline).  An `[Extensive search]` button on the result
 * card can later trigger deeper queries (pod/network) — that's
 * a separate skill (e.g. extendedSearchSkill) not in this slice.
 *
 * Empty-section handling: apps that return no items are skipped.
 *
 * Phase v0.7.
 *
 * Platform: neutral.
 */

/**
 * @typedef {object} SearchResultGroup
 * @property {string}                   appOrigin
 * @property {Array<{id, label, type?}> } items
 * @property {string}                   [error]
 */

/**
 * @typedef {object} FindReply
 * @property {string}              query
 * @property {SearchResultGroup[]} groups
 * @property {number}              generatedAt
 * @property {boolean}             [extensiveAvailable]   true → [Extensive] button
 */

/**
 * Run the /find fan-out.
 *
 * @param {object} args
 * @param {import('./manifestMerge.js').MergedCatalogue} args.catalogue
 * @param {(appOrigin: string, opId: string, args: object) => Promise<*>} args.callSkill
 * @param {string}  args.query
 * @returns {Promise<FindReply>}
 */
export async function runFind({ catalogue, callSkill, query }) {
  if (!catalogue || typeof catalogue.searchAggregations !== 'function') {
    throw new TypeError('runFind: catalogue with searchAggregations required');
  }
  if (typeof callSkill !== 'function') {
    throw new TypeError('runFind: callSkill required');
  }
  const q = String(query ?? '').trim();
  if (q === '') {
    return { query: '', groups: [], generatedAt: Date.now() };
  }

  const decls = catalogue.searchAggregations();
  const results = await Promise.all(decls.map(async (decl) => {
    try {
      const payload = await callSkill(decl.appOrigin, decl.searchSkill, { query: q });
      const items = Array.isArray(payload?.items) ? payload.items : [];
      if (items.length === 0) return null;
      return /** @type {SearchResultGroup} */ ({
        appOrigin: decl.appOrigin,
        items: items.map((it) => ({
          id:    String(it?.id ?? ''),
          label: String(it?.label ?? it?.title ?? it?.text ?? it?.id ?? ''),
          ...(it?.type ? { type: it.type } : {}),
        })),
      });
    } catch (err) {
      return {
        appOrigin: decl.appOrigin,
        items:     [],
        error:     err?.message ?? String(err),
      };
    }
  }));

  const groups = results
    .filter((g) => g && (g.items.length > 0 || g.error))
    .sort((a, b) => a.appOrigin.localeCompare(b.appOrigin));

  return {
    query: q,
    groups,
    generatedAt:        Date.now(),
    extensiveAvailable: true,    // [Extensive search] button rendered
  };
}
