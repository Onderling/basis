/**
 * **Platform: web** — composes a Solid OIDC `session.fetch` to read /
 * write resources at the user's pod root.
 *
 * basis — minimal pod-write helper for v0.7..
 *
 * Pattern: when the user signs in (v0.7.), `podAuth.getCurrentSession`
 * returns `{ webid, isLoggedIn, fetch }` where `fetch` is an
 * authenticated browser-fetch.  This module wraps it to provide
 * `createPodWriter(session)` — a function the calendar (and future
 * apps) call to PUT JSON / iCal / Turtle resources at a stable URL
 * under the user's pod root.
 *
 * Path convention:
 *   - `<pod-root>/onderling/<app>/<resource>` — namespaced under
 *     `onderling/` so basis-managed pod state doesn't collide
 *     with other Solid apps (folio's existing
 *     `<pod>/<folder-mirror>` paths remain unaffected). Reads fall
 *     back to the pre-2026-07-29 `canopy/` namespace.
 *
 * v0.7. limitations:
 *   - One-way write only (calendar emits .ics feed to pod).
 *   - No conflict detection / If-Match.
 *   - No parent-container creation (PUT to leaf URL; most Solid
 *     servers auto-create containers).  When servers don't,
 *     v0.7. adds explicit container creation via PUT with
 *     ldp:Container link header.
 *
 * Future v0.7.:
 *   - Bidirectional via @onderling/pseudo-pod cache-mode + per-URI
 *     mode override.
 */

/**
 * Derive a pod root URL from a webid via the URL structure only.
 * Best-effort fallback when the WebID document can't be fetched.
 *
 * v0.7. note: this fallback is WRONG for Inrupt-style providers
 * where the WebID lives on the identity-provider host but the actual
 * pod storage is on a separate host (e.g. id.inrupt.com vs
 * storage.inrupt.com).  Always prefer `discoverPodRoot(session)`
 * which fetches the WebID doc + reads the `pim:storage` triple.
 *
 * @param {string} webid
 * @returns {string} pod root URL (ends with `/`)
 */
export function podRootFromWebid(webid) {
  if (typeof webid !== 'string' || webid === '') {
    throw new TypeError('podRootFromWebid: webid required');
  }
  const url = new URL(webid);
  const profileIdx = url.pathname.indexOf('/profile/');
  if (profileIdx >= 0) {
    const prefix = url.pathname.slice(0, profileIdx);
    return `${url.origin}${prefix}/`;
  }
  return `${url.origin}/`;
}

const PIM_STORAGE = 'http://www.w3.org/ns/pim/space#storage';

/**
 * v0.7. — discover the user's actual pod storage URL by fetching
 * the WebID document + reading the `pim:storage` triple.  This is
 * the canonical Solid mechanism and works for every spec-compliant
 * provider (Inrupt PodSpaces, CommunitySolid, SolidCommunity, NSS).
 *
 * Falls back to `podRootFromWebid` when the WebID doc can't be
 * fetched OR doesn't carry a `pim:storage` triple.
 *
 * @param {{ webid: string, fetch: typeof fetch }} session
 * @returns {Promise<string>} pod root URL (ends with `/`)
 */
export async function discoverPodRoot(session) {
  if (!session?.webid || typeof session?.fetch !== 'function') {
    throw new TypeError('discoverPodRoot: session with {webid, fetch} required');
  }
  // Strip any fragment from the WebID; the doc URL is the part
  // before `#`.  Many WebIDs have shape `<doc>#me`.
  const docUrl = session.webid.split('#')[0];
  try {
    const res = await session.fetch(docUrl, {
      headers: { Accept: 'text/turtle, application/ld+json' },
    });
    if (!res.ok) {
      return podRootFromWebid(session.webid);
    }
    const ct   = res.headers.get('content-type') ?? '';
    const body = await res.text();
    const url  = parseStorageTriple(body, ct, session.webid);
    if (url) return url.endsWith('/') ? url : url + '/';
  } catch {
    // Network / parse error — fall through.
  }
  return podRootFromWebid(session.webid);
}

