/**
 * SolidPodSource — DataSource backed by a Solid Pod (LDP).
 *
 * Implementation engine for Track A1 of the pod substrate.  Wraps
 * `@inrupt/solid-client` for read/write/list/delete and a raw HEAD via
 * `fetch` for `exists`.  The higher-level `@onderling/pod-client` API
 * (Track A5) is layered on top of this class and maps the raw `code`-bearing
 * errors thrown here onto its own `PodClientError` taxonomy.
 *
 * Note that this class diverges from the abstract `DataSource` contract in
 * one important way: `read(uri)` returns a *rich object*
 * `{ content, contentType, lastModified, etag, size }` rather than a raw
 * `Buffer|string|null`.  This is intentional — the pod-client surface
 * (see `Design-v3/pod-client-api.md`) needs the metadata for conflict
 * detection.  Consumers that only want the bytes pull `.content`.
 *
 * Errors thrown by this class are plain `Error`s with a `code` field drawn
 * from this small taxonomy:
 *
 *   - `NOT_FOUND`           — resource doesn't exist (HTTP 404)
 *   - `UNAUTHORIZED`        — auth missing or invalid (HTTP 401)
 *   - `FORBIDDEN`           — auth valid but lacks the requested scope (HTTP 403)
 *   - `CONFLICT`            — `If-Match` precondition failed (HTTP 409 / 412)
 *   - `RATE_LIMITED`        — server told us to back off (HTTP 429)
 *   - `SERVER_ERROR`        — 5xx
 *   - `NETWORK_ERROR`       — fetch threw before a response arrived
 *   - `INVALID_ARGUMENT`    — bad input (no podUrl, etc.)
 *   - `HTTP_ERROR`          — anything else
 *
 * `@onderling/pod-client` is responsible for translating these to typed
 * `PodClientError` subclasses.
 */
import {
  getFile,
  overwriteFile,
  deleteFile,
  getSolidDataset,
  getContainedResourceUrlAll,
  getContentType,
  getSourceUrl,
  createContainerAt,
} from '@inrupt/solid-client';

import { DataSource } from '@onderling/core';
import { log } from '@onderling/logger';

/* ─────────────────────────────────────────────────────────────────────────── */

const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

/**
 * Map an HTTP status to one of our error codes.
 * @param {number} status
 * @returns {string}
 */
function codeForStatus(status) {
  if (status === 404)               return 'NOT_FOUND';
  if (status === 401)               return 'UNAUTHORIZED';
  if (status === 403)               return 'FORBIDDEN';
  if (status === 409 || status === 412) return 'CONFLICT';
  if (status === 429)               return 'RATE_LIMITED';
  if (status >= 500 && status < 600) return 'SERVER_ERROR';
  return 'HTTP_ERROR';
}

/**
 * Build an Error with a `.code`, `.status`, `.uri` and optional `.cause`.
 * Use this everywhere instead of throwing raw — it keeps A5's mapper simple.
 */
function podError(message, { code, status, uri, cause } = {}) {
  const err = new Error(message);
  if (code   !== undefined) err.code   = code;
  if (status !== undefined) err.status = status;
  if (uri    !== undefined) err.uri    = uri;
  if (cause  !== undefined) err.cause  = cause;
  return err;
}

/**
 * Translate an exception thrown by `@inrupt/solid-client` (or by a raw
 * `fetch`) into a code-bearing `Error`.  The Inrupt v3 client throws
 * `ClientHttpError` instances that expose `.response.status`; older
 * shapes (and our own `fetch` paths) expose `.statusCode` or `.status`.
 */
