/**
 * basis v2 — the LIVE sealed-media composition for a circle (media
 * wiring; plans/NOTE-media-and-streaming.md "no live composition point" gap).
 *
 * `createMediaEmbed` (src/core/handlers/mediaEmbed.js) owns NO infra — it
 * needs an injected `mediaGateway {bucket, sealer, opener?, keyRef?}`. Until
 * now only test harnesses composed one. This module builds that gateway for
 * the ACTIVE circle from the circle's own seal strategy, so the v2 web shell
 * (and later the mobile shell — this module is platform-neutral, no DOM) can
 * offer a real attach affordance:
 *
 *   circle seal strategy ({seal, open}, getCircleSealStrategy)
 *        └─▶ { sealer, opener }               (content sealed with the circle's key)
 *   injected bucket (dev default below)
 *        └─▶ { bucket }                        (ciphertext-only object store)
 *   createBlobGatekeeper + a local-session verifier/ACL
 *        └─▶ { gate, token }                   (deny-by-default full-image reads)
 *
 * SEALED-ONLY stands: a circle with NO content seal strategy (p0/p1 posture,
 * or the strategy failed to resolve) composes to `null` — the caller hides
 * the attach affordance instead of falling back to an unsealed upload.
 *
 * ── What is DEV-GRADE here vs real ────────────────────────────────────────
 * The default bucket (`makeDevMediaBucket`) is an IN-MEMORY, per-session
 * object store: uploads do not survive a reload and never leave this device.
 * It exists so the sealed path is user-reachable and demoable NOW. The seal
 * strategy, the upload/refuse-plaintext invariants, and the deny-by-default
 * gate are the REAL contracts. The recorded swap point for live infra:
 *   • bucket      → `@onderling/blob-gateway/adapters/s3`   (createS3Bucket, S3/R2)
 *   • verifyToken → `@onderling/blob-gateway/adapters/solid-verifier`
 *   • acl         → `@onderling/blob-gateway/adapters/pod-acl`
 *   • HTTP edge   → `@onderling/blob-gateway/http` (createHttpGate)
 * Only the `bucket`/`gate`/`token` seams change; the gateway shape — and so
 * the handler, the message pointer, and the chip — stay byte-identical.
 */

import { createBlobGatekeeper, openBlob, BLOB_SCHEME } from '@onderling/blob-gateway';
import { CapabilityToken } from '@onderling/core';
import { circleMemberActors } from './circleMemberActors.js';

/**
 * DEV-GRADE in-memory bucket (same injected contract blob-gateway's own test
 * rig models: put / presign / delete + a fetchPresigned resolver standing in
 * for "the presigned URL grants access to the ciphertext"). One instance per
 * app session; holds ONLY sealing envelopes (uploadBlob refuses plaintext).
 */
export function makeDevMediaBucket() {
  const store = new Map();      // key → sealed envelope (ciphertext)
  const presigns = new Map();   // url → { key, expiresAt }
  let n = 0;
  return {
    store,
    async put(key, bytes) { store.set(key, bytes); },
    async presign(key, { ttl } = {}) {
      if (!store.has(key)) return null;
      const url = `dev-bucket://presigned/${key}?sig=${(n += 1)}`;
      presigns.set(url, { key, expiresAt: Date.now() + (ttl ?? 60) * 1000 });
      return url;
    },
    async delete(key) { store.delete(key); },
    /** Resolve a presigned URL back to the stored ciphertext (the dev stand-in
     *  for HTTP-fetching a real presigned bucket URL). */
    async fetchPresigned(url) {
      const rec = presigns.get(url);
      if (!rec || Date.now() > rec.expiresAt) return null;
      return store.get(rec.key);
    },
  };
}

/* ── REMOTE (deployed edge) mode ──────────────────────────────────────────────
 * The DEPLOYED counterpart of the dev bucket: full-size photos land in a real
 * object bucket behind the blob-gate HTTP edge (@onderling/relay `blobGateMount`),
 * not in the per-session in-memory store. The wire (mirrored from blobGateMount,
 * not imported — the client only talks to it over HTTP):
 *
 *   POST <gateUrl>/upload-url  { key }              Bearer <token> → { url }   presigned PUT
 *   PUT  <url>                 <sealed bytes>                        (client → bucket)
 *   POST <gateUrl>/grant       { key:'blob://<k>', actors:[…] }   Bearer <token> → { ok }
 *   POST <gateUrl>             { ref:'blob://<k>' }                Bearer <token> → { url }   presigned GET
 *   GET  <url>                                                       → sealed ciphertext
 *
 * Auth is the member's SELF-SIGNED `media.read` capability token (issuer ===
 * subject === the member's own key; minted once, reused for the composition).
 * Reads flow through the edge (its verifier + ACL decide, deny-by-default);
 * the client never presigns locally.
 */

