/**
 * embedResolve — resolve a cross-object embed ref to a LIVE title.
 *
 * `embedChips.js` surfaces the reference; this upgrades it from a bare ref to
 * the referenced item's actual title (so a pinboard post embedding a task shows
 * "Fix the gate", not "urn:dec:item:T2"). Best-effort + graceful: any failure
 * (unknown type, cross-pod ref, missing circle, not found) leaves the embed
 * unchanged so the chip keeps its label/ref. PURE + shared web↔mobile (callSkill
 * injected).
 *
 * Today resolves the two types with a reliable local snapshot op:
 *   task           → tasks    getTaskSnapshot (needs circleId = the circle id)
 *   calendar-event → calendar  getEventSnapshot
 * Cross-pod (http) refs resolve by fetching the public item URL and extracting
 * its title (fetch is injected — pure + SSR/test-safe). Pinboard/folio TYPES that
 * are still local-only are a follow-up — see REMAINING-WORK "Surface embeds[]".
 */

/** type → { app, op } for the snapshot lookup. */
const RESOLVERS = Object.freeze({
  'task':           { app: 'tasks',    op: 'getTaskSnapshot' },
  'calendar-event': { app: 'calendar',  op: 'getEventSnapshot' },
});

/** Last local id segment of a ref (urn:dec:item:T2 → T2 · …/items/X.json → X). */
function localId(ref) {
  const s = String(ref ?? '');
  const seg = s.split('/').pop() || s;
  return seg.replace(/\.json$/i, '').split(':').pop() || seg;
}

/** First non-empty string among the given candidates, else null. */
function firstNonEmpty(...cands) {
  for (const c of cands) {
    if (typeof c === 'string' && c.trim()) return c;
  }
  return null;
}

/**
 * Extract a display title from a fetched canonical item body (cross-pod JSON).
 * Priority: .text · .title · .name · .label · .source.text · .source.title ·
 * .frontmatter.title (folio notes). Returns the first non-empty string or null.
 */
function titleFromItemBody(body) {
  if (!body || typeof body !== 'object') return null;
  const src = (body.source && typeof body.source === 'object') ? body.source : {};
  const fm = (body.frontmatter && typeof body.frontmatter === 'object') ? body.frontmatter : {};
  return firstNonEmpty(
    body.text, body.title, body.name, body.label,
    src.text, src.title,
    fm.title,
  );
}

/**
 * Resolve a cross-pod HTTP ref to a result by fetching its JSON body.
 * Best-effort + graceful. Returns `{ title }` on success, `{ denied: true }` for
 * an ACP-protected ref (401/403 — you can't read it; the chip shows a 🔒
 * placeholder), or `null` for any other miss / throw (chip keeps its ref).
 * @returns {Promise<{title:string}|{denied:true}|null>}
 */
async function resolveCrossPodResult(ref, fetchImpl) {
  if (typeof fetchImpl !== 'function') return null;   // no fetch available → skip, never throw
  try {
    const res = await fetchImpl(ref, { headers: { Accept: 'application/json' } });
    if (res && (res.status === 401 || res.status === 403)) return { denied: true };   // 🔒 ACP-protected
    if (!res || !res.ok) return null;                 // 404, etc. → keep the ref
    const title = titleFromItemBody(await res.json());
    return title ? { title } : null;
  } catch { /* network error / bad JSON → graceful null */ return null; }
}

/**
 * Resolve one embed → `{ title }` | `{ denied: true }` | `null`.
 * Local task/calendar refs go through callSkill (→ {title}|null); cross-pod HTTP
 * refs are fetched (→ {title}|{denied}|null). With the pod-session's AUTHED
 * fetch passed in, the user's OWN private-pod refs resolve too; without it, only
 * public refs resolve and protected ones come back `{denied}` (the 🔒 chip).
 * @returns {Promise<{title:string}|{denied:true}|null>}
 */
async function resolveEmbedResult({ callSkill, embed, circleId, fetchImpl = globalThis.fetch } = {}) {
  if (!embed || !embed.type || !embed.ref) return null;
  if (/^https?:\/\//i.test(String(embed.ref))) {
    return resolveCrossPodResult(String(embed.ref), fetchImpl);
  }
  if (typeof callSkill !== 'function') return null;
  const r = RESOLVERS[embed.type];
  if (!r) return null;
  // Try the ref verbatim, then its local-id tail (refs come in both shapes).
  for (const id of [String(embed.ref), localId(embed.ref)]) {
    try {
      const snap = await callSkill(r.app, r.op, { id, ...(circleId ? { circleId } : {}) });
      if (snap && !snap.error) {
        const title = snap.title ?? snap.label ?? null;
        if (title) return { title: String(title) };
      }
    } catch { /* try the next id form, else fall through to null */ }
  }
  return null;
}

/**
 * Resolve one embed to its live title, or null when unresolvable. (Title-only
 * convenience; for the 🔒 denied signal use enrichEmbedsWithTitles.)
 * @returns {Promise<string|null>}
 */
export async function resolveEmbedTitle(args = {}) {
  const r = await resolveEmbedResult(args);
  return r?.title ?? null;
}

/**
 * Return a copy of `embeds` with a resolved `title` attached where possible, or
 * `denied: true` for an ACP-protected cross-pod ref (→ a 🔒 chip). Unresolved
 * embeds pass through unchanged. Resolves concurrently.
 * @returns {Promise<object[]>}
 */
export async function enrichEmbedsWithTitles({ callSkill, embeds, circleId, fetchImpl = globalThis.fetch } = {}) {
  if (!Array.isArray(embeds) || embeds.length === 0) return Array.isArray(embeds) ? embeds : [];
  return Promise.all(embeds.map(async (e) => {
    const r = await resolveEmbedResult({ callSkill, embed: e, circleId, fetchImpl });
    if (r?.title) return { ...e, title: r.title };
    if (r?.denied) return { ...e, denied: true };
    return e;
  }));
}
