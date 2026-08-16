/**
 * historyMirror — the personal history store's SINK: a sealed, incremental follower of the
 * device log plus a small snapshot head.
 *
 * The device log is the record; every store is a projection over it. This module adds NO second
 * authority — it is a follower that copies the log outward, batch by batch, into a sealed
 * DataSource (the pod first; any read/write/delete/list backend fits). Restore later hydrates
 * these batches back THROUGH the same verify-on-ingest gates a peer's statements pass, so a
 * tampered mirror can corrupt nothing — it can only fail to verify.
 *
 * Sealing is the SOURCE'S job, by construction: the caller hands a sealed DataSource (the same
 * seal-to-self mechanism the settings pod-sync uses — sealed to the agent's own network-derived
 * key, identical across the user's enrolled devices and re-derived by the phrase ceremony), so
 * nothing this module writes ever reaches the backend as plaintext.
 *
 * Layout under `prefix` (default `basis/history/`) — one LANE per enrolled device:
 *   log/<laneId>/batch-<n>.json  {n, firstSeq, lastSeq, entries:[…]} — append-only, never rewritten
 *   log/<laneId>/cursor.json     {batch, lastSeq}                     — replace-on-write, the resume point
 *   head.json                    {v, writtenAt, …snapshot()}          — replace-on-write, the non-log state
 *
 * Resumable: `start()` reads the lane's cursor and backfills every LIVE log entry with seq >
 * lastSeq (entries the log already pruned are honestly gone — the mirror is complete from the day
 * it is turned on). A failed flush keeps its buffer and retries on the next one; `status()` says so.
 *
 * The READ half (`hydrateHistory`) is the instant-restore ladder: merge every lane by entry id,
 * hydrate the RECENT window first (last N days OR the newest M entries per circle, whichever is
 * larger — conversations open live), then the long tail in the background (folds are
 * deterministic, so arrival order cannot change any outcome). Opening a sealed batch IS the
 * integrity gate: the seal is authenticated encryption under the owner's key, so a tampered or
 * foreign mirror fails to OPEN — it cannot inject.
 */

import { createSealedPodDataSource } from '@onderling/pod-client';

/** Mirror switch — OFF by default (the mirror writes only after the person turns it on). */
export const HISTORY_MIRROR_PARAM_KEY = 'history.mirror';

/**
 * The pod backend for the mirror — the settings pod-sync's sibling: a sealed DataSource over the
 * user's own pod, sealed with the caller-supplied seal-to-self strategy. The shell supplies the
 * pod (fetch/podRoot); realAgent supplies the strategy; tests inject a memory `podSource`.
 * Not signed in / no strategy → null (the mirror simply doesn't run — honest degrade).
 */
export async function createHistoryPodMedium({ fetch, podRoot, strategy, podSource } = {}) {
  if ((typeof fetch !== 'function' && !podSource) || (!podRoot && !podSource)) return null;
  if (!strategy || typeof strategy.seal !== 'function' || typeof strategy.open !== 'function') return null;
  return createSealedPodDataSource({ podSource, fetch, podUrl: podRoot ?? 'mem://', strategy });
}

