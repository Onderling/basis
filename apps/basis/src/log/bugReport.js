/**
 * Anonymous bug-report envelope — shared pure module (web ≡ mobile).
 *
 * ANONYMITY GUARANTEE (by construction): the envelope this builds carries NO identity.
 * There is no chatId, no participant pseudonym / agent public key, no webid, no handle,
 * and no device id — and no field through which any of those could ride. We read ONLY
 * the PII-safe on-device `records` (event codes + scalar counts, produced by the logger,
 * which is PII-safe BY CONSTRUCTION) and emit a fixed-shape literal `{ kind, at, app,
 * version, log, n }`. Because the output is a literal built from `formatLogs(records)`,
 * `records.length`, and the explicitly-named metadata, ANY extra keys on the inputs
 * (even an identity smuggled into a record or an extra arg) are ignored, never copied
 * through. This is the anonymous half of the "Report a problem" flow: the user reviews
 * the same PII-safe log, and only these fields ever leave the device.
 *
 * `at` is INJECTED (not read from Date.now() in here) so the envelope is deterministic
 * and testable; the caller passes the timestamp.
 */
import { formatLogs } from '@onderling/logger';

/**
 * Package the PII-safe on-device log dump into an anonymous report object.
 * @param {object}  a
 * @param {Array}   [a.records=[]]  the logger dump (`dumpLogs()`) — scalar-only records
 * @param {string}  [a.app]         non-identifying app name (e.g. 'basis')
 * @param {string}  [a.version]     non-identifying app/build version
 * @param {number}  [a.at]          injected timestamp (epoch ms)
 * @returns {{kind:'bug-report', at:number|undefined, app:string|null, version:string|null, log:string, n:number}}
 */
export function buildReportEnvelope({ records = [], app, version, at } = {}) {
  const recs = Array.isArray(records) ? records : [];
  return {
    kind: 'bug-report',
    at,
    app: app ?? null,
    version: version ?? null,
    log: formatLogs(recs),   // PII-safe text render (codes + scalar fields only)
    n: recs.length,
  };
}
