/**
 * metrics — Tasks V1 Phase 9 observability.
 *
 * Composes `@onderling/notifier`'s `UsageMetrics` (lifted from Stoop
 * 2026-05-08) for counters, plus a tiny per-name latency reservoir
 * for the two time-series the UX cares about most:
 *
 *   - **time-to-claim**: ms between `item-added` and `item-claimed`
 *     for each task.
 *   - **time-from-submit-to-approval**: ms between `item-submitted`
 *     and `item-completed` (when `approval !== 'self-mark'`).
 *
 * The latency reservoir is bounded (default 200 samples per name)
 * with FIFO eviction. Apps that want longer-window stats persist
 * snapshots to their pod on a foreground cadence — V1 ships
 * in-memory only.
 *
 * The circle admin surfaces the snapshot via the `getMetrics` skill;
 * the snapshot is locally aggregated (per-device). User opt-in to
 * share with the circle admin is wired at the skill layer (a future
 * V2 sync). Per the pod-data-sharing caution principles, V1 keeps
 * the snapshot strictly local.
 */

import { UsageMetrics } from '@onderling/notifier';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

// Parameter register (#36) — per-name latency reservoir size (scope:device, kind:internal).
const DEFAULT_LATENCY_RESERVOIR = param({ key: 'tasksV0.latencyReservoir', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 200 });

const COUNTER_NAMES = Object.freeze({
  ADDED:            'task.added',
  CLAIMED:          'task.claimed',
  SUBMITTED:        'task.submitted',
  REJECTED:         'task.rejected',
  REVOKED:          'task.revoked',
  APPROVED:         'task.approved',
  COMPLETED:        'task.completed',
  MISSED_DEADLINE:  'task.missed-deadline',
  SUBTASK_REQUEST:  'subtask.request',
  SUBTASK_APPROVED: 'subtask.approved',
  SUBTASK_DECLINED: 'subtask.declined',
});

/**
 * Build a `MetricsTracker` and return a `{tracker, detach}` pair.
 *
 * @param {object} args
 * @param {object} args.itemStore                    — emits item-* events
 * @param {number} [args.latencyReservoirSize]
 * @param {() => number} [args.now=Date.now]
 */
