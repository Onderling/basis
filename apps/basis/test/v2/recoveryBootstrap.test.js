/**
 * recoveryBootstrap — the pure half of "the file carries someone to ask": whom the export picks, what
 * the file's body gains and loses, and the offer the import builds. The relay walk
 * (`recoveryRestoreParity.relay.test.js`) proves the restored phone talks again.
 */
import { describe, it, expect } from 'vitest';
import { setCircleMembership, circleMembershipsOf, circleBootstrapPeerOf } from '@onderling/agent-registry';
import { chooseBootstrapPeer, bodyWithBootstrapPeers, bootstrapOfferFromEntry } from '../../src/v2/recoveryBootstrap.js';
import { parseEnrollOffer } from '../../src/v2/enrollOffer.js';

const ME = 'me';

describe('whom the file names', () => {
  it('an admin first, else any member — never the person themself, and by their own address (webid)', () => {
    expect(chooseBootstrapPeer({ selfPubKey: ME, members: [
      { webid: ME, role: 'admin', circleAddress: 'me-c' },
      { webid: 'cas', role: 'member', circleAddress: 'cas-c' },
      { webid: 'bea', role: 'admin', circleAddresses: ['bea-c'] },
    ] })).toEqual({ webid: 'bea', address: 'bea-c' });
    expect(chooseBootstrapPeer({ selfPubKey: ME, members: [{ webid: ME, role: 'admin' }, { webid: 'cas' }] }))
      .toEqual({ webid: 'cas', address: null });
    expect(chooseBootstrapPeer({ selfPubKey: ME, members: [{ webid: ME, role: 'admin' }] }), 'alone in a circle: nobody to ask').toBeNull();
    expect(chooseBootstrapPeer({ selfPubKey: ME, members: null })).toBeNull();
  });
});

describe("the file's body", () => {
  const entry = (props) => ({ agentId: 'default', properties: props });
  const props = () => {
    let p = setCircleMembership({}, 'huis', { address: 'me-huis', handle: 'an' });
    p = setCircleMembership(p, 'koor', { address: 'me-koor', peer: { address: 'old-peer', point: 'wss://old' } });
    return p;
  };

  it('writes the chosen peers onto the ticked circles and REMOVES a peer from an un-ticked one — on a copy', () => {
    const body = { agents: [entry(props()), { agentId: 'other', properties: {} }] };
    const out = bodyWithBootstrapPeers({ body, peers: { huis: { address: 'bea', point: 'wss://r' }, koor: null } });
    const me = out.agents.find((a) => a.agentId === 'default');
    expect(circleBootstrapPeerOf(me, 'huis')).toEqual({ address: 'bea', point: 'wss://r' });
    expect(circleBootstrapPeerOf(me, 'koor'), 'un-ticked: the old peer is gone from the file').toBeNull();
    expect(circleMembershipsOf(me).huis.handle, 'the other facets survive').toBe('an');
    // The body handed in is untouched — the choice belongs to the file being written.
    expect(circleBootstrapPeerOf(body.agents[0], 'huis')).toBeNull();
    expect(circleBootstrapPeerOf(body.agents[0], 'koor')).toEqual({ address: 'old-peer', point: 'wss://old' });
    expect(out.agents[1]).toBe(body.agents[1]);
  });

  it('a peer without a point is carried as an address alone', () => {
    const out = bodyWithBootstrapPeers({ body: { agents: [entry(props())] }, peers: { huis: { address: 'bea', point: null } } });
    expect(circleBootstrapPeerOf(out.agents[0], 'huis')).toEqual({ address: 'bea' });
  });
});

describe('the offer the import builds', () => {
  it('one circle per record with a peer, marked as a MEMBER, the points as relays; null when nobody was named', () => {
    let p = setCircleMembership({}, 'huis', { address: 'me-huis', handle: 'an', peer: { address: 'bea', point: 'wss://r1' }, relays: ['wss://r2'] });
    p = setCircleMembership(p, 'koor', { address: 'me-koor', peer: { address: 'cas' } });
    p = setCircleMembership(p, 'club', { address: 'me-club' });
    const made = bootstrapOfferFromEntry({ agentId: 'default', properties: p });
    expect(made.circles).toBe(2);
    const parsed = parseEnrollOffer(made.offer);
    expect(parsed.ok).toBe(true);
    expect(parsed.relays).toEqual(['wss://r1', 'wss://r2']);
    expect(parsed.circles).toEqual([
      { id: 'huis', handle: 'an', address: 'bea', member: true },
      { id: 'koor', handle: null, address: 'cas', member: true },
    ]);
    expect(bootstrapOfferFromEntry({ agentId: 'default', properties: setCircleMembership({}, 'club', { address: 'x' }) })).toBeNull();
    expect(bootstrapOfferFromEntry(null)).toBeNull();
  });
});