function rethrow(err, uri, op = 'pod') {
  // Already one of ours — propagate unchanged (it was already logged at origin).
  if (err && typeof err.code === 'string' && err.code !== undefined && err.message) {
    if (['NOT_FOUND', 'UNAUTHORIZED', 'FORBIDDEN', 'CONFLICT', 'RATE_LIMITED',
         'SERVER_ERROR', 'NETWORK_ERROR', 'INVALID_ARGUMENT', 'HTTP_ERROR'].includes(err.code)) {
      throw err;
    }
  }

  // Inrupt v3 ClientHttpError — has `response.status`.
  const status =
    err?.response?.status ??
    err?.statusCode ??
    err?.status ??
    null;

  if (typeof status === 'number') {
    // PII-SAFE: coarse op label + our error code + numeric status + error NAME.
    // NEVER the URI (which carries the resource path / user identity) or content.
    log.error('pod', 'pod.error', { op, code: codeForStatus(status), status, err: err?.name ?? 'Error' });
    throw podError(err.message || `Pod request failed (${status})`, {
      code: codeForStatus(status),
      status,
      uri,
      cause: err,
    });
  }

  // Fetch-level failure — DNS, connection refused, abort, etc.
  log.error('pod', 'pod.error', { op, code: 'NETWORK_ERROR', err: err?.name ?? 'Error' });
  throw podError(err?.message || 'Pod network error', {
    code: 'NETWORK_ERROR',
    uri,
    cause: err,
  });
}

/**
 * Convert an arbitrary write payload into a Blob suitable for
 * `overwriteFile`.  We pass the explicit `type` so the LDP server's
 * Content-Type is set correctly.
 *
 * @param {string|Uint8Array|ArrayBuffer|Blob|Buffer} data
 * @param {string} contentType
 * @returns {Blob}
 */
function toBlob(data, contentType) {
  if (typeof Blob === 'undefined') {
    throw podError('Blob is not available in this runtime', { code: 'INVALID_ARGUMENT' });
  }
  if (data instanceof Blob) {
    // If the caller already gave us a Blob with a different type, re-wrap so
    // the contentType the caller asked for wins.
    if (data.type === contentType) return data;
    return new Blob([data], { type: contentType });
  }
  if (typeof data === 'string') {
    return new Blob([data], { type: contentType });
  }
  if (data instanceof Uint8Array) {
    return new Blob([data], { type: contentType });
  }
  if (data instanceof ArrayBuffer) {
    return new Blob([data], { type: contentType });
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) {
    return new Blob([new Uint8Array(data)], { type: contentType });
  }
  throw podError('Unsupported write payload', { code: 'INVALID_ARGUMENT' });
}

/**
 * Read a couple of conventional headers off whatever `solid-client` returned.
 * We piggy-back on the underlying Blob plus the `internal_resourceInfo`
 * metadata; we cannot get `lastModified` / `etag` from the Inrupt API
 * directly so we re-fetch the headers via HEAD when callers need them.
 *
 * Returns `{ contentType, size }` — the rest is filled in by callers that
 * also issued a HEAD.
 */
function infoFromInruptFile(file) {
  const contentType = getContentType(file) ?? DEFAULT_CONTENT_TYPE;
  // Blob exposes `.size`; if not present (defensive), fall back to 0.
  const size = typeof file?.size === 'number' ? file.size : 0;
  return { contentType, size };
}

/* ─────────────────────────────────────────────────────────────────────────── */

/**
 * `DataSource` over a Solid pod via `@inrupt/solid-client`: read/write/list/delete/exists plus
 * container creation, using an injected authenticated `fetch` (falls back to `globalThis.fetch`).
 * Relative URIs are resolved against `podUrl`; reads return bytes plus `etag`/`lastModified`
 * metadata for conflict detection upstream.
 */
export class SolidPodSource extends DataSource {
  #podUrl;
  #fetch;

  /**
   * @param {object} opts
   * @param {string}   [opts.podUrl]   — base URL of the Solid Pod (e.g.
   *                                      `https://pod.example.org/`).  Used
   *                                      when callers pass a relative URI.
   *                                      Optional; absolute URIs work without it.
   * @param {Function} [opts.fetch]    — authenticated fetch (e.g. from
   *                                      `SolidVault.getAuthenticatedFetch()`).
   *                                      Falls back to `globalThis.fetch`.
   * @param {string}   [opts.credential] — DEPRECATED.  Kept only for backwards
   *                                      compatibility with the previous stub;
   *                                      currently unused.  Pass `fetch`
   *                                      instead.
   */
  constructor({ podUrl, fetch: fetchFn, credential } = {}) {
    super();
    this.#podUrl = podUrl ?? null;
    this.#fetch  = fetchFn ?? (typeof globalThis !== 'undefined' ? globalThis.fetch : undefined);
    // `credential` is accepted but ignored.  See class JSDoc.
    void credential;
  }

