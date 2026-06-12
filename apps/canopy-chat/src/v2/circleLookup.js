// canopy-chat v2 — the shared circle label→candidate lookup (web↔mobile consolidation Phase 3).
//
// Promotes mobile's LIVE lookup to the one shared implementation; web adopts it. For a label like
// "the dishes" the clarify resolver (`clarifyCommandTargets`) needs the circle's candidate items for
// an op's `pickerSource.listOp`; this produces them as `{id,label}[]`:
//   BASE (platform-injected) — mobile's preloaded items / web's last-listing cache —
//   PLUS an app-qualified LIVE fetch of the op's own list (`appCallSkill(app, listOp, scopeArgs)`),
//   deduped by id.
//
// App-qualified: the fetch goes to the op's OWN app (`app` = the catalog entry's appOrigin, passed by
// clarifyCommandTargets), NOT probe-first-origin — so a shared op name like `listOpen` resolves on the
// right app (the bug that sent it to stoop). Best-effort: a live-fetch throw keeps the base, so web
// safely degrades to its cache and mobile to its loaded items. Without `app` or `appCallSkill` it
// returns the base only (no live fetch).

const toCand = (it) => ({
  id:    String(it?.id ?? ''),
  label: String(it?.label ?? it?.title ?? it?.name ?? it?.text ?? it?.id ?? ''),
});

function normalizeList(r) {
  return Array.isArray(r) ? r
    : Array.isArray(r?.items)  ? r.items
    : Array.isArray(r?.tasks)  ? r.tasks
    : Array.isArray(r?.posts)  ? r.posts
    : Array.isArray(r?.files)  ? r.files
    : Array.isArray(r?.events) ? r.events
    : [];
}

/**
 * @param {object} a
 * @param {(scope:any, listOp:string)=>any[]} [a.getBase]       platform base candidates (mobile loaded items; web thread cache)
 * @param {(app:string, op:string, args:object)=>Promise<any>} [a.appCallSkill]  3-arg app-routed callSkill for the live fetch
 * @param {()=>(string|null)} [a.scopeId]  override the scope id used for the fetch (web pins this to the active-circle id;
 *                                          AUTHORITATIVE when provided: null → no-circle scope (default crew,
 *                                          empty fetch args), never the thread id. Mobile omits it → falls back to `scope.id`.)
 * @returns {(listOp:string, query:string, scope:any, app?:string)=>Promise<Array<{id:string,label:string}>>}
 */
export function makeCircleLookup({ getBase, appCallSkill, scopeId } = {}) {
  return async function circleLookup(listOp, _query, scope, app) {
    const baseRaw = typeof getBase === 'function' ? getBase(scope, listOp) : [];
    const base = (Array.isArray(baseRaw) ? baseRaw : []).map(toCand);
    if (!listOp || !app || typeof appCallSkill !== 'function') return base;
    try {
      // When `scopeId` is PROVIDED (web), its result is AUTHORITATIVE: null means "no circle scope"
      // (resolve against the member's default crew → empty fetch args), and must NOT fall through to
      // `scope?.id`. On web `scope` is the THREAD, whose id (e.g. 'main') is not a crew id, so the
      // old fallback mis-scoped the fetch to a non-existent crew and resolved nothing — the classic
      // shell's `/complete-task <label>` returned "item not found" (2026-06-12). The `scope?.id`
      // fallback is only for callers that OMIT `scopeId` (mobile, where `scope` IS the circle).
      const sid = (typeof scopeId === 'function')
        ? scopeId()
        : (scope?.id ?? (typeof scope === 'string' ? scope : null));
      const scopeArgs = sid ? { crewId: sid, circleId: sid, groupId: sid } : {};
      const arr = normalizeList(await appCallSkill(app, listOp, scopeArgs));
      const seen = new Set(base.map((c) => c.id));
      for (const it of arr) {
        const c = toCand(it);
        if (c.id && !seen.has(c.id)) { seen.add(c.id); base.push(c); }
      }
    } catch { /* keep base */ }
    return base;
  };
}
