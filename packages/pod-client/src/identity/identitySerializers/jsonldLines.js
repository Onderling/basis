/**
 * jsonldLines.js — JSON-LD Lines serializer for the auth-log.
 *
 * Per `Design-v3/identity-pod-schema.md` §AuthEvent (auth-log) the
 * auth-log is a `\n`-separated stream of one JSON object per line.
 * Each line is parsed independently — robust against truncated tails.
 *
 * The auth-log file lives ENCRYPTED on the pod (`YYYY-MM.enc`), so
 * the plaintext bytes this module produces are wrapped in the
 * encryption envelope before being written.
 */

// Naming migration 2026-07-28: new lines carry the onderling context. Parsing is per-line JSON and
// never validates the context string, so pre-rename lines still parse unchanged.
const NS_CONTEXT = 'https://onderling.org/ns';

/**
 * Build a single auth-event line.  Caller is responsible for signing
 * the canonical form (this helper does NOT sign — it just serializes).
 *
 * @param   {object} event
 * @param   {string} event.event       e.g. `'device-paired'`.
 * @param   {string} [event.actor]     URI string (device URI).
 * @param   {string} [event.target]    URI or identifier of the affected entity.
 * @param   {string} event.at          ISO-8601 datetime.
 * @param   {object} [event.metadata]  free-form extras.
 * @param   {string} [event.signature] base64-encoded ed25519 sig.
 * @returns {string} a single-line JSON string (no trailing newline).
 */
export function serializeAuthEvent(event) {
  const obj = {
    '@context': NS_CONTEXT,
    '@type':    'dw:AuthEvent',
    'dw:event': event.event,
    'dw:at':    event.at,
  };
  if (event.actor    !== undefined) obj['dw:actor']     = event.actor;
  if (event.target   !== undefined) obj['dw:target']    = event.target;
  if (event.metadata !== undefined) obj['dw:metadata']  = event.metadata;
  if (event.signature !== undefined) obj['dw:signature'] = event.signature;
  return JSON.stringify(obj);
}

/**
 * Parse a JSON-LD Lines blob into an array of event objects.
 * Empty lines are skipped; malformed lines are dropped silently
 * (consistent with append-only-log semantics — a partial trailing
 * write must not poison the rest of the log).
 *
 * @param   {string} blob
 * @returns {Array<object>}
 */
export function parseAuthLog(blob) {
  if (typeof blob !== 'string' || blob.length === 0) return [];
  const lines = blob.split('\n');
  const out = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) continue;
    try { out.push(JSON.parse(line)); }
    catch { /* skip malformed */ }
  }
  return out;
}

/**
 * Compute the YYYY-MM filename component for a given Date (or ISO
 * string).  Used to pick the auth-log file an event belongs to.
 *
 * @param   {Date|string} when  defaults to current time.
 * @returns {string} e.g. `'2026-04'`.
 */
export function authLogFileFor(when = new Date()) {
  const d = (when instanceof Date) ? when : new Date(when);
  const yyyy = d.getUTCFullYear().toString().padStart(4, '0');
  const mm   = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  return `${yyyy}-${mm}`;
}
