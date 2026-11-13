/**
 * A CHANGE MADE WITHOUT THE VOTE IS SHOWN, NOT ONLY REFUSED (Frits 2026-11-10: kept and shown, never applied).
 *
 * The receiver gate refuses an admin's rules or settings change that skipped the vote its circle requires; the
 * governance view lists it, naming who made it, so the members see that it happened. Changes the device applied,
 * and refused changes older than the newest applied one, are not listed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { refusedCarriedChanges } from '../../src/v2/governanceReceiverGate.js';
import { foldGovernance, proposeEvent, voteEvent } from '../../src/v2/governanceLog.js';
import { normalizeCirclePolicy } from '../../src/v2/circlePolicy.js';

const members = [{ ref: 'a0', role: 'admin' }, { ref: 'a1', role: 'admin' }, { ref: 'm0', role: 'member' }];
const quorum = normalizeCirclePolicy({ governance: { changeRule: 'admin-quorum', changePolicy: 'admin-quorum' } });
const rules = { purpose: 'Samen koken', agreements: 'Om de beurt' };
const rulesBody = (author, version, extra = {}) => ({ kind: 'rules-update', author, hash: `h${version}${author}`, payload: { rules, version, ...extra } });

describe('the changes made without the vote', () => {
  it('a lone admin\'s rules change is listed, with who made it', () => {
    const out = refusedCarriedChanges({ bodies: [rulesBody('a1', 3)], policy: quorum, members, proposals: [] });
    expect(out).toEqual([{ action: 'changeRule', by: 'a1', version: 3, hash: 'h3a1' }]);
  });

  it('an applied change is not listed, nor a refused one older than it', () => {
    const proposals = foldGovernance([
      proposeEvent({ proposalId: 'p1', action: 'changeRule', subject: rules, by: 'a0', at: 0 }),
      voteEvent({ proposalId: 'p1', voter: 'a0', choice: 'yes', at: 0 }),
      voteEvent({ proposalId: 'p1', voter: 'a1', choice: 'yes', at: 0 }),
    ].map((e) => ({ ...e, kind: 'governance' })), { policy: quorum, members, now: 1 }).proposals;
    const out = refusedCarriedChanges({ bodies: [rulesBody('a1', 2), rulesBody('a0', 3, { proposalId: 'p1' })], policy: quorum, members, proposals });
    expect(out).toEqual([]);
  });

  it('a member\'s change is not listed (the lane drops it before any vote is asked)', () => {
    expect(refusedCarriedChanges({ bodies: [rulesBody('m0', 3)], policy: quorum, members, proposals: [] })).toEqual([]);
  });
});

describe('both governance screens show them', () => {
  const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  it('web', () => expect(read('../../web/v2/circleGovernancePanel.js')).toMatch(/view\?\.refused/));
  it('phone', () => expect(read('../../../basis-mobile/src/screens/v2/CircleGovernanceScreen.js')).toMatch(/view\.refused/));
});
