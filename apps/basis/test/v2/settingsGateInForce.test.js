/**
 * WHO DECIDES A SETTINGS SAVE IS THE RULE IN FORCE, NOT THE ONE BEING SAVED.
 *
 * The settings screens asked the decision table about the EDITED policy, so an admin of a circle that decides
 * together (two admins, `changePolicy: admin-quorum`) could set "who decides" back to "any admin" in the same Save and
 * the Save went through directly, the very change the rule exists to put to the others. The gate reads the policy in
 * force; the edit is what the proposal carries.
 */
import { describe, it, expect } from 'vitest';
import { settingsSaveNeedsProposal } from '../../src/v2/circlePolicy.js';

const quorumTwoAdmins = { governance: { changePolicy: 'admin-quorum' }, admins: ['a', 'b'] };
const anyAdmin = { governance: { changePolicy: 'any-admin' }, admins: ['a', 'b'] };

describe('the settings gate reads the rule in force', () => {
  it('flipping who-decides to "any admin" in the same Save still opens a proposal', () => {
    expect(settingsSaveNeedsProposal({ inForce: quorumTwoAdmins, edited: anyAdmin })).toBe(true);
  });
  it('a circle where any admin decides saves directly, even when the edit asks for agreement from now on', () => {
    expect(settingsSaveNeedsProposal({ inForce: anyAdmin, edited: quorumTwoAdmins })).toBe(false);
  });
  it('with nothing in force yet (a fresh screen), the edited policy is all there is', () => {
    expect(settingsSaveNeedsProposal({ inForce: null, edited: quorumTwoAdmins })).toBe(true);
    expect(settingsSaveNeedsProposal({ inForce: null, edited: anyAdmin })).toBe(false);
  });
});
