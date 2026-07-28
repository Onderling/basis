/**
 * screenDrilldown — selection-context drill-down between manifest screens.
 *
 * A LIST view's rows can drill into a sibling DETAIL view whose
 * `dataSource.argsFromContext` needs a SELECTION-derived `$key`:
 *
 *   agents        →  agent-detail          ($agentId ← the picked row)
 *   data-versions →  data-version-detail   ($uri    ← the picked row)
 *
 * The manifest declares no explicit list→detail link — the pair is DERIVED
 * from the projection (invariant #4: the manifest is the contract):
 * the detail is the sibling section (same manifest, same `itemType`) whose
 * `argsFromContext` needs at least one context key the HOST does not
 * already materialize (`hostKeys`, e.g. `circleId`) and the list screen
 * itself didn't need.  Those missing keys are the SELECTION KEYS — the
 * picked row supplies them: `item[key] ?? item.id` (agents rows carry
 * `agentId`, data-versions series rows carry `uri` === `id`).
 *
 * Invariant #1 (logic lives once, in shared code): this mapping +
 * reply-shape logic lives here in shared `src/v2`, consumed by the web
 * shell (circleApp's screen panel) and — later — the RN shell.  The `$key`
 * substitution itself is @onderling/web-adapter's `fetchSectionItems` (the
 * fetch seam) — REUSED via {@link fetchScreenItems}, not reimplemented
 * (invariant #3).
 */
import { renderWeb } from '@onderling/app-manifest';
import { fetchSectionItems } from '@onderling/web-adapter';

/**
 * The context KEY names a section's `dataSource.argsFromContext` draws
 * from the fetch context — the `$`-stripped values (grammar).
 *
 * @param {object|null|undefined} section  projected NavModel section
 * @returns {string[]}
 */
export function sectionContextKeys(section) {
  const afc = section?.dataSource?.argsFromContext;
  if (!afc || typeof afc !== 'object') return [];
  return Object.values(afc)
    .filter((v) => typeof v === 'string' && v.startsWith('$'))
    .map((v) => v.slice(1));
}

/**
 * Resolve the DRILL-DOWN target for a list screen: the sibling section
 * (same owning manifest, same `itemType`) whose `argsFromContext` needs
 * ≥1 context key that is neither host-materialized (`hostKeys`) nor
 * already needed by the list itself.  Declaration order wins when several
 * candidates match (none do today).
 *
 * Returns `null` when the screen has no selection-context sibling — a
 * DETAIL screen never drills further (its own keys count as resolved via
 * `hostKeys`, which the host passes as the current panel's context keys).
 *
 * @param {Object<string, object>} manifestsByOrigin  {appOrigin → manifest}
 * @param {string} screenId    the projected LIST section id (e.g. 'data-versions')
 * @param {object} [opts]
 * @param {string[]} [opts.hostKeys]  context keys the host materializes for
 *   this panel (e.g. `['circleId']`, plus any selection keys already picked)
 * @param {Function} [opts.renderer]  pure projector (`renderWeb` | `renderMobile`)
 * @returns {{ screenId: string, appOrigin: string, section: object,
 *             selectionKeys: string[] } | null}
 */
export function drilldownForSection(manifestsByOrigin, screenId, { hostKeys = [], renderer = renderWeb } = {}) {
  if (!manifestsByOrigin || typeof manifestsByOrigin !== 'object') return null;
  if (typeof screenId !== 'string' || !screenId) return null;
  const seen = new Set();
  for (const manifest of Object.values(manifestsByOrigin)) {
    if (!manifest || typeof manifest !== 'object' || seen.has(manifest)) continue;
    seen.add(manifest);   // a manifest keyed under both app + appId is scanned once
    const nav = renderer(manifest);
    const sections = Array.isArray(nav.sections) ? nav.sections : [];
    const list = sections.find((s) => s && s.id === screenId);
    if (!list) continue;
    // Keys already resolvable WITHOUT a row pick: host-supplied + the list's own.
    const resolved = new Set([...hostKeys, ...sectionContextKeys(list)]);
    for (const s of sections) {
      if (!s || s.id === screenId) continue;
      if (s.itemType !== list.itemType) continue;
      const selectionKeys = sectionContextKeys(s).filter((k) => !resolved.has(k));
      if (!selectionKeys.length) continue;   // fully resolvable → a sibling list, not a drill-down
      const appOrigin = typeof manifest.app === 'string' && manifest.app
        ? manifest.app
        : (typeof manifest.appId === 'string' ? manifest.appId : '');
      return { screenId: s.id, appOrigin, section: s, selectionKeys };
    }
    return null;   // owning manifest found, no selection-context sibling
  }
  return null;
}

