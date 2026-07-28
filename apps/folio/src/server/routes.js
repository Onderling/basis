/**
 * Folio REST contract — Folio.B1.server (track-H §Folio.B1).
 *
 * All endpoints are JSON.  All errors are shaped:
 *   { error: { code: <STRING_CODE>, message: <human-readable> } }
 *
 * The server binds to 127.0.0.1:8888 only.  No auth on the localhost layer:
 * the agent process is the trust boundary, localhost is in the user's trust
 * domain.
 *
 * ┌──────────────────────────┬───────┬────────────────────────────────────────────────┐
 * │ Endpoint                 │ Verb  │ Body / response                                 │
 * ├──────────────────────────┼───────┼────────────────────────────────────────────────┤
 * │ /status                  │ GET   │ → { ts, stats, localRoot, podRoot, webId,      │
 * │                          │       │     watching, lastSyncAt, pending: { uploads,  │
 * │                          │       │     downloads, deletes, conflicts },           │
 * │                          │       │     openConflictFiles }                        │
 * │                          │       │                                                 │
 * │ /conflicts               │ GET   │ → { ts, conflicts: [{ id, relPath, absPath }]} │
 * │                          │       │                                                 │
 * │ /conflicts/:id/resolve   │ POST  │ body: { resolution: 'mine'|'theirs'|<text> }   │
 * │                          │       │ → { ok: true, relPath }                        │
 * │                          │       │ Errors: 404 NOT_FOUND, 400 BAD_RESOLUTION      │
 * │                          │       │                                                 │
 * │ /share                   │ POST  │ body: { webid, scopes:[…], expiresIn?,          │
 * │                          │       │         path? }                                │
 * │                          │       │ → { token: <serialized PodCapabilityToken> }   │
 * │                          │       │ Errors: 400 BAD_REQUEST, 503 NO_IDENTITY       │
 * │                          │       │                                                 │
 * │ /sync/now                │ POST  │ body: { direction?: 'both'|'push'|'pull' }     │
 * │                          │       │ → 202 { ok: true, started: true }              │
 * │                          │       │ Progress streamed over /events WebSocket as     │
 * │                          │       │   sync.progress / sync.done frames.            │
 * │                          │       │                                                 │
 * │ /sync/force              │ POST  │ Folio v2.5 — re-upload every local file        │
 * │                          │       │ → 202 { ok: true, started: true }              │
 * │                          │       │ Streams sync.force.start / sync.force.done      │
 * │                          │       │ over /events.                                  │
 * │                          │       │                                                 │
 * │ /verify/:id              │ GET   │ Folio v2.5 — verify pod's view of one file.    │
 * │                          │       │ id = base64url(relPath).                       │
 * │                          │       │ → { ts, relPath, podUri, exists,                │
 * │                          │       │     sizeMatches?, shaMatches?, podEtag? }      │
 * │                          │       │ Errors: 400 BAD_VERIFY_ID, 500 VERIFY_FAILED   │
 * │                          │       │                                                 │
 * │ /rm/:id                  │ POST  │ Folio v2.11 — local tombstone for one file.    │
 * │                          │       │ id = base64url(relPath).                       │
 * │                          │       │ → { ok: true, relPath }                        │
 * │                          │       │ Errors: 400 BAD_DELETE_ID, 404 NOT_FOUND,      │
 * │                          │       │         500 DELETE_FAILED                      │
 * │                          │       │                                                 │
 * │ /delete/:id              │ POST  │ Folio v2.11 — permanent pod delete + local +   │
 * │                          │       │ knownState + version history wipe.             │
 * │                          │       │ id = base64url(relPath).                       │
 * │                          │       │ → { ok: true, relPath, podUri }                │
 * │                          │       │ Streams sync.delete.done over /events.         │
 * │                          │       │ Errors: 400 BAD_DELETE_ID, 404 NOT_FOUND,      │
 * │                          │       │         500 DELETE_FAILED                      │
 * │                          │       │                                                 │
 * │ /watch/start             │ POST  │ → { ok: true, watching: true }                 │
 * │ /watch/stop              │ POST  │ → { ok: true, watching: false }                │
 * │                          │       │                                                 │
 * │ /diagnostics             │ POST  │ → 202 { ok: true, started: true, total }       │
 * │                          │       │ Folio v2.3 — kicks off the 16-step doctor      │
 * │                          │       │ engine; results stream over /events as         │
 * │                          │       │ diagnostics.step + diagnostics.done frames.    │
 * │                          │       │ Errors: 409 DIAGNOSTICS_IN_PROGRESS            │
 * └──────────────────────────┴───────┴────────────────────────────────────────────────┘
 *
 * WebSocket (/events) frames:
 *   { type: 'status',            ts, stats, watching }
 *   { type: 'sync.progress',     ts, phase: 'start'|'scanning'|'applying', direction }
 *   { type: 'sync.done',         ts, uploads, downloads, deletes, conflicts }
 *   { type: 'sync.force.start',  ts }                                          (v2.5)
 *   { type: 'sync.force.done',   ts, uploads, errors }                         (v2.5)
 *   { type: 'conflict.new',      ts, id, relPath, podUri }
 *   { type: 'error',             ts, phase, relPath?, message }
 *   { type: 'diagnostics.step',  ts, idx, total, id, label, status, detail? } (v2.3)
 *   { type: 'diagnostics.done',  ts, ok, counts, abortReason?, recommendedFix? } (v2.3)
 *   { type: 'sync.delete.done',  ts, relPath, podUri }                          (v2.11)
 */

