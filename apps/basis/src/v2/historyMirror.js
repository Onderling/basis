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
 * Layout under `prefix` (default `basis/history/`):
 *   log/batch-<n>.json   {n, firstSeq, lastSeq, entries:[…]} — append-only, never rewritten
 *   cursor.json          {batch, lastSeq}                     — replace-on-write, the resume point
 *   head.json            {v, writtenAt, …snapshot()}          — replace-on-write, the non-log state
 *
 * Resumable: `start()` reads the cursor and backfills every LIVE log entry with seq > lastSeq
 * (entries the log already pruned are honestly gone — the mirror is complete from the day it is
 * turned on). A failed flush keeps its buffer and retries on the next one; `status()` says so.
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
  batchMax = 50,
  flushMs = 2000,
  now = Date.now,
  logger = console,
} = {}) {
  if (!eventLog || typeof eventLog.subscribe !== 'function') throw new Error('createHistoryMirror: an event log with subscribe() is required');
  if (!source || typeof source.read !== 'function' || typeof source.write !== 'function') throw new Error('createHistoryMirror: a DataSource-shaped source is required');

  const cursorUri = `${prefix}cursor.json`;
  const headUri   = `${prefix}head.json`;
  const batchUri  = (n) => `${prefix}log/batch-${n}.json`;

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
        .filter((e) => Number.isFinite(e?.seq) && e.seq > cursor.lastSeq)
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