export function createHistoryMirror({
  eventLog,
  source,
  snapshot = null,
  prefix = 'basis/history/',
  laneId = 'root',
  skip = null,
  filter = null,
  batchMax = 50,
  flushMs = 2000,
  now = Date.now,
  logger = console,
} = {}) {
  if (!eventLog || typeof eventLog.subscribe !== 'function') throw new Error('createHistoryMirror: an event log with subscribe() is required');
  if (!source || typeof source.read !== 'function' || typeof source.write !== 'function') throw new Error('createHistoryMirror: a DataSource-shaped source is required');

  // Every ENROLLED DEVICE mirrors its own log into its own LANE (`log/<laneId>/…`): lanes never
  // clobber each other's batch numbering, and each device's cursor is meaningful only against its
  // own local seqs (seq is per-instance and never travels). Restore merges all lanes by entry id.
  // `skip` (a Set of entry ids) excludes what restore just hydrated — those entries came FROM the
  // mirror, so backfilling them into this device's lane would only duplicate storage.
  // `filter` (a predicate over entries) makes this a PARTIAL lane — the remote surface's
  // per-view "edition": only entries the grant's sections cover are ever written, so combined
  // with a recipient-widened seal the lane discloses exactly the granted slice and nothing else.
  const lane      = `${prefix}log/${laneId}/`;
  const cursorUri = `${lane}cursor.json`;
  const headUri   = `${prefix}head.json`;
  const batchUri  = (n) => `${lane}batch-${n}.json`;

  let buffer = [];          // entries awaiting flush, ascending seq
  let cursor = { batch: 0, lastSeq: 0 };
  let unsubscribe = null;
  let timer = null;
  let flushing = null;      // in-flight flush promise (serialises flushes)
  let lastFlushAt = null;
  let lastError = null;
  let mirrored = 0;

  async function readCursor() {
    try {
      const raw = await source.read(cursorUri);
      const c = raw ? JSON.parse(raw) : null;
      if (c && Number.isFinite(c.batch) && Number.isFinite(c.lastSeq)) cursor = { batch: c.batch, lastSeq: c.lastSeq };
    } catch (err) {
      // An unreadable cursor is treated as absent — batches dedupe by seq on restore, so the worst
      // case is a re-mirrored overlap, never a gap.
      logger.warn?.('[history-mirror] cursor unreadable — starting from the live log', err?.message ?? err);
    }
  }

  async function doFlush() {
    if (buffer.length === 0) return;
    const entries = buffer;
    buffer = [];
    const n = cursor.batch + 1;
    const batch = { n, firstSeq: entries[0].seq, lastSeq: entries[entries.length - 1].seq, entries };
    try {
      await source.write(batchUri(n), JSON.stringify(batch));
      cursor = { batch: n, lastSeq: batch.lastSeq };
      await source.write(cursorUri, JSON.stringify(cursor));
      mirrored += entries.length;
      lastFlushAt = now();
      lastError = null;
      await writeHead();   // the head is small; refreshing it per flush keeps restore's step 1 current
    } catch (err) {
      // Put the entries back IN FRONT of anything appended meanwhile — order stays ascending, and
      // the next flush retries the same batch number (the cursor never advanced).
      buffer = entries.concat(buffer);
      lastError = err?.message ?? String(err);
      logger.warn?.('[history-mirror] flush failed — will retry', lastError);
    }
  }

  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    // Serialise: a flush that starts while one is in flight queues behind it.
    flushing = (flushing ?? Promise.resolve()).then(doFlush, doFlush);
    return flushing;
  }

  function onAppend(entry) {
    if (!entry || !Number.isFinite(entry.seq) || entry.seq <= cursor.lastSeq) return;
    if (filter && !filter(entry)) return;
    buffer.push(entry);
    if (buffer.length >= batchMax) flush();
    else if (!timer) timer = setTimeout(flush, flushMs);
  }

  async function writeHead() {
    if (typeof snapshot !== 'function') return;
    try {
      const head = { v: 1, writtenAt: now(), ...(await snapshot()) };
      await source.write(headUri, JSON.stringify(head));
    } catch (err) {
      lastError = err?.message ?? String(err);
      logger.warn?.('[history-mirror] head write failed', lastError);
    }
  }

  return {
    /** Read the cursor, backfill the live log past it, and follow appends. */
    async start() {
      await readCursor();
      // The log's read surface is query() (most-recent-first); mirror ascending.
      const backlog = (typeof eventLog.query === 'function' ? eventLog.query() : [])
        .filter((e) => Number.isFinite(e?.seq) && e.seq > cursor.lastSeq && !(skip?.has?.(e.id))
          && (!filter || filter(e)))
        .sort((a, b) => a.seq - b.seq);
      buffer = backlog.concat(buffer);
      unsubscribe = eventLog.subscribe(onAppend);
      await writeHead();
      if (buffer.length) await flush();
      return this;
    },

    /** Stop following; one final flush so nothing buffered is lost. */
    async stop() {
      unsubscribe?.();
      unsubscribe = null;
      await flush();
    },

    flush,
    writeHead,

    /** For the my-data "mirror healthy" row (M3). */
    status: () => ({ mirrored, pending: buffer.length, lastFlushAt, lastError, cursor: { ...cursor } }),
  };
}

