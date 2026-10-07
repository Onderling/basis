/**
 * hostTick — the one clock a host runs. Every timed thing a host does is a JOB on it: a name, a period and what to
 * run; nothing in the app code keeps an interval of its own (the host-tick guard fails one outside this file).
 *
 * Each tick, the due jobs are STARTED in the order they were added — a fixed order, so what runs first is a decision,
 * not a race between timers. A job is due when its period has passed since its last start; a job still running from an
 * earlier tick is not started again, and a slow or failing job never holds up or stops the others (they are started
 * one after another, not awaited one after another). A failure is reported, never thrown.
 *
 * The box composes it today (reminders, the export shelf, the model watch, the unlocked-key sweep); the web and mobile
 * shells will tick on foreground. It is the clock adapter of the pending-work design: what is due is decided by the
 * jobs' own projections; the tick only says when to ask.
 */
import { createActiveCadence } from '@onderling/online-cadence/cadence';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

/** How often the host asks its jobs whether they are due. A minute: the finest any job needs (a reminder 5 minutes ahead). */
export const HOST_TICK_MS = param({ key: 'host.tickMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 60_000 });

/** Never faster than this, whatever a period says: a bad number must not make the host spin. */
const FLOOR_MS = 1_000;

/**
 * @param {object} [a]
 * @param {number} [a.every]  the tick's own period
 * @param {() => number} [a.now]
 * @param {{setInterval: Function, clearInterval: Function}} [a.timers]
 * @param {(e: {job: string, error: string}) => void} [a.onError]  a job that threw or rejected, for the walk log
 */
export function createHostTick({ every = HOST_TICK_MS, now = Date.now, timers = globalThis, onError = null } = {}) {
  /** @type {Array<{name: string, every: number, run: Function, atStart: boolean, lastAt: number|null, running: Promise|null}>} */
  const jobs = [];
  let handle = null;
  const period = Math.max(FLOOR_MS, Number(every) || HOST_TICK_MS);
  // A job is due a little before its period is up: a timer that fires a millisecond early must not push a job whose
  // period IS the tick to the tick after (a reminder a minute late). Half a tick, at most half the job's own period.
  const slackFor = (job) => Math.min(period, job.every) / 2;

  const report = (job, e) => { try { onError?.({ job, error: e?.message ?? String(e) }); } catch { /* a listener never stops the tick */ } };

  function startJob(job, at) {
    job.lastAt = at;
    let p;
    try { p = Promise.resolve(job.run()); } catch (e) { report(job.name, e); return null; }
    job.running = p.catch((e) => { report(job.name, e); }).finally(() => { job.running = null; });
    return job.running;
  }

  return {
    /**
     * Add a job. `atStart: false` — its first run is one period after the start (the export shelf: a box that restarts
     * in a loop must not write at every boot).
     */
    add(name, { every: period, run, atStart = true }) {
      if (jobs.some((j) => j.name === name)) throw new Error(`host tick: a job named ${name} is already on the clock`);
      jobs.push({ name, every: Math.max(FLOOR_MS, Number(period) || 0), run, atStart, lastAt: null, running: null });
      return this;
    },
    /** One tick: start every due job, in order; resolves when the ones started now have settled. */
    tick() {
      const at = now();
      const started = [];
      for (const job of jobs) {
        if (job.running) continue;
        const due = job.lastAt === null ? job.atStart : at - job.lastAt >= job.every - slackFor(job);
        if (!due) continue;
        const p = startJob(job, at);
        if (p) started.push(p);
      }
      return Promise.all(started).then(() => undefined);
    },
    /** The first tick now, then one every `every` ms. A job that waits for its first period counts from here. */
    start() {
      if (handle) return Promise.resolve();
      const at = now();
      for (const job of jobs) if (job.lastAt === null && !job.atStart) job.lastAt = at;
      handle = timers.setInterval(() => { this.tick(); }, period);
      handle?.unref?.();
      return this.tick();
    },
    stop() { if (handle) { timers.clearInterval(handle); handle = null; } },
    /** The jobs on the clock, in order — for the walk log at boot. */
    names() { return jobs.map((j) => j.name); },
  };
}

/**
 * The host tick's timers, but only while the app is in front: `setInterval` starts a foreground cadence, `clearInterval`
 * stops it.
 * @param {{AppState: {currentState?: string, addEventListener: Function}}} a
 */
export function foregroundTimers({ AppState }) {
  return {
    setInterval(fn, ms) {
      const cadence = createActiveCadence({ runOnce: async () => { fn(); }, getPollIntervalMs: () => ms, AppState });
      cadence.start();
      return cadence;
    },
    clearInterval(cadence) { cadence?.stop?.(); },
  };
}