/**
 * Best-effort extraction of the `pim:storage` URL from a WebID doc.
 * Handles Turtle (most common) + JSON-LD; ignores RDF/XML.
 *
 * @internal
 */
function parseStorageTriple(body, contentType, webid) {
  if (contentType.includes('application/ld+json') || body.trim().startsWith('{')) {
    return parseStorageFromJsonLd(body, webid);
  }
  return parseStorageFromTurtle(body);
}

function parseStorageFromTurtle(body) {
  // Full-URI form: <pim:storage> <pod>.
  const fullRe   = /<http:\/\/www\.w3\.org\/ns\/pim\/space#storage>\s*<([^>]+)>/i;
  const fullMatch = body.match(fullRe);
  if (fullMatch) return fullMatch[1];
  // Prefixed form: pim:storage <pod>. OR space:storage <pod>.
  // We accept any prefix declared with the canonical IRI.
  const prefixDeclRe = /@prefix\s+(\w+)\s*:\s*<http:\/\/www\.w3\.org\/ns\/pim\/space#>\s*\.?/i;
  const prefixDecl   = body.match(prefixDeclRe);
  if (prefixDecl) {
    const prefix = prefixDecl[1];
    const re = new RegExp(`\\b${prefix}:storage\\s*<([^>]+)>`, 'i');
    const m  = body.match(re);
    if (m) return m[1];
  }
  // Fallback: bare `space:storage` / `pim:storage` (common defaults).
  const fallbacks = ['space:storage', 'pim:storage'];
  for (const pred of fallbacks) {
    const re = new RegExp(`\\b${pred.replace(':', '\\:')}\\s*<([^>]+)>`, 'i');
    const m = body.match(re);
    if (m) return m[1];
  }
  return null;
}

function parseStorageFromJsonLd(body, webid) {
  try {
    const json = JSON.parse(body);
    const docs = Array.isArray(json) ? json
               : Array.isArray(json['@graph']) ? json['@graph']
               : [json];
    for (const doc of docs) {
      const id = doc?.['@id'];
      if (id && (id === webid || webid.startsWith(id))) {
        const storage = doc?.[PIM_STORAGE];
        if (typeof storage === 'string') return storage;
        if (Array.isArray(storage) && storage.length > 0) {
          const first = storage[0];
          return typeof first === 'string' ? first : first?.['@id'];
        }
      }
    }
  } catch { /* fall through */ }
  return null;
}

/* ───────────────── v0.7.P3d — WebID ↔ NKN mapping ───────────────── */

// The namespace for app-specific triples published to user pods:
// <webid> <onderling:peerAddr> "<nkn-address-string>" — see publishPeerAddr/discoverPeerAddr below.
// Naming migration 2026-07-29: new docs use the onderling namespace; discovery still accepts the two
// legacy spellings (canopy.dev prefix + IRI) so peers on older app versions stay discoverable.

/**
 * v0.7.P3d — publish the user's peer address as a triple in their
 * pod profile, so other users can discover it from their WebID.
 *
 * Writes a small Turtle doc at <pod>/onderling/identity/identity.ttl containing:
 *   <#me> onderling:peerAddr "app.<addr-hex>" .
 * A legacy `canopy:peerAddr` triple is written ALONGSIDE for one migration window, so a peer still on
 * an older app version can keep discovering this address.
 *
 * Lives separately from the WebID doc (which the user can't always
 * write to directly).  Discovery: peer fetches THIS doc by URL
 * convention.
 *
 * @param {{ podRoot: string, write: Function }} podWriter
 * @param {string} peerAddr
 * @returns {Promise<{ ok: boolean, url: string, status: number }>}
 */
