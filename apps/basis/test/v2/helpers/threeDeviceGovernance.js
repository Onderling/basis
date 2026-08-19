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
 *
 * Since the governance cutover the bus carries SIGNED statements: every device signs with its own per-circle
 * identity, the roster rows carry each device's `circleAddress` (the proof-checked key↔ref binding the
 * receive rails verify), and each receiver runs the full rail ingest — so these stories now exercise the
 * production verify-before-land path, not a trust-the-sender stand-in.
 */
import { vi } from 'vitest';
import { AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { bindCircleGovernance, makeGovernanceRail } from '../../../src/v2/governanceAppWiring.js';
import { makeCircleGovernancePeerHandler, makeCircleReportPeerHandler } from '../../../src/v2/circleLogReceiver.js';
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

export const defaultPolicy = () => normalizeCirclePolicy({ governance: { removeMember: 'member-vote' } });

/**
 * NOTE: async since the governance cutover (per-device signing identities are generated).
 *
 * @param {object} [opts]
 * @param {object} [opts.policy]   circle policy every device reads (default: removeMember = member-vote)
 * @param {number} [opts.clock]    initial `now()` value
 * @returns {Promise<{devices, partition, reconnect, setClock, enactsEverywhere, removalsEverywhere, rowOn, tallyOf}>}
 */
export async function threeDevices({ policy = defaultPolicy(), clock = 1 } = {}) {
  const devices = {};
  const held = {};                                   // ref → [payload] while partitioned
  let nowValue = clock;

  // Per-device circle-scoped signing identities; the roster rows carry each key as the member's
  // `circleAddress` — the binding the receive rails verify before a fanned statement lands.
  const cids = {};
  for (const ref of DEVICE_REFS) cids[ref] = await AgentIdentity.generate(new VaultMemory());
  const rosterRows = FULL.map((m) => (cids[m.addr]
    ? { ...m, circleAddress: cids[m.addr].pubKey }
    : { ...m }));
  /** Mirrors `listGroupRoster`, which excludes the caller — the shape the wiring actually reads. */
  const rosterExcluding = (ref) => ({ members: rosterRows.filter((m) => m.addr !== ref) });

  for (const ref of DEVICE_REFS) {
    const log = new EventLog({ initial: [] });
    const rosterCallSkill = async (app, op) => (op === 'listGroupRoster' ? rosterExcluding(ref) : { ok: true });
    const rail = makeGovernanceRail({
      eventLog: log, circleIdentityFor: async () => cids[ref], myRef: ref, callSkill: rosterCallSkill,
    });
    devices[ref] = {
      ref,
      log,
      rail,
      online: true,
      enacted: [],                                   // real-world side effects THIS device performed
      removed: [],                                   // reported posts/messages THIS device deleted
      ingestGovernance: makeCircleGovernancePeerHandler({ eventLog: log, rail }),
      ingestReport: makeCircleReportPeerHandler({ eventLog: log }),
    };
    held[ref] = [];
  }

  /** Fan an event from `fromRef` to the OTHER two devices (holding for the partitioned).
   *  Channel-aware: the report channel carries its own subtype and its own ingest handler. */
  const broadcastFrom = (fromRef) => (channel, circleId, event, opts = undefined) => {
    const subtype = channel === 'report' ? 'circle-report-broadcast' : 'circle-governance-broadcast';
    // `opts.to` NARROWS the recipient set — what `broadcastCircleReport`'s `to` does on the wire. Modelled
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

  // The rail's ingest awaits verification (incl. a roster read), so a fire-and-forget fan needs a drain
  // point: every delivery's promise is tracked, and the per-replica reads settle the queue first — a test
  // reads a device only after everything already fanned to it has actually landed (or been refused).
  const pending = [];
  const deliver = (d, payload) => {
    const done = (payload.subtype === 'circle-report-broadcast')
      ? d.ingestReport(null, payload)
      : d.ingestGovernance(null, payload);
    pending.push(Promise.resolve(done).catch(() => { /* refusals are outcomes, not harness errors */ }));
  };
  const settle = async () => { while (pending.length) await Promise.all(pending.splice(0)); };

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
      circleIdentityFor: async () => cids[ref],
      removeReported: (circleId, targetType, targetRef) => {
        d.removed.push({ circleId, targetType, targetRef });
        return { ok: true };
      },
    });
  }

  const h = {
    devices,
    cids,
    partition: (ref) => { devices[ref].online = false; },
    reconnect: async (ref) => {                      // flush everything held while away, in order — and
      devices[ref].online = true;                     // SETTLE: the rail's ingest is async (verify + roster
      const queue = held[ref].splice(0, held[ref].length);   // read), so the flush must land before return.
      for (const p of queue) deliver(devices[ref], p);
      await settle();
    },
    /** Advance/for-set the shared clock — deadline stories are vacuous without this. */
    setClock: (t) => { nowValue = t; },
    now: () => nowValue,
    /** Every enact side effect that fired anywhere, tagged with the device that fired it. */
    enactsEverywhere: () => Object.values(devices).flatMap((d) => d.enacted.map((e) => ({ by: d.ref, ...e }))),
    removalsEverywhere: () => h.enactsEverywhere().filter((e) => /remove/i.test(e.op)),
    /** The proposal row as THIS device sees it (open or closed) — the per-replica read under test. */
    settle,
    rowOn: async (ref, proposalId) => {
      await settle();
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