/**
 * The fetch context for a drill-down target: the base (host) context plus
 * each selection key filled from the PICKED ROW — `item[key] ?? item.id`
 * (the row field named like the key wins; the generic row id is the
 * fallback, e.g. data-versions series rows expose `uri` as both).
 *
 * @param {{selectionKeys: string[]}|null|undefined} drilldown  from {@link drilldownForSection}
 * @param {object|null|undefined} item   the picked row's item
 * @param {object} [base]                the current panel's context
 * @returns {object}
 */
export function selectionContextFor(drilldown, item, base = {}) {
  const ctx = { ...base };
  for (const k of (Array.isArray(drilldown?.selectionKeys) ? drilldown.selectionKeys : [])) {
    const v = item?.[k] ?? item?.id;
    if (v !== undefined) ctx[k] = v;
  }
  return ctx;
}

/**
 * Fetch a projected screen section's data through the seam
 * (`fetchSectionItems`): static `dataSource.args` merged with
 * `argsFromContext` `$keys` substituted from `context`.
 *
 * Deliberately REQUIRES an explicit `dataSource.skillId` — a
 * dataSource-less section throws (the panel's legacy empty-state path)
 * instead of falling into fetchSectionItems' `listOpen` fallback,
 * which would be a behaviour change for existing screens.
 *
 * @param {object} section
 * @param {object} args
 * @param {(skillId: string, args?: object) => Promise<*>} args.callSkill
 *   already-curried per-app skill caller (the shell binds `appOrigin`)
 * @param {object} [args.context]
 * @returns {Promise<*>} raw skill reply
 */
export function fetchScreenItems(section, { callSkill, context } = {}) {
  if (typeof section?.dataSource?.skillId !== 'string' || !section.dataSource.skillId) {
    throw new TypeError('fetchScreenItems: section has no dataSource.skillId');
  }
  return fetchSectionItems(section, { callSkill, context });
}

/**
 * Extract the ROW LIST from a skill reply (fetchSectionItems returns
 * replies verbatim; "adapters extract items per their app's convention").
 * The chat shell's convention, in order:
 *   1. a bare array;
 *   2. `items` / `payload.items` (the chat-shell list contract);
 *   3. the reply's SOLE array-valued property (e.g. listAgents →
 *      `{agents: [...]}`) — unambiguous, so tolerated; two or more
 *      array props → no guess, empty.
 *
 * @param {*} res
 * @returns {object[]}
 */
export function itemsFromReply(res) {
  if (Array.isArray(res)) return res;
  if (Array.isArray(res?.items)) return res.items;
  if (Array.isArray(res?.payload?.items)) return res.payload.items;
  for (const base of [res, res?.payload]) {
    if (!base || typeof base !== 'object') continue;
    const arrays = Object.values(base).filter(Array.isArray);
    if (arrays.length === 1) return arrays[0];
  }
  return [];
}

/**
 * Extract the RECORD from a `shape:'record'` section's reply:
 * `item` / `record` when present, else the reply's SOLE plain-object
 * property (e.g. viewAgent → `{agent: {...}}`).  `null` when the reply
 * carries no unambiguous record (including an honest `{agent: null}` miss).
 *
 * @param {*} res
 * @returns {object|null}
 */
export function recordFromReply(res) {
  const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
  for (const base of [res, res?.payload]) {
    if (!isObj(base)) continue;
    if (isObj(base.item)) return base.item;
    if (isObj(base.record)) return base.record;
    const objs = Object.values(base).filter((v) => isObj(v) && v !== base.payload);
    if (objs.length === 1) return objs[0];
  }
  return null;
}
