/**
 * parseDeepLink — generic deep-link path dispatcher.
 *
 * Lifted from apps/pinboard-mobile/src/lib/deepLinks.js 2026-05-09
 * (Phase 41.0.b A6; Tasks-mobile is the second consumer — its
 * `tasks://invite | tasks://bot-token | tasks://auth/callback` URLs
 * use the same dispatcher with its own parser table).
 *
 * The substrate handles:
 *   - scheme matching (`pinboard:` / `tasks:` / `folio:` / …)
 *   - URL parsing into `{path, query}` (no real-host required)
 *   - `parsers[path]` lookup; first match wins; the parser may
 *     return `null` to fall through to `{kind: 'unknown'}`
 *   - graceful fallthrough to `{kind: 'unknown', url}` on no match
 *
 * Apps provide:
 *   - `scheme`              — `'pinboard:'` or `'tasks:'` or …
 *   - `parsers`             — `{[path]: (query, url) => Parsed | null}`
 *   - optional `defaultPath` — the empty-path landing target
 *     (e.g. `'welcome'` for pinboard), so `pinboard://` and `pinboard://welcome`
 *     resolve to the same parser.
 *
 * Pure JS — no Linking, no React. The deep-link handler in `App.js`
 * couples this to `useNavigation()` itself.
 */

/**
 * @typedef {{kind: string, params?: object, url?: string}} ParsedDeepLink
 *
 * @typedef {object} DeepLinkConfig
 * @property {string} scheme           e.g. `'pinboard:'`, `'tasks:'`
 * @property {Object<string, (query: object, url: string) => ParsedDeepLink | null>} parsers
 * @property {string} [defaultPath]    path used when the URL is `<scheme>//`
 *
 * @param {string} input
 * @param {DeepLinkConfig} config
 * @returns {ParsedDeepLink}
 */
export function parseDeepLink(input, { scheme, parsers, defaultPath } = {}) {
  if (typeof scheme !== 'string' || !scheme.endsWith(':')) {
    throw new TypeError('parseDeepLink: scheme must be a string ending in ":"');
  }
  if (!parsers || typeof parsers !== 'object') {
    throw new TypeError('parseDeepLink: parsers map required');
  }
  if (typeof input !== 'string' || input.length === 0) return { kind: 'unknown', url: '' };
  const trimmed = input.trim();

  if (!trimmed.toLowerCase().startsWith(scheme.toLowerCase())) {
    return { kind: 'unknown', url: trimmed };
  }

  const afterScheme = trimmed.slice(scheme.length).replace(/^\/\//, '');
  const [pathRaw, queryRaw = ''] = afterScheme.split('?');
  let path = pathRaw.replace(/^\/+/, '').replace(/\/+$/, '');
  if (path === '' && typeof defaultPath === 'string') path = defaultPath;
  const query = parseQuery(queryRaw);

  const parser = parsers[path];
  if (typeof parser === 'function') {
    const out = parser(query, trimmed);
    if (out && typeof out === 'object' && typeof out.kind === 'string') {
      // Auto-attach the `url` field so handlers can re-emit for logging.
      return out.url ? out : { ...out, url: trimmed };
    }
  }

  return { kind: 'unknown', url: trimmed };
}

/**
 * Parse `?a=1&b=2` query strings without needing `URL`/`URLSearchParams`
 * (which behave differently across RN versions).
 *
 * @param {string} query
 * @returns {object}
 */
export function parseQuery(query) {
  const out = {};
  if (!query) return out;
  for (const pair of query.split('&')) {
    if (pair.length === 0) continue;
    const eq = pair.indexOf('=');
    const k = eq >= 0 ? pair.slice(0, eq) : pair;
    const v = eq >= 0 ? pair.slice(eq + 1) : '';
    if (!k) continue;
    try { out[decodeURIComponent(k)] = decodeURIComponent(v); }
    catch { out[k] = v; }
  }
  return out;
}

/**
 * Common helper: parse a `token=` query param that may be either raw
 * JSON or base64url-encoded JSON. Used by invite-style deep links;
 * apps can compose this into their parsers map.
 *
 * @param {string} raw
 * @param {(parsed: object) => boolean} validate   gate the parsed shape
 * @returns {object | null}
 */
export function parseTokenParam(raw, validate = () => true) {
  if (typeof raw !== 'string' || raw.length === 0) return null;

  // Raw JSON form (already URL-decoded by parseQuery).
  try {
    const parsed = JSON.parse(raw);
    if (validate(parsed)) return parsed;
  } catch { /* not JSON — try base64url */ }

  try {
    const padded = raw.replace(/-/g, '+').replace(/_/g, '/');
    const b64 = padded + '='.repeat((4 - padded.length % 4) % 4);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const json = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(json);
    if (validate(parsed)) return parsed;
  } catch { /* fall through */ }

  return null;
}
