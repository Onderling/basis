/**
 * knownPeersSync — a person's own devices tell each other who they know.
 *
 * On a relay an address IS its public key, and a device accepts a message only from a key it has
 * bound to that address. The binding is made by a greeting — the HI — and a greeting lands on ONE
 * device: whichever socket the relay currently maps the person's address to. So a contact who
 * greeted the phone is bound on the phone and nowhere else; when the box registers the same address
 * later and the contact writes again, the box refuses them as a stranger. Silently. The contact
 * book has the same shape one layer up: a card scanned on the phone is a contact on the phone.
 *
 * The greeting is between sockets; that cannot change. But its RESULT — "this key is Bea", "Bea is
 * a contact" — is a fact about the person, and this carries it to every device of theirs. Two kinds
 * ride the same wire: the security layer's bindings (address → key) and the contact book's rows.
 *
 * Deliberately the SAME shape as the contact-turn fan and the grants catch-up: a sibling is reached
 * at its proven per-circle address (`siblingDeviceAddresses`), over hold-forward, and a landed
 * payload is admitted by the same gate — it came from the profile address or from one of the
 * owner's own proven device addresses, both of which are proofs of key-holding the security layer
 * has already checked. Three moments carry it:
 *
 *   • LIVE — a greeting lands or a contact is added on one device: that one row goes to the others.
 *   • A NEW SIBLING — a device of mine just announced its per-circle address: it gets everything.
 *   • CATCH-UP — on connect, a device asks its siblings for everything (an offline stretch longer
 *     than the hold is reconciled here; any one complete answer suffices).
 *
 * On landing, a binding is filed through `learnPeerKey`: ESTABLISH if absent, never replace — a
 * sibling's word can introduce a key, not overrule one this device holds (a key change arrives as a
 * rotation proof, on its own path). A contact is ADDED if absent and otherwise left alone: each
 * device's own edits stand, and "the same contact, edited on two devices" is a merge question this
 * does not answer (recorded as open).
 *
 * Pure — no DOM, no RN, no transport import. Web, mobile and the headless device share it; the agent
 * injects its sends, its sibling lookup, its security layer and its contact book.
 */

/** A row learned live on one device, carried to the others. */
export const KNOWN_PEERS_BROADCAST = 'device-known-peers';

/** The catch-up pair: a sibling asks; a sibling answers with everything it knows. */
export const KNOWN_PEERS_CATCHUP_SUBTYPES = Object.freeze({
  request: 'device-known-peers-request',
  batch:   'device-known-peers-batch',
});

/** The contact fields that cross: what another device needs to hold the same person. Never a blob. */
const CONTACT_FIELDS = ['webid', 'pubKey', 'handle', 'displayName', 'name', 'avatarUrl', 'trustLevel', 'tags', 'peerAddr',
  'shareLocation', 'allowHopThrough', 'allowAutomatching'];

function bindingToWire(b) {
  if (!b || typeof b !== 'object') return null;
  if (typeof b.address !== 'string' || !b.address) return null;
  if (typeof b.pubKey !== 'string' || !b.pubKey) return null;
  return { address: b.address, pubKey: b.pubKey };
}

function contactToWire(c) {
  if (!c || typeof c !== 'object' || typeof c.webid !== 'string' || !c.webid) return null;
  const out = {};
  for (const k of CONTACT_FIELDS) if (c[k] !== undefined && c[k] !== null) out[k] = c[k];
  return out;
}

/**
 * Project what a device knows onto the wire. Malformed rows are dropped, not carried.
 * @param {{peers?: Array<{address: string, pubKey: string}>, contacts?: object[]}} known
 * @returns {{peers: Array<{address: string, pubKey: string}>, contacts: object[]}|null}  null when nothing survives
 */
export function knownPeersToWire(known) {
  const peers = (Array.isArray(known?.peers) ? known.peers : []).map(bindingToWire).filter(Boolean);
  const contacts = (Array.isArray(known?.contacts) ? known.contacts : []).map(contactToWire).filter(Boolean);
  if (peers.length === 0 && contacts.length === 0) return null;
  return { peers, contacts };
}

