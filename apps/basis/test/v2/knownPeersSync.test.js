/**
 * knownPeersSync — the pure half: the wire, the sibling gate, and the two landing rules
 * (a binding is established and never replaced; a contact is added and never overwritten).
 * The relay walk (`contactsReachEveryOwnDevice.relay.test.js`) proves it crossing a real socket.
 */
import { describe, it, expect } from 'vitest';
import {
  createKnownPeersSync, knownPeersToWire, KNOWN_PEERS_BROADCAST, KNOWN_PEERS_CATCHUP_SUBTYPES,
} from '../../src/v2/knownPeersSync.js';

const ME = 'me-pubkey';
const SIBLING = 'my-tablet-circle-address';
const STRANGER = 'someone-else';

function rig({ siblings = [SIBLING], known = { peers: [], contacts: [] }, book = new Map() } = {}) {
  const sent = [];
  const bindings = new Map();
  const landed = [];
  const refused = [];
  const sync = createKnownPeersSync({
    siblings: async () => siblings,
    selfPubKey: ME,
    sendToPeer: async (to, payload) => { sent.push({ to, payload }); },
    snapshot: async () => known,
    learnPeerKey: (address, pubKey) => {
      const held = bindings.get(address);
      if (held === undefined) { bindings.set(address, pubKey); return 'established'; }
      return held === pubKey ? 'unchanged' : 'refused';
    },
    contacts: {
      has: async (webid) => book.has(webid),
      add: async (c) => { book.set(c.webid, c); },
    },
    onLanded: (s) => landed.push(s),
    onRefused: (reason, from) => refused.push({ reason, from }),
  });
  return { sync, sent, bindings, book, landed, refused };
}

describe('the wire', () => {
  it('carries bindings and the contact fields another device needs, and drops what is malformed', () => {
    const wire = knownPeersToWire({
      peers: [{ address: 'a', pubKey: 'k' }, { address: '', pubKey: 'k' }, null, { address: 'b' }],
      contacts: [{ webid: 'w', displayName: 'Bea', pubKey: 'k', secretNote: 'never' }, { displayName: 'no webid' }],
    });
    expect(wire.peers).toEqual([{ address: 'a', pubKey: 'k' }]);
    expect(wire.contacts).toEqual([{ webid: 'w', displayName: 'Bea', pubKey: 'k' }]);
  });
  it('is null when nothing survives — a device with nothing to say sends nothing', () => {
    expect(knownPeersToWire({ peers: [{ address: 'x' }], contacts: [] })).toBeNull();
    expect(knownPeersToWire(null)).toBeNull();
  });
});

describe('landing', () => {
  it('establishes a binding it lacks and never replaces one it holds', async () => {
    const r = rig();
    r.bindings.set('held', 'the-real-key');
    await r.sync.handlers[KNOWN_PEERS_BROADCAST](SIBLING, {
      subtype: KNOWN_PEERS_BROADCAST,
      peers: [{ address: 'new', pubKey: 'k1' }, { address: 'held', pubKey: 'an-impostor-key' }],
      contacts: [],
    });
    expect(r.bindings.get('new')).toBe('k1');
    expect(r.bindings.get('held'), 'a sibling cannot overrule a key this device holds').toBe('the-real-key');
    expect(r.landed).toEqual([{ from: SIBLING, established: 1, contactsAdded: 0 }]);
  });
  it('adds a contact it lacks and leaves one it has untouched', async () => {
    const r = rig();
    r.book.set('w-old', { webid: 'w-old', displayName: 'my edit' });
    await r.sync.handlers[KNOWN_PEERS_CATCHUP_SUBTYPES.batch](SIBLING, {
      subtype: KNOWN_PEERS_CATCHUP_SUBTYPES.batch,
      peers: [],
      contacts: [{ webid: 'w-new', displayName: 'Bea' }, { webid: 'w-old', displayName: 'their edit' }],
    });
    expect(r.book.get('w-new')).toEqual({ webid: 'w-new', displayName: 'Bea' });
    expect(r.book.get('w-old').displayName, 'each device\'s own edits stand').toBe('my edit');
    expect(r.landed[0]).toMatchObject({ established: 0, contactsAdded: 1 });
  });
  it('never learns itself from a sibling', async () => {
    const r = rig();
    await r.sync.handlers[KNOWN_PEERS_BROADCAST](ME, {
      subtype: KNOWN_PEERS_BROADCAST, peers: [{ address: ME, pubKey: ME }], contacts: [{ webid: ME }],
    });
    expect(r.bindings.size).toBe(0);
    expect(r.book.size).toBe(0);
  });
});

