/**
 * MIJ: "WAT WACHT OP JOU" — what is waiting for the person, from the reads the tabs already make: a vote open to them
 * (they have not voted), an appointment in a circle they have not answered (not their own), a device offer waiting to be
 * taken. Each is a chip that OPENS where it lives; nothing here acts. Nothing waiting = no items (one quiet line).
 */
import { describe, it, expect } from 'vitest';
import { awaitingItems } from '../../src/v2/awaiting.js';

const now = Date.parse('2026-10-20T12:00:00Z');
const soon = (h) => new Date(now + h * 3_600_000).toISOString();

describe('what is waiting for you (Mij)', () => {
  it('an open vote they have not cast, an appointment they have not answered, a device offer — each opening where it lives', () => {
    const items = awaitingItems({
      now,
      circles: [{ id: 'c1', name: 'Straat' }, { id: 'c2', name: 'Werk' }],
      selfIn: (cid) => ({ c1: 'me1', c2: 'me2' }[cid]),
      proposalsByCircle: { c1: [{ proposalId: 'p1', votes: [] }, { proposalId: 'p2', votes: [{ voter: 'me1', choice: 'yes' }] }] },
      eventsByCircle: { c2: [
        { id: 'e1', title: 'Overleg', startsAt: soon(24), createdBy: 'boss' },
        { id: 'e2', title: 'Lunch', startsAt: soon(30), createdBy: 'boss', rsvp: { me2: 'accepted' } },
        { id: 'e3', title: 'Mijn eigen', startsAt: soon(30), createdBy: 'me2' },
        { id: 'e4', title: 'Voorbij', startsAt: soon(-5), createdBy: 'boss' },
      ] },
      deviceOffer: true,
    });
    expect(items).toEqual([
      { kind: 'vote', circleId: 'c1', name: 'Straat', count: 1, open: { kind: 'open-proposals', circleId: 'c1' }, labelKey: 'circle.mij.awaiting_vote' },
      { kind: 'rsvp', circleId: 'c2', name: 'Werk', count: 1, open: { kind: 'open-circle', circleId: 'c2' }, labelKey: 'circle.mij.awaiting_rsvp' },
      { kind: 'device', count: 1, open: { kind: 'open-mydata' }, labelKey: 'circle.mij.awaiting_device' },
    ]);
  });
  it('nothing waiting = no items', () => {
    expect(awaitingItems({ now, circles: [{ id: 'c1', name: 'Straat' }], selfIn: () => 'me', proposalsByCircle: {}, eventsByCircle: {}, deviceOffer: false })).toEqual([]);
  });
});

describe('the block on Mij, through the one screen materializer', () => {
  it('reads each circle\'s open proposals and appointments, and the device offer, from the host\'s sources', async () => {
    const { mijScreenBlocks } = await import('../../src/v2/mijScreen.js');
    const later = new Date(Date.now() + 86_400_000).toISOString();
    const callSkill = async (app, op, args) => (app === 'calendar' && op === 'listEvents' && args.circleId === 'c1'
      ? { ok: true, items: [{ id: 'e1', title: 'Overleg', startsAt: later, createdBy: 'boss' }] } : { ok: true, items: [] });
    const blocks = await mijScreenBlocks({ hostOps: {
      callSkill, circles: [{ id: 'c1', name: 'Straat' }], selfIn: () => 'me',
      openProposals: async () => ({ proposals: [{ proposalId: 'p1', votes: [] }] }),
      pendingDeviceOffer: async () => true,
    } });
    const a = blocks.find((b) => b.type === 'awaiting');
    expect(a.content.items.map((i) => i.kind)).toEqual(['vote', 'rsvp', 'device']);
  });
});

describe('Mij: what was shared with me is waiting too (it was a door on My data)', () => {
  it('a shared chip with the count, opening the inbox; none when nothing was shared', () => {
    const items = awaitingItems({ sharedWithMe: 2 });
    expect(items).toEqual([{ kind: 'shared', count: 2, open: { kind: 'open-shared-with-me' }, labelKey: 'circle.mij.awaiting_shared' }]);
    expect(awaitingItems({ sharedWithMe: 0 })).toEqual([]);
    expect(awaitingItems({})).toEqual([]);
  });
});