import express from 'express';
import { promises as fs } from 'node:fs';
import { join, dirname, relative } from 'node:path';

import {
  AgentIdentity,
  Bootstrap,
  PodCapabilityToken,
} from '@onderling/core';

import { PathMap }            from '../PathMap.js';
import { scanLocal }          from '../scanLocal.js';
import { scanPod }            from '../scanPod.js';
import { diff }               from '../diff.js';
import { hasConflictMarkers } from '../applyConflict.js';

import { conflictIdFromRelPath, relPathFromConflictId } from './conflictId.js';
// Versioning now rides the engine's @onderling/versioning store
// reached via `engine.versionStore` (list/read/listSeries/isVersionable),
// not the retired `../versions.js` module.
import {
  runDiagnostics as defaultRunDiagnostics,
  STEP_TOTAL,
  recommendFix as recommendFixFromSteps,
} from '../diagnostics.js';

const STATE_FILE_RELPATH = '.onderling/notes-sync-state.json';
/** Read the sync-state file (null when absent). */
async function readStateText(fsImpl, root) {
  try { return await fsImpl.readFile(join(root, STATE_FILE_RELPATH), 'utf8'); }
  catch (err) { if (err.code !== 'ENOENT') throw err; return null; }
}


/**
 * Build the REST router.
 *
 * @param {object} deps
 * @param {object} deps.engine     SyncEngine (or compatible mock)
 * @param {object} [deps.podClient] PodClient instance — if not given, we try
 *                                  `engine._podClient ?? engine.__podClient`
 *                                  (the SyncEngine keeps the real one private).
 * @param {object} deps.vault      Vault* (must support .get(key))
 * @param {object} [deps.identity] AgentIdentity — optional; if absent, /share
 *                                 lazy-derives one from the vault.
 * @param {object} deps.hub        WsHub for broadcasting progress.
 * @param {object} [deps.errorBuffer] Folio v2.2 — SyncErrorBuffer; if present,
 *                                    /status carries `lastError` + `errors`,
 *                                    and POST /errors/clear empties it.
 * @returns {express.Router}
 */
