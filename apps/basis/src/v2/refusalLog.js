/**
 * EVERY REFUSAL SAYS WHY. The few places where a device judges what it received and refuses it (a statement's signature
 * or format at the rail, whose key it is, a governance gate) write ONE record into the device's own structured log
 * (`@onderling/logger`: tag, code and a few scalar fields; no content, identifier-shaped values redacted by the facade),
 * which the log report and a bug report already read. Found on 2026-11-13: every old-format spine statement on a phone
 * was refused and the log said nothing, so only the screen could tell what the person saw.
 *
 * A read re-checks every stored statement, so one cause repeats hundreds of times: the first refusal of a kind is
 * written at once, the repeats are counted and written at most once per window (`n` since the last record, `total`).
 * Keyed by lane × check × reason only: never a circle id, a key or a hash.
 */
import { log as structuredLog } from '@onderling/logger';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

const WINDOW_MS = param({ key: 'diagnostics.refusalLogWindowMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 60_000 });   // how often a repeating refusal is written again

/**
 * The contact door's codes: what pinboard's message-request hold (and its skill) refuses a turn with, and what the door
 * itself says when the hold failed without one. Held against those sources by refusalCodesCoverTheDoor.test.js.
 */
const DOOR_REFUSAL_CODES_LIST = [
  'no-card', 'malformed-card', 'card-not-sender', 'file-on-request', 'turn-too-large', 'no-self', 'no-contacts', 'invalid',
  'no-answer', 'hold-threw', 'not-held',
];
export const DOOR_REFUSAL_CODES = Object.freeze([...DOOR_REFUSAL_CODES_LIST]);

/**
 * The key router's codes: a change to a circle's group key that was NOT made, because another device kept changing the
 * key (the bounded compare-and-swap ran out) or the roster could not say whether the member is still a member. The
 * next producer start's roster seed re-drives a join. Held against the router by circleKeyChangeNotMadeIsLogged.test.js.
 */
const KEY_REFUSAL_CODES_LIST = ['key-write-contended', 'member-unknown'];
export const KEY_REFUSAL_CODES = Object.freeze([...KEY_REFUSAL_CODES_LIST]);

/**
 * THE CLOSED SET of reason codes (Opus, reviewing): a reason is often built from the refused statement's own text
 * (`unsupported version: ${body.v}`, an exception's message), so a remote sender could mint unlimited distinct codes:
 * log spam and a growing key table. Only these codes are written; anything else is 'other'.
 */
export const REFUSAL_CODES = Object.freeze([
  // the rail's statement check (verifySpine)
  'unsupported-version', 'bad-signature', 'bad-chain-hash', 'circle-mismatch', 'kind-mismatch', 'malformed-statement',
  'missing-body', 'missing-signature', 'payload-missing', 'payload-does-not-match-its-digest',
  'authorref-does-not-match-the-header', 'a-tombstone-keeps-its-authorref-only', 'unverifiable',
  'body-kind-required', 'body-circleid-required', 'body-subject-required', 'body-author-required', 'body-hash-required',
  'body-payloaddigest-required', 'body-parenthash-must-be-a-hash-string-or-null', 'body-deps-must-be-an-array-of-hash-strings',
  'body-authorref-must-be-a-string-or-null',
  // the binding check and the gates
  'key-not-bound-to-its-member', 'not-allowed-by-the-circle-rule',
  // the contact door's hold of a message request (held anyway after the refusal: nothing there is dropped silently)
  ...DOOR_REFUSAL_CODES_LIST,
  // a change to a circle's group key that was NOT made (the key router's codes)
  ...KEY_REFUSAL_CODES_LIST,
]);
const KNOWN = new Set(REFUSAL_CODES);
const DETAIL_MAX = 32;

/**
 * A refusal's reason as a code from the closed set and its detail: "unsupported version: onderling/spine.v1" →
 * `{ reason: 'unsupported-version', detail: 'onderling/spine.v1' }`. The detail is the sender's text: only a short run of
 * [A-Za-z0-9._/-], and only for a known code (an unknown one is 'other', no detail).
 * @param {unknown} reason
 * @returns {{reason: string, detail: string|null}}
 */
export function refusalCode(reason) {
  if (typeof reason !== 'string' || !reason.trim()) return { reason: 'unknown', detail: null };
  const i = reason.indexOf(':');
  const head = (i < 0 ? reason : reason.slice(0, i)).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!KNOWN.has(head)) return { reason: 'other', detail: null };
  const raw = i < 0 ? '' : reason.slice(i + 1).trim();
  const detail = raw.replace(/[^A-Za-z0-9._/-]+/g, '').slice(0, DETAIL_MAX);
  return { reason: head, detail: detail || null };
}

/**
 * @param {object} [o]
 * @param {() => number} [o.now]
 * @param {number} [o.windowMs]
 * @param {{warn: Function}} [o.log]   the structured log (`@onderling/logger`'s `log`)
 * @returns {{note: (r: {lane: string, check: string, reason: unknown, tag?: string}) => void, size: number}}
 */
export function makeRefusalLog({ now = () => Date.now(), windowMs = Number(WINDOW_MS), log = structuredLog } = {}) {
  const seen = new Map();   // lane|check|reason → { total, pending, at }
  return {
    note({ lane, check, reason, tag = 'rail' } = {}) {
      try {
        const { reason: code, detail } = refusalCode(reason);
        const key = `${tag}|${lane}|${check}|${code}`;
        const s = seen.get(key) ?? { total: 0, pending: 0, at: -Infinity };
        s.total += 1; s.pending += 1;
        const t = now();
        if (t - s.at >= windowMs) {
          // `checks`: RE-CHECKS since the last record (a read re-checks every stored statement: 396 checks were 77
          // statements on the phone), `totalChecks` since start; never a count of distinct statements
          log.warn(tag, 'refused', { lane: String(lane ?? ''), check: String(check ?? ''), reason: code, ...(detail ? { detail } : {}), checks: s.pending, totalChecks: s.total });
          s.pending = 0; s.at = t;
        }
        seen.set(key, s);
      } catch { /* the log never breaks a read */ }
    },
    get size() { return seen.size; },
  };
}

/** The process's refusal log: one per process, like the signature memo. */
let processLog = null;
export function processRefusalLog() {
  processLog ??= makeRefusalLog();
  return processLog;
}
