import { describe, it, expect } from 'vitest';
import { makeGovernanceCatchUp } from '../../src/v2/governanceCatchUp.js';
import { makeFrontierReplay } from '../../src/v2/frontierReplay.js';

// The reconnect kick used to ask NOBODY, on every lane, on both shells.
//
// `listMyCircles` answers with plain string ids. Both `requestAll` implementations read
// `b?.groupId ?? b?.id` off each entry, which is `undefined` for a string, so the guard below it
// skipped every circle and the walk requested nothing. Five kicks in the web shell (governance,
// membership, keys, tasks, chat) and two in mobile were all inert, and a device that went offline
// never recovered anything it missed — with nothing anywhere reporting a problem, because a
// zero-request walk is indistinguishable from a successful one at every layer above it.
//
// Discovered by the absence journey (a device goes dark, the circle moves on, it comes back). These
// pin the shape so the string case cannot regress: both lanes, and a check that the walk actually
// reaches the members rather than merely counting.
const CIRCLE = 'circle:absent';

/** The two ops a `requestAll` walk makes, answering in the shapes the real skills answer in. */
const callSkill = (app, op) => {
  if (op === 'listMyCircles') return Promise.resolve({ circles: [CIRCLE] });   // STRINGS, not objects
  if (op === 'listGroupRoster') {
    return Promise.resolve({ members: [{ addr: 'peer:ada', role: 'admin' }, { addr: 'peer:bo', role: 'member' }] });
  }
  return Promise.resolve({});
};

/** A rail stub: enough surface for both catch-ups to build and address a request. */
const rail = () => ({
  storedStatements: () => [],
  ingest: async () => ({ ok: true }),
  catchUpStatements: () => [],
});

describe('the reconnect catch-up walks a circle list of plain STRINGS', () => {
  it('the governance-shaped catch-up asks every member of every circle', async () => {
    const asked = [];
    const cu = makeGovernanceCatchUp({
      rail: rail(),
      sendToPeer: (addr, payload) => { asked.push([addr, payload?.circleId]); },
    });

    const { requested } = await cu.requestAll({ callSkill });

    expect(requested).toBe(2);
    expect(asked.map(([addr]) => addr).sort()).toEqual(['peer:ada', 'peer:bo']);
    // …and it asked about the right circle, not `undefined`.
    expect(asked.every(([, cid]) => cid === CIRCLE)).toBe(true);
  });

  it('the frontier replay (chat + tasks) asks every member of every circle', async () => {
    const asked = [];
    const replay = makeFrontierReplay({
      rail: rail(),
      subtypes: { request: 'req', batch: 'batch', offer: 'offer' },
      sendToPeer: (addr, payload) => { asked.push([addr, payload?.circleId]); },
    });

    const { requested } = await replay.requestAll({ callSkill });

    expect(requested).toBe(2);
    expect(asked.map(([addr]) => addr).sort()).toEqual(['peer:ada', 'peer:bo']);
    expect(asked.every(([, cid]) => cid === CIRCLE)).toBe(true);
  });

  it('still walks the OBJECT shape, so a caller that answers with rows keeps working', async () => {
    const asked = [];
    const cu = makeGovernanceCatchUp({ rail: rail(), sendToPeer: (addr) => { asked.push(addr); } });
    const objectShaped = (app, op) => (op === 'listMyCircles'
      ? Promise.resolve({ circles: [{ groupId: CIRCLE }] })
      : callSkill(app, op));

    expect((await cu.requestAll({ callSkill: objectShaped })).requested).toBe(2);
    expect(asked).toHaveLength(2);
  });
});