/** Restore params — the recency window's two halves (whichever is larger wins, per circle). */
export const HISTORY_RECENCY_DAYS_KEY = 'history.restore.recencyDays';
export const HISTORY_RECENCY_MAX_KEY  = 'history.restore.maxPerCircle';

/** Parse `log/<lane>/batch-<n>.json` keys out of a backend listing (any nesting the backend reports). */
const BATCH_KEY_RE = /log\/([^/]+)\/batch-(\d+)\.json$/;

async function listBatchKeys(source, prefix, lanes = null) {
  const keys = new Set();
  const seen = new Set();
  async function walk(p) {
    if (seen.has(p)) return;
    seen.add(p);
    let listed = [];
    try { listed = (await source.list(p)) ?? []; } catch { return; }
    for (const k of listed) {
      if (typeof k !== 'string') continue;
      const m = BATCH_KEY_RE.exec(k);
      if (m) { if (!lanes || lanes(m[1])) keys.add(k); }
      // A pod backend may list containers one level at a time — walk anything that looks deeper.
      else if (k.endsWith('/') && k !== p) await walk(k);
    }
  }
  await walk(`${prefix}log/`);
  return [...keys];
}

/**
 * The instant-restore hydrate (the ladder's steps 2 + 3). Reads every lane's batches, merges the
 * entries by id, and hydrates the local device log in two phases:
 *   RECENT — per circle, everything inside the recency window (ts >= now − recencyDays) PLUS the
 *            newest maxPerCircle entries, whichever set is larger; awaited, so the caller knows
 *            when conversations are live.
 *   TAIL   — the rest, oldest last, in the background (`tailDone` resolves when it lands).
 *
 * `EventLog.hydrate` dedupes by id and restamps seq locally, so re-running is idempotent and a
 * half-restored device just continues. Returns the hydrated ids so the caller can hand them to
 * the sink's `skip` — what came FROM the mirror must not backfill into this device's lane.
 *
 * @returns {Promise<{recent:number, hydratedIds:Set<string>, tailDone:Promise<number>}>}
 */
export async function hydrateHistory({
  source,
  eventLog,
  prefix = 'basis/history/',
  lanes = null,
  recencyDays = 30,
  maxPerCircle = 500,
  now = Date.now,
  logger = console,
} = {}) {
  if (!source || typeof source.list !== 'function') throw new Error('hydrateHistory: a DataSource-shaped source is required');
  if (!eventLog || typeof eventLog.hydrate !== 'function') throw new Error('hydrateHistory: an event log with hydrate() is required');

  // `lanes` (a predicate over lane ids) narrows which lanes hydrate: a paired view reads ONLY
  // its own lane (the others are sealed past it anyway — this just skips the noisy failed
  // opens); a restoring device may exclude view lanes (their entries are subsets, deduped by id
  // regardless, so this is efficiency, not a gate — the SEAL is the gate).
  const keys = await listBatchKeys(source, prefix, lanes);
  const byId = new Map();
  for (const key of keys) {
    try {
      const batch = JSON.parse(await source.read(key));
      for (const e of (batch?.entries ?? [])) {
        if (e && typeof e.id === 'string' && e.id && !byId.has(e.id)) byId.set(e.id, e);
      }
    } catch (err) {
      // An unopenable batch is a FAILED gate (tampered, or sealed under a foreign key) — skip it
      // loudly; the rest of the mirror still restores.
      logger.warn?.(`[history-restore] batch unreadable — skipped: ${key}`, err?.message ?? err);
    }
  }

  // Newest first, per the hydrate contract (it walks oldest→newest itself).
  const all = [...byId.values()].sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
  const cutoff = now() - recencyDays * 24 * 60 * 60 * 1000;
  const perCircle = new Map();
  const recentSet = new Set();
  for (const e of all) {
    const circle = typeof e.circleId === 'string' && e.circleId ? e.circleId : '';
    const rank = perCircle.get(circle) ?? 0;
    perCircle.set(circle, rank + 1);
    if ((e.ts ?? 0) >= cutoff || rank < maxPerCircle) recentSet.add(e.id);
  }
  const recentEntries = all.filter((e) => recentSet.has(e.id));
  const tailEntries   = all.filter((e) => !recentSet.has(e.id));

  const recent = eventLog.hydrate(recentEntries);
  const hydratedIds = new Set(byId.keys());

  // A real macrotask, not a microtask — the recent window must be OBSERVABLY live before the
  // tail lands (that is the ladder's promise), and the event loop gets a turn to paint.
  const tailDone = new Promise((resolve) => {
    setTimeout(() => {
      const n = eventLog.hydrate(tailEntries);
      if (n) logger.info?.(`[history-restore] tail landed: ${n} older entr${n === 1 ? 'y' : 'ies'}`);
      resolve(n);
    }, 0);
  });

  return { recent, hydratedIds, tailDone };
}