  get podUrl() { return this.#podUrl; }

  // ── DataSource API ──────────────────────────────────────────────────────

  /**
   * Read a resource and return both its bytes and metadata needed for
   * conflict detection upstream.
   *
   * @param {string} uri  — absolute URI, or path relative to `podUrl`.
   * @param {object} [opts]
   * @returns {Promise<{
   *   content:      Uint8Array,
   *   contentType:  string,
   *   lastModified: string|null,
   *   etag:         string|null,
   *   size:         number,
   * }>}
   */
  async read(uri, _opts = {}) {   // eslint-disable-line no-unused-vars
    const fullUri = this.#resolve(uri);
    const t0 = Date.now();
    let blob;
    try {
      blob = await getFile(fullUri, { fetch: this.#fetch });
    } catch (err) {
      rethrow(err, fullUri, 'read');
    }

    const { contentType, size: blobSize } = infoFromInruptFile(blob);
    const buf  = await blob.arrayBuffer();
    const content = new Uint8Array(buf);
    const size = content.byteLength || blobSize;
    // PII-SAFE: byte COUNT + duration only — never the resource path or content.
    log.info('pod', 'pod.read', { bytes: size, ms: Date.now() - t0 });

    // The Inrupt API hides response headers from us; re-fetch with HEAD to
    // get etag/lastModified for conflict detection.  Best-effort — failure
    // here doesn't fail the read.
    let etag = null;
    let lastModified = null;
    try {
      const headRes = await this.#headFetch(fullUri);
      if (headRes && headRes.ok) {
        etag         = headRes.headers.get('etag');
        lastModified = headRes.headers.get('last-modified');
      }
    } catch {
      // ignore — etag/lastModified stay null
    }

    return { content, contentType, lastModified, etag, size };
  }

  /**
   * Write (overwrite) a resource.
   *
   * @param {string} uri  — absolute URI or path relative to `podUrl`.
   * @param {string|Uint8Array|ArrayBuffer|Blob|Buffer} content
   * @param {object} [opts]
   * @param {string} [opts.contentType='application/octet-stream']
   * @param {string} [opts.ifMatch]   — value for the `If-Match` precondition
   * @returns {Promise<{
   *   uri:          string,
   *   contentType:  string,
   *   lastModified: string|null,
   *   etag:         string|null,
   *   size:         number,
   * }>}
   */
  async write(uri, content, opts = {}) {
    const fullUri     = this.#resolve(uri);
    const contentType = opts.contentType || DEFAULT_CONTENT_TYPE;
    const blob        = toBlob(content, contentType);
    const t0          = Date.now();

    // If the caller wants conflict detection, do a manual PUT so we can
    // attach `If-Match`.  `overwriteFile` does not surface request-init.
    if (opts.ifMatch) {
      let res;
      try {
        res = await this.#fetch(fullUri, {
          method: 'PUT',
          headers: {
            'Content-Type': contentType,
            'If-Match':     opts.ifMatch,
          },
          body: blob,
        });
      } catch (err) {
        rethrow(err, fullUri, 'write');
      }
      if (!res.ok) {
        // PII-SAFE: op label + code + numeric status only.
        log.error('pod', 'pod.error', { op: 'write', code: codeForStatus(res.status), status: res.status });
        throw podError(`PUT ${fullUri} failed: ${res.status} ${res.statusText}`, {
          code:   codeForStatus(res.status),
          status: res.status,
          uri:    fullUri,
        });
      }
      // PII-SAFE: byte COUNT + duration + a boolean; never the path or content.
      log.info('pod', 'pod.write', { bytes: blob.size, ms: Date.now() - t0, conditional: true });
      return {
        uri:          fullUri,
        contentType,
        lastModified: res.headers.get('last-modified'),
        etag:         res.headers.get('etag'),
        size:         blob.size,
      };
    }

    // Default path: delegate to Inrupt.
    let saved;
    try {
      saved = await overwriteFile(fullUri, blob, {
        contentType,
        fetch: this.#fetch,
      });
    } catch (err) {
      rethrow(err, fullUri, 'write');
    }

    // Best-effort HEAD for fresh etag/lastModified.
    let etag = null;
    let lastModified = null;
    try {
      const headRes = await this.#headFetch(fullUri);
      if (headRes && headRes.ok) {
        etag         = headRes.headers.get('etag');
        lastModified = headRes.headers.get('last-modified');
      }
    } catch { /* ignore */ }

    const savedUrl =
      (saved && getSourceUrl?.(saved)) ||
      fullUri;

    // PII-SAFE: byte COUNT + duration + a boolean; never the path or content.
    log.info('pod', 'pod.write', { bytes: blob.size, ms: Date.now() - t0, conditional: false });
    return {
      uri:          savedUrl,
      contentType,
      lastModified,
      etag,
      size:         blob.size,
    };
  }

  /**
   * Delete a resource.
   *
   * @param {string} uri
   * @param {object} [opts]
   * @param {string} [opts.ifMatch]   — `If-Match` precondition.
   */
  async delete(uri, opts = {}) {
    const fullUri = this.#resolve(uri);

    if (opts.ifMatch) {
      let res;
      try {
        res = await this.#fetch(fullUri, {
          method: 'DELETE',
          headers: { 'If-Match': opts.ifMatch },
        });
      } catch (err) {
        rethrow(err, fullUri, 'delete');
      }
      if (!res.ok && res.status !== 404) {
        throw podError(`DELETE ${fullUri} failed: ${res.status} ${res.statusText}`, {
          code:   codeForStatus(res.status),
          status: res.status,
          uri:    fullUri,
        });
      }
      return;
    }