export function createRouter({ engine, podClient, vault, identity, hub, errorBuffer, runDiagnostics, diagnosticsDeps }) {
  if (!engine) throw new Error('createRouter: engine is required');
  if (!hub)    throw new Error('createRouter: hub is required');
  const resolvedPodClient = podClient ?? engine._podClient ?? engine.__podClient ?? null;
  const runDiagnosticsFn  = runDiagnostics ?? defaultRunDiagnostics;

  // Folio v2.3 — guard so only one diagnostics run is in flight at a time.
  // 409 Conflict is returned for concurrent POST /diagnostics requests.
  let diagnosticsInFlight = false;

  const router = express.Router();
  router.use(express.json({ limit: '4mb' }));

  // ── /status ────────────────────────────────────────────────────────────────
  router.get('/status', async (_req, res) => {
    try {
      const localRoot = engine.localRoot;
      const podRoot   = engine.podRoot;
      const stats     = engine.stats ?? {};

      const pathMap = new PathMap({ localRoot, podRoot });

      // Best-effort knownState load (mirrors statusCmd).
      let lastSyncAt = stats.lastSyncAt ?? null;
      let knownState = {};
      try {
        const text = await readStateText(fs, localRoot);
        if (text != null) {
          const parsed = JSON.parse(text);
          knownState = parsed.files ?? {};
          lastSyncAt = lastSyncAt ?? parsed.writtenAt ?? null;
        }
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }

      let pending = { uploads: 0, downloads: 0, deletes: 0, conflicts: 0 };
      let openConflictFiles = 0;
      let scanError = null;
      try {
        if (!resolvedPodClient) {
          throw new Error('no podClient available for status scan');
        }
        const localScan = await scanLocal(localRoot, { pathMap });
        const podScan   = await scanPod(resolvedPodClient, podRoot, { pathMap });
        const d         = diff(localScan, podScan, knownState);
        pending = {
          uploads:   d.toUpload.length,
          downloads: d.toDownload.length,
          deletes:   d.toDelete.length,
          conflicts: d.conflicts.length,
        };
        for (const f of localScan) {
          try {
            const text = await fs.readFile(f.absPath, 'utf8');
            if (hasConflictMarkers(text)) openConflictFiles++;
          } catch { /* ignore */ }
        }
      } catch (err) {
        // Pod might be unreachable; surface but don't fail the whole status.
        scanError = err?.message ?? String(err);
      }

      // Folio v2.2 — surface the in-memory ring buffer's recent errors so the
      // UI paints the banner + recent-errors list on first load (no need to
      // wait for the next WS error frame).
      const lastError = errorBuffer?.lastError ?? null;
      const errors    = errorBuffer ? errorBuffer.recent(10) : [];

      res.json({
        ts:        Date.now(),
        stats,
        localRoot,
        podRoot,
        watching:  !!engine.__watching,
        lastSyncAt,
        pending,
        openConflictFiles,
        lastError,
        errors,
        ...(scanError ? { scanError } : {}),
      });
    } catch (err) {
      sendError(res, 500, 'STATUS_FAILED', err?.message ?? String(err));
    }
  });

  // ── /errors/clear ─────────────────────────────────────────────────────────
  // Folio v2.2 — empties the in-memory ring buffer.  Returns 204 No Content
  // either way (idempotent).  When no buffer is wired, still 204 — callers
  // shouldn't have to special-case the missing-buffer state.
  router.post('/errors/clear', (_req, res) => {
    if (errorBuffer && typeof errorBuffer.clear === 'function') {
      errorBuffer.clear();
    }
    res.status(204).end();
  });

  // ── /conflicts ────────────────────────────────────────────────────────────
  router.get('/conflicts', async (_req, res) => {
    try {
      const localRoot = engine.localRoot;
      const conflicted = [];
      await walkConflicts(localRoot, localRoot, conflicted);

      res.json({
        ts: Date.now(),
        conflicts: conflicted.map((absPath) => {
          const relPath = relative(localRoot, absPath).split(/[\\/]/).join('/');
          return {
            id:      conflictIdFromRelPath(relPath),
            relPath,
            absPath,
          };
        }),
      });
    } catch (err) {
      sendError(res, 500, 'CONFLICTS_FAILED', err?.message ?? String(err));
    }
  });

  // ── /conflicts/:id/content ────────────────────────────────────────────────
  // Returns the raw file content for a conflicted file so the UI can extract
  // the "yours" / "theirs" sides for the merge view.  Body is text/plain;
  // path is the same base64url(relPath) used by /resolve.  Confined to
  // localRoot — the conflictId decoder rejects '..' segments via the
  // round-trip check.
  router.get('/conflicts/:id/content', async (req, res) => {
    const id = req.params.id;
    const relPath = relPathFromConflictId(id);
    if (!relPath) {
      return sendError(res, 400, 'BAD_CONFLICT_ID', 'conflict id is malformed');
    }
    if (relPath.split(/[\\/]/).some((seg) => seg === '..' || seg === '')) {
      return sendError(res, 400, 'BAD_CONFLICT_ID', 'conflict id has invalid path segments');
    }
    const localRoot = engine.localRoot;
    const absPath   = join(localRoot, ...relPath.split('/'));
    try {
      const text = await fs.readFile(absPath, 'utf8');
      res.type('text/plain; charset=utf-8').send(text);
    } catch (err) {
      if (err.code === 'ENOENT') {
        return sendError(res, 404, 'NOT_FOUND', `no file at ${relPath}`);
      }
      sendError(res, 500, 'READ_FAILED', err?.message ?? String(err));
    }
  });

  // ── /conflicts/:id/resolve ────────────────────────────────────────────────
  router.post('/conflicts/:id/resolve', async (req, res) => {
    const id = req.params.id;
    const relPath = relPathFromConflictId(id);
    if (!relPath) {
      return sendError(res, 400, 'BAD_CONFLICT_ID', 'conflict id is malformed');
    }
    const body = req.body ?? {};
    const resolution = body.resolution;
    if (typeof resolution !== 'string' || resolution.length === 0) {
      return sendError(res, 400, 'BAD_RESOLUTION',
        'body.resolution must be "mine" | "theirs" | <text> (a non-empty string)');
    }

    const localRoot = engine.localRoot;
    const absPath   = join(localRoot, ...relPath.split('/'));

    let original;
    try {
      original = await fs.readFile(absPath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') {
        return sendError(res, 404, 'NOT_FOUND', `no file at ${relPath}`);
      }
      return sendError(res, 500, 'READ_FAILED', err?.message ?? String(err));
    }

    if (!hasConflictMarkers(original)) {
      return sendError(res, 400, 'NO_CONFLICT_MARKERS',
        `file ${relPath} contains no conflict markers; nothing to resolve`);
    }

    let resolvedText;
    if (resolution === 'mine') {
      const ext = extractSide(original, 'mine');
      if (ext == null) {
        return sendError(res, 400, 'CANNOT_PARSE_CONFLICT',
          `could not parse conflict markers in ${relPath}`);
      }
      resolvedText = ext;
    } else if (resolution === 'theirs') {
      const ext = extractSide(original, 'theirs');
      if (ext == null) {
        return sendError(res, 400, 'CANNOT_PARSE_CONFLICT',
          `could not parse conflict markers in ${relPath}`);
      }
      resolvedText = ext;
    } else {
      // Custom text: write verbatim.
      resolvedText = resolution;
    }

    try {
      await fs.mkdir(dirname(absPath), { recursive: true });
      await fs.writeFile(absPath, resolvedText, 'utf8');
    } catch (err) {
      return sendError(res, 500, 'WRITE_FAILED', err?.message ?? String(err));
    }

    // Folio.B4: snapshot the resolution.  Best-effort — never fail a resolve
    // because versioning had a hiccup.
    if (typeof engine.captureVersion === 'function') {
      try { await engine.captureVersion(relPath, resolvedText); }
      catch { /* swallow */ }
    }

    res.json({ ok: true, relPath });
  });

  // ── /versions ─────────────────────────────────────────────────────────────
  // Folio.B4 — list versions for a file.  id = base64url(relPath), same
  // encoding the conflicts UI uses.
  router.get('/versions/:id', async (req, res) => {
    const id = req.params.id;
    const relPath = relPathFromConflictId(id);
    if (!relPath || !engine.versionStore.isVersionable(relPath)) {
      return sendError(res, 400, 'BAD_VERSION_ID', 'version id is malformed or refers to an unsupported path');
    }
    try {
      const versions = await engine.versionStore.list(relPath);
      // Records carry no on-disk path — expose only ts/sha256/size.
      const out = versions.map(({ ts, sha256, size }) => ({ ts, sha256, size }));
      res.json({ relPath, versions: out });
    } catch (err) {
      sendError(res, 500, 'READ_FAILED', err?.message ?? String(err));
    }
  });

  // ── /versions/:id/content/:ms ─────────────────────────────────────────────
  router.get('/versions/:id/content/:ms', async (req, res) => {
    const id = req.params.id;
    const relPath = relPathFromConflictId(id);
    if (!relPath || !engine.versionStore.isVersionable(relPath)) {
      return sendError(res, 400, 'BAD_VERSION_ID', 'version id is malformed or refers to an unsupported path');
    }
    const ms = Number(req.params.ms);
    if (!Number.isFinite(ms)) {
      return sendError(res, 400, 'BAD_VERSION_ID', 'ms must be a number');
    }
    try {
      const content = await engine.versionStore.read(relPath, ms);
      // Snapshot content is a string or Uint8Array — normalize to a Buffer
      // so express ships raw bytes rather than JSON-encoding a typed array.
      res.type('text/plain; charset=utf-8').send(Buffer.from(content));
    } catch (err) {
      if (err?.code === 'VERSION_NOT_FOUND') {
        return sendError(res, 404, 'VERSION_NOT_FOUND', err.message);
      }
      sendError(res, 500, 'READ_FAILED', err?.message ?? String(err));
    }
  });

  // ── /versions/:id/restore ─────────────────────────────────────────────────
  router.post('/versions/:id/restore', async (req, res) => {
    const id = req.params.id;
    const relPath = relPathFromConflictId(id);
    if (!relPath || !engine.versionStore.isVersionable(relPath)) {
      return sendError(res, 400, 'BAD_VERSION_ID', 'version id is malformed or refers to an unsupported path');
    }
    const body = req.body ?? {};
    const ts = Number(body.ts);
    if (!Number.isFinite(ts)) {
      return sendError(res, 400, 'BAD_VERSION_ID', 'body.ts must be a number');
    }
    if (typeof engine.restoreVersion !== 'function') {
      return sendError(res, 500, 'WRITE_FAILED', 'engine has no restoreVersion()');
    }
    try {
      const r = await engine.restoreVersion(relPath, ts);
      res.json({
        relPath:                 r.relPath,
        restoredFromMs:          r.restoredFromMs,
        snapshotMsBeforeRestore: r.snapshotMsBeforeRestore,
      });
    } catch (err) {
      if (err?.code === 'VERSION_NOT_FOUND') {
        return sendError(res, 404, 'VERSION_NOT_FOUND', err.message);
      }
      if (err?.code === 'NOT_VERSIONABLE') {
        return sendError(res, 400, 'BAD_VERSION_ID', err.message);
      }
      sendError(res, 500, 'WRITE_FAILED', err?.message ?? String(err));
    }
  });

  // ── /versions (collection) ────────────────────────────────────────────────
  // List every relPath that has at least one snapshot, newest-first.  Used
  // by the UI's history-pane file picker.
  router.get('/versions', async (_req, res) => {
    try {
      // listSeries() → [{ uri, latestMs, count }] newest-first; `uri` IS the relPath.
      const files = await engine.versionStore.listSeries();
      // Attach an `id` field so the UI doesn't have to re-encode.
      const out = files.map((f) => ({
        id:       conflictIdFromRelPath(f.uri),
        relPath:  f.uri,
        latestMs: f.latestMs,
        count:    f.count,
      }));
      res.json({ ts: Date.now(), files: out });
    } catch (err) {
      sendError(res, 500, 'READ_FAILED', err?.message ?? String(err));
    }
  });

  // ── /share ────────────────────────────────────────────────────────────────
  // Phase 52.16.3 (2026-05-14) — `mode` param:
  //   'auto' (default): probe pod capabilities; ACP-mediated grant if
  //                     supported, otherwise fall back to cap-token.
  //   'acp':            force ACP/WAC grant via podClient.sharing.grant.
  //                     Errors if pod doesn't support ACP or WAC.
  //   'cap-token':      force PodCapabilityToken issuance (legacy).
  router.post('/share', async (req, res) => {
    const body = req.body ?? {};
    const webid    = body.webid;
    const scopes   = body.scopes;
    const expiresIn = body.expiresIn;
    const path     = body.path;
    const mode     = body.mode ?? 'auto';

    if (typeof webid !== 'string' || webid.length === 0) {
      return sendError(res, 400, 'BAD_REQUEST', 'body.webid is required');
    }
    if (!Array.isArray(scopes) || scopes.length === 0) {
      return sendError(res, 400, 'BAD_REQUEST', 'body.scopes must be a non-empty array');
    }
    if (expiresIn !== undefined && (typeof expiresIn !== 'number' || expiresIn <= 0)) {
      return sendError(res, 400, 'BAD_REQUEST', 'body.expiresIn must be a positive number of milliseconds');
    }
    if (!['auto', 'acp', 'cap-token'].includes(mode)) {
      return sendError(res, 400, 'BAD_REQUEST',
        `body.mode must be 'auto' | 'acp' | 'cap-token' (got "${mode}")`);
    }

    const podRoot = engine.podRoot;

    // Try ACP first when requested. The `auto` path falls through to
    // cap-token on any failure; `acp` surfaces the failure to the
    // caller.
    if (mode === 'acp' || mode === 'auto') {
      const acpResult = await _tryAcpGrant({
        podClient, podRoot, webid, scopes, path,
      });
      if (acpResult.ok) {
        return res.json({
          mode:  acpResult.acpMode,    // 'acp' | 'wac'
          grant: acpResult.grant,
        });
      }
      if (mode === 'acp') {
        // 422 = pod can't satisfy the request (no sharing surface).
        // 500 = something else broke (Inrupt SDK error, etc).
        const status = (acpResult.code === 'SHARING_NOT_SUPPORTED'
                     || acpResult.code === 'SHARING_UNAVAILABLE') ? 422 : 500;
        return sendError(res, status, acpResult.code, acpResult.message);
      }
      // mode === 'auto' → fall through to cap-token.
    }

    // Cap-token path (legacy default).
    let id = identity;
    if (!id) {
      try {
        id = await deriveIdentity(vault);
      } catch (err) {
        return sendError(res, 503, 'NO_IDENTITY', err?.message ?? 'no identity material in vault');
      }
    }

    let scopeStrings;
    try {
      scopeStrings = scopes.map((s) => normalizeScope(s, path));
    } catch (err) {
      return sendError(res, 400, 'BAD_REQUEST', err.message);
    }

    try {
      const token = await PodCapabilityToken.issue(id, {
        subject:   webid,
        pod:       podRoot,
        scopes:    scopeStrings,
        expiresIn: expiresIn ?? 3_600_000,
      });
      res.json({ mode: 'cap-token', token: token.toJSON() });
    } catch (err) {
      sendError(res, 500, 'ISSUE_FAILED', err?.message ?? String(err));
    }
  });

  // ── /sync/now ─────────────────────────────────────────────────────────────
  router.post('/sync/now', async (req, res) => {
    const body = req.body ?? {};
    const direction = body.direction ?? 'both';
    if (!['both', 'push', 'pull'].includes(direction)) {
      return sendError(res, 400, 'BAD_DIRECTION',
        'direction must be "both" | "push" | "pull"');
    }

    // Fire-and-forget; progress + done go over WS.  202 = accepted-not-yet-done.
    res.status(202).json({ ok: true, started: true });

    hub.broadcast({ type: 'sync.progress', phase: 'start', direction });
    Promise.resolve()
      .then(() => engine.runOnce({ direction }))
      .then(() => {
        // sync.done is broadcast by wsHub via the engine's 'synced' event; no-op here.
      })
      .catch((err) => {
        hub.broadcast({
          type:    'error',
          phase:   'sync.now',
          message: err?.message ?? String(err),
        });
      });
  });

  // ── /sync/force ───────────────────────────────────────────────────────────
  // Folio v2.5 — re-uploads every local file regardless of cached state.
  // Same fire-and-forget shape as /sync/now: 202 immediately, progress over
  // the WebSocket as `sync.force.start` / `sync.force.done` frames.
  router.post('/sync/force', async (_req, res) => {
    if (typeof engine.forcePush !== 'function') {
      return sendError(res, 500, 'NOT_SUPPORTED', 'engine has no forcePush()');
    }
    res.status(202).json({ ok: true, started: true });
    Promise.resolve()
      .then(() => engine.forcePush())
      .catch((err) => {
        hub.broadcast({
          type:    'error',
          phase:   'sync.force',
          message: err?.message ?? String(err),
        });
      });
  });

  // ── /verify/:id ───────────────────────────────────────────────────────────
  // Folio v2.5 — verify the pod's view of one file.  `id` is the same
  // base64url(relPath) encoding the conflicts + versions endpoints use.
  router.get('/verify/:id', async (req, res) => {
    const id = req.params.id;
    const relPath = relPathFromConflictId(id);
    if (!relPath || relPath.length === 0) {
      return sendError(res, 400, 'BAD_VERIFY_ID', 'verify id is malformed');
    }
    if (relPath.split(/[\\/]/).some((seg) => seg === '..')) {
      return sendError(res, 400, 'BAD_VERIFY_ID', 'verify id has invalid path segments');
    }
    if (typeof engine.verifyPodState !== 'function') {
      return sendError(res, 500, 'NOT_SUPPORTED', 'engine has no verifyPodState()');
    }
    try {
      const r = await engine.verifyPodState(relPath);
      res.json({ ts: Date.now(), ...r });
    } catch (err) {
      sendError(res, 500, 'VERIFY_FAILED', err?.message ?? String(err));
    }
  });

  // ── /rm/:id (Folio v2.11) ─────────────────────────────────────────────────
  // Per-file local-tombstone delete.  `id` = base64url(relPath) — same
  // encoding the conflicts + versions + verify endpoints use.  The pod copy
  // is preserved; the local file is removed on the next sync; the file
  // won't re-download because the SDK records a tombstone.
  //
  // Errors:
  //   - 400 BAD_DELETE_ID — id malformed or has '..' segments
  //   - 404 NOT_FOUND     — relPath has no local file AND no knownState
  //                          entry (nothing to tombstone)
  //   - 500 DELETE_FAILED — engine threw during deleteLocal
  router.post('/rm/:id', async (req, res) => {
    const id = req.params.id;
    const relPath = relPathFromConflictId(id);
    if (!relPath || relPath.length === 0) {
      return sendError(res, 400, 'BAD_DELETE_ID', 'delete id is malformed');
    }
    if (relPath.split(/[\\/]/).some((seg) => seg === '..' || seg === '')) {
      return sendError(res, 400, 'BAD_DELETE_ID', 'delete id has invalid path segments');
    }
    if (typeof engine.deleteLocal !== 'function') {
      return sendError(res, 500, 'NOT_SUPPORTED', 'engine has no deleteLocal()');
    }

    // Confirm there's something to tombstone.  We treat "file present locally"
    // OR "file ever synced (knownState)" as the precondition.  Without either,
    // a tombstone for a never-seen file is a no-op the user probably didn't
    // mean — surface as 404 so the UI can warn.
    const localRoot = engine.localRoot;
    const absPath   = join(localRoot, ...relPath.split('/'));
    let hasLocal = false;
    try { await fs.access(absPath); hasLocal = true; } catch { /* ENOENT */ }
    let hasKnown = false;
    try {
      const text = await readStateText(fs, localRoot);
      const parsed = text != null ? JSON.parse(text) : null;
      hasKnown = !!parsed?.files?.[relPath];
    } catch { /* no state yet */ }
    if (!hasLocal && !hasKnown) {
      return sendError(res, 404, 'NOT_FOUND', `no file at ${relPath}`);
    }

    try {
      await engine.deleteLocal(relPath);
    } catch (err) {
      return sendError(res, 500, 'DELETE_FAILED', err?.message ?? String(err));
    }
    res.json({ ok: true, relPath });
  });

  // ── /delete/:id (Folio v2.11) ─────────────────────────────────────────────
  // Per-file PERMANENT delete.  Removes the resource from the pod for
  // everyone, removes the local file, drops knownState, and wipes the
  // file's time-machine history.
  //
  // Emits `sync.delete.done` over /events on success.  Local-only tombstone
  // (POST /rm/:id) intentionally has no WS frame — the next sync's
  // `sync.done` frame surfaces it via `deletes`.
  //
  // Errors:
  //   - 400 BAD_DELETE_ID — id malformed or has '..' segments
  //   - 404 NOT_FOUND     — file is absent locally AND from the pod
  //   - 500 DELETE_FAILED — engine / pod-client threw
  router.post('/delete/:id', async (req, res) => {
    const id = req.params.id;
    const relPath = relPathFromConflictId(id);
    if (!relPath || relPath.length === 0) {
      return sendError(res, 400, 'BAD_DELETE_ID', 'delete id is malformed');
    }
    if (relPath.split(/[\\/]/).some((seg) => seg === '..' || seg === '')) {
      return sendError(res, 400, 'BAD_DELETE_ID', 'delete id has invalid path segments');
    }
    if (typeof engine.deleteCompletely !== 'function') {
      return sendError(res, 500, 'NOT_SUPPORTED', 'engine has no deleteCompletely()');
    }

    // Confirm something exists somewhere.  We're more permissive than /rm:
    // a stale local copy is enough; an absent local copy is fine if the
    // file is on the pod.  Only refuse when both are missing.
    const localRoot = engine.localRoot;
    const absPath   = join(localRoot, ...relPath.split('/'));
    let hasLocal = false;
    try { await fs.access(absPath); hasLocal = true; } catch { /* ENOENT */ }

    let hasPod = false;
    if (!hasLocal) {
      // Probe the pod cheaply.  If there's no `exists()` we just let the
      // engine try and surface NOT_FOUND from the pod-client below.
      const pc = resolvedPodClient;
      if (pc && typeof pc.exists === 'function') {
        try {
          const podUri = engine.pathMap?.localToPod
            ? engine.pathMap.localToPod(absPath)
            : `${engine.podRoot}${relPath.split('/').map(encodeURIComponent).join('/')}`;
          hasPod = !!(await pc.exists(podUri));
        } catch { /* treat as unknown — let engine decide */ hasPod = true; }
      } else {
        // Unknown — defer to engine; we can't 404 confidently.
        hasPod = true;
      }
      if (!hasPod) {
        return sendError(res, 404, 'NOT_FOUND', `no file at ${relPath}`);
      }
    }

    try {
      const r = await engine.deleteCompletely(relPath);
      res.json({ ok: true, relPath: r.relPath, podUri: r.podUri });
    } catch (err) {
      sendError(res, 500, 'DELETE_FAILED', err?.message ?? String(err));
    }
  });

  // ── /watch/start ──────────────────────────────────────────────────────────
  router.post('/watch/start', (_req, res) => {
    try {
      if (!engine.__watching) {
        engine.start();
        engine.__watching = true;
      }
      hub.broadcast({ type: 'status', stats: engine.stats ?? {}, watching: true });
      res.json({ ok: true, watching: true });
    } catch (err) {
      sendError(res, 500, 'WATCH_START_FAILED', err?.message ?? String(err));
    }
  });

  // ── /watch/stop ───────────────────────────────────────────────────────────
  router.post('/watch/stop', async (_req, res) => {
    try {
      if (engine.__watching) {
        await engine.stop();
        engine.__watching = false;
      }
      hub.broadcast({ type: 'status', stats: engine.stats ?? {}, watching: false });
      res.json({ ok: true, watching: false });
    } catch (err) {
      sendError(res, 500, 'WATCH_STOP_FAILED', err?.message ?? String(err));
    }
  });

  // ── /diagnostics (Folio v2.3) ─────────────────────────────────────────────
  // POST /diagnostics → 202 (accepted, runs in the background) or 409
  // (one is already in flight).  Step events stream over the WebSocket
  // /events as `{ type: 'diagnostics.step', ts, idx, total, label, status,
  // detail? }` frames; the run ends with `{ type: 'diagnostics.done', ts,
  // ok, counts, recommendedFix? }`.
  //
  // The CLI's `folio doctor` consumes the same step engine — see
  // `apps/folio/src/diagnostics.js` for the 16-step sequence.
  router.post('/diagnostics', async (_req, res) => {
    if (diagnosticsInFlight) {
      return sendError(res, 409, 'DIAGNOSTICS_IN_PROGRESS',
        'a diagnostics run is already in progress; wait for diagnostics.done');
    }
    diagnosticsInFlight = true;
    res.status(202).json({ ok: true, started: true, total: STEP_TOTAL });

    // Run async so we return the 202 immediately.  Errors are surfaced via
    // a `diagnostics.done` frame with ok:false rather than swallowed.
    const steps = [];
    let idx = 0;
    const reporter = {
      step(event) {
        idx++;
        steps.push(event);
        hub.broadcast({
          type:   'diagnostics.step',
          idx,
          total:  STEP_TOTAL,
          id:     event.id,
          label:  event.label,
          status: event.status,
          ...(event.detail ? { detail: String(event.detail) } : {}),
        });
      },
    };

    try {
      const result = await runDiagnosticsFn(reporter, diagnosticsDeps ?? {});
      const counts = result?.counts ?? { PASS: 0, FAIL: 0, WARN: 0, SKIP: 0 };
      const ok = counts.FAIL === 0 && result?.abortReason !== 'NO_CONFIG';
      const recommendedFix = recommendFixFromSteps(steps);
      hub.broadcast({
        type:        'diagnostics.done',
        ok,
        counts,
        abortReason: result?.abortReason ?? null,
        ...(recommendedFix ? { recommendedFix } : {}),
      });
    } catch (err) {
      // Engine-level throw (very unlikely — the engine catches its own).
      hub.broadcast({
        type:    'diagnostics.done',
        ok:      false,
        counts:  { PASS: 0, FAIL: 1, WARN: 0, SKIP: 0 },
        error:   err?.message ?? String(err),
      });
    } finally {
      diagnosticsInFlight = false;
    }
  });

  // ── /shutdown (Folio v2.7) ─────────────────────────────────────────────
  // POST /shutdown — graceful shutdown of `folio serve` (server + tray + engine).
  //
  // Gated by an explicit confirmation header (`X-Folio-Shutdown: true`) so a
  // misfired curl POST or a typo'd Open-graph crawl can NOT kill the running
  // agent.  When the header is missing, returns 400 BAD_HEADER.
  //
  // The actual shutdown function is registered by `serveCmd` on
  // `req.app.locals.folioShutdown`.  Tests that wire `createServer()` without
  // a CLI driver will get 503 NO_SHUTDOWN_HOOK so they can assert the
  // contract independently.
  router.post('/shutdown', (req, res) => {
    if (req.get('x-folio-shutdown') !== 'true') {
      return sendError(res, 400, 'BAD_HEADER',
        'POST /shutdown requires the header X-Folio-Shutdown: true');
    }
    const hook = req.app?.locals?.folioShutdown;
    if (typeof hook !== 'function') {
      return sendError(res, 503, 'NO_SHUTDOWN_HOOK',
        'shutdown hook not registered (folio serve only — not a programmatic embed)');
    }
    res.status(202).json({ ok: true, stopping: true });
    // Defer the call so the response actually ships before the process
    // exits.  The hook itself calls process.exit(0); we never come back.
    setTimeout(() => { try { hook(); } catch { /* ignore */ } }, 50);
  });

  // 404 for anything else under this router (lets index.js mount it cleanly).
  router.use((_req, res) => {
    sendError(res, 404, 'NOT_FOUND', 'no such endpoint');
  });

  return router;
}

