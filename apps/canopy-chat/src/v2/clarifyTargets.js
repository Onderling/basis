// Clarification turn — resolve a command's id-like params to concrete targets WITHIN the circle
// scope, and detect ambiguity so the bot asks instead of guessing.
//
// The LLM (or a typed label) gives a human label — "the dishes", "afval wegbrengen". A command param
// that declares `pickerSource.listOp` is id-like: it must resolve to ONE item in the circle's listing.
// This is the structured form of the web shell's `resolveTextArgsInPlace`, which already binds the
// unique case and *punts* on ambiguous/no-match — here those two become explicit outcomes the shell
// turns into a question.
//
// Platform-neutral: the shell injects `lookup(listOp, query, scope) → items[]` (the CIRCLE-SCOPED
// candidate search — this is what confines resolution to the active circle, and why the same label in
// another circle can't be hit) and the catalog. Screens are filtered views of one circle, so a label
// can still match several items inside a circle — that surfaces here as `clarify`.
//
// Outcomes:
//   {kind:'ready',      opId, args}                            all id-params resolved uniquely → dispatch
//   {kind:'clarify',    opId, args, param, query, candidates}  a param matched MULTIPLE items → ask which
//   {kind:'unresolved', opId, args, param, query}              a REQUIRED id-param matched nothing → ask for it

/**
 * @param {{opId:string, args:object}} command
 * @param {{catalog:object, lookup:(listOp:string, query:string, scope:object)=>(any[]|Promise<any[]>), scope?:object}} deps
 * @returns {Promise<{kind:'ready'|'clarify'|'unresolved', opId:string, args:object, param?:string, query?:string, candidates?:Array<{id:string,label:string,hint?:string}>}>}
 */
export async function clarifyCommandTargets({ opId, args }, { catalog, lookup, scope } = {}) {
  const entry = catalog && catalog.opsById ? catalog.opsById.get(opId) : null;
  const op = entry && entry.op ? entry.op : entry;
  // The op's owning app — passed to `lookup` so the picker's `listOp` resolves on the SAME app as the
  // op, not by probe-first-origin. Without it a shared op name (e.g. `listOpen`, declared by both
  // stoop and tasks-v0) resolves to the wrong app — "done <task>" searched stoop's buurt feed and
  // never found the task (device-verify 2026-06-11). Lookups ignoring the 4th arg keep prior behaviour.
  const appOrigin = entry && entry.appOrigin ? entry.appOrigin : null;
  const params = (op && Array.isArray(op.params)) ? op.params : [];
  const resolved = { ...(args || {}) };

  for (const p of params) {
    const listOp = p && p.pickerSource && p.pickerSource.listOp;
    if (!listOp) continue;                                   // not an id-like param
    const raw = resolved[p.name];

    if (typeof raw !== 'string' || raw === '') {             // no value supplied
      if (p.required) return { kind: 'unresolved', opId, args: resolved, param: p.name, query: '' };
      continue;
    }
    if (isIdLike(raw)) continue;                             // already a concrete (ULID-ish) id

    const items = (typeof lookup === 'function' ? await lookup(listOp, raw, scope, appOrigin) : null) || [];
    // Exact id match wins (e.g. the value is a candidate id the user just PICKED) — authoritative,
    // skip the fuzzy label match. Also covers short/non-ULID ids that isIdLike wouldn't catch.
    const exact = items.find((it) => it && it.id === raw);
    if (exact) { resolved[p.name] = exact.id; continue; }
    const needle = raw.toLowerCase();
    const hits = items.filter((it) => String(it && it.label || '').toLowerCase().includes(needle));

    if (hits.length === 1) { resolved[p.name] = hits[0].id; continue; }
    if (hits.length > 1) {
      return {
        kind: 'clarify', opId, args: resolved, param: p.name, query: raw,
        candidates: hits.map((h) => ({ id: h.id, label: String(h.label ?? h.id), ...(h.hint ? { hint: h.hint } : {}) })),
      };
    }
    if (p.required) return { kind: 'unresolved', opId, args: resolved, param: p.name, query: raw };
    // optional + no match → leave unbound, let dispatch decide
  }

  return { kind: 'ready', opId, args: resolved };
}

/** A ULID-ish opaque id (already resolved) — skip lookup. Matches the web shell's heuristic. */
function isIdLike(s) { return /^[0-9A-Z]{20,}$/.test(s); }
