/**
 * autoShare — `with-<urlencoded-webid>/` folder convention (Q-Folio.3).
 *
 * Anything dropped under `<root>/with-<urlencoded-webid>/` auto-mints a
 * `PodCapabilityToken` granting that WebID `pod.read` + `pod.write` on the
 * folder's pod path.  Tokens are persisted alongside the SyncEngine state
 * file (in `<root>/.folio/shares.json`) and re-issued on rotation.
 *
 * Folder convention (POSIX-style relative path; on disk the WebID is URL-
 * encoded so the segment is a valid filename across platforms):
 *
 *     with-https%3A%2F%2Falice.example.com%2Fprofile%2Fcard%23me/
 *     ↓ decoded
 *     webid = "https://alice.example.com/profile/card#me"
 *     sharePath = "with-https%3A%2F%2Falice.example.com%2Fprofile%2Fcard%23me"
 *
 * Lifecycle (per `runOnce`):
 *   1. Walk the local tree to find every `with-<webid>/` top-level folder.
 *   2. For each folder, check whether a current token exists in shares.json.
 *   3. If no token → mint a fresh 90-day token, persist.
 *   4. If token expires within 7 days → renew (issue a new one), persist.
 *   5. Identity rotation: if the loaded token's `issuer` differs from the
 *      current identity's pubKey, re-issue under the new key.  Old tokens
 *      remain valid until expiry; we do not retroactively revoke (per spec).
 *
 * Persistence file shape:
 *   {
 *     version:   1,
 *     writtenAt: <unix-ms>,
 *     shares: {
 *       "<webid>|<sharePath>": {
 *         webid, sharePath, podUri, issuer, token, issuedAt, expiresAt
 *       }
 *     }
 *   }
 *
 * Atomicity: every persist call writes to `shares.json.tmp` then renames,
 * so a crash mid-write cannot corrupt the file.  On RN, `expo-file-system`
 * has no atomic-rename primitive — we use temp-then-move (best-effort);
 * see `apps/folio/src/adapters/fsRN.js`.
 *
 * Error code: malformed `with-...` segments throw an Error with
 * `.code === 'AUTO_SHARE_BAD_PATH'` so the caller can distinguish them
 * from genuine runtime errors.
 *
 * Folio.C1 — adapter-aware: every `node:fs/promises` call goes through an
 * injected `FsAdapter` (default Node).
 */

import { PodCapabilityToken, param, PARAM_SCOPE, PARAM_KIND } from '@onderling/core';

import { fsNode }              from './adapters/fsNode.js';
import { joinPosix, dirnamePosix } from './adapters/pathPosix.js';

// ── Public constants ────────────────────────────────────────────────────────

