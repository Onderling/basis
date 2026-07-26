/**
 * Test helper — THREE devices on one governance bus.
 *
 * Extracted from `governanceThreeDevice.test.js` (stories 3.1/3.2) so the 3.3/3.5/3.6 suite drives the same
 * substrate instead of a second copy of the harness (invariant 3: no duplication — a divergent second
 * harness is how two suites end up "proving" incompatible things about one system).
 *
 * What it models that a two-device test cannot:
 *   • a device may be PARTITIONED — its events are HELD (as the relay's hold-forward would) and flushed in
 *     order on reconnect, so "offline" is a first-class state rather than an error path;
 *   • both fan channels (`governance` AND `report`) are wired, so report propagation is observable;
 *   • the clock is MUTABLE (`h.setClock`), which deadline/expiry stories need — a frozen `now` silently
 *     makes every expiry assertion vacuous.
 */
import { vi } from 'vitest';
import { bindCircleGovernance } from '../../../src/v2/governanceAppWiring.js';
import { makeKringGovernancePeerHandler, makeKringReportPeerHandler } from '../../../src/v2/kringLogReceiver.js';
import { EventLog } from '../../../src/eventLog.js';
import { normalizeCirclePolicy } from '../../../src/v2/circlePolicy.js';

/** Anna (admin) · Bram · Cato · Dirk. Dirk (`m2`) is the usual SUBJECT — never a device, so the three
 *  devices are all bystanders-or-actors and none of them is the one being removed. */
export const FULL = [
  { addr: 'admin0', role: 'admin' },
  { addr: 'm0', role: 'member' },
  { addr: 'm1', role: 'member' },
  { addr: 'm2', role: 'member' },
];

export const DEVICE_REFS = ['admin0', 'm0', 'm1'];

/** Mirrors `listGroupRoster`, which excludes the caller — the shape the wiring actually reads. */
export const rosterExcluding = (ref) => ({ members: FULL.filter((m) => m.addr !== ref) });

export const defaultPolicy = () => normalizeCirclePolicy({ governance: { removeMember: 'member-vote' } });

/**
 * @param {object} [opts]
 * @param {object} [opts.policy]   circle policy every device reads (default: removeMember = member-vote)
 * @param {number} [opts.clock]    initial `now()` value
 * @returns {{devices, partition, reconnect, setClock, enactsEverywhere, removalsEverywhere, rowOn, tallyOf}}
 */
export function threeDevices({ policy = defaultPolicy(), clock = 1 } = {}) {
  const devices = {};
  const held = {};                                   // ref → [payload] while partitioned
  let nowValue = clock;

  for (const ref of DEVICE_REFS) {
    const log = new EventLog({ initial: [] });
    devices[ref] = {
      ref,
      log,
      online: true,
      enacted: [],                                   // real-world side effects THIS device performed
      removed: [],                                   // reported posts/messages THIS device deleted
      ingestGovernance: makeKringGovernancePeerHandler({ eventLog: log }),
      ingestReport: makeKringReportPeerHandler({ eventLog: log }),
    };
    held[ref] = [];
  }

  /** Fan an event from `fromRef` to the OTHER two devices (holding for the partitioned).
   *  Channel-aware: the report channel carries its own subtype and its own ingest handler. */
  const broadcastFrom = (fromRef) => (channel, circleId, event, opts = undefined) => {
    const subtype = channel === 'report' ? 'kring-report-broadcast' : 'kring-governance-broadcast';
    // `opts.to` NARROWS the recipient set — what `broadcastKringReport`'s `to` does on the wire. Modelled
    // here so a report genuinely does not reach a non-admin's log; without it the harness would fan to
    // everyone and quietly contradict the shipped routing.
    const allow = Array.isArray(opts?.to) ? new Set(opts.to) : null;
    // `ts` is the DELIVERY timestamp, deliberately NOT the governance clock: `EventLog` prunes by a
    // retention window, so stamping a fanned entry with a small logical clock (1) dates it to 1970 and the
    // receiver silently drops it — the fan appears to work and every replica stays empty.
    const payload = { subtype, circleId, event, ts: Date.now() };
    for (const ref of Object.keys(devices)) {
      if (ref === fromRef) continue;
      if (allow && !allow.has(ref)) continue;
      if (devices[ref].online) deliver(devices[ref], payload);
      else held[ref].push(payload);
    }
  };

  const deliver = (d, payload) => {
    if (payload.subtype === 'kring-report-broadcast') d.ingestReport(null, payload);
    else d.ingestGovernance(null, payload);
  };

  let n = 0;
  for (const ref of Object.keys(devices)) {
    const d = devices[ref];
    d.gov = bindCircleGovernance({
      eventLog: d.log,
      callSkill: vi.fn(async (app, op, args) => {
        if (op === 'listGroupRoster') return rosterExcluding(ref);
        // Every non-roster op is a real-world side effect — record WHICH device performed it.
        d.enacted.push({ op, args });
        return { ok: true };
      }),
      getPolicy: async () => policy,
      myRef: ref,
      genId: () => `p${(n += 1)}`,
      now: () => nowValue,
      broadcast: broadcastFrom(ref),
      removeReported: (circleId, targetType, targetRef) => {
        d.removed.push({ circleId, targetType, targetRef });
        return { ok: true };
      },
    });
  }

  const h = {
    devices,
    partition: (ref) => { devices[ref].online = false; },
    reconnect: (ref) => {                            // flush everything held while away, in order
      devices[ref].online = true;
      const queue = held[ref].splice(0, held[ref].length);
      for (const p of queue) deliver(devices[ref], p);
    },
    /** Advance/for-set the shared clock — deadline stories are vacuous without this. */
    setClock: (t) => { nowValue = t; },
    now: () => nowValue,
    /** Every enact side effect that fired anywhere, tagged with the device that fired it. */
    enactsEverywhere: () => Object.values(devices).flatMap((d) => d.enacted.map((e) => ({ by: d.ref, ...e }))),
    removalsEverywhere: () => h.enactsEverywhere().filter((e) => /remove/i.test(e.op)),
    /** The proposal row as THIS device sees it (open or closed) — the per-replica read under test. */
    rowOn: async (ref, proposalId) => {
      const v = await devices[ref].gov.view('c1');
      return [...v.open, ...v.closed].find((r) => r.proposalId === proposalId);
    },
    tallyOf: async (ref, proposalId) => (await h.rowOn(ref, proposalId))?.tally,
  };
  return h;
}

/** Open a `removeMember` proposal on Dirk from Anna. `deadline: null` mirrors what the SHELLS pass. */
export const openProposal = async (h, deadline = 100) =>
  (await h.devices.admin0.gov.propose({
    circleId: 'c1', action: 'removeMember', subject: 'm2', actor: { ref: 'admin0' }, deadline,
  })).proposalId;