export function buildMetrics({ itemStore, latencyReservoirSize, now } = {}) {
  if (!itemStore?.on) throw new TypeError('buildMetrics: itemStore (Emitter) required');
  const tracker = new MetricsTracker({
    latencyReservoirSize,
    now,
  });

  // Track per-task add timestamp so claim-latency can reference it.
  const addAtById = new Map();
  // Track submit timestamp so approve-latency can reference it.
  const submitAtById = new Map();

  const onAdded = (item) => {
    if (item?.type === 'subtask-request') {
      tracker.record(COUNTER_NAMES.SUBTASK_REQUEST);
      return;
    }
    tracker.record(COUNTER_NAMES.ADDED);
    if (item?.id) addAtById.set(item.id, item.addedAt ?? Date.now());
  };

  const onClaimed = (item) => {
    tracker.record(COUNTER_NAMES.CLAIMED);
    const addedAt = addAtById.get(item?.id);
    if (Number.isFinite(addedAt) && Number.isFinite(item?.claimedAt)) {
      tracker.recordLatency('latency.time-to-claim', item.claimedAt - addedAt);
    }
  };

  const onSubmitted = (item) => {
    tracker.record(COUNTER_NAMES.SUBMITTED);
    if (item?.id) submitAtById.set(item.id, item.deliverable?.submittedAt ?? Date.now());
  };

  const onRejected = (item) => {
    tracker.record(COUNTER_NAMES.REJECTED);
    // Keep submitAt so a re-submit-then-approve cycle still records latency
    // from the first submit. (Apps that want per-cycle latency override
    // here.)
  };

  const onRevoked = (e) => {
    tracker.record(COUNTER_NAMES.REVOKED);
    if (e?.item?.id) {
      addAtById.delete(e.item.id);
      submitAtById.delete(e.item.id);
    }
  };

  const onCompleted = (item) => {
    if (item?.type === 'subtask-request') {
      // Closing a subtask-request item via markComplete is how
      // approve/decline both terminate; differentiate via notes.
      if (typeof item.notes === 'string' && item.notes.startsWith('Declined')) {
        tracker.record(COUNTER_NAMES.SUBTASK_DECLINED);
      } else {
        tracker.record(COUNTER_NAMES.SUBTASK_APPROVED);
      }
      return;
    }
    tracker.record(COUNTER_NAMES.COMPLETED);
    // Approval-mode-aware: 'self-mark' completes via markComplete (no
    // submit/approve cycle). Only track approve-latency when there
    // was a submit.
    const submitAt = submitAtById.get(item?.id);
    if (Number.isFinite(submitAt) && Number.isFinite(item?.completedAt)) {
      tracker.record(COUNTER_NAMES.APPROVED);
      tracker.recordLatency('latency.submit-to-approval', item.completedAt - submitAt);
    }
    addAtById.delete(item?.id);
    submitAtById.delete(item?.id);
  };

  const onRemoved = (e) => {
    if (e?.id) {
      addAtById.delete(e.id);
      submitAtById.delete(e.id);
    }
  };

  itemStore.on('item-added',     onAdded);
  itemStore.on('item-claimed',   onClaimed);
  itemStore.on('item-submitted', onSubmitted);
  itemStore.on('item-rejected',  onRejected);
  itemStore.on('item-revoked',   onRevoked);
  itemStore.on('item-completed', onCompleted);
  itemStore.on('item-removed',   onRemoved);

  return {
    tracker,
    detach() {
      try { itemStore.off?.('item-added',     onAdded);    } catch { /* noop */ }
      try { itemStore.off?.('item-claimed',   onClaimed);  } catch { /* noop */ }
      try { itemStore.off?.('item-submitted', onSubmitted); } catch { /* noop */ }
      try { itemStore.off?.('item-rejected',  onRejected); } catch { /* noop */ }
      try { itemStore.off?.('item-revoked',   onRevoked);  } catch { /* noop */ }
      try { itemStore.off?.('item-completed', onCompleted); } catch { /* noop */ }
      try { itemStore.off?.('item-removed',   onRemoved);  } catch { /* noop */ }
    },
  };
}

/**
 * MetricsTracker — counters + bounded latency reservoirs.
 *
 * Counters live in a `notifier.UsageMetrics` instance; latency
 * arrays are stored locally and surfaced via percentile helpers.
 */
export class MetricsTracker {
  /** @type {UsageMetrics} */ #counters;
  /** @type {Map<string, number[]>} */ #latencies = new Map();
  #reservoir;
  #now;

  constructor({ latencyReservoirSize = DEFAULT_LATENCY_RESERVOIR, now } = {}) {
    this.#counters  = new UsageMetrics({ now });
    this.#reservoir = Math.max(1, latencyReservoirSize);
    this.#now       = now ?? (() => Date.now());
  }

  record(name) {
    this.#counters.record(name);
  }

  recordLatency(name, ms) {
    if (typeof name !== 'string' || !name) throw new TypeError('recordLatency: name required');
    if (!Number.isFinite(ms) || ms < 0) return;
    let arr = this.#latencies.get(name);
    if (!arr) {
      arr = [];
      this.#latencies.set(name, arr);
    }
    arr.push(ms);
    if (arr.length > this.#reservoir) arr.shift();
  }

  /** Snapshot — counters + latency p50/p90/count per name. */
  snapshot() {
    const counters = this.#counters.snapshot();
    const latencies = {};
    for (const [name, arr] of this.#latencies) {
      latencies[name] = {
        count: arr.length,
        p50:   _percentile(arr, 50),
        p90:   _percentile(arr, 90),
        max:   arr.length ? arr[arr.length - 1] : 0,
      };
    }
    return { counters, latencies };
  }

  reset(name) {
    this.#counters.reset(name);
    if (name === undefined) this.#latencies.clear();
    else                    this.#latencies.delete(name);
  }
}

function _percentile(arr, p) {
  if (!arr || arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export { COUNTER_NAMES, DEFAULT_LATENCY_RESERVOIR };
