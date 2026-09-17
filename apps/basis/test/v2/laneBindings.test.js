/**
 * The kinds table declares what a receiver ACCEPTS a kind with; the rails choose their verifier at wiring time.
 * Two layers holding one fact — this pins the agreement, so a rail that changes its default verifier, or a kind
 * whose `accepts` cell drifts, fails here instead of quietly disagreeing with the declaration.
 */
import { describe, it, expect } from 'vitest';
import { ENTRY_KINDS, ACCEPTS, SIGNS, bindingOf, entryKind } from '@onderling/item-store';
import { LANE_ACCEPTS } from '../../src/v2/laneBindings.js';
import { rosterBindingVerifier, membershipBindingVerifier } from '../../src/v2/membershipRail.js';
import { keyBindingVerifier } from '../../src/v2/keyRail.js';
import { deviceSetBindingVerifier } from '../../src/v2/grantsRail.js';
import { makeTaskRail } from '../../src/v2/taskRail.js';
import { makeChatRail } from '../../src/v2/chatRail.js';
import { makeGovernanceRail } from '../../src/v2/governanceAppWiring.js';
import { makeMembershipRail } from '../../src/v2/membershipRail.js';
import { makeKeyRail } from '../../src/v2/keyRail.js';

/** Each verifier factory names the ACCEPTS level it implements. */
const VERIFIER_ACCEPTS = new Map([
  [rosterBindingVerifier, ACCEPTS.ROSTER],
  [membershipBindingVerifier, ACCEPTS.MEMBERSHIP],
  [keyBindingVerifier, ACCEPTS.KEY],
  [deviceSetBindingVerifier, ACCEPTS.DEVICE_SET],
]);

describe('the lane pin agrees with the kinds table', () => {
  it('every signed lane names the accepts level its kind declares — and no lane is missing', () => {
    for (const [lane, accepts] of Object.entries(LANE_ACCEPTS)) {
      expect(ENTRY_KINDS[lane], `${lane} is a declared kind`).toBeDefined();
      expect(bindingOf(lane).accepts, `${lane}.accepts`).toBe(accepts);
    }
    const signedKinds = Object.keys(ENTRY_KINDS).filter((k) => bindingOf(k).accepts !== ACCEPTS.NONE);
    expect(Object.keys(LANE_ACCEPTS).sort()).toEqual(signedKinds.sort());
  });

  it('a kind that is never signed is never accepted from a peer, and never carried', () => {
    for (const [kind, d] of Object.entries(ENTRY_KINDS)) {
      const b = bindingOf(kind);
      if (b.signs.includes(SIGNS.LOCAL)) {
        expect(b.signs, `${kind} local means only local`).toEqual([SIGNS.LOCAL]);
        expect(b.accepts, `${kind}.accepts`).toBe(ACCEPTS.NONE);
        expect(b.syncPolicy, `${kind}.syncPolicy`).toBe('none');
      } else {
        expect(b.accepts, `${kind} signed ⇒ accepted with a named verifier`).not.toBe(ACCEPTS.NONE);
      }
      expect(d.signs).toBeDefined();
    }
  });
});

describe('the rails DEFAULT to the verifier the table names (the runtime side of the pin)', () => {
  // Each rail exposes no getter for its verifier, so the pin reads the module import each rail defaults to.
  // Source-level: the default expression in each factory names one of the four verifier functions.
  const railSource = async (path) => (await import('node:fs')).readFileSync(new URL(path, import.meta.url), 'utf8');
  const cases = [
    ['task-statement', '../../src/v2/taskRail.js', 'rosterBindingVerifier(callSkill)'],
    ['chat-message', '../../src/v2/chatRail.js', 'rosterBindingVerifier(callSkill)'],
    ['governance', '../../src/v2/governanceAppWiring.js', 'rosterBindingVerifier(callSkill)'],
    ['membership', '../../src/v2/membershipRail.js', 'membershipBindingVerifier(callSkill'],
    ['key-event', '../../src/v2/keyRail.js', 'keyBindingVerifier(callSkill'],
  ];
  for (const [lane, path, needle] of cases) {
    it(`${lane}: the rail's default verifier is the one the table names (${LANE_ACCEPTS[lane]})`, async () => {
      const src = await railSource(path);
      expect(src, `${path} defaults to ${needle}`).toContain(`verifyBinding ?? ${needle}`);
      const fn = { rosterBindingVerifier, membershipBindingVerifier, keyBindingVerifier }[needle.split('(')[0]];
      expect(VERIFIER_ACCEPTS.get(fn)).toBe(entryKind(lane).accepts);
    });
  }

  it('grants: the rail takes its verifier from the caller, and realAgent hands it the device-set one', async () => {
    const src = await railSource('../../src/core/agent/realAgent.js');
    const at = src.indexOf('makeGrantsRail({');
    expect(at).toBeGreaterThan(0);
    expect(src.slice(at, at + 400)).toMatch(/verifyBinding:\s*deviceSetVerifier/);
    expect(src).toMatch(/deviceSetVerifier\s*=\s*deviceSetBindingVerifier\(/);
    expect(VERIFIER_ACCEPTS.get(deviceSetBindingVerifier)).toBe(entryKind('grants').accepts);
  });

  it('the rail factories exist (so the source needles above are not pinning dead code)', () => {
    for (const f of [makeTaskRail, makeChatRail, makeGovernanceRail, makeMembershipRail, makeKeyRail]) expect(typeof f).toBe('function');
  });
});