/**
 * The EXPORT fold-in: a full-log export IS "mirror to a file" — the same sink, one shot, into an
 * in-memory archive, serialized to one JSON document (key → sealed body). No bespoke exporter:
 * whatever the sink writes is what the file holds, sealed exactly like the pod mirror, and
 * `archiveSource` feeds the SAME `hydrateHistory` door on the way back — an export is proven
 * restorable by construction.
 */

/** A SolidPodSource-shaped backing over a Map — the archive's in-memory body store. */
function archiveBacking(map = new Map()) {
  return {
    map,
    async read(uri) { if (!map.has(uri)) { const e = new Error('not-found'); e.status = 404; throw e; } return { content: map.get(uri) }; },
    async write(uri, body) { map.set(uri, String(body)); },
    async delete(uri) { map.delete(uri); },
    async list(prefix) { return [...map.keys()].filter((k) => k.startsWith(prefix)); },
  };
}

/** The archive document format. */
const ARCHIVE_V = 1;

/**
 * One-shot export: run the sink over the LIVE device log into a sealed in-memory archive and
 * serialize it. `strategy` is the same seal-to-self the pod mirror uses — the file is opaque to
 * anyone but the owner, and a future install opens it with the phrase-restored identity.
 *
 * @returns {Promise<string>} the archive JSON (`{v, exportedAt, entries: {key: sealedBody}}`)
 */
export async function exportHistoryArchive({ eventLog, strategy, snapshot = null, laneId = 'export', now = Date.now } = {}) {
  if (!strategy) throw new Error('exportHistoryArchive: a seal strategy is required (never export unsealed)');
  const backing = archiveBacking();
  const sealed = createSealedPodDataSource({ podSource: backing, podUrl: 'mem://', strategy });
  const sink = createHistoryMirror({
    eventLog, source: sealed, snapshot, laneId,
    batchMax: 500, flushMs: 60_000, now,
  });
  await sink.start();   // backfills the whole live log, flushes, writes the head
  await sink.stop();
  return JSON.stringify({ v: ARCHIVE_V, exportedAt: now(), entries: Object.fromEntries(backing.map) });
}

/**
 * Open an archive document as a read-only DataSource — hand it (sealed) to `createSealedPodDataSource`
 * via `podSource`, or its sealed form directly to `hydrateHistory` after wrapping. Convenience:
 * `archiveSource(json, strategy)` returns the READY sealed source for `hydrateHistory`.
 */
export function archiveSource(json, strategy) {
  const doc = typeof json === 'string' ? JSON.parse(json) : json;
  if (!doc || typeof doc.entries !== 'object') throw new Error('archiveSource: not a history archive');
  const backing = archiveBacking(new Map(Object.entries(doc.entries)));
  return strategy ? createSealedPodDataSource({ podSource: backing, podUrl: 'mem://', strategy }) : backing;
}