// ── helpers ─────────────────────────────────────────────────────────────────

function sendError(res, status, code, message) {
  res.status(status).json({ error: { code, message } });
}

/**
 * Walk a tree, collecting absolute paths of files containing conflict markers.
 * Skips dotfiles (which also skips the .onderling/ metadata dir).
 */
async function walkConflicts(root, dir, out) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      await walkConflicts(root, full, out);
    } else if (e.isFile()) {
      if (!/\.(md|markdown|txt|json|html?|css)$/i.test(e.name)) continue;
      try {
        const text = await fs.readFile(full, 'utf8');
        if (hasConflictMarkers(text)) out.push(full);
      } catch { /* ignore */ }
    }
  }
}

/**
 * Extract one side of a git-style conflict block.
 *   <<<<<<< YOURS …\n MINE \n=======\n THEIRS \n>>>>>>> THEIRS …\n
 *
 * Multiple conflict regions are all reduced to the chosen side.
 *
 * @param {string} text
 * @param {'mine'|'theirs'} side
 * @returns {string|null}
 */
function extractSide(text, side) {
  // Use a loose regex that tolerates any header text after the marker.
  const re = /^<{7}[^\n]*\n([\s\S]*?)^={7}\n([\s\S]*?)^>{7}[^\n]*\n?/gm;
  let lastIndex = 0;
  let result = '';
  let matched = false;
  let match;
  while ((match = re.exec(text)) !== null) {
    matched = true;
    result += text.slice(lastIndex, match.index);
    result += side === 'mine' ? match[1] : match[2];
    lastIndex = re.lastIndex;
  }
  if (!matched) return null;
  result += text.slice(lastIndex);
  return result;
}