export async function publishPeerAddr(podWriter, peerAddr) {
  if (!podWriter?.write) throw new TypeError('publishPeerAddr: podWriter required');
  if (typeof peerAddr !== 'string' || peerAddr === '') {
    throw new TypeError('publishPeerAddr: peerAddr required');
  }
  const safe = peerAddr.replace(/"/g, '\\"');
  const turtle = `@prefix onderling: <https://onderling.org/ns#>.
@prefix canopy: <https://canopy.dev/ns#>.
<#me> onderling:peerAddr "${safe}" .
<#me> canopy:peerAddr "${safe}" .
`;
  return podWriter.write('identity', 'identity.ttl', turtle, 'text/turtle');
}

/**
 * v0.7.P3d — discover a peer's peer address by fetching their WebID
 * + following the pod root + reading their identity.ttl.
 *
 * Two-step:
 *   1. Get the peer's WebID doc → find pim:storage (their pod root)
 *   2. Fetch <pod>/onderling/identity/identity.ttl (falling back to the legacy canopy/ path for a peer
 *      who hasn't republished since the rename) → extract the peerAddr triple (either spelling)
 *
 * Falls back to null when any step fails (network, no triple, ACL).
 *
 * @param {{ fetch: typeof fetch }} session   our session.fetch
 * @param {string} targetWebid
 * @returns {Promise<string|null>}
 */
export async function discoverPeerAddr(session, targetWebid) {
  if (typeof session?.fetch !== 'function') return null;
  if (typeof targetWebid !== 'string' || targetWebid === '') return null;

  // Step 1: find the peer's pod root.
  const peerPodRoot = await discoverPodRoot({
    webid: targetWebid,
    fetch: session.fetch,
  }).catch(() => null);
  if (!peerPodRoot) return null;

  // Step 2: fetch the peer's identity.ttl — the new path first, then the legacy canopy/ path (a peer
  // who hasn't republished since the 2026-07-29 rename still lives there).
  for (const url of [
    `${peerPodRoot}onderling/identity/identity.ttl`,
    `${peerPodRoot}canopy/identity/identity.ttl`,
  ]) {
    try {
      const res = await session.fetch(url, {
        headers: { Accept: 'text/turtle' },
      });
      if (!res.ok) continue;
      const body = await res.text();
      // Accept the new AND legacy spellings, each as bare prefix or full IRI.
      const full = body.match(/<https:\/\/(?:onderling\.org|canopy\.dev)\/ns#peerAddr>\s*"([^"]+)"/);
      if (full) return full[1];
      const pref = body.match(/\b(?:onderling|canopy):peerAddr\s*"([^"]+)"/);
      if (pref) return pref[1];
    } catch {
      /* try the next path */
    }
  }
  return null;
}

/**
 * Build a pod-namespaced URL for basis-managed app state.
 *
 * Naming migration 2026-07-29: NEW writes land under `onderling/`; `podUrlLegacy` spells the same
 * resource under the old `canopy/` namespace — read paths try new-then-legacy so state written before
 * the rename keeps resolving. Old app versions keep writing canopy/ until updated, which the fallback
 * also covers.
 *
 * @param {string} podRoot   from podRootFromWebid()
 * @param {string} app       'calendar' | 'household' | …
 * @param {string} resource  path under the app (e.g. 'feed.ics')
 * @returns {string}         full https URL
 */
export function podUrl(podRoot, app, resource) {
  if (typeof podRoot !== 'string' || podRoot === '') {
    throw new TypeError('podUrl: podRoot required');
  }
  const base = podRoot.endsWith('/') ? podRoot : podRoot + '/';
  const r = String(resource ?? '').replace(/^\/+/, '');
  return `${base}onderling/${app}/${r}`;
}

/** The legacy `canopy/` spelling of the same resource — read-fallback only, never written. */
export function podUrlLegacy(podRoot, app, resource) {
  return podUrl(podRoot, app, resource).replace('/onderling/', '/canopy/');
}

/**
 * Create a podWriter bound to a signed-in session.
 *
 * @param {{ fetch: typeof fetch, webid: string }} session
 * @returns {{
 *   write: (app: string, resource: string, body: string, contentType: string) => Promise<{ ok: boolean, url: string, status: number }>,
 *   read:  (app: string, resource: string) => Promise<{ ok: boolean, url: string, body: string|null, status: number }>,
 *   urlFor: (app: string, resource: string) => string,
 *   webid: string,
 *   podRoot: string,
 * }}
 */
export function createPodWriter(session, opts = {}) {
  if (!session || typeof session.fetch !== 'function' || typeof session.webid !== 'string') {
    throw new TypeError('createPodWriter: session with {fetch, webid} required');
  }
  // v0.7. — caller can supply a pre-discovered pod root (e.g.
  // from discoverPodRoot(session)).  Defaults to the URL-shape
  // heuristic if not provided.
  const podRoot = (typeof opts.podRoot === 'string' && opts.podRoot)
    ? (opts.podRoot.endsWith('/') ? opts.podRoot : opts.podRoot + '/')
    : podRootFromWebid(session.webid);

  return {
    webid:   session.webid,
    podRoot,
    urlFor:  (app, resource) => podUrl(podRoot, app, resource),
    /**
     * Ensure parent container exists (recursively).  Some Solid
     * servers (community-solid-server / CSS) require explicit
     * container creation before you can PUT into them; Inrupt's
     * older NSS auto-creates. v0.7. adds the explicit step.
     */
    async ensureContainer(containerUrl) {
      // Stop at pod root.
      if (containerUrl === podRoot) return { ok: true, status: 200, url: containerUrl, created: false };
      // Check if it exists.
      try {
        const head = await session.fetch(containerUrl, { method: 'HEAD' });
        if (head.ok) return { ok: true, status: head.status, url: containerUrl, created: false };
      } catch { /* fall through to create */ }
      // Recurse up first.
      const parent = containerUrl.replace(/[^/]+\/?$/, '');
      if (parent && parent !== containerUrl) {
        await this.ensureContainer(parent);
      }
      // Create via PUT with empty body + Link header indicating
      // Container resource type.  Most Solid servers accept this.
      const res = await session.fetch(containerUrl, {
        method:  'PUT',
        headers: {
          'Content-Type': 'text/turtle',
          'Link':         '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"',
        },
        body: '',
      });
      return { ok: res.ok, status: res.status, url: containerUrl, created: res.ok };
    },
    async write(app, resource, body, contentType = 'application/octet-stream') {
      const url = podUrl(podRoot, app, resource);
      // Pre-create parent container (containerUrl ends with /).
      const containerUrl = url.replace(/[^/]+$/, '');
      const cont = await this.ensureContainer(containerUrl).catch((err) => ({
        ok: false, status: 0, url: containerUrl, error: err?.message ?? String(err),
      }));
      // Even if container creation reported failure, try the PUT —
      // some servers return non-2xx HEAD but still accept the write.
      const res = await session.fetch(url, {
        method:  'PUT',
        headers: { 'Content-Type': contentType },
        body,
      });
      // Surface the body of failures so the caller can show the
      // server's error text (CORS rejection / WAC denial / etc).
      let errorBody = null;
      if (!res.ok) {
        try { errorBody = await res.text(); } catch { /* defensive */ }
      }
      return {
        ok: res.ok, url, status: res.status,
        ...(errorBody ? { errorBody: errorBody.slice(0, 500) } : {}),
        ...(cont?.created ? { containerCreated: true } : {}),
      };
    },
    async read(app, resource) {
      // New namespace first; fall back to the legacy canopy/ path so pre-rename state keeps resolving.
      let last = null;
      for (const url of [podUrl(podRoot, app, resource), podUrlLegacy(podRoot, app, resource)]) {
        try {
          const res = await session.fetch(url);
          if (res.ok) {
            const body = await res.text();
            return { ok: true, url, body, status: res.status };
          }
          last = { ok: false, url, body: null, status: res.status };
        } catch (err) {
          last = { ok: false, url, body: null, status: 0, error: err?.message };
        }
      }
      return last ?? { ok: false, url: podUrl(podRoot, app, resource), body: null, status: 0 };
    },
  };
}