// Parameter register (#36) — share lifetime + renewal window (scope:device, kind:internal).
/** 90 days, the default share lifetime. */
export const SHARE_EXPIRY_MS = param({ key: 'folio.shareExpiryMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 90 * 24 * 60 * 60 * 1000 });

/** Renew a token if it expires within this window. */
export const SHARE_RENEW_WINDOW_MS = param({ key: 'folio.shareRenewWindowMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 7 * 24 * 60 * 60 * 1000 });

/** Where the persisted token store lives, relative to the local root. */
export const SHARES_FILE_RELPATH = '.folio/shares.json';

/** Folder-name prefix that triggers auto-share. */
export const SHARE_PREFIX = 'with-';

// ── Path parsing ────────────────────────────────────────────────────────────

/**
 * Parse a POSIX-style relative path under the local root.  If the path's
 * top-level segment matches `with-<urlencoded-webid>`, return the WebID,
 * the share-folder relative path (top-level segment only), and any
 * remaining sub-path within the share.  Otherwise return null.
 *
 * Throws an Error with `.code === 'AUTO_SHARE_BAD_PATH'` if the segment
 * starts with the `with-` prefix but the WebID is malformed (empty or
 * fails URL decoding).  Returns null (not a throw) for paths that
 * simply don't match the prefix.
 *
 * @param {string} rootRel  POSIX-style relative path (no leading slash)
 * @returns {{ webid: string, sharePath: string, rest: string } | null}
 */
export function parsePath(rootRel) {
  if (typeof rootRel !== 'string' || rootRel === '') return null;
  // Trim any leading slash defensively, then split on '/'.
  const clean = rootRel.replace(/^\/+/, '');
  const slashIdx = clean.indexOf('/');
  const top   = slashIdx === -1 ? clean : clean.slice(0, slashIdx);
  const rest  = slashIdx === -1 ? ''    : clean.slice(slashIdx + 1);

  if (!top.startsWith(SHARE_PREFIX)) return null;

  const encoded = top.slice(SHARE_PREFIX.length);
  if (encoded.length === 0) {
    const err = new Error(`autoShare: malformed share segment (empty WebID): ${top}`);
    err.code = 'AUTO_SHARE_BAD_PATH';
    throw err;
  }

  let webid;
  try {
    webid = decodeURIComponent(encoded);
  } catch {
    const err = new Error(`autoShare: malformed share segment (invalid URL encoding): ${top}`);
    err.code = 'AUTO_SHARE_BAD_PATH';
    throw err;
  }
  // Sanity: must look like a URL/URI with a scheme.
  if (!/^[a-zA-Z][a-zA-Z0-9+.\-]*:/.test(webid)) {
    const err = new Error(`autoShare: malformed share segment (WebID is not a URI): ${top}`);
    err.code = 'AUTO_SHARE_BAD_PATH';
    throw err;
  }

  return { webid, sharePath: top, rest };
}

/**
 * Given a WebID, build the canonical share folder name (URL-encoded).
 * Used by tests + tooling that mints share folders programmatically.
 *
 * @param {string} webid
 * @returns {string}  e.g. `with-https%3A%2F%2Falice.example.com%2Fprofile%2Fcard%23me`
 */
export function shareFolderName(webid) {
  if (typeof webid !== 'string' || webid === '') {
    throw new Error('autoShare.shareFolderName: webid required');
  }
  return `${SHARE_PREFIX}${encodeURIComponent(webid)}`;
}

// ── Persistence ─────────────────────────────────────────────────────────────

function shareKey(webid, sharePath) {
  return `${webid}|${sharePath}`;
}

function sharesFilePath(localRoot) {
  return joinPosix(localRoot, SHARES_FILE_RELPATH);
}

/**
 * Load the persisted shares map.  Returns `{}` when the file does not
 * exist or is unreadable; corrupted JSON is logged and treated as empty
 * (we'd rather re-mint than crash the SyncEngine).
 *
 * @param {string} localRoot
 * @param {{ fs?: import('./adapters/index.js').FsAdapter }} [opts]
 * @returns {Promise<Record<string, ShareRecord>>}
 */
export async function loadShares(localRoot, opts = {}) {
  const fs = opts.fs ?? fsNode;
  const file = sharesFilePath(localRoot);
  let raw;
  try {
    raw = await fs.readFileText(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed?.shares ?? {};
  } catch {
    // Corrupted file — start fresh.  Atomic writes mean this should
    // only happen if a user (or external tool) mucked with the file.
    return {};
  }
}

/**
 * Persist the shares map atomically (write-temp-then-rename).
 *
 * @param {string} localRoot
 * @param {Record<string, ShareRecord>} shares
 * @param {{ fs?: import('./adapters/index.js').FsAdapter }} [opts]
 */
export async function saveShares(localRoot, shares, opts = {}) {
  const fs = opts.fs ?? fsNode;
  const file = sharesFilePath(localRoot);
  const dir  = dirnamePosix(file);
  await fs.mkdir(dir, { recursive: true });
  const tmp  = `${file}.tmp`;
  const payload = JSON.stringify({
    version:   1,
    writtenAt: Date.now(),
    shares,
  }, null, 2);
  await fs.writeFile(tmp, payload, { encoding: 'utf8' });
  await fs.rename(tmp, file);
}

// ── Token mint / renew ──────────────────────────────────────────────────────

/**
 * Mint a fresh 90-day token for `(webid, sharePodUri)`.  Returns a
 * ShareRecord ready to drop into the persistence map.
 *
 * @param {object} identity  AgentIdentity (must have `pubKey` and `sign`)
 * @param {object} args
 * @param {string} args.webid
 * @param {string} args.sharePath   relative share-folder path
 * @param {string} args.podRoot     pod root URI (used as the token's `pod`)
 * @param {string} args.sharePodUri pod URI of the share folder (e.g.
 *                                  `https://alice.example/notes/with-.../`)
 * @returns {Promise<ShareRecord>}
 */
export async function mintShareToken(identity, { webid, sharePath, podRoot, sharePodUri }) {
  // Token scopes are pod-relative paths; derive from sharePodUri by stripping
  // the host part — PodCapabilityToken.matchesScope does prefix-strict path
  // comparison, and the convention used elsewhere (CapabilityAuth) is that
  // the path component of the resource URI is what gets matched.
  const scopePath = pathFromPodUri(sharePodUri);
  // Ensure trailing slash so the scope is a CONTAINER scope (covers
  // every file inside the share folder, including future additions).
  const containerScope = scopePath.endsWith('/') ? scopePath : `${scopePath}/`;

  const expiresIn = SHARE_EXPIRY_MS;
  const tok = await PodCapabilityToken.issue(identity, {
    subject: webid,
    pod:     podRoot,
    scopes:  [`pod.read:${containerScope}`, `pod.write:${containerScope}`],
    expiresIn,
  });

  const json = tok.toJSON();
  return {
    webid,
    sharePath,
    podUri:    sharePodUri,
    mode:      'cap-token',
    issuer:    json.issuer,
    token:     json,
    issuedAt:  json.issuedAt,
    expiresAt: json.expiresAt,
  };
}

/**
 * Phase 52.16.5 (2026-05-14) — mint an ACP grant for `webid` on the
 * share folder. Used by `ensureShares` when the pod supports ACP and
 * a `podClient` with `.sharing` is supplied.
 *
 * The resulting record has `mode: 'acp'` (or `'wac'`) and no
 * `token` / `expiresAt` — ACP grants don't expire automatically. The
 * `issuer` field carries the current identity's pubKey so
 * `shouldRenew` can detect identity rotation (force a re-grant after
 * a key change so the new identity is the one writing the ACR).
 *
 * @param {object} podClient    — PodClient with `.sharing` (Phase 52.16.1)
 * @param {string} currentPubKey
 * @param {object} args
 * @param {string} args.webid
 * @param {string} args.sharePath
 * @param {string} args.sharePodUri  — pod URI of the share folder (trailing `/`)
 * @returns {Promise<ShareRecord>}
 */
export async function mintShareViaAcp(podClient, currentPubKey, { webid, sharePath, sharePodUri }) {
  if (!podClient?.sharing) {
    throw new Error('mintShareViaAcp: podClient must expose .sharing');
  }
  const grant = await podClient.sharing.grant({
    containerUri: sharePodUri,
    agent:        webid,
    modes:        ['read', 'write'],
  });
  return {
    webid,
    sharePath,
    podUri:    sharePodUri,
    mode:      grant.mode,    // 'acp' | 'wac'
    issuer:    currentPubKey, // for rotation detection in shouldRenew
    grant:     {
      targetUri: grant.targetUri,
      agent:     grant.agent,
      modes:     grant.modes,
    },
    issuedAt:  Date.now(),
  };
}

/**
 * Should the given record be renewed under the current identity?
 * True if:
 *   - missing
 *   - expires within `SHARE_RENEW_WINDOW_MS`
 *   - already expired
 *   - identity rotated (record.issuer != currentPubKey)
 *
 * @param {ShareRecord | undefined} record
 * @param {string} currentPubKey
 * @param {number} [now=Date.now()]
 */
export function shouldRenew(record, currentPubKey, now = Date.now()) {
  if (!record) return true;
  // Phase 52.16.5 — ACP grants don't carry an expiry. Renew on
  // identity rotation only; the grant lives on the pod until
  // someone (the user or admin) revokes it.
  if (record.mode === 'acp' || record.mode === 'wac') {
    return record.issuer !== currentPubKey;
  }
  if (typeof record.expiresAt !== 'number') return true;
  if (record.expiresAt - now <= SHARE_RENEW_WINDOW_MS) return true;
  if (record.issuer !== currentPubKey) return true;
  return false;
}

// ── Walk: find every share folder under the local root ─────────────────────

/**
 * Walk the local root's TOP-LEVEL entries and return every directory whose
 * name matches `with-<webid>`.  Top-level only — that's the convention,
 * and it keeps this O(top-level-folders), not O(all-files).
 *
 * Malformed `with-...` directory names are surfaced as `errors` rather
 * than thrown, so a single bad folder doesn't take down the whole
 * `ensureShares` pass.
 *
 * @param {string} localRoot
 * @param {{ fs?: import('./adapters/index.js').FsAdapter }} [opts]
 * @returns {Promise<{ folders: Array<{ webid, sharePath, absPath }>, errors: Array<{ name, code, message }> }>}
 */
export async function findShareFolders(localRoot, opts = {}) {
  const fs = opts.fs ?? fsNode;
  const folders = [];
  const errors  = [];

  let dirents;
  try {
    dirents = await fs.readdir(localRoot, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return { folders, errors };
    throw err;
  }

  for (const ent of dirents) {
    if (!ent.isDirectory()) continue;
    const name = ent.name;
    if (!name.startsWith(SHARE_PREFIX)) continue;
    try {
      const parsed = parsePath(name);
      if (!parsed) continue;
      folders.push({
        webid:     parsed.webid,
        sharePath: parsed.sharePath,
        absPath:   joinPosix(localRoot, name),
      });
    } catch (err) {
      errors.push({
        name,
        code:    err.code || 'AUTO_SHARE_BAD_PATH',
        message: err.message,
      });
    }
  }

  return { folders, errors };
}

// ── Top-level driver ────────────────────────────────────────────────────────

/**
 * Walk the engine's localRoot for `with-<webid>/` folders, ensure every
 * one has a current token, mint or renew as needed, persist, and return
 * the up-to-date shares map.
 *
 * Safe to call repeatedly: idempotent when no folder changed.
 *
 * The optional `fs` adapter is taken first from the engine itself (if it
 * exposes one via `engine.fs`), then from `opts.fs`, finally Node default.
 *
 * @param {object} engine    SyncEngine (must expose `localRoot`, `podRoot`, `pathMap`; may expose `fs`)
 * @param {object} identity  AgentIdentity for signing tokens
 * @param {{ fs?: import('./adapters/index.js').FsAdapter }} [opts]
 * @returns {Promise<{ shares: Record<string, ShareRecord>, minted: number, renewed: number, errors: Array<object> }>}
 */
export async function ensureShares(engine, identity, opts = {}) {
  if (!engine || typeof engine.localRoot !== 'string') {
    throw new Error('ensureShares: engine.localRoot is required');
  }
  if (!identity || typeof identity.pubKey !== 'string' || typeof identity.sign !== 'function') {
    throw new Error('ensureShares: identity with pubKey + sign() is required');
  }
  const fs = opts.fs ?? engine.fs ?? fsNode;

  // Phase 52.16.5 (2026-05-14) — when a `podClient` with `.sharing` is
  // supplied AND the pod supports ACP/WAC, prefer ACP grants. Falls
  // back to cap-token issuance per-folder if the grant call fails
  // (e.g. probe says unsupported, network glitch).
  const podClient = opts.podClient ?? engine.podClient ?? null;

  const { localRoot, podRoot, pathMap } = engine;
  const shares = await loadShares(localRoot, { fs });
  const { folders, errors } = await findShareFolders(localRoot, { fs });

  let minted  = 0;
  let renewed = 0;
  let acpMinted = 0;
  let capTokenMinted = 0;
  const seenKeys = new Set();
  let mutated = false;

  // Probe pod sharing capabilities once. If `podClient` is absent or
  // the probe says no support, every folder gets cap-token.
  let canUseAcp = false;
  if (podClient?.sharing && folders.length > 0) {
    try {
      const caps = await podClient.sharing.capabilities({ containerUri: podRoot });
      canUseAcp = caps.acp || caps.wac;
    } catch (err) {
      errors.push({
        name:    podRoot,
        code:    'AUTO_SHARE_PROBE_FAILED',
        message: `capabilities probe failed: ${err.message}`,
      });
    }
  }

  for (const f of folders) {
    const key      = shareKey(f.webid, f.sharePath);
    seenKeys.add(key);
    const existing = shares[key];

    if (!shouldRenew(existing, identity.pubKey)) {
      continue;
    }

    // Compute the pod URI of the share folder.  Use the PathMap if available;
    // otherwise build from podRoot directly (the path encoder mirrors PathMap's
    // encodeRelForPod by URI-encoding each segment).
    let sharePodUri;
    try {
      sharePodUri = pathMap?.localToPod
        ? pathMap.localToPod(f.absPath)
        : `${podRoot}${encodeURIComponent(f.sharePath)}`;
    } catch (err) {
      errors.push({
        name:    f.sharePath,
        code:    'AUTO_SHARE_PATH_MAP',
        message: err.message,
      });
      continue;
    }
    if (!sharePodUri.endsWith('/')) sharePodUri = `${sharePodUri}/`;

    let record = null;
    // Phase 52.16.5 — ACP path first when available.
    if (canUseAcp) {
      try {
        record = await mintShareViaAcp(podClient, identity.pubKey, {
          webid:       f.webid,
          sharePath:   f.sharePath,
          sharePodUri,
        });
        acpMinted++;
      } catch (err) {
        errors.push({
          name:    f.sharePath,
          code:    'AUTO_SHARE_ACP_FAILED',
          message: `ACP grant failed; falling back to cap-token: ${err.message}`,
        });
        // Fall through to cap-token path.
      }
    }
    if (!record) {
      try {
        record = await mintShareToken(identity, {
          webid:       f.webid,
          sharePath:   f.sharePath,
          podRoot,
          sharePodUri,
        });
        capTokenMinted++;
      } catch (err) {
        errors.push({
          name:    f.sharePath,
          code:    'AUTO_SHARE_MINT_FAILED',
          message: err.message,
        });
        continue;
      }
    }

    if (existing) renewed++; else minted++;
    shares[key] = record;
    mutated = true;
  }

  if (mutated) {
    await saveShares(localRoot, shares, { fs });
  }

  return { shares, minted, renewed, acpMinted, capTokenMinted, errors };
}

/**
 * Convenience: list all currently-known shares as a plain array, suitable
 * for `engine.shares()` consumers.
 *
 * @param {string} localRoot
 * @param {{ fs?: import('./adapters/index.js').FsAdapter }} [opts]
 * @returns {Promise<Array<{ webid, path, expires, issuedAt, podUri, issuer }>>}
 */
export async function listShares(localRoot, opts = {}) {
  const fs = opts.fs ?? fsNode;
  const shares = await loadShares(localRoot, { fs });
  return Object.values(shares).map((r) => ({
    webid:     r.webid,
    path:      r.sharePath,
    podUri:    r.podUri,
    issuer:    r.issuer,
    issuedAt:  r.issuedAt,
    expires:   r.expiresAt,
  }));
}

// ── Internals ───────────────────────────────────────────────────────────────

/**
 * Strip the scheme + authority from a pod URI to get the path component.
 * Falls back to the input on malformed URIs (defensive).
 */
function pathFromPodUri(uri) {
  try {
    const u = new URL(uri);
    return u.pathname || '/';
  } catch {
    // Best-effort: search past the scheme://host
    const m = String(uri).match(/^[a-zA-Z][a-zA-Z0-9+.\-]*:\/\/[^/]+(\/.*)?$/);
    return m && m[1] ? m[1] : '/';
  }
}

/**
 * @typedef {object} ShareRecord
 * @property {string} webid
 * @property {string} sharePath        relative share-folder path
 * @property {string} podUri           pod URI of the share folder
 * @property {string} issuer           identity pubKey that minted this token
 * @property {object} token            full PodCapabilityToken JSON
 * @property {number} issuedAt
 * @property {number} expiresAt
 */