/**
 * Build an AgentIdentity from the vault.
 * Mirrors the logic in shareCmd.js.
 */
async function deriveIdentity(vault) {
  if (!vault) throw new Error('no vault provided to /share');
  const seedB64  = await vault.get('bootstrap-seed-b64');
  const mnemonic = await vault.get('bootstrap-mnemonic');
  if (!seedB64 && !mnemonic) {
    throw new Error('no identity material in vault — run `folio init`');
  }
  const bootstrap = seedB64
    ? Bootstrap.fromSeed(new Uint8Array(Buffer.from(seedB64, 'base64')))
    : Bootstrap.fromMnemonic(mnemonic);
  return new AgentIdentity({ seed: bootstrap.secret, vault: null });
}

/**
 * Normalize a scope spec to a `pod.<verb>:/<path>` string.
 * Accepts:
 *   - "pod.read:/foo"        — used as-is.
 *   - "read" / "write" / "delete" / "*"  — combined with `path` (default '/').
 */
function normalizeScope(scope, path) {
  if (typeof scope !== 'string' || scope.length === 0) {
    throw new Error('each scope must be a non-empty string');
  }
  if (scope.startsWith('pod.')) return scope;
  const verb = scope;
  if (!['read', 'write', 'delete', '*'].includes(verb)) {
    throw new Error(`invalid scope verb "${verb}"; expected read|write|delete|* or a fully-qualified pod.<verb>:<path>`);
  }
  const p = typeof path === 'string' && path.length > 0 ? path : '/';
  const normalized = p.startsWith('/') ? p : `/${p}`;
  return `pod.${verb}:${normalized}`;
}

