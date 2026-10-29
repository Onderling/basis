/**
 * knownPeersSync — the pure half: the wire, the sibling gate, and the landing rule (a binding is established and never
 * replaced). The contact rows ride the own-devices lane and merge there (item-store's `fieldClockMerge.test.js`).
 */
import { describe, it, expect } from 'vitest';
import {
  createKnownPeersSync, knownPeersToWire, KNOWN_PEERS_BROADCAST, KNOWN_PEERS_CATCHUP_SUBTYPES,
} from '../../src/v2/knownPeersSync.js';

const ME = 'me-pubkey';
const SIBLING = 'my-tablet-circle-address';
const STRANGER = 'someone-else';

function rig({ siblings = [SIBLING], known = { peers: [] } } = {}) {
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
    onLanded: (s) => landed.push(s),
    onRefused: (reason, from) => refused.push({ reason, from }),
  });
  return { sync, sent, bindings, landed, refused };
}

describe('the wire', () => {
  it('carries bindings only, and drops what is malformed', () => {
    const wire = knownPeersToWire({
      peers: [{ address: 'a', pubKey: 'k', extra: 'never' }, { address: 'no-key' }],
      contacts: [{ webid: 'w', displayName: 'Bea' }],
    });
    expect(wire).toEqual({ peers: [{ address: 'a', pubKey: 'k' }] });
  });
  it('is null when nothing survives — a device with nothing to say sends nothing', () => {
    expect(knownPeersToWire({ peers: [{ address: 'x' }], contacts: [{ webid: 'w' }] })).toBeNull();
  });
});

describe('landing', () => {
  it('establishes a binding it lacks and never replaces one it holds', async () => {
    const r = rig();
    r.bindings.set('held', 'old-key');
    await r.sync.handlers[KNOWN_PEERS_BROADCAST](SIBLING, {
      subtype: KNOWN_PEERS_BROADCAST, peers: [{ address: 'new', pubKey: 'nk' }, { address: 'held', pubKey: 'other' }],
    });
    expect(r.bindings.get('new')).toBe('nk');
    expect(r.bindings.get('held')).toBe('old-key');
    expect(r.landed).toEqual([{ from: SIBLING, established: 1 }]);
  });
  it('never learns itself from a sibling', async () => {
    const r = rig();
    await r.sync.handlers[KNOWN_PEERS_BROADCAST](SIBLING, { subtype: KNOWN_PEERS_BROADCAST, peers: [{ address: ME, pubKey: ME }] });
    expect(r.bindings.size).toBe(0);
  });
});

describe('the gate', () => {
  it('admits a proven sibling; refuses everyone else — the profile address included — naming the reason', async () => {
    const r = rig();
    const wire = { subtype: KNOWN_PEERS_BROADCAST, peers: [{ address: 'p', pubKey: 'k' }] };
    await r.sync.handlers[KNOWN_PEERS_BROADCAST](STRANGER, wire);
    expect(r.bindings.size, 'a stranger\'s "who I know" binds nothing').toBe(0);
    expect(r.refused).toEqual([{ reason: 'not-a-sibling', from: STRANGER }]);
    // The profile address is every device's — a revoked one too — so it is nobody's device here (2026-09-14).
    await r.sync.handlers[KNOWN_PEERS_BROADCAST](ME, wire);
    expect(r.bindings.size, 'the profile address is not a sibling').toBe(0);
    expect(r.refused.at(-1)).toEqual({ reason: 'not-a-sibling', from: ME });
    await r.sync.handlers[KNOWN_PEERS_BROADCAST](SIBLING, wire);
    expect(r.bindings.get('p')).toBe('k');
  });
  it('a malformed payload from a sibling is refused as such, not silently', async () => {
    const r = rig();
    await r.sync.handlers[KNOWN_PEERS_BROADCAST](SIBLING, { subtype: KNOWN_PEERS_BROADCAST, peers: [{ address: 'x' }] });
    expect(r.refused).toEqual([{ reason: 'malformed', from: SIBLING }]);
  });
  it('answers a sibling\'s request with everything, and a stranger\'s with nothing', async () => {
    const known = { peers: [{ address: 'p', pubKey: 'k' }] };
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
    expect(r.sent[0].payload).toEqual({ subtype: KNOWN_PEERS_BROADCAST, peers: [{ address: 'bea', pubKey: 'bea' }] });
    expect(await r.sync.fanPeer({ address: 'bea', pubKey: 'bea' })).toEqual({ attempted: 0, deduped: true });
  });
  it('hands a new sibling the whole snapshot, and has no contact fan', async () => {
    const known = { peers: [{ address: 'p', pubKey: 'k' }] };
    const r = rig({ known });
    expect(r.sync.fanContact).toBeUndefined();
    expect(await r.sync.pushTo('fresh-device')).toEqual({ sent: true });
    expect(r.sent[0]).toEqual({ to: 'fresh-device', payload: { subtype: KNOWN_PEERS_CATCHUP_SUBTYPES.batch, ...known } });
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
