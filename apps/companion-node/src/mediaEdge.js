/**
 * mediaEdge — the companion node's SECOND tenant: the media blob edge.
 *
 * The companion node is a MULTI-TENANT host. Tenant #1 is the folio agent hosted
 * over the relay's WebSocket (index.js). Tenant #2 is THIS: the blob-gateway HTTP
 * edge, mounted additively on the SAME relay HTTP server via `startRelay`'s
 * `blobGate` seam (packages/relay/src/server.js:254 → blobGateMount.js). One
 * process, one port, two tenants — that is the whole thesis this slice proves.
 *
 * `buildDevMediaEdge` assembles the `blobGate` object `startRelay` consumes:
 *
 *     { verifyToken, bucket, uploaders?, ttl?, route? }
 *
 *   • verifyToken — the onderling `createCapabilityVerifier` (blob-gateway adapter):
 *                   media Phase-1 posture — `requiredSkill: 'media.read'`,
 *                   `requireSelfIssued: true` (issuer === subject, so the ACL
 *                   actor is proof-of-possession of the signing key), REAL Ed25519
 *                   signature check (CapabilityToken.verify), deny-by-default on
 *                   any failure. No unsealed fallback exists at this layer — the
 *                   sealed-only invariant lives in uploadBlob/openBlob.
 *   • bucket      — a DEV in-memory bucket (the honest analog of the real R2/S3
 *                   bucket): ciphertext-only object store with presign (GET) +
 *                   presignPut (upload-url) + a `fetchPresigned` dev resolver
 *                   standing in for "the presigned URL grants HTTP access to the
 *                   ciphertext". Mirrors the established dev-bucket contract
 *                   (blob-gateway test helpers / basis circleMediaGateway).
 *   • uploaders   — the allow-list of actor ids (webIds = token subjects) permitted
 *                   to /grant and /upload-url. DEFAULT: [] ⇒ NOBODY (deny-by-default;
 *                   we never silently open this — a real deploy configures it).
 *   • acl         — LEFT to the mount, which defaults a fresh MemoryBlobAclStore and
 *                   returns it as `relay.blobGate.acl` (deny-by-default; grants are
 *                   recorded only through the authenticated /grant route).
 *
 * ── REAL vs DEV (what a production deploy swaps) ──────────────────────────────
 *   REAL here — the relay HTTP mount, the capability verifier (real Ed25519), the
 *               deny-by-default gate + ACL, the sealed-only upload/open invariants,
 *               the presign→grant→open wire.
 *   DEV here  — the in-memory bucket. Its presigned URLs are NOT HTTP-reachable
 *               object URLs; the sealed bytes live in-process and vanish on stop.
 *   SWAP SEAM — one documented infra action (Frits): replace `bucket` with the
 *               S3/R2 adapter. Nothing else changes shape:
 *                 import { createS3Bucket } from '@onderling/blob-gateway/adapters/s3';
 *                 buildDevMediaEdge({ bucket: createS3Bucket({ endpoint: R2_ENDPOINT,
 *                   region: 'auto', bucket: R2_BUCKET, accessKeyId, secretAccessKey }),
 *                   uploaders: [...] })
 *               // real bucket/verifier swap = Frits' infra action (one documented seam)
 */
import { createCapabilityVerifier } from '@onderling/blob-gateway/adapters/capability-verifier';

const DEFAULT_TTL   = 60;              // seconds — short-lived presigned URLs
const DEFAULT_SKILL = 'media.read';
const DEFAULT_ROUTE = '/blob-gate';

/**
 * DEV-GRADE in-memory blob bucket — the honest analog of the real R2/S3 bucket.
 * Ciphertext-only (uploadBlob refuses to hand it plaintext). Same injected
 * contract the blob-gateway test rig + basis dev mode model:
 *   put / presign(GET) / presignPut(upload-url) / delete + a `fetchPresigned`
 *   resolver standing in for HTTP-fetching a real presigned bucket URL.
 * NOT an S3 client — no sigv4, no network; it just moves opaque bytes in-process.
 */
export function makeDevBlobBucket() {
  const store    = new Map();   // key → sealed envelope (ciphertext)
  const presigns = new Map();   // url → { key, expiresAt, method }
  let n = 0;
  const mint = (key, method, ttl) => {
    const url = `dev-bucket://${method}/${key}?sig=${(n += 1)}`;
    presigns.set(url, { key, method, expiresAt: Date.now() + (ttl ?? DEFAULT_TTL) * 1000 });
    return url;
  };
  return {
    store,
    async put(key, bytes) { store.set(key, bytes); },
    /** Short-lived URL granting GET access to the stored ciphertext. */
    async presign(key, { ttl } = {}) {
      if (!store.has(key)) return null;
      return mint(key, 'get', ttl);
    },
    /** Short-lived PUT URL — the credential-less upload seam (/upload-url). A dev
     *  url; a real client PUTs to R2 here. Present so /upload-url authorizes an
     *  uploader instead of opaque-403'ing on a presignPut-less bucket. */
    async presignPut(key, { ttl } = {}) {
      return mint(key, 'put', ttl);
    },
    async delete(key) { store.delete(key); },
    /** Dev stand-in for HTTP-GETting a presigned URL back to the ciphertext. */
    async fetchPresigned(url) {
      const rec = presigns.get(url);
      if (!rec || rec.method !== 'get' || Date.now() > rec.expiresAt) return null;
      return store.get(rec.key);
    },
  };
}

/**
 * Build the DEV media blob edge — the `blobGate` object `startRelay` mounts as the
 * companion's 2nd tenant. Keeps sealed-only / deny-by-default invariants intact.
 *
 * @param {object}   [opts]
 * @param {string[]} [opts.uploaders=[]]  actor ids (token subjects) allowed to
 *                                        /grant + /upload-url. DEFAULT [] = NOBODY.
 * @param {number}   [opts.ttl=60]        presigned-URL lifetime (seconds)
 * @param {string}   [opts.requiredSkill='media.read']  skill the gate demands
 * @param {string}   [opts.route='/blob-gate']          mount path
 * @param {object}   [opts.bucket]        inject a bucket (real deploy: createS3Bucket);
 *                                        default a fresh dev in-memory bucket
 * @param {Function} [opts.verifyToken]   inject a verifier; default the capability verifier
 * @returns {{ verifyToken: Function, bucket: object, uploaders: string[], ttl: number, route: string }}
 *   the exact shape `startRelay({ blobGate })` → `mountBlobGate` consumes.
 */
export function buildDevMediaEdge({
  uploaders = [],
  ttl = DEFAULT_TTL,
  requiredSkill = DEFAULT_SKILL,
  route = DEFAULT_ROUTE,
  bucket,
  verifyToken,
} = {}) {
  // Media Phase-1 posture: sealed-only, self-issued capability tokens, deny-by-default.
  // requireSelfIssued defaults TRUE for the non-wildcard 'media.read' skill; make it
  // explicit so the invariant is legible at the composition root.
  const verifier = typeof verifyToken === 'function'
    ? verifyToken
    : createCapabilityVerifier({ requiredSkill, requireSelfIssued: true });

  return {
    verifyToken: verifier,
    bucket:      bucket ?? makeDevBlobBucket(),
    uploaders:   Array.isArray(uploaders) ? uploaders : [],
    ttl,
    route,
  };
}
