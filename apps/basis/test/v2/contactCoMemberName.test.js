/**
 * A person met in a circle you share is named in Contacten by the handle they use there — not by their address.
 * Contacten named a row only through its PAIR circle, so a co-member that reached the peer graph from an ordinary
 * circle showed as `SmKGC4Pcv…` in the list and in the thread title (screen walk, 2026-10-22).
 */
import { describe, it, expect } from 'vitest';
import { loadContactRoster } from '../../src/v2/contactsSource.js';

const ADDR = 'SmKGC4PcvXrQiq0e8tHyTFIXPvMVIFEzAnUIQN_fKbY';
function fakes({ members }) {
  const peerGraph = { all: async () => [{ type: 'native', pubKey: ADDR, reachable: true }] };
  const callSkill = async (app, op, args) => {
    if (op === 'listContacts') return { contacts: [] };
    if (op === 'listMyCircles') return { circles: ['c-kijk'] };
    if (op === 'listGroupMembers') return args.groupId === 'c-kijk' ? { members } : { members: [] };
    return null;
  };
  return { peerGraph, callSkill };
}

describe('Contacten names a co-member from a shared circle', () => {
  it('a graph row with no pair circle takes the handle its address carries in a circle we share', async () => {
    const rows = await loadContactRoster(fakes({ members: [{ webid: 'w-bram', handle: 'peerbee', circleAddress: ADDR }] }));
    const row = rows.find((r) => r.contactId === ADDR);
    expect(row.name).toBe('peerbee');
  });

  it('only the handle — a name released to that circle does not travel into Contacten', async () => {
    const rows = await loadContactRoster(fakes({ members: [{ webid: 'w-bram', handle: 'peerbee', circleAddress: ADDR, personaProperties: { realName: 'Bram de Wit' } }] }));
    expect(rows.find((r) => r.contactId === ADDR).name).toBe('peerbee');
  });

  it('nobody in a shared circle has that address → the row keeps what it had', async () => {
    const rows = await loadContactRoster(fakes({ members: [{ webid: 'w-x', handle: 'other', circleAddress: 'elsewhere' }] }));
    expect(rows.find((r) => r.contactId === ADDR).name).toBe(ADDR);
  });
});
