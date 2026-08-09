/**
 * @onderling/logger — privacy-first structured logging (web ≡ mobile).
 *
 * WHY: a single facade so logs are captured identically on every shell, kept in a bounded on-device ring
 * buffer, and can be handed to a user-triggered bug report — WITHOUT ever leaking user data.
 *
 * PII-SAFE BY CONSTRUCTION. An event is `(tag, code, fields?)` — there is NO free-text message parameter, so
 * you cannot accidentally log message content, a name, or an address. `tag` = subsystem ('feedback',
 * 'agent', 'transport', 'pod', 'llm'); `code` = a stable event slug ('consent.stored', 'llm.error',
 * 'round.opened'); `fields` = a SMALL object of safe scalars (counts, durations, booleans, short enum codes)
 * — strings are truncated and nested objects dropped so content can't ride along. Never put a pubkey, webid,
 * raw text, or file path in a field — and since 2026-07-26 the facade ENFORCES that rather than trusting it:
 * an identifier-shaped value (a URL, an email, a long hex/mixed token) is replaced by `⟨redacted⟩:<length>`
 * whatever field name it arrives under. See `looksLikeIdentifier`.
 *
 * Dev builds can attach a `sink` to mirror to console/Metro; production just fills the buffer, and a "Report
 * a problem" flow reads it via `dumpLogs()` / `formatLogs()` (shown to the user before anything is sent).
 */

const LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/params';

// Parameter register (#36) — ring-buffer capacity + field truncation (scope:device, kind:internal).
const DEFAULT_MAX = param({ key: 'logger.ringMaxRecords', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 500 });   // ring-buffer capacity (records)
const FIELD_STR_MAX = param({ key: 'logger.fieldStrMax', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 48 });  // truncate string field values — codes are short; content gets clipped
export const REDACTED = '\u27e8redacted\u27e9';   // stands in for an identifier-shaped value (see looksLikeIdentifier)

const state = {
  buf: [],
  max: DEFAULT_MAX,
  min: LEVELS.debug,
  sink: null,            // optional (dev) mirror: (record) => void
  clock: () => Date.now(),
};

/**
 * Does this string LOOK like an identifier — a peer address, a webid, a key, a hash, a URL?
 *
 * Added 2026-07-26 (story 12.2). Truncating at 48 chars was never enough: 48 characters of an NKN address
 * or a webid identify a person exactly as well as the whole thing does. Until this check, "no identity in
 * the log" rested entirely on every call site remembering the rule in the header above — and the
 * bug-report flow ships whatever survives to a third party, so a single forgetful call site discloses it.
 *
 * Shape-based, not key-name-based, deliberately: a deny-list of field NAMES only catches the names someone
 * thought of, and the leak arrives under the name they didn't (`who`, `target`, `from`, `msg`).
 *
 * The three shapes, chosen to leave real log fields untouched:
 *   • a URL / URI scheme       — webids, pod resources, endpoints with a host in them
 *   • an email-ish address     — the one identifier people paste without thinking
 *   • a long high-entropy run  — 16+ hex chars (keys, hashes, addresses) or 24+ mixed letters-and-digits
 * Letters-only text never matches, so error slugs, enum codes and ordinary clipped prose are unaffected
 * (`'TimeoutWhileConnectingToRelay'` stays; `'bram-phone.9f3c1a77…'` does not).
 */
const URL_ISH = /\b[a-z][a-z0-9+.-]*:\/\//i;
const EMAIL_ISH = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const HEX_RUN = /[0-9a-f]{16,}/i;
const MIXED_RUN = /(?=[a-z0-9_-]{24,})[a-z0-9_-]*[a-z][a-z0-9_-]*[0-9][a-z0-9_-]*/i;
function looksLikeIdentifier(v) {
  return URL_ISH.test(v) || EMAIL_ISH.test(v) || HEX_RUN.test(v) || MIXED_RUN.test(v);
}

/**
 * Keep only PII-safe scalars; REDACT identifier-shaped strings whole, truncate the rest, drop nesting.
 *
 * A value is redacted ENTIRELY rather than partially: in `bram-phone.<64 hex>` the hex is what trips the
 * check, but the label before it is just as identifying, so a partial scrub would leak the interesting half.
 * The replacement keeps the length, which is what a debugger actually needs from a value they may not see.
 */
function sanitize(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return undefined;
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string') {
      out[k] = looksLikeIdentifier(v)
        ? `${REDACTED}:${v.length}`
        : (v.length > FIELD_STR_MAX ? `${v.slice(0, FIELD_STR_MAX)}…` : v);
    }
    // objects / arrays / functions / null are intentionally dropped — a log field is never a container.
  }
  return Object.keys(out).length ? out : undefined;
}

function record(lvl, tag, code, fields) {
  if (LEVELS[lvl] < state.min) return;
  const f = sanitize(fields);
  const rec = { t: state.clock(), lvl, tag: String(tag || ''), code: String(code || ''), ...(f ? { f } : {}) };
  state.buf.push(rec);
  if (state.buf.length > state.max) state.buf.shift();
  if (state.sink) { try { state.sink(rec); } catch { /* a broken sink must NEVER break logging */ } }
  return rec;
}

/** The logging facade. Usage: `log.info('feedback', 'consent.stored', { n: 2 })`. No free-text message param. */
export const log = Object.freeze({
  debug: (tag, code, fields) => record('debug', tag, code, fields),
  info:  (tag, code, fields) => record('info', tag, code, fields),
  warn:  (tag, code, fields) => record('warn', tag, code, fields),
  error: (tag, code, fields) => record('error', tag, code, fields),
});

/** The recent records (shallow copy) — for a bug report / a "copy logs" affordance. */
export function dumpLogs() { return state.buf.slice(); }

/** One line per record, PII-safe (codes + scalar fields only). Ready to show the user / copy to clipboard. */
export function formatLogs(records = state.buf) {
  return records
    .map((r) => `${r.t} ${r.lvl.toUpperCase().padEnd(5)} ${r.tag}/${r.code}${r.f ? ` ${JSON.stringify(r.f)}` : ''}`)
    .join('\n');
}

/** Empty the log ring buffer in place. */
export function clearLogs() { state.buf.length = 0; }

/**
 * Configure the logger (dev sink, min level, ring size, injectable clock for tests).
 * @param {{ min?: 'debug'|'info'|'warn'|'error', sink?: ((rec:object)=>void)|null, max?: number, clock?: ()=>number }} [opts]
 */
export function configureLog({ min, sink, max, clock } = {}) {
  if (min && LEVELS[min]) state.min = LEVELS[min];
  if (sink !== undefined) state.sink = sink;
  if (typeof max === 'number' && max > 0) state.max = max;
  if (typeof clock === 'function') state.clock = clock;
}

/** A dev sink that mirrors records to the console (attach in dev builds; NEVER in prod). */
export const consoleSink = (rec) => {
  const line = `[${rec.tag}/${rec.code}]${rec.f ? ` ${JSON.stringify(rec.f)}` : ''}`;
  if (rec.lvl === 'error') console.error(line);
  else if (rec.lvl === 'warn') console.warn(line);
  else console.log(line);
};

/** The level-name → numeric-severity map (debug 10 · info 20 · warn 30 · error 40), frozen. */
export const LOG_LEVELS = LEVELS;
