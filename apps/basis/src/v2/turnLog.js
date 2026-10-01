/**
 * turnLog — what a door writes down about a conversation turn, if anything.
 *
 * The walk log is the box's operational record (it started, a contact returned, a policy applied). A door's TURN
 * records — what a person typed, what went back, which op ran with which arguments — are other people's words, so
 * they are not written unless the operator asks:
 *   - `off` (the default) — no turn record at all;
 *   - `redacted` — every string in the record passes the platform's redaction rules (IBAN, citizen number, phone,
 *     e-mail); names are not redacted — no name list ships with the platform;
 *   - `full` — as is; for a test profile, never for a household.
 * When turns are logged, the people talking to the door are told so (`doorDisclosure`).
 */
import { PRESEND_DEFAULT_CONFIG, applyPresendFloor } from './presendFloor.js';

export const TURN_LOG_MODES = Object.freeze(['off', 'redacted', 'full']);

const redactDeep = (v) => {
  if (typeof v === 'string') return applyPresendFloor(v, PRESEND_DEFAULT_CONFIG).text;
  if (Array.isArray(v)) return v.map(redactDeep);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redactDeep(x)]));
  return v;
};

/**
 * The sink a door hands its turn records to, for a mode — or null when turns are not logged.
 * @param {string|undefined} mode  one of TURN_LOG_MODES; anything else is `off`
 * @param {(record: object) => void} sink  where a record goes (the walk-log file)
 */
export function turnLogFor(mode, sink) {
  if (typeof sink !== 'function') return null;
  if (mode === 'full') return sink;
  if (mode === 'redacted') return (record) => sink(redactDeep(record));
  return null;
}

/**
 * The sentence that tells the people in the house their conversations are kept and read — only when they are.
 * @param {string|undefined} mode
 * @param {(key: string) => string} t
 * @returns {string|null}
 */
export function doorDisclosure(mode, t) {
  return mode === 'redacted' || mode === 'full' ? t('circle.bot.log_disclosure') : null;
}
