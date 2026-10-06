/**
 * intentionRunner — pending work, RUN. One job on the host's tick: ask `due` over the book's rows, and run each due
 * occurrence through the door AS its person (`actsAs`), handing the op the occurrence id. The op's own gate decides;
 * the runner has no powers of its own.
 *
 *   • it went through → a done-mark on the device log (first write wins on the occurrence id) and the row's last run
 *     moves (a one-off row is finished). Either alone keeps it from running again: a crash between the two is safe;
 *   • "not yet" (`{ notYet: reason }` — the person's quiet hours) → it stays due, and is said once;
 *   • a failure → said once, tried again next tick, until its window closes.
 * One row's failure never stops another's; two passes at once never run one occurrence twice. At one host the
 * done-mark IS the claim; a second executor will claim by compare-and-swap first.
 */
import { due } from './intentions.js';

/** The device-log kind a run leaves behind (declared in the entry-kind table). */
export const INTENTION_DONE_KIND = 'intention-done';

/**
 * @param {object} a
 * @param {ReturnType<import('./intentionBook.js').createIntentionBook>} a.book
 * @param {{append: Function, query: Function}} a.log    the device log
 * @param {(o: object) => Promise<{ok?: boolean, notYet?: string, reason?: string}>} a.run   the op through the door, as `o.actsAs`
 * @param {string} a.tz
 * @param {() => number} [a.now]
 * @param {(e: {occurrence: string, row: string, op: string, actsAs: string, outcome: 'ran'|'not-yet'|'failed', reason?: string}) => void} [a.onFired]
 */
export function createIntentionRunner({ book, log, run, tz, now = Date.now, onFired = null }) {
  const inFlight = new Set();
  /** What was already said for an occurrence that has not run ("not-yet:quiet", "failed:door down"). */
  const said = new Map();
  const tell = (e) => { try { onFired?.(e); } catch { /* a listener never stops the runner */ } };
  const doneIds = () => new Set(log.query({ filter: { type: INTENTION_DONE_KIND } }).map((e) => e?.payload?.occurrence).filter(Boolean));

  async function runOne(o) {
    const base = { occurrence: o.id, row: o.rowId, op: o.op, actsAs: o.actsAs };
    let res;
    try { res = await run(o); } catch (e) { res = { ok: false, reason: e?.message ?? String(e) }; }
    if (res?.ok) {
      log.append({ id: `${INTENTION_DONE_KIND}:${o.id}`, type: INTENTION_DONE_KIND, ts: now(), payload: { occurrence: o.id, row: o.rowId, op: o.op } });
      said.delete(o.id);
      try { await book.ran(o.rowId); } catch { /* the done-mark already keeps it from running again */ }
      tell({ ...base, outcome: 'ran' });
      return;
    }
    const outcome = res?.notYet ? 'not-yet' : 'failed';
    const reason = String(res?.notYet ?? res?.reason ?? res?.error?.code ?? res?.error ?? 'unknown');
    const key = `${outcome}:${reason}`;
    if (said.get(o.id) === key) return;
    said.set(o.id, key);
    tell({ ...base, outcome, reason });
  }

  return {
    /** One pass: every due occurrence, each once. */
    async pass() {
      const list = due({ rows: book.rows(), done: doneIds(), now: now(), tz });
      for (const o of list) {
        if (inFlight.has(o.id)) continue;
        inFlight.add(o.id);
        try { await runOne(o); } finally { inFlight.delete(o.id); }
      }
    },
  };
}
