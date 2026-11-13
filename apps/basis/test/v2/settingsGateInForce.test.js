/**
 * WHO DECIDES A SETTINGS SAVE IS THE RULE IN FORCE, NOT THE ONE BEING SAVED.
 *
 * The settings screens asked the decision table about the EDITED policy, so an admin of a circle that decides
 * together (two admins, `changePolicy: admin-quorum`) could set "who decides" back to "any admin" in the same Save and
 * the Save went through directly, the very change the rule exists to put to the others. The gate reads the policy in
 * force; the edit is what the proposal carries.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { settingsSaveNeedsProposal } from '../../src/v2/circlePolicy.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const SCREENS = {
  web: '../../web/v2/circleApp.js',
  mobile: '../../../basis-mobile/src/screens/v2/CircleSettingsScreen.js',
};

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

describe('the admins are counted from the roster, as every other device counts them', () => {
  // A real circle's policy carries no admin list (`policy.admins` is never written), so counting it said "one admin"
  // in every admin-quorum circle and a Save never proposed. The roster is what the receiving devices count.
  const quorumNoList = { governance: { changePolicy: 'admin-quorum' } };
  const roster = [{ webid: 'a', role: 'admin' }, { webid: 'b', role: 'admin' }, { webid: 'm', role: 'member' }];
  it('two admins on the roster: a Save in an admin-quorum circle opens a proposal', () => {
    expect(settingsSaveNeedsProposal({ inForce: quorumNoList, edited: quorumNoList, members: roster })).toBe(true);
  });
  it('one admin on the roster: that admin is the quorum, the Save goes directly', () => {
    expect(settingsSaveNeedsProposal({ inForce: quorumNoList, edited: quorumNoList, members: roster.filter((m) => m.webid !== 'b') })).toBe(false);
  });
});

describe('both settings screens ask the one gate, with the rule in force', () => {
  for (const [shell, rel] of Object.entries(SCREENS)) {
    it(`${shell}: calls settingsSaveNeedsProposal with inForce, never the old per-policy gate`, () => {
      const src = read(rel);
      expect(src).toMatch(/settingsSaveNeedsProposal\(\{\s*inForce:[^}]*members:/);
      expect(src).not.toMatch(/settingsChangeNeedsProposal\(/);
    });
  }
});
