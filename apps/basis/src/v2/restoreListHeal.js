/**
 * Every circle this device is in belongs on the restore list — the default profile's circle memberships, what a
 * restored device re-opens. Creating wrote that record inside the create's own wait, so an unreachable agents store
 * held "Creating circle…" for minutes (walk, 2026-10-09); and a write that failed there was simply lost, leaving a
 * circle the restore could not bring back. The create now writes it AFTER answering, and this heal runs at every
 * boot: one source of truth (the circles stoop says I am in), no pending store to keep in sync, and it also repairs
 * circles missed before this existed. The address is derived, never stored, so it can always be re-made.
 *
 * Idempotent: a circle already on the list is not touched (its handle and proof stay as the join wrote them).
 *
 * @param {object} o
 * @param {() => Promise<string[]>} o.circleIds       the circles this device is in
 * @param {() => Promise<Object<string, object>>} o.memberships   the restore list as it stands, `{ [circleId]: record }`
 * @param {(circleId: string) => (string|null)} o.addressFor      this device's derived per-circle address
 * @param {(circleId: string, address: string) => Promise<any>} o.write   writes one record
 * @param {number} [o.boundMs]   how long one write may take
 * @param {(msg: string) => void} [o.log]
 * @returns {Promise<{written: string[], failed: string[]}>}
 */
export async function healRestoreList({ circleIds, memberships, addressFor, write, boundMs = 10_000, log = () => {} }) {
  const written = []; const failed = [];
  let have = {};
  try { have = (await memberships()) ?? {}; } catch { return { written, failed }; }   // unreadable list: nothing to compare against — the next boot tries again
  let ids = [];
  try { ids = (await circleIds()) ?? []; } catch { return { written, failed }; }
  for (const circleId of ids) {
    if (typeof circleId !== 'string' || !circleId || have[circleId]) continue;
    const address = addressFor(circleId);
    if (!address) continue;
    try {
      await settleWithin(write(circleId, address), boundMs);
      written.push(circleId);
    } catch (err) {
      failed.push(circleId);
      log(`[restore-data] ${circleId.slice(0, 12)}… still not on the restore list (the next boot retries): ${err?.message ?? err}`);
    }
  }
  return { written, failed };
}

function settleWithin(p, ms) {
  let timer = null;
  const bound = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms); });
  return Promise.race([Promise.resolve(p), bound]).finally(() => clearTimeout(timer));
}