/** Strip a trailing slash so `${gateUrl}/upload-url` never doubles up. */
function normalizeGateUrl(gateUrl) {
  return typeof gateUrl === 'string' ? gateUrl.replace(/\/+$/, '') : gateUrl;
}

/** POST a small JSON body to the edge with the member's Bearer token, returning
 *  the parsed JSON (or throwing on a non-2xx — callers decide whether to surface). */
async function edgePostJson(fetchImpl, url, token, body) {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (res && res.ok === false) {
    const err = new Error(`media edge ${url} failed (${res.status ?? 'error'})`);
    err.status = res.status;
    throw err;
  }
  if (res && typeof res.json === 'function') return res.json();
  return res; // a test double may resolve the parsed object directly
}

/**
 * A blob bucket whose `put` drives the deployed edge: presign a PUT, upload the
 * sealed bytes, then grant the circle roster. `put` is the ONLY method uploadBlob
 * needs; reads never touch the bucket (they go through the edge gate below).
 *
 * GRANT-ON-UPLOAD is not best-effort: a failed `/grant` THROWS out of `put`, so
 * uploadBlob (and createMediaEmbed) surface it — an uploaded-but-ungranted blob
 * (nobody, not even peers, could read it) must never be reported as success.
 *
 * @param {object} a
 * @param {string}   a.gateUrl       the edge mount URL (e.g. `https://relay/blob-gate`)
 * @param {string}   a.token         the member's self-signed media.read token (wire form)
 * @param {string[]} a.memberActors  the roster to grant read (the actor ids the edge ACL keys on)
 * @param {Function} a.fetch         injected fetch(url, init) (defaults to globalThis.fetch)
 */
export function createRemoteMediaBucket({ gateUrl, token, memberActors, fetch: fetchImpl } = {}) {
  const base = normalizeGateUrl(gateUrl);
  const doFetch = fetchImpl || globalThis.fetch;
  const actors = Array.isArray(memberActors) ? memberActors : [];
  return {
    async put(key, bytes) {
      // 1. presigned PUT url from the edge (auth: the member's token).
      const up = await edgePostJson(doFetch, `${base}/upload-url`, token, { key });
      const putUrl = up && up.url;
      if (!putUrl) throw new Error('media edge: /upload-url returned no url');
      // 2. PUT the sealed ciphertext straight to the bucket.
      const put = await doFetch(putUrl, { method: 'PUT', body: bytes });
      if (put && put.ok === false) throw new Error(`media edge: PUT failed (${put.status ?? 'error'})`);
      // 3. grant the roster. A denial here MUST surface (no silent drop).
      await edgePostJson(doFetch, `${base}/grant`, token, {
        // The FULL ref for /grant — stored verbatim and presented back by the reader. Note the edge's
        // asymmetry: /upload-url takes the BARE key (see blobGateMount's header).
        key: BLOB_SCHEME + key, actors,
      });
    },
  };
}

/**
 * The edge READ gate: a `gate(token, ref)` closure that asks the edge to presign
 * a GET (its verifier + ACL decide), returning `{ url }` or `{ denied }` — the
 * same deny-by-default contract the local gatekeeper honours, so `openBlob`
 * is byte-identical whether the gate is local (dev) or remote.
 */
function createRemoteGate({ gateUrl, fetch: fetchImpl }) {
  const base = normalizeGateUrl(gateUrl);
  const doFetch = fetchImpl || globalThis.fetch;
  return async function gate(token, ref) {
    try {
      const out = await edgePostJson(doFetch, base, token, { ref });
      return out && out.url ? { url: out.url } : { denied: true };
    } catch {
      return { denied: true }; // any failure denies — never leak a bucket url
    }
  };
}

