/**
 * mountBlobGate — mount the blob-gateway HTTP edge on the relay's HTTP server.
 *
 * PLAN-media-infra-deployment (DECIDED: edge-on-relay, R2 as provider).
 * The relay already terminates HTTP(S) for its WebSocket endpoint + optional
 * static dir; this mount ADDS two JSON endpoints under `route` (default
 * '/blob-gate') and leaves every other path byte-identical — non-mount
 * requests fall through to the relay's pre-existing request listeners.
 *
 *   GET|POST <route>?ref=blob://<key>     Authorization: Bearer <token>
 *     → 200 { url }                       presigned GET to the ciphertext
 *     → 403 { error: 'forbidden' }        on ANY denial
 *
 *   POST <route>/grant                    Authorization: Bearer <token>
 *     body { key: 'blob://<key>', actors: ['<actorId>', …] }
 *     → 200 { ok: true, granted: n }      grants recorded in the ACL store
 *     → 403 { error: 'forbidden' }        on ANY denial
 *
 *   POST <route>/upload-url               Authorization: Bearer <token>
 *     body { key: '<bucketKey>' }         ⚠ the BARE bucket key — NOT a `blob://` ref
 *     → 200 { url }                       presigned PUT URL to the ciphertext
 *     → 403 { error: 'forbidden' }        on ANY denial
 *
 * ⚠ `key` MEANS TWO DIFFERENT THINGS on the two routes above, and this doc used to get it wrong.
 *   • `/grant` takes the FULL ref (`blob://<key>`) — it is stored verbatim and the reader presents the
 *     same string back, so the ACL store never parses it.
 *   • `/upload-url` takes the BARE bucket key — it goes to `bucket.presignPut(key)`, which must be the
 *     object name, because the GET side derives that name with `bucketKeyFromRef` (which STRIPS the
 *     scheme).
 *   This header previously documented `/upload-url` as taking `blob://<key>`. A second client written to
 *   that line would have PUT its ciphertext under the literal object name `blob://<key>`, received a 200,
 *   and produced a blob that every later read fails to find — a silent, permanent loss with a success
 *   response. Corrected 2026-08-03. Today only `circleMediaGateway` speaks this wire and it sends the bare
 *   key, so nothing is broken; the doc was the only thing wrong, and it was wrong in the dangerous
 *   direction.
 *
 * CREDENTIAL-LESS CLIENT UPLOAD (presigned PUT — PLAN-media-infra-deployment):
 * a client that holds an uploader token never sees R2/S3 credentials. The flow is
 *   1. client → POST <route>/upload-url { key }   → { url }   (a short-lived PUT URL)
 *   2. client → PUT <url> (the sealed bytes)      → R2 directly (edge never sees them)
 *   3. client → POST <route>/grant { key, actors }             (record read-ACL)
 * The `uploaders` allow-list gates BOTH /upload-url and /grant, and is EDGE DEPLOY
 * CONFIG (env / mount options), never data — same deny-by-default discipline.
 * REMOTE UPLOADS REQUIRE A `presignPut`-CAPABLE BUCKET: the s3 adapter
 * (`createS3Bucket`) has `presignPut(key,{ttl})`; a memory/`presign`-only bucket
 * does not, so /upload-url is an opaque 403 there (no remote PUT surface exists).
 *
 * NO-LEAK: the presign path reuses `createHttpGate` from `@onderling/blob-gateway`,
 * which already collapses every failure (missing/invalid token, ACL deny, bad
 * ref, thrown error) to the same opaque 403 — no reason, no URL. The grant
 * route and any unknown path under the mount follow the same rule: one opaque
 * 403 body, always. Do not add deny reasons here.
 *
 * GRANT-AUTH RULE (v1, deny-by-default): a grant needs a valid token
 * (`verifyToken(token) → { webId }`) AND that webId must be listed in the
 * `uploaders` allow-list given at mount time. No `uploaders` option (or an
 * empty list) means NOBODY can grant — deny-by-default. We chose the explicit
 * allow-list over a token-scope rule because the injected `verifyToken`
 * contract only promises `{ webId }` — scopes/skills are not part of it, and
 * inventing one here would fork the blob-gateway contract.
 *
 * R2 WIRING (S3-compatible — creds are CONFIG via env, never in the repo):
 *
 *   import { createS3Bucket } from '@onderling/blob-gateway/adapters/s3';
 *   const bucket = createS3Bucket({
 *     endpoint:        process.env.R2_ENDPOINT,      // https://<account-id>.r2.cloudflarestorage.com
 *     region:          'auto',                       // R2 ignores region; 'auto' is conventional
 *     bucket:          process.env.R2_BUCKET,
 *     accessKeyId:     process.env.R2_ACCESS_KEY_ID,
 *     secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
 *   });
 *   await startRelay({ port: 8787, blobGate: { verifyToken, bucket, uploaders: [...] } });
 *
 * @param {import('node:http').Server | { httpServer: import('node:http').Server }} server
 *   The relay's HTTP(S) server (or the `startRelay` result carrying one).
 * @param {object}   opts
 * @param {Function} opts.verifyToken       token => Promise<{ webId }|null> (INJECTED, duck-typed)
 * @param {object}   opts.bucket            { presign(key, {ttl}) => url } (e.g. createS3Bucket)
 * @param {object}   [opts.acl]             A `BlobAclStore` ({ check, grantMany, … }) or a
 *                                          gatekeeper-style `{ canRead }` (read-only: the grant
 *                                          route then denies). Defaults to a fresh MemoryBlobAclStore.
 * @param {number}   [opts.ttl]             Presigned-URL lifetime in seconds (gatekeeper default: 60).
 * @param {string}   [opts.route='/blob-gate']  Mount path.
 * @param {string[]} [opts.uploaders]       Allow-list of actor ids (webIds) permitted to grant.
 * @returns {{ route: string, acl: object }}  The mount's route + the live ACL store.
 */
