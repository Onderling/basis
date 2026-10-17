/**
 * `fetchSectionItems(section, {callSkill, context?})` — +.
 *
 * One-stop helper that adapters call to populate a NavModel section
 * with items. Honours the `section.dataSource` declaration
 * if present; otherwise falls back to the rule-b default
 * (`listOpen({type, ...filter})`).
 *
 * `dataSource.argsFromContext` recognised.
 * Values of the form `"$<key>"` are substituted from the caller-
 * supplied `context` object at call time:
 *
 *   dataSource: {
 *     skillId: 'getPrivacyNotice',
 *     argsFromContext: { lang: '$lang' },
 *   }
 *   fetchSectionItems(section, { callSkill, context: { lang: 'nl' } });
 *   → callSkill('getPrivacyNotice', { lang: 'nl' })
 *
 * If a `$key` doesn't appear in `context`, the literal is passed
 * through (so callers can detect-and-recover).  Static `args` +
 * `argsFromContext` are merged (`args` first, context-substituted
 * keys override).
 *
 * Removes adapter-side hard-coding of "this section calls listMine /
 * listMyRequests / getDagTree" that household + tasks-v0 + pinboard web
 * bootstraps all currently duplicate.  Same helper feeds renderMobile
 * (Slice C) — keeping section→data-fetch logic device-independent.
 *
 * Robustness — skill replies vary in shape across apps:
 *   - Some return a bare array of items: `[{...}, {...}]`
 *   - Some return `{items: [...]}`
 *   - Some return `{tasks: [...]}` or `{approvals: [...]}` etc.
 *   - Household-side `addItem`/`listOpen` chat-shape returns
 *     `{replies, stateUpdates}` — the bootstrap re-reads the store
 *     to recover `items[]` (an A.3 signal).
 *
 * This helper does NOT try to normalise reply shapes.  It returns
 * `result` verbatim; adapters extract `items` per their app's
 * convention. Forward-additive: could normalise via a
 * configurable extractor if a real consumer needs it.
 *
 * @param {object} section          NavModel section (sees: itemType, filter?, dataSource?)
 * @param {object} args
 * @param {(skillId: string, args?: object) => Promise<*>} args.callSkill
 *   Adapter-supplied skill caller.  Same shape as @onderling/web-adapter's
 *   `callSkill(baseUrl, ...)` already-curried with baseUrl.
 * @param {object} [args.context]
 *   context object whose keys back the `argsFromContext`
 *   `$key` substitution.  Optional; if absent, `$key` literals pass
 *   through unchanged so callers can detect missing values.
 * @param {string} [args.defaultListSkill='listOpen']
 *   Skill id to call when `section.dataSource` is absent.  Defaults to
 *   `'listOpen'`; apps with a different default (e.g. `'listAllOpen'`)
 *   can override.
 *
 * @returns {Promise<*>}   raw skill reply.  Adapters extract `items` per
 *                          their convention.
 */
export async function fetchSectionItems(section, { callSkill, context, defaultListSkill = 'listOpen' } = {}) {
  if (!section || typeof section !== 'object') {
    throw new TypeError('fetchSectionItems: section (NavModel section) required');
  }
  if (typeof callSkill !== 'function') {
    throw new TypeError('fetchSectionItems: callSkill (function) required');
  }

  // explicit dataSource wins.
  if (section.dataSource && typeof section.dataSource.skillId === 'string') {
    // merge static args + context-substituted args.
    const staticArgs    = section.dataSource.args            ?? {};
    const contextSubst  = substituteContext(section.dataSource.argsFromContext, context);
    const finalArgs     = { ...staticArgs, ...contextSubst };
    return callSkill(section.dataSource.skillId, finalArgs);
  }

  // rule-b fallback — `listOpen({type,...filter})`.
  const args = {
    ...(section.itemType !== undefined ? { type: section.itemType } : {}),
    ...(section.filter ?? {}),
  };
  return callSkill(defaultListSkill, args);
}

/**
 * recognise `"$key"` strings in `argsFromContext` and
 * substitute from the caller-supplied `context` object.  Unknown keys
 * pass through literally (caller can detect "still got `$lang`" and
 * recover).  Non-string values pass through unchanged.
 *
 * @param {object|undefined} argsFromContext
 * @param {object|undefined} context
 * @returns {object}
 */
function substituteContext(argsFromContext, context) {
  if (!argsFromContext || typeof argsFromContext !== 'object') return {};
  const ctx = (context && typeof context === 'object') ? context : {};
  const out = {};
  for (const [k, v] of Object.entries(argsFromContext)) {
    if (typeof v === 'string' && v.startsWith('$')) {
      const key = v.slice(1);
      if (key in ctx) {
        out[k] = ctx[key];
      } else {
        // Unknown context key — pass through literally so consumer
        // can detect + recover.
        out[k] = v;
      }
    } else {
      out[k] = v;  // non-substituted literal
    }
  }
  return out;
}
