/**
 * FITNESS — the real-agent test node answers every inbound subtype the shells' lane table registers.
 *
 * `test/support/pairRealAgents.js` reassembles a device for the relay tests and the phone walks' second person. Three
 * times on 2026-11-13 a walk "found" a product defect that was the harness lacking a lane the shells compose: the
 * governance catch-up (a policy signed before a member joined never reached them), a device log, a carried log. Each
 * cost hours of probing. The shells' lanes are built once (`buildCircleLanes`, src/v2/circleLanes.js); this boots one
 * harness node, builds that table over the SAME agent, and fails on any subtype the table registers that the node does
 * not answer, so the next missing lane is red here instead of in a walk.
 *
 * @vitest-environment node
 */
import { describe, it, expect, afterAll } from 'vitest';
import { bootRealAgentNode, teardown } from '../support/pairRealAgents.js';
import { buildCircleLanes } from '../../src/v2/circleLanes.js';
import { makeGovernanceRail } from '../../src/v2/governanceAppWiring.js';
import { EventLog } from '../../src/eventLog.js';

/**
 * Subtypes the shells' table registers that the harness leaves out ON PURPOSE. Every entry needs a reason; an entry the
 * harness now answers must be removed (the test fails on it). Adding here is a decision, not a way to go green.
 */
const KNOWN_GAPS = {
  // The items catch-up (circleLanes.js `task`): a member who joins after a list, chore or appointment was made does
  // not pull it from a harness node. Found by this test (2026-11-13). Composed the shells' way, one full run of the
  // harness suites had 12 failing files (each green alone); a second had only appListFanTwoDevice, which also fails in
  // full runs without it. One bad run is not a verdict either way: it is added after a few clean full runs with it. A
  // walk that needs a joiner to see older items makes them after the join meanwhile.
  'circle-items-catchup-request': 'items catch-up not composed yet (see above)',
  'circle-items-catchup-batch':   'items catch-up not composed yet (see above)',
  'circle-items-catchup-offer':   'items catch-up not composed yet (see above)',
};

let node = null;
afterAll(async () => { if (node) await teardown(node).catch(() => {}); });

describe('the real-agent harness answers the lanes the shells compose', () => {
  it("every subtype in the shells' lane table is answered by the harness node", async () => {
    node = await bootRealAgentNode('lanes', { itemsLane: true, contactChannel: true });
    const eventLog = new EventLog({ initial: [], muted: [] });
    const govRail = makeGovernanceRail({ eventLog, circleIdentityFor: node.agent.circleIdentityFor, myRef: '', callSkill: (...a) => node.agent.callSkill(...a) });
    const lanes = buildCircleLanes({ agent: node.agent, govRail, eventLog });
    // the governance statement itself: each shell builds it beside the table (it needs the shell's rail + re-render)
    const shell = new Set([...Object.keys(lanes.handlers), 'circle-governance-broadcast']);
    const harness = new Set(node.handlerSubtypes);
    const missing = [...shell].filter((s) => !harness.has(s) && !(s in KNOWN_GAPS)).sort();
    expect(missing, `the harness node does not answer: ${missing.join(', ')}`).toEqual([]);
    const stale = Object.keys(KNOWN_GAPS).filter((s) => harness.has(s) || !shell.has(s));
    expect(stale, 'a listed gap the harness now answers (or the shells no longer register): remove it').toEqual([]);
  });
});
