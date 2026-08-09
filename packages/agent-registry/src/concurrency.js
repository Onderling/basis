/**
 * Etag-based optimistic concurrency helper.
 *
 * Each registry mutation reads the current resource (with its etag),
 * applies the mutation, and writes back with `If-Match: <etag>`. If
 * the pseudo-pod's underlying store reports a CAS-style failure
 * (`CONFLICT` / `412`), we re-read and retry up to `maxRetries`
 * (default 3). After exhausting retries the caller's
 * `onPersistentConflict` callback fires so the UI can surface
 * "registry changed on another device — reload?".
 *
 * Standardisation Phase 52.10.3.
 */

import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/core';

// Parameter register (#36) — etag compare-and-swap retry cap (scope:device, kind:internal).
const DEFAULT_MAX_RETRIES = param({ key: 'concurrency.maxRetries', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 3 });
const DEFAULT_BACKOFF_MS  = [10, 50, 200];

/**
 * Run one read → mutate → write cycle under etag compare-and-swap, retrying on `CONFLICT` with a
 * short backoff (10/50/200 ms) up to `maxRetries` (default 3). Mutation errors propagate verbatim;
 * after retries are exhausted, `onPersistentConflict` fires and a `PERSISTENT_CONFLICT` error is
 * thrown.
 *
 * @param {object} args
 * @param {() => Promise<{body: object, etag?: string | null}>} args.readCurrent
 * @param {(current: object, etag: string | null) => Promise<object> | object} args.mutate
 *   — returns the new body. May throw to abort the mutation.
 * @param {(body: object, etag: string | null) => Promise<{etag?: string}>} args.writeNext
 *   — returns the new etag. Throws `{code: 'CONFLICT'}` on 412.
 * @param {number}    [args.maxRetries=3]
 * @param {number[]}  [args.backoffMs=[10, 50, 200]]  — per-attempt retry delays; the last entry
 *   repeats when attempts outnumber entries.
 * @param {(error: Error) => void} [args.onPersistentConflict]
 * @param {(ms: number) => Promise<void>} [args.sleep]
 *
 * @returns {Promise<{body: object, etag?: string, retries: number}>}
 */
export async function withCAS({
  readCurrent,
  mutate,
  writeNext,
  maxRetries = DEFAULT_MAX_RETRIES,
  backoffMs  = DEFAULT_BACKOFF_MS,
  onPersistentConflict,
  sleep,
} = {}) {
  if (typeof readCurrent !== 'function' || typeof mutate !== 'function' || typeof writeNext !== 'function') {
    throw Object.assign(
      new Error('withCAS: readCurrent / mutate / writeNext required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  const doSleep = typeof sleep === 'function'
    ? sleep
    : (ms) => new Promise(r => setTimeout(r, ms));

  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const { body, etag } = await readCurrent();
    let next;
    try {
      next = await mutate(body, etag ?? null);
    } catch (err) {
      throw err;   // mutation-level errors propagate verbatim
    }
    try {
      const { etag: newEtag } = await writeNext(next, etag ?? null);
      return { body: next, etag: newEtag ?? null, retries: attempt };
    } catch (err) {
      if (err?.code !== 'CONFLICT') throw err;
      lastError = err;
      if (attempt < maxRetries) {
        const delay = backoffMs[Math.min(attempt, backoffMs.length - 1)];
        await doSleep(delay);
        continue;
      }
    }
  }
  if (typeof onPersistentConflict === 'function') {
    try { onPersistentConflict(lastError); } catch { /* swallow */ }
  }
  throw Object.assign(
    new Error('agent-registry: persistent CAS conflict — registry changed on another device'),
    { code: 'PERSISTENT_CONFLICT', cause: lastError },
  );
}
