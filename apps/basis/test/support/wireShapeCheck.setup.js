/**
 * THE WIRE SHAPE IS CHECKED WHERE IT IS SENT, UNDER TEST (the wire register, src/v2/wireRegister.js). Every test file in
 * this package runs with the check installed at the one wire call (`wireSend` in realAgent): a payload whose subtype has
 * no register row, or whose keys and value kinds are not its row's, is refused there and recorded, and the test that
 * sent it fails here. Recorded as well as thrown, because many sends are best-effort and swallow their own errors.
 *
 * Shell builds never install it (a fitness test pins that only test files name the hook).
 */
import { afterEach, expect } from 'vitest';
import { wireShapeProblem, WIRE_SHAPE_CHECK } from '../../src/v2/wireRegister.js';

/**
 * What a test sends ON PURPOSE that no build sends: an unknown kind to see it answered, a bare chat body to see the
 * router's chat fallback, a probe that only has to cross. Keyed by subtype (or the bare body's `type`), with why.
 */
const TEST_ONLY = Object.freeze({
  'from-a-sibling-shell': 'notUnderstood.relay.test.js: a kind the other shell does not route',
  'from-the-future': 'notUnderstood.relay.test.js: a kind from a newer build',
  note: 'personaOwnsItsCircles.test.js: any payload, to see which address it leaves from',
  'lan-sibling-probe': 'lanWhisperSiblings.test.js: a payload that only has to cross the LAN',
  'sealed-content': 'support/pairRealAgents.js postSealed: a sealed post fanned by hand',
  'p2p-chat': 'relay tests: a bare chat body with no subtype (the router\'s chat fallback)',
});
const testOnly = (payload) => {
  const tag = typeof payload?.subtype === 'string' ? payload.subtype : (payload?.subtype === undefined ? payload?.type : null);
  return typeof tag === 'string' && Object.hasOwn(TEST_ONLY, tag);
};

const refused = [];
globalThis[WIRE_SHAPE_CHECK] = (payload) => {
  if (testOnly(payload)) return;
  const problem = wireShapeProblem(payload);
  if (!problem) return;
  refused.push(problem);
  throw new Error(`wire shape refused under test: ${problem}`);
};

afterEach(() => {
  const seen = refused.splice(0);
  expect(seen, 'a send whose shape is not its wire register row (src/v2/wireRegister.js)').toEqual([]);
});