/**
 * Phase 52.16.3 (2026-05-14) — try the ACP/WAC grant path.
 *
 * Returns `{ok: true, acpMode: 'acp'|'wac', grant}` on success;
 * `{ok: false, code, message}` on failure (so the caller can branch
 * between "fall back to cap-token" and "surface the error").
 *
 * Requires `podClient.sharing` — present only when the server was
 * booted with a SolidOidcAuth-backed podClient (i.e. the user signed
 * in via the browser flow). Mock pods don't have it.
 */
async function _tryAcpGrant({ podClient, podRoot, webid, scopes, path }) {
  if (!podClient || typeof podClient.sharing !== 'object') {
    return {
      ok: false,
      code: 'SHARING_UNAVAILABLE',
      message: 'pod client does not expose .sharing — sign in via /auth/login first',
    };
  }

  // Derive the ACP modes from the cap-token-style scope verbs. The
  // mapping is one-to-one for the standard four; '*' becomes
  // 'control' (full grant).
  const modesSet = new Set();
  for (const s of scopes) {
    let verb;
    if (typeof s === 'string' && s.startsWith('pod.')) {
      // 'pod.read:/x' → 'read'
      verb = s.slice(4).split(':')[0];
    } else if (typeof s === 'string') {
      verb = s;
    } else {
      return { ok: false, code: 'BAD_REQUEST', message: `unsupported scope shape: ${JSON.stringify(s)}` };
    }
    switch (verb) {
      case 'read':   modesSet.add('read'); break;
      case 'write':  modesSet.add('write'); break;
      case 'delete': modesSet.add('write'); break;   // delete needs write in ACP
      case 'append': modesSet.add('append'); break;
      case '*':      modesSet.add('control'); break;
      default:
        return { ok: false, code: 'BAD_REQUEST', message: `unknown scope verb "${verb}"` };
    }
  }
  const modes = [...modesSet];

  // Compute the target URI. `path` may be empty (= pod root), a
  // relative path, or an absolute URI under podRoot.
  let targetUri;
  if (typeof path === 'string' && path.startsWith('http')) {
    targetUri = path;
  } else {
    const rel = (path ?? '').replace(/^\/+/, '');
    const root = podRoot.endsWith('/') ? podRoot : `${podRoot}/`;
    targetUri = rel.length === 0 ? root : `${root}${rel}`;
  }
  const isContainer = targetUri.endsWith('/');
  const targetField = isContainer ? { containerUri: targetUri } : { resourceUri: targetUri };

  try {
    const grant = await podClient.sharing.grant({
      ...targetField,
      agent: webid,
      modes,
    });
    return {
      ok: true,
      acpMode: grant.mode,     // 'acp' or 'wac'
      grant,
    };
  } catch (err) {
    return {
      ok: false,
      code: err?.code ?? 'SHARING_GRANT_FAILED',
      message: err?.message ?? String(err),
    };
  }
}