describe('the gate', () => {
  it('admits the profile address and a proven sibling; refuses everyone else, naming the reason', async () => {
    const r = rig();
    const wire = { subtype: KNOWN_PEERS_BROADCAST, peers: [{ address: 'p', pubKey: 'k' }], contacts: [] };
    await r.sync.handlers[KNOWN_PEERS_BROADCAST](STRANGER, wire);
    expect(r.bindings.size, 'a stranger\'s "who I know" binds nothing').toBe(0);
    expect(r.refused).toEqual([{ reason: 'not-a-sibling', from: STRANGER }]);
    await r.sync.handlers[KNOWN_PEERS_BROADCAST](ME, wire);
    expect(r.bindings.get('p')).toBe('k');
  });
  it('a malformed payload from a sibling is refused as such, not silently', async () => {
    const r = rig();
    await r.sync.handlers[KNOWN_PEERS_BROADCAST](SIBLING, { subtype: KNOWN_PEERS_BROADCAST, peers: [{ address: 'x' }] });
    expect(r.refused).toEqual([{ reason: 'malformed', from: SIBLING }]);
  });
  it('answers a sibling\'s request with everything, and a stranger\'s with nothing', async () => {
    const known = { peers: [{ address: 'p', pubKey: 'k' }], contacts: [{ webid: 'w', displayName: 'Bea' }] };
    const r = rig({ known });
    await r.sync.handlers[KNOWN_PEERS_CATCHUP_SUBTYPES.request](STRANGER, { subtype: KNOWN_PEERS_CATCHUP_SUBTYPES.request });
    expect(r.sent).toEqual([]);
    await r.sync.handlers[KNOWN_PEERS_CATCHUP_SUBTYPES.request](SIBLING, { subtype: KNOWN_PEERS_CATCHUP_SUBTYPES.request });
    expect(r.sent).toEqual([{ to: SIBLING, payload: { subtype: KNOWN_PEERS_CATCHUP_SUBTYPES.batch, ...known } }]);
  });
});

describe('carrying', () => {
  it('fans a landed greeting to every sibling once — a chatty peer is not a fan per reconnect', async () => {
    const r = rig({ siblings: ['t1', 't2'] });
    expect(await r.sync.fanPeer({ address: 'bea', pubKey: 'bea' })).toEqual({ attempted: 2 });
    expect(r.sent.map((s) => s.to)).toEqual(['t1', 't2']);
    expect(r.sent[0].payload).toEqual({ subtype: KNOWN_PEERS_BROADCAST, peers: [{ address: 'bea', pubKey: 'bea' }], contacts: [] });
    expect(await r.sync.fanPeer({ address: 'bea', pubKey: 'bea' })).toEqual({ attempted: 0, deduped: true });
  });
  it('fans an added contact, and hands a new sibling the whole snapshot', async () => {
    const known = { peers: [{ address: 'p', pubKey: 'k' }], contacts: [{ webid: 'w', displayName: 'Bea' }] };
    const r = rig({ known });
    await r.sync.fanContact({ webid: 'w2', displayName: 'Cas', avatarUrl: null });
    expect(r.sent[0]).toEqual({ to: SIBLING, payload: { subtype: KNOWN_PEERS_BROADCAST, peers: [], contacts: [{ webid: 'w2', displayName: 'Cas' }] } });
    expect(await r.sync.pushTo('fresh-device')).toEqual({ sent: true });
    expect(r.sent[1]).toEqual({ to: 'fresh-device', payload: { subtype: KNOWN_PEERS_CATCHUP_SUBTYPES.batch, ...known } });
  });
  it('asks every sibling on catch-up, and says how many', async () => {
    const r = rig({ siblings: ['t1', 't2', 't3'] });
    expect(await r.sync.requestFromSiblings()).toEqual({ requested: 3 });
    expect(r.sent.every((s) => s.payload.subtype === KNOWN_PEERS_CATCHUP_SUBTYPES.request)).toBe(true);
  });
  it('with no siblings there is nothing to do and nothing to report as failed', async () => {
    const r = rig({ siblings: [] });
    expect(await r.sync.fanPeer({ address: 'a', pubKey: 'a' })).toEqual({ attempted: 0 });
    expect(await r.sync.requestFromSiblings()).toEqual({ requested: 0 });
    expect(await r.sync.pushTo('x')).toEqual({ sent: false, reason: 'nothing-known' });
  });
});
