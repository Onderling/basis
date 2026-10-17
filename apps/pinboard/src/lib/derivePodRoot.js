/**
 * derivePodRootFromWebId — resolve a user's writable Pod storage
 * root from their WebID profile's `pim:storage` triple.
 *
 * Why this exists: a WebID URL's *origin* is the IDENTITY host
 * (e.g. `https://id.inrupt.com/`), NOT the writable Pod. For Inrupt
 * PodSpaces the storage is a different URL (e.g.
 * `https://storage.inrupt.com/<uuid>/`), declared in the public
 * WebID profile as `pim:storage`. Using the origin → every pod PUT
 * 404s (device-pass #1, 2026-05-17). The desktop path
 * (`apps/pinboard/src/lib/podSignIn.js derivePodRoot`) already does
 * this; this is the shared, fetch-injected version mobile uses too.
 *
 * Pure aside from the injected `fetch`. WebID profile docs are
 * world-readable, so an unauthenticated fetch is fine; pass an
 * authenticated one when available for restricted setups.
 *
 * @param {object} a
 * @param {string} a.webid
 * @param {(url:string, init?:object)=>Promise<Response>} [a.fetch]
 * @returns {Promise<string|null>}  the pod root (trailing-slashed),
 *   the WebID origin as a fallback, or null when `webid` is unusable.
 */
export async function derivePodRootFromWebId({ webid, fetch: fetchFn } = {}) {
  if (typeof webid !== 'string' || webid.length === 0) return null;

  if (typeof fetchFn === 'function') {
    try {
      const res = await fetchFn(webid, {
        headers: { Accept: 'text/turtle, application/ld+json;q=0.9, */*;q=0.5' },
      });
      if (res && res.ok) {
        const body = await res.text();
        const m = body.match(/pim:storage\s*<([^>]+)>/)
          ?? body.match(/<http:\/\/www\.w3\.org\/ns\/pim\/space#storage>\s*<([^>]+)>/)
          ?? body.match(/"http:\/\/www\.w3\.org\/ns\/pim\/space#storage"\s*:\s*\{?\s*"@id"\s*:\s*"([^"]+)"/);
        if (m && m[1]) {
          return m[1].endsWith('/') ? m[1] : `${m[1]}/`;
        }
      }
    } catch { /* fall through to the origin fallback */ }
  }

  try {
    return `${new URL(webid).origin}/`;
  } catch {
    return null;
  }
}