import { createHttpGate } from '@onderling/blob-gateway/http';
import { MemoryBlobAclStore } from './blobAclStore.js';

const DENY = Object.freeze({ status: 403, body: Object.freeze({ error: 'forbidden' }) });
const MAX_BODY_BYTES = 64 * 1024;   // grant bodies are tiny; cap defensively.

export function mountBlobGate(server, {
  verifyToken, bucket, acl, ttl, route = '/blob-gate', uploaders,
} = {}) {
  const httpServer = server?.httpServer ?? server;
  if (!httpServer || typeof httpServer.listeners !== 'function') {
    throw new Error('mountBlobGate: a node http(s) server (or { httpServer }) is required');
  }
  if (typeof verifyToken !== 'function') {
    throw new Error('mountBlobGate: verifyToken(token) => {webId}|null required');
  }

  // ACL: a BlobAclStore by default; a gatekeeper-style { canRead } also works
  // for the read path (its grant route stays deny-by-default: no grantMany, no grants).
  const aclStore = acl ?? new MemoryBlobAclStore();
  const canRead = typeof aclStore.canRead === 'function'
    ? (webId, ref) => aclStore.canRead(webId, ref)
    : (webId, ref) => aclStore.check(webId, ref);

  const handleGate = createHttpGate({ verifyToken, acl: { canRead }, bucket, ttl });
  const granters     = new Set(uploaders ?? []);
  const grantPath    = `${route}/grant`;
  const uploadUrlPath = `${route}/upload-url`;

  // Shared uploader auth (deny-by-default): valid token AND its webId in the
  // `uploaders` allow-list. No/empty `uploaders` ⇒ nobody. Both the grant route
  // and the upload-url route gate on THIS — do not fork the check. Returns the
  // authorised webId, or null (the caller collapses null to the opaque 403).
  const authorizeUploader = async (req) => {
    const token = bearerFrom(req.headers?.authorization);
    if (!token) return null;
    const verified = await verifyToken(token);
    const webId = verified && verified.webId;
    if (!webId) return null;
    if (!granters.has(webId)) return null;
    return webId;
  };

  // ── grant route (deny-by-default; every failure is the same opaque 403) ────
  const handleGrant = async (req) => {
    try {
      if (!(await authorizeUploader(req))) return DENY;
      if (typeof aclStore.grantMany !== 'function') return DENY;

      const body = await readJsonBody(req);
      const { key, actors } = body ?? {};
      if (typeof key !== 'string' || key.length === 0) return DENY;
      if (!Array.isArray(actors) || actors.length === 0) return DENY;
      if (!actors.every(a => typeof a === 'string' && a.length > 0)) return DENY;

      await aclStore.grantMany(key, actors);
      return { status: 200, body: { ok: true, granted: actors.length } };
    } catch {
      return DENY;
    }
  };

  // ── upload-url route (same uploader auth; issues a presigned PUT URL) ───────
  // A `presignPut`-less bucket (e.g. a memory bucket) has no remote-PUT surface,
  // so it denies opaquely — remote uploads need the s3 adapter's presignPut.
  const handleUploadUrl = async (req) => {
    try {
      if (!(await authorizeUploader(req))) return DENY;
      if (typeof bucket?.presignPut !== 'function') return DENY;

      const body = await readJsonBody(req);
      const { key } = body ?? {};
      if (typeof key !== 'string' || key.length === 0) return DENY;

      const url = await bucket.presignPut(key, { ttl });
      if (!url) return DENY;
      return { status: 200, body: { url } };
    } catch {
      return DENY;
    }
  };

  // ── mount dispatch ──────────────────────────────────────────────────────────
  const handleMount = async (req, res, pathname) => {
    let out = DENY;
    try {
      if (pathname === route) {
        // httpGate's framework-agnostic req: ref comes from the query string
        // (or a JSON POST body), token from the Authorization header.
        const body = req.method === 'POST' ? await readJsonBody(req) : undefined;
        out = await handleGate({ method: req.method, url: req.url, headers: req.headers, body });
      } else if (pathname === grantPath && req.method === 'POST') {
        out = await handleGrant(req);
      } else if (pathname === uploadUrlPath && req.method === 'POST') {
        out = await handleUploadUrl(req);
      }
      // Any other path/method under the mount stays the opaque DENY.
    } catch {
      out = DENY;
    }
    respondJson(res, out);
  };

  // Wire ADDITIVELY onto the relay's existing HTTP dispatch: the server's
  // current 'request' listeners (the static-dir/banner handler from
  // `startRelay`) are captured and re-invoked verbatim for every non-mount
  // path, so untouched routes behave byte-identically.
  const existing = httpServer.listeners('request').slice();
  httpServer.removeAllListeners('request');
  httpServer.on('request', (req, res) => {
    const pathname = (req.url ?? '').split('?')[0];
    if (pathname === route || pathname.startsWith(`${route}/`)) {
      handleMount(req, res, pathname);
      return;
    }
    for (const listener of existing) listener.call(httpServer, req, res);
  });

  return { route, acl: aclStore };
}

/* ── node req/res adaptation ────────────────────────────────────────────────── */

function respondJson(res, { status, body }) {
  try {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  } catch { /* client may have raced a disconnect */ }
}

/** Same Bearer/DPoP extraction the httpGate default parser uses. */
function bearerFrom(auth) {
  if (!auth || typeof auth !== 'string') return null;
  const m = auth.match(/^\s*(?:Bearer|DPoP)\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/** Collect + parse a small JSON body. Throws on over-cap / bad JSON — callers
 *  collapse that to the opaque 403. */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve(undefined);
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}