/**
 * Compose the sealed-media gateway for ONE circle, or `null` when the circle
 * has no content seal strategy (p0/p1 / unresolved) — sealed-only, no
 * unsealed fallback.
 *
 * The gate is REAL even though the identity plumbing is session-local: a
 * random per-composition token maps to `localActor`, and the ACL grants
 * exactly the refs uploaded THROUGH this composition to that actor. Every
 * other (token, ref) pair is denied — deny-by-default is preserved, and the
 * swap to the Solid verifier + pod ACL changes the seams, not the contract.
 *
 * @param {object} a
 * @param {string}   a.circleId
 * @param {() => Promise<{seal:Function, open:Function}|null>} a.getSealStrategy
 *   the circle's content strategy resolver (web: `() => getCircleSealStrategy(id, policy)`)
 * @param {string}   a.localActor   the local user's actor id (ACL subject + item issuer)
 * @param {object}   [a.bucket]     injected bucket (DEV mode; default `makeDevMediaBucket()`)
 * @param {number}   [a.ttl]        presign TTL seconds for the gate
 * @param {object}   [a.remote]     REMOTE (deployed edge) mode. When present the full-size
 *   photos go to a deployed bucket behind the blob-gate edge instead of the dev bucket.
 * @param {string}     a.remote.gateUrl       the edge mount URL (e.g. `https://relay/blob-gate`)
 * @param {object}     a.remote.identity      an AgentIdentity-shaped signer ({pubKey, sign})
 *   — the member self-signs its own `media.read` token from this.
 * @param {string[]}   a.remote.memberActors  the roster granted read on every upload.
 * @param {Function}   [a.remote.fetch]       injected fetch (tests); default globalThis.fetch.
 * @param {number}     [a.remote.tokenTtlMs]  media.read token lifetime (default 1h).
 * @returns {Promise<null | {
 *   circleId: string,
 *   mediaGateway: {bucket:object, sealer:Function, opener:Function, keyRef:string, gate:Function, token:string},
 *   openFullImage: (line: object|string) => Promise<{bytes:Uint8Array, media:object|null}>,
 * }>}
 */
export async function createCircleMediaGateway({
  circleId, getSealStrategy, localActor, bucket, ttl = 60, remote,
} = {}) {
  // DEV needs a bucket; REMOTE brings its own edge — either satisfies the infra requirement.
  if (!circleId || typeof getSealStrategy !== 'function') return null;
  if (!remote && !bucket) return null;
  let strategy = null;
  try { strategy = await getSealStrategy(); } catch { strategy = null; }
  if (!strategy || typeof strategy.seal !== 'function' || typeof strategy.open !== 'function') {
    return null;   // p0/p1 (or unresolved) → NO sealed path; the affordance stays hidden
  }

  // ── REMOTE mode: the deployed edge/bucket, self-signed media.read auth ──────
  if (remote && remote.gateUrl && remote.identity) {
    const capToken = await CapabilityToken.issue(remote.identity, {
      subject:   remote.identity.pubKey,   // SELF-signed: issuer === subject === the member's key
      agentId:   'blob-gate',
      skill:     'media.read',
      expiresIn: remote.tokenTtlMs ?? 3_600_000,
    });
    const token = capToken.toString();     // JSON wire form (Bearer <token>)
    const remoteBucket = createRemoteMediaBucket({
      gateUrl: remote.gateUrl, token, memberActors: remote.memberActors, fetch: remote.fetch,
    });
    const gate = createRemoteGate({ gateUrl: remote.gateUrl, fetch: remote.fetch });
    const readFetch = remote.fetch || globalThis.fetch;
    return {
      circleId,
      mediaGateway: {
        bucket: remoteBucket,
        sealer: strategy.seal,
        opener: strategy.open,
        keyRef: `urn:circle:${circleId}:content-key`,
        gate,
        token,
      },
      /** Full-size read: the edge gate presigns a GET, `readFetch` pulls the ciphertext. */
      openFullImage: (line) => openBlob({
        ref: line, gate, token, opener: strategy.open, fetch: readFetch,
      }),
    };
  }

  // (fall through: no remote → the DEV path below.)

  // Session-local identity + ACL for the deny-by-default gate (dev slice of
  // the Solid-verifier + pod-ACL pair; see module doc for the swap point).
  const token = `dev-media-${Math.random().toString(36).slice(2, 10)}`;
  const verifyToken = async (tk) => (tk === token ? { webId: localActor } : null);
  const granted = new Set();   // blob refs uploaded through THIS composition
  const acl = {
    async canRead(webId, ref) { return webId === localActor && granted.has(ref); },
  };
  // Grant-on-upload: every blob put through this gateway becomes readable by
  // the uploader (and nobody else). uploadBlob's key IS the ref authority.
  const uploadingBucket = {
    ...bucket,
    put: async (key, bytes) => { await bucket.put(key, bytes); granted.add(BLOB_SCHEME + key); },
  };
  const gate = createBlobGatekeeper({ verifyToken, acl, bucket, ttl });

  return {
    circleId,
    mediaGateway: {
      bucket: uploadingBucket,
      sealer: strategy.seal,
      opener: strategy.open,
      keyRef: `urn:circle:${circleId}:content-key`,
      gate,
      token,
    },
    /** Full-size read of a manifest line, THROUGH the gate (denials throw). */
    openFullImage: (line) => openBlob({
      ref: line, gate, token, opener: strategy.open,
      fetch: typeof bucket.fetchPresigned === 'function' ? bucket.fetchPresigned : undefined,
    }),
  };
}