    try {
      await deleteFile(fullUri, { fetch: this.#fetch });
    } catch (err) {
      // 404 on delete is a no-op per DataSource semantics.
      const status = err?.response?.status ?? err?.statusCode ?? err?.status ?? null;
      if (status === 404) return;
      rethrow(err, fullUri, 'delete');
    }
  }

  /**
   * List the contents of a container.  `containerUri` should typically end
   * with a `/` per LDP convention; if it doesn't, one is appended.
   *
   * When `opts.recursive` is true, descends into child containers and
   * returns a flat entry list covering every resource and container at
   * or below `containerUri`.  Nested containers appear once each (in the
   * `entries` list of their parent).  Mid-walk 404s are skipped silently
   * (a child container deleted between the parent listing and the
   * recursive descent is a normal race; other errors propagate).
   *
   * @param {string} containerUri
   * @param {object} [opts]
   * @param {boolean} [opts.recursive=false]
   * @returns {Promise<{ container: string, entries: Array<{
   *   uri:           string,
   *   type:          'resource'|'container',
   *   contentType?:  string,
   *   lastModified?: string,
   *   size?:         number,
   * }>}>}
   */
  async list(containerUri = '', opts = {}) {
    let resolved = this.#resolve(containerUri);
    if (!resolved.endsWith('/')) resolved += '/';

    const entries = await this.#listOne(resolved);

    if (!opts.recursive) {
      return { container: resolved, entries };
    }

    // BFS through child containers; flat result list per the contract above.
    const all   = [...entries];
    const queue = entries.filter((e) => e.type === 'container').map((e) => e.uri);
    while (queue.length > 0) {
      const childContainer = queue.shift();
      let subEntries;
      try {
        subEntries = await this.#listOne(childContainer);
      } catch (err) {
        if (err?.code === 'NOT_FOUND') continue;   // race with concurrent delete
        throw err;
      }
      all.push(...subEntries);
      for (const e of subEntries) {
        if (e.type === 'container') queue.push(e.uri);
      }
    }
    return { container: resolved, entries: all };
  }

  async #listOne(resolved) {
    let dataset;
    try {
      dataset = await getSolidDataset(resolved, { fetch: this.#fetch });
    } catch (err) {
      rethrow(err, resolved, 'list');
    }
    const urls = getContainedResourceUrlAll(dataset);
    return urls.map((uri) => ({
      uri,
      type: uri.endsWith('/') ? 'container' : 'resource',
    }));
  }

  /**
   * Check whether a resource exists by issuing a HEAD.
   *
   * @param {string} uri
   * @returns {Promise<boolean>}
   */
  async exists(uri) {
    const fullUri = this.#resolve(uri);
    let res;
    try {
      res = await this.#headFetch(fullUri);
    } catch (err) {
      rethrow(err, fullUri, 'exists');
    }
    if (res.ok)              return true;
    if (res.status === 404)  return false;
    if (res.status === 401)  throw podError('Unauthorized', { code: 'UNAUTHORIZED', status: 401, uri: fullUri });
    if (res.status === 403)  throw podError('Forbidden',    { code: 'FORBIDDEN',    status: 403, uri: fullUri });
    throw podError(`HEAD ${fullUri} failed: ${res.status} ${res.statusText}`, {
      code:   codeForStatus(res.status),
      status: res.status,
      uri:    fullUri,
    });
  }

  /**
   * Idempotently create an LDP container at the given URI.  Inrupt's
   * `createContainerAt` is a no-op (returns the existing container) when
   * the container is already present, so callers don't need to check
   * `exists()` first.  Trailing slash is enforced.
   *
   * @param {string} uri
   * @returns {Promise<{ uri: string }>}
   */
  async createContainer(uri) {
    let fullUri = this.#resolve(uri);
    if (!fullUri.endsWith('/')) fullUri += '/';
    try {
      await createContainerAt(fullUri, { fetch: this.#fetch });
    } catch (err) {
      rethrow(err, fullUri, 'create');
    }
    return { uri: fullUri };
  }

  /**
   * `query` is intentionally unsupported on Solid pods — there's no LDP
   * equivalent of "structured field-match across all resources".  The
   * pod-client API exposes higher-level helpers on top of `read`/`list`.
   */
  async query() {
    throw podError('SolidPodSource does not support query()', {
      code: 'INVALID_ARGUMENT',
    });
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  /**
   * Resolve an input URI:
   * - absolute URLs (`http(s)://…`) pass through unchanged
   * - relative paths are joined to `#podUrl` if it is set
   * - throws if neither holds
   */
  #resolve(input) {
    if (typeof input !== 'string' || input.length === 0) {
      throw podError('SolidPodSource: uri is required', { code: 'INVALID_ARGUMENT' });
    }
    if (/^https?:\/\//i.test(input)) return input;
    // Fail loud: a non-http(s) URI scheme (`mem://`, `pseudo-pod://`,
    // …) is a LOGICAL key, not a pod path.  Concatenating it onto the
    // pod root silently produced `…/mem://…` → 404 (the Pinboard
    // pod-write bug, 2026-05-16).  Callers MUST map logical keys to
    // pod paths (via `@onderling/pod-routing`) before they reach a pod
    // client.
    const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(input);
    if (scheme) {
      throw podError(
        `SolidPodSource: refusing to resolve non-pod URI '${input}' `
        + `(scheme '${scheme[1]}://') against the pod root — map `
        + `logical keys to pod paths before writing`,
        { code: 'INVALID_ARGUMENT' },
      );
    }
    if (!this.#podUrl) {
      throw podError(`SolidPodSource: relative URI '${input}' but no podUrl configured`, {
        code: 'INVALID_ARGUMENT',
      });
    }
    const base = this.#podUrl.endsWith('/') ? this.#podUrl : `${this.#podUrl}/`;
    const tail = input.startsWith('/') ? input.slice(1) : input;
    return base + tail;
  }

  /** Issue a HEAD via the configured fetch, throwing NETWORK_ERROR on failure. */
  async #headFetch(uri) {
    if (typeof this.#fetch !== 'function') {
      throw podError('SolidPodSource: no fetch implementation available', {
        code: 'NETWORK_ERROR', uri,
      });
    }
    return await this.#fetch(uri, { method: 'HEAD' });
  }
}
