/**
 * recoveryBootstrap — the pure half of "the file carries the member list": what a circle's snapshot
 * holds, what the file's body gains, and the offer the import builds from it. The relay walk
 * (`recoveryRestoreParity.relay.test.js`) proves the restored phone talks again.
 */
import { describe, it, expect } from 'vitest';
import { setCircleMembership } from '@onderling/agent-registry';
import {
  rosterSnapshot, projectMemberRow, bodyWithRosters, rostersOf, bootstrapOfferFromRosters, ROSTERS_KEY,
} from '../../src/v2/recoveryBootstrap.js';
import { parseEnrollOffer } from '../../src/v2/enrollOffer.js';

const ME = 'me';
const rows = [{ id: 'r1', type: 'membership-redemption', source: { groupId: 'huis', redeemedBy: 'bea' } }];
const members = [
  { webid: ME, role: 'admin', displayName: 'Anna', sealingPublicKey: 'never-carried' },
  { webid: 'bea', role: 'member', handle: 'bea', circleAddress: 'bea-huis', circleAddresses: ['bea-huis'], ceremonyCommitment: 'cc' },
  { webid: 'cas', role: 'member' },
  { notAMember: true },
];

describe('a circle\'s snapshot', () => {
  it('carries the trail rows and the member facts the seed serves — nothing more — plus the owner\'s own proven announcement', () => {
    const own = { circleId: 'huis', memberWebid: ME, circleAddress: 'me-huis', circleAddressProof: 'p' };
    const snap = rosterSnapshot({ rows, members, ownAnnouncement: own });
    expect(snap.rows).toEqual(rows);
    expect(snap.members).toEqual([
      { webid: ME, role: 'admin', displayName: 'Anna' },
      { webid: 'bea', role: 'member', handle: 'bea', circleAddress: 'bea-huis', circleAddresses: ['bea-huis'], ceremonyCommitment: 'cc' },
      { webid: 'cas', role: 'member' },
    ]);
    expect(snap.own).toBe(own);
    expect(projectMemberRow({ webid: '' })).toBeNull();
  });
  it('an announcement without an address is not carried; an empty circle is nothing', () => {
    expect(rosterSnapshot({ rows, members, ownAnnouncement: { memberWebid: ME } }).own).toBeUndefined();
    expect(rosterSnapshot({ rows: [], members: [] })).toBeNull();
    expect(rosterSnapshot()).toBeNull();
  });
});

describe("the file's body", () => {
  it('gains the ticked circles\' snapshots beside the registry, on a COPY; an un-ticked circle carries nothing', () => {
    const body = { agents: [{ agentId: 'default', properties: {} }] };
    const huis = rosterSnapshot({ rows, members });
    const out = bodyWithRosters({ body, rosters: { huis, koor: null } });
    expect(rostersOf(out)).toEqual({ huis });
    expect(out.agents).toBe(body.agents);
    expect(body[ROSTERS_KEY], 'the body handed in is untouched').toBeUndefined();
    expect(rostersOf(bodyWithRosters({ body, rosters: {} }))).toEqual({});
    expect(rostersOf(null)).toEqual({});
  });
});

describe('the offer the import builds', () => {
  it('names EVERY other member of each carried circle — an admin first — marked as members, with the record\'s relays', () => {
    const body = bodyWithRosters({ body: { agents: [] }, rosters: {
      huis: rosterSnapshot({ rows, members: [members[0], members[2], { ...members[1], role: 'admin' }] }),
      koor: rosterSnapshot({ rows: [], members: [{ webid: ME, role: 'admin' }] }),   // alone: nobody to tell
    } });
    const memberships = setCircleMembership({}, 'huis', { address: 'me-huis', handle: 'an', relays: ['wss://r'] })
      .circleMemberships.value;
    const made = bootstrapOfferFromRosters({ body, selfPubKey: ME, memberships });
    expect(made.circles).toBe(1);
    const parsed = parseEnrollOffer(made.offer);
    expect(parsed.ok).toBe(true);
    expect(parsed.relays).toEqual(['wss://r']);
    expect(parsed.circles).toEqual([{ id: 'huis', handle: 'an', address: 'bea', others: ['cas'], member: true }]);
    expect(bootstrapOfferFromRosters({ body: { agents: [] }, selfPubKey: ME })).toBeNull();
  });
});
