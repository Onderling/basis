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
 *
 * WHO A ROW MAY ACT AS. A row in the host's own store was written here (or by the person's own devices), so it runs as
 * the person it names. A row in a CIRCLE's store is a field any member can write — the sync proves which member SENT
 * it, not who wrote it — so by default it is not run as anyone: it is said once ("refused") and left. A host lets a
 * circle row through only by its own rule (`mayRun`), which sees the op, the circle and whom it would act as.
 *
 * ONE HOST PER CIRCLE ROW. Every member's host holds the same circle row; before running one, a host CLAIMS the row
 * (the task lifecycle's compare-and-swap on its holders) and keeps it — a row another host claimed is left to that
 * host. Across hosts the row is the truth (its holders and its last run sync with it); the done-mark never leaves its
 * host and only keeps this host from running one occurrence twice. Two hosts that cannot see each other may both claim
 * (each on its own copy) and both run one occurrence; when the copies meet, the claim fold keeps one holder and the
 * other host leaves the row from then on.
 */
import { claim as claimItem } from '@onderling/item-store';
import { due } from './intentions.js';

/** The device-log kind a run leaves behind (declared in the entry-kind table). */
export const INTENTION_DONE_KIND = 'intention-done';

/**
 * The done-marks on a device log: the ids of what already ran or was said, and the mark for one more. First write wins
 * (the kind is auditable), so a repeat never records a second run. Shared by the runner and the reminder tick.
 * @param {{append: Function, query: Function}} log
 * @param {() => number} [now]
 */
export function doneMarksOn(log, now = Date.now) {
  return {
    ids: () => new Set(log.query({ filter: { type: INTENTION_DONE_KIND } }).map((e) => e?.payload?.occurrence).filter(Boolean)),
    mark: (occurrence, payload = {}) => log.append({ id: `${INTENTION_DONE_KIND}:${occurrence}`, type: INTENTION_DONE_KIND, ts: now(), payload: { ...payload, occurrence } }),
  };
}

/**
 * @param {object} a
 * @param {ReturnType<import('./intentionBook.js').createIntentionBook>} a.book
 * @param {{append: Function, query: Function}} a.log    the device log
 * @param {(o: object) => Promise<{ok?: boolean, notYet?: string, reason?: string}>} a.run   the op through the door, as `o.actsAs`
 * @param {string} a.tz
 * @param {() => number} [a.now]
 * @param {(e: {occurrence: string, row: string, op: string, actsAs: string, outcome: 'ran'|'not-yet'|'failed'|'refused', reason?: string}) => void} [a.onFired]
 * @param {(o: object, scope: string) => true|string} [a.mayRun]   a circle row's way through: true, or why not
 * @param {string} [a.claimAs]   this host, as a circle row's claim names it (a key, unique to the host)
 */
export function createIntentionRunner({ book, log, run, tz, now = Date.now, onFired = null, mayRun = null, claimAs = null }) {
  const inFlight = new Set();
  /** What was already said for an occurrence that has not run ("not-yet:quiet", "failed:door down"). */
  const said = new Map();
  const tell = (e) => { try { onFired?.(e); } catch { /* a listener never stops the runner */ } };
  const marks = doneMarksOn(log, now);

  /** True, or why a circle row is not run here. */
  const allowed = (o) => {
    const scope = book.scopeOf?.(o.rowId) ?? null;
    if (!scope) return true;
    let verdict = 'a circle row names whom it acts as, and nothing proves it';
    if (typeof mayRun === 'function') { try { verdict = mayRun(o, scope); } catch (e) { verdict = e?.message ?? 'refused'; } }
    return verdict === true ? true : String(verdict || 'refused');
  };

  /** True when this host holds the row (its own store's rows always; a circle row once claimed), or who does. */
  async function claimed(o) {
    if (!book.scopeOf?.(o.rowId)) return true;
    if (!claimAs) return 'this host has no name to claim with';
    const store = book.storeOf(o.rowId);
    try {
      const res = await claimItem(store, o.rowId, { actor: claimAs });
      if (!res?.error) return true;
      const holders = [...new Set([...(res.current?.assignees ?? []), res.current?.assignee].filter(Boolean))];
      return holders.includes(claimAs) ? true : `claimed by ${String(holders[0] ?? 'another host').slice(0, 12)}`;
    } catch (e) { return e?.message ?? 'claim failed'; }
  }

  async function runOne(o) {
    const base = { occurrence: o.id, row: o.rowId, op: o.op, actsAs: o.actsAs };
    const ok = allowed(o);
    if (ok !== true) {
      const key = `refused:${ok}`;
      if (said.get(o.id) !== key) { said.set(o.id, key); tell({ ...base, outcome: 'refused', reason: ok }); }
      return;
    }
    const mine = await claimed(o);
    if (mine !== true) {
      const key = `elsewhere:${mine}`;
      if (said.get(o.id) !== key) { said.set(o.id, key); tell({ ...base, outcome: 'elsewhere', reason: mine }); }
      return;
    }
    let res;
    try { res = await run(o); } catch (e) { res = { ok: false, reason: e?.message ?? String(e) }; }
    if (res?.ok) {
      marks.mark(o.id, { row: o.rowId, op: o.op });
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
      // read again: a row a member's device wrote into a circle's store reaches this host by sync, not by this book
      try { await book.load?.(); } catch { /* the rows as last read still serve */ }
      const list = due({ rows: book.rows(), done: marks.ids(), now: now(), tz });
      for (const o of list) {
        if (inFlight.has(o.id)) continue;
        inFlight.add(o.id);
        try { await runOne(o); } finally { inFlight.delete(o.id); }
      }
    },
  };
}
