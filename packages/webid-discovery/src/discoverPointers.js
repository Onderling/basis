/**
 * discoverPointers — fetch a WebID profile + parse the standardisation
 * pointer predicates out of it.
 *
 * Returns `{ pointers, raw }`:
 *   - `pointers`: `{ storageMappingUri?, agentRegistryUri?, auditLogUri? }`
 *     (each present only if found on the profile).
 *   - `raw`: the unparsed profile body (Turtle or JSON-LD), for callers
 *     that want to do their own extraction.
 *
 * Profile parsing follows the same pattern as `SolidVault.extractPimStorage`
 * in `@onderling/oidc-session`: try JSON-LD first, then Turtle regex.
 * The substrate doesn't pull in a full RDF parser — the canonical writings
 * are well-defined and a regex is adequate.
 *
 * Recognised predicate forms (Turtle):
 *   <webid> dec:storage-mapping-uri <uri> .
 *   <webid> <https://onderling.org/ns#storage-mapping-uri> <uri> .
 *
 * Recognised predicate forms (JSON-LD):
 *   "storage-mapping-uri": "<uri>"
 *   "https://onderling.org/ns#storage-mapping-uri": [{"@id": "<uri>"}]
 *
 * Any unrecognised predicates are silently ignored.
 */

import { NAMESPACE, WEBID_PREDICATES, SHORT_NAMES } from './predicates.js';

/**
 * @param {string} webidUri
 * @param {object} opts
 * @param {(input: string, init?: object) => Promise<Response>} opts.fetch
 * @returns {Promise<{
 *   pointers: { storageMappingUri?: string, agentRegistryUri?: string, auditLogUri?: string },
 *   raw: string,
 * }>}
 */
export async function discoverPointers(webidUri, { fetch }) {
  if (typeof webidUri !== 'string' || webidUri.length === 0) {
    throw Object.assign(
      new Error('discoverPointers: `webidUri` is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  if (typeof fetch !== 'function') {
    throw Object.assign(
      new Error('discoverPointers: `fetch` must be a function'),
      { code: 'INVALID_ARGUMENT' },
    );
  }

  const res = await fetch(webidUri, {
    headers: { Accept: 'text/turtle, application/ld+json;q=0.9, */*;q=0.5' },
  });
  if (!res.ok) {
    throw Object.assign(
      new Error(`discoverPointers: ${webidUri} returned HTTP ${res.status}`),
      { code: 'FETCH_FAILED', status: res.status, webidUri },
    );
  }
  const raw = await res.text();
  return { pointers: parseWebIdPointers(raw, webidUri), raw };
}

/**
 * Pure parser — exported separately for testing + for callers that already
 * have the profile body in hand.
 *
 * @param {string} body
 * @param {string} webidUri  (used to filter to triples about this subject)
 * @returns {{ storageMappingUri?: string, agentRegistryUri?: string, auditLogUri?: string }}
 */
export function parseWebIdPointers(body, webidUri) {
  if (typeof body !== 'string' || body.length === 0) return {};

  // Try JSON-LD first.
  const trimmed = body.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const json = JSON.parse(body);
      const arr  = Array.isArray(json) ? json : [json];
      const out  = {};
      for (const node of arr) {
        if (!node || typeof node !== 'object') continue;
        for (const [key, target] of Object.entries(WEBID_PREDICATES)) {
          // Full IRI key.
          let v = node[target];
          // Short-name key (without prefix).
          if (v === undefined) {
            const shortName = target.slice(NAMESPACE.length);
            v = node[shortName];
          }
          if (v === undefined) continue;
          const uri = extractJsonLdId(v);
          if (uri) out[key] = uri;
        }
      }
      // If JSON-LD parsed at all, return what we got (may be empty).
      return out;
    } catch {
      // fall through to Turtle parser
    }
  }

  // Turtle.  Match canonical `<subject> <pred> <obj> .` shapes.
  // The subject filter is best-effort — we accept triples with the bare
  // webidUri, the prefixed pred-only form, or no explicit subject if the
  // profile uses `<>` (relative IRIs).
  const out = {};
  for (const [key, fullIri] of Object.entries(WEBID_PREDICATES)) {
    const localName = fullIri.slice(NAMESPACE.length);
    const uri = matchTurtlePredicate(body, fullIri, localName, webidUri);
    if (uri) out[key] = uri;
  }
  return out;
}

/**
 * @param {string|object|Array} v  JSON-LD value
 * @returns {string|null}
 */
function extractJsonLdId(v) {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && v.length > 0) {
    return extractJsonLdId(v[0]);
  }
  if (v && typeof v === 'object' && typeof v['@id'] === 'string') {
    return v['@id'];
  }
  return null;
}

/**
 * Turtle predicate matcher.  Looks for both `dec:<localName>` and full-IRI
 * forms.  Returns the first matching object URI, or null.
 */
function matchTurtlePredicate(body, fullIri, localName, _webidUri) {
  // Form 1: `<full-IRI> <object> .` — escape regex special chars.
  const fullEsc = fullIri.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const reFull  = new RegExp(`<${fullEsc}>\\s*<([^>]+)>`, 'i');
  const m1 = body.match(reFull);
  if (m1) return m1[1];

  // Form 2: `dec:<localName> <object> .` — we don't verify the prefix
  // declaration; that's the same shortcut the SolidVault Turtle path takes.
  const localEsc = localName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const reShort  = new RegExp(`(?:dec|onderling):${localEsc}\\s*<([^>]+)>`, 'i');
  const m2 = body.match(reShort);
  if (m2) return m2[1];

  void _webidUri;  // subject filter is best-effort; the canonical profile
                   // has exactly one subject (the user) so we don't enforce.
  return null;
}
