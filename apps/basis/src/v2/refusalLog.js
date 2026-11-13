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
 * A refusal's reason as a short code and its detail: "unsupported version: onderling/spine.v1" →
 * `{ reason: 'unsupported-version', detail: 'onderling/spine.v1' }`.
 * @param {unknown} reason
 * @returns {{reason: string, detail: string|null}}
 */
export function refusalCode(reason) {
  if (typeof reason !== 'string' || !reason.trim()) return { reason: 'unknown', detail: null };
  const i = reason.indexOf(':');
  const head = (i < 0 ? reason : reason.slice(0, i)).trim().toLowerCase();
  const detail = i < 0 ? null : (reason.slice(i + 1).trim() || null);
  return { reason: head.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown', detail };
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
          log.warn(tag, 'refused', { lane: String(lane ?? ''), check: String(check ?? ''), reason: code, ...(detail ? { detail } : {}), n: s.pending, total: s.total });
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