/**
 * media P-live — compose the circle media gateway FROM A ROSTER: the live-peer seam.
 *
 * This is the wiring that makes full-size photo fetch real for real peers. It resolves
 * each circle member to their **signing** pubKey (`circleMemberActors` →
 * `members.resolveByWebid(webid).pubKey`) and hands EXACTLY those keys to the blob-gate
 * `/grant` as the read-ACL. The media ACL keys on the capability-token SUBJECT — a
 * member's signing key (see `capabilityVerifier` → `{ webId: subject }`); a member whose
 * signing key was captured on redeem (stoop `redeemMembershipCode`) can therefore open
 * the sealed blob, and a member whose key is NOT yet captured is reported (never granted).
 *
 * Two mutually-exclusive modes, same gateway shape out (delegates to
 * `createCircleMediaGateway`, so SEALED-ONLY still stands: no seal strategy → null):
 *   • remote {gateUrl, identity, members, roster} → DEPLOYED edge. Grants the roster's
 *       resolved signing keys, UNIONed with the uploader's own signing key (so the
 *       uploader can always re-read its OWN uploads — a self-signed subject, never a
 *       non-member). Roster members with no captured signing key are DROPPED + counted
 *       and surfaced on the result as `unresolvedMembers` — the honest gap, never a
 *       fabricated actor, never a silent authorize.
 *   • bucket (dev, default)                        → the in-memory dev path (unchanged).
 *
 * @param {object} a
 * @param {string}   a.circleId
 * @param {() => Promise<{seal:Function, open:Function}|null>} a.getSealStrategy
 * @param {string}   a.localActor
 * @param {object}   [a.bucket]   DEV bucket (used when no remote edge is configured).
 * @param {number}   [a.ttl]
 * @param {object}   [a.remote]   REMOTE (deployed edge) config.
 * @param {string}     a.remote.gateUrl
 * @param {{pubKey:string, sign:Function}} a.remote.identity  the local member's signer.
 * @param {{resolveByWebid:Function}}      a.remote.members   the circle MemberMap (webid → signing pubKey).
 * @param {Array}      a.remote.roster                        the circle roster (member webids).
 * @param {Function}   [a.remote.fetch]
 * @param {number}     [a.remote.tokenTtlMs]
 * @returns {Promise<null | (object & { unresolvedMembers?: number })>}
 */
export async function createCircleMediaComposition({
  circleId, getSealStrategy, localActor, bucket, ttl = 60, remote,
} = {}) {
  if (remote && remote.gateUrl && remote.identity) {
    const { actors, unresolved } = await circleMemberActors(remote.members, remote.roster);
    // The uploader must always be able to re-read its OWN uploads: union its own
    // signing key into the read-ACL. It is the self-signed token's subject === issuer,
    // so this only ever adds the uploader's own key — never a non-member.
    const memberActors = [...new Set([...actors, remote.identity.pubKey].filter(Boolean))];
    const composition = await createCircleMediaGateway({
      circleId, getSealStrategy, localActor,
      remote: {
        gateUrl: remote.gateUrl, identity: remote.identity, memberActors,
        fetch: remote.fetch, tokenTtlMs: remote.tokenTtlMs,
      },
    });
    // Surface the honest gap: roster members with no captured signing key are NOT
    // media-reachable yet (same root cause as circle fan-out). Never silently dropped.
    if (composition) composition.unresolvedMembers = unresolved;
    return composition;
  }
  return createCircleMediaGateway({ circleId, getSealStrategy, localActor, bucket, ttl });
}