/**
 * @param {object} a
 * @param {() => Promise<string[]>} a.siblings   the owner's own proven device addresses (`siblingDeviceAddresses`)
 * @param {string} a.selfPubKey                  the profile's chat pubKey
 * @param {(to: string, payload: object) => Promise<any>} a.sendToPeer   hold-forward, like every own-devices fan
 * @param {() => Promise<{peers: object[], contacts: object[]}>} a.snapshot   everything this device knows, for a new sibling or a catch-up
 * @param {(address: string, pubKey: string) => 'established'|'unchanged'|'refused'} a.learnPeerKey   the security layer's establish-never-replace setter
 * @param {{ has: (webid: string) => Promise<boolean>, add: (contact: object) => Promise<any> }} a.contacts   the contact book, raw (not through the waist — a landed row must not fan back out)
 * @param {(summary: {from: string, established: number, contactsAdded: number}) => void} [a.onLanded]   observability seam
 * @param {(reason: string, fromAddr: string) => void} [a.onRefused]   observability seam
 */
export function createKnownPeersSync({ siblings, selfPubKey, sendToPeer, snapshot, learnPeerKey, contacts, onLanded = null, onRefused = null } = {}) {
  if (typeof siblings !== 'function') throw new Error('knownPeersSync: a `siblings` lookup is required');
  if (typeof selfPubKey !== 'string' || !selfPubKey) throw new Error('knownPeersSync: selfPubKey required');
  if (typeof sendToPeer !== 'function') throw new Error('knownPeersSync: `sendToPeer` is required');
  if (typeof snapshot !== 'function') throw new Error('knownPeersSync: `snapshot` is required');
  if (typeof learnPeerKey !== 'function') throw new Error('knownPeersSync: `learnPeerKey` is required');
  if (!contacts || typeof contacts.has !== 'function' || typeof contacts.add !== 'function') throw new Error('knownPeersSync: a `contacts` book {has, add} is required');

  const refuse = (reason, fromAddr) => { try { onRefused?.(reason, fromAddr); } catch { /* observability never throws */ } };
  const warn = (msg) => { if (typeof console !== 'undefined') console.warn(`[own-devices] ${msg}`); };

  /** The gate every landing passes: the person's own address, or one of their proven device addresses. */
  async function fromOwnDevice(fromAddr) {
    if (fromAddr === selfPubKey) return true;
    let addrs = [];
    try { addrs = (await siblings()) ?? []; } catch { return false; }
    return addrs.includes(fromAddr);
  }

  /** File a landed wire on this device. Establish, never replace; add, never overwrite. */
  async function land(fromAddr, wire) {
    let established = 0;
    for (const b of wire.peers) {
      if (b.address === selfPubKey || b.pubKey === selfPubKey) continue;   // a device never learns itself from a sibling
      try { if (learnPeerKey(b.address, b.pubKey) === 'established') established += 1; } catch { /* one bad row never blocks the rest */ }
    }
    let contactsAdded = 0;
    for (const c of wire.contacts) {
      if (c.webid === selfPubKey) continue;
      try {
        if (await contacts.has(c.webid)) continue;
        await contacts.add(c);
        contactsAdded += 1;
      } catch (err) { warn(`a contact from my own device could not be added: ${err?.message ?? err}`); }
    }
    try { onLanded?.({ from: fromAddr, established, contactsAdded }); } catch { /* observability never throws */ }
    return { established, contactsAdded };
  }

  async function sendWire(to, subtype, wire) {
    try { await sendToPeer(to, { subtype, ...wire }); return true; }
    catch (err) { warn(`sync to my own device failed — that device will not know these until the next catch-up: ${err?.message ?? err}`); return false; }
  }

  /** Everything this device knows, on the wire — or null when it knows nothing worth carrying. */
  async function snapshotWire() {
    let known = null;
    try { known = await snapshot(); } catch (err) { warn(`could not read what this device knows: ${err?.message ?? err}`); return null; }
    return knownPeersToWire(known);
  }

  // Live rows already carried this session, so a chatty peer (a HI per reconnect) does not become a
  // fan per reconnect. A sibling that missed one gets it by catch-up, which is the row's other road.
  const carried = new Set();

  return {
    subtypes: { broadcast: KNOWN_PEERS_BROADCAST, ...KNOWN_PEERS_CATCHUP_SUBTYPES },

    /** LIVE: one binding just landed here (a greeting) — carry it to the other devices. */
    async fanPeer(binding) {
      const wire = knownPeersToWire({ peers: [binding] });
      if (!wire) return { attempted: 0 };
      const key = `p:${wire.peers[0].address}:${wire.peers[0].pubKey}`;
      if (carried.has(key)) return { attempted: 0, deduped: true };
      carried.add(key);
      return fanWire(wire);
    },

    /** LIVE: a contact was added here — carry the row to the other devices. */
    async fanContact(contact) {
      const wire = knownPeersToWire({ contacts: [contact] });
      if (!wire) return { attempted: 0 };
      return fanWire(wire);
    },

    /** A NEW SIBLING announced itself at `address`: hand it everything this device knows. */
    async pushTo(address) {
      if (typeof address !== 'string' || !address) return { sent: false };
      const wire = await snapshotWire();
      if (!wire) return { sent: false, reason: 'nothing-known' };
      return { sent: await sendWire(address, KNOWN_PEERS_CATCHUP_SUBTYPES.batch, wire) };
    },

    /** CATCH-UP: ask every sibling for everything. Any ONE complete answer suffices (idempotent landing). */
    async requestFromSiblings() {
      let addrs = [];
      try { addrs = (await siblings()) ?? []; } catch { return { requested: 0 }; }
      let requested = 0;
      for (const addr of addrs) {
        try { await sendToPeer(addr, { subtype: KNOWN_PEERS_CATCHUP_SUBTYPES.request }); requested += 1; } catch { /* next sibling */ }
      }
      return { requested };
    },

    /** The inbound entries, keyed by subtype — spread into the peer router like every other lane. */
    handlers: {
      [KNOWN_PEERS_BROADCAST]: async (fromAddr, payload) => {
        if (payload?.subtype !== KNOWN_PEERS_BROADCAST) return;
        if (!(await fromOwnDevice(fromAddr))) { refuse('not-a-sibling', fromAddr); return; }
        const wire = knownPeersToWire(payload);
        if (!wire) { refuse('malformed', fromAddr); return; }
        await land(fromAddr, wire);
      },
      [KNOWN_PEERS_CATCHUP_SUBTYPES.batch]: async (fromAddr, payload) => {
        if (payload?.subtype !== KNOWN_PEERS_CATCHUP_SUBTYPES.batch) return;
        if (!(await fromOwnDevice(fromAddr))) { refuse('not-a-sibling', fromAddr); return; }
        const wire = knownPeersToWire(payload);
        if (!wire) { refuse('malformed', fromAddr); return; }
        await land(fromAddr, wire);
      },
      [KNOWN_PEERS_CATCHUP_SUBTYPES.request]: async (fromAddr, payload) => {
        if (payload?.subtype !== KNOWN_PEERS_CATCHUP_SUBTYPES.request) return;
        if (!(await fromOwnDevice(fromAddr))) { refuse('not-a-sibling', fromAddr); return; }
        const wire = await snapshotWire();
        if (!wire) return;   // nothing to say is not an error
        await sendWire(fromAddr, KNOWN_PEERS_CATCHUP_SUBTYPES.batch, wire);
      },
    },
  };

  async function fanWire(wire) {
    let addrs = [];
    try { addrs = (await siblings()) ?? []; } catch { addrs = []; }
    await Promise.all(addrs.map((addr) => sendWire(addr, KNOWN_PEERS_BROADCAST, wire)));
    return { attempted: addrs.length };
  }
}
