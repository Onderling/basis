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
 * The greeting is between sockets; that cannot change. But its RESULT — "this key is Bea" — is a fact
 * about the person, and this carries it to every device of theirs: the security layer's bindings
 * (address → key). The contact book's rows do NOT ride here: they are `contact` rows on the person's
 * own-devices store, carried by that self's own-devices lane and merged there (their field-sets by
 * their own times).
 *
 * Deliberately the SAME shape as the contact-turn fan and the grants catch-up: a sibling is reached
 * at its proven per-circle address (`siblingDeviceAddresses`), over hold-forward, and a landed
 * payload is admitted by the same gate — it came from the profile address or from one of the
 * owner's own proven device addresses, both of which are proofs of key-holding the security layer
 * has already checked. Three moments carry it:
 *
 *   • LIVE — a greeting lands on one device: that one binding goes to the others.
 *   • A NEW SIBLING — a device of mine just announced its per-circle address: it gets everything.
 *   • CATCH-UP — on connect, a device asks its siblings for everything (an offline stretch longer
 *     than the hold is reconciled here; any one complete answer suffices).
 *
 * On landing, a binding is filed through `learnPeerKey`: ESTABLISH if absent, never replace — a
 * sibling's word can introduce a key, not overrule one this device holds (a person's key changes through
 * the root-gated ceremony, on its own path).
 *
 * Pure — no DOM, no RN, no transport import. Web, mobile and the headless device share it; the agent
 * injects its sends, its sibling lookup and its security layer.
 */

/** A row learned live on one device, carried to the others. */
import { makeSiblingCarry } from './siblingCarry.js';
export const KNOWN_PEERS_BROADCAST = 'device-known-peers';

/** The catch-up pair: a sibling asks; a sibling answers with everything it knows. */
export const KNOWN_PEERS_CATCHUP_SUBTYPES = Object.freeze({
  request: 'device-known-peers-request',
  batch:   'device-known-peers-batch',
});

function bindingToWire(b) {
  if (!b || typeof b !== 'object') return null;
  if (typeof b.address !== 'string' || !b.address) return null;
  if (typeof b.pubKey !== 'string' || !b.pubKey) return null;
  return { address: b.address, pubKey: b.pubKey };
}

/**
 * Project what a device knows onto the wire. Malformed rows are dropped, not carried.
 * @param {{peers?: Array<{address: string, pubKey: string}>}} known
 * @returns {{peers: Array<{address: string, pubKey: string}>}|null}  null when nothing survives
 */
export function knownPeersToWire(known) {
  const peers = (Array.isArray(known?.peers) ? known.peers : []).map(bindingToWire).filter(Boolean);
  if (peers.length === 0) return null;
  return { peers };
}

/**
 * @param {object} a
 * @param {() => Promise<string[]>} a.siblings   the owner's own proven device addresses (`siblingDeviceAddresses`)
 * @param {string} a.selfPubKey                  the profile's chat pubKey
 * @param {(to: string, payload: object) => Promise<any>} a.sendToPeer   hold-forward, like every own-devices fan
 * @param {() => Promise<{peers: object[]}>} a.snapshot   every binding this device knows, for a new sibling or a catch-up
 * @param {(address: string, pubKey: string) => 'established'|'unchanged'|'refused'} a.learnPeerKey   the security layer's establish-never-replace setter
 * @param {(summary: {from: string, established: number}) => void} [a.onLanded]   observability seam
 * @param {(reason: string, fromAddr: string) => void} [a.onRefused]   observability seam
 */
export function createKnownPeersSync({ siblings, selfPubKey, sendToPeer, snapshot, learnPeerKey, onLanded = null, onRefused = null } = {}) {
  if (typeof siblings !== 'function') throw new Error('knownPeersSync: a `siblings` lookup is required');
  if (typeof selfPubKey !== 'string' || !selfPubKey) throw new Error('knownPeersSync: selfPubKey required');
  if (typeof sendToPeer !== 'function') throw new Error('knownPeersSync: `sendToPeer` is required');
  if (typeof snapshot !== 'function') throw new Error('knownPeersSync: `snapshot` is required');
  if (typeof learnPeerKey !== 'function') throw new Error('knownPeersSync: `learnPeerKey` is required');

  const refuse = (reason, fromAddr) => { try { onRefused?.(reason, fromAddr); } catch { /* observability never throws */ } };
  const warn = (msg) => { if (typeof console !== 'undefined') console.warn(`[own-devices] ${msg}`); };
  // One caller of the ONE sibling carry (siblingCarry.js) for the live rows; the targeted push and the
  // catch-up request stay what they are (one sibling, not the set).
  const { carry } = makeSiblingCarry({ siblings, sendToPeer, onWarn: (m) => warn(`sync to my own device failed — that device will not know these until the next catch-up: ${m}`) });

  /** The gate every landing passes: one of the person's proven device addresses — never the profile
   *  address, which every device of theirs holds, a revoked one included (2026-09-14). */
  async function fromOwnDevice(fromAddr) {
    let addrs = [];
    try { addrs = (await siblings()) ?? []; } catch { return false; }
    return addrs.includes(fromAddr);
  }

  /** File a landed wire on this device. Establish, never replace. */
  async function land(fromAddr, wire) {
    let established = 0;
    for (const b of wire.peers) {
      if (b.address === selfPubKey || b.pubKey === selfPubKey) continue;   // a device never learns itself from a sibling
      try { if (learnPeerKey(b.address, b.pubKey) === 'established') established += 1; } catch { /* one bad row never blocks the rest */ }
    }
    const summary = { from: fromAddr, established };
    try { onLanded?.(summary); } catch { /* observability never throws */ }
    for (const fn of landedListeners) { try { fn(summary); } catch { /* observability never throws */ } }
    return { established };
  }
  const landedListeners = new Set();

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

    /** Is `fromAddr` one of THIS self's proven sibling addresses (what binds a landing to this self — never a payload field)? */
    admits: (fromAddr) => fromOwnDevice(fromAddr),

    /** Observe what a sibling's wire changed here (a shell repaints its roster; the box writes its log). Returns the unsubscribe. */
    onLanded(fn) { if (typeof fn === 'function') landedListeners.add(fn); return () => landedListeners.delete(fn); },

    /** LIVE: one binding just landed here (a greeting) — carry it to the other devices. */
    async fanPeer(binding) {
      const wire = knownPeersToWire({ peers: [binding] });
      if (!wire) return { attempted: 0 };
      const key = `p:${wire.peers[0].address}:${wire.peers[0].pubKey}`;
      if (carried.has(key)) return { attempted: 0, deduped: true };
      carried.add(key);
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
      const r = await carry({ subtype: KNOWN_PEERS_CATCHUP_SUBTYPES.request }, { sendOpts: {}, quiet: true });
      return { requested: r.outcomes.filter((o) => !o.error).length };
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
    const r = await carry({ subtype: KNOWN_PEERS_BROADCAST, ...wire });
    return { attempted: r.attempted };
  }
}

/**
 * ONE LANE, THE BINDINGS PER SELF. A device holds several selves; each has its own contacts' bindings and its own siblings
 * (the devices holding that self). Each self has its own sync; this router hands a landing to the self whose PROVEN
 * SIBLING SET the sender is in — the self is bound by who sent it, never by anything the payload says — and refuses a
 * sender that is no self's sibling.
 * @param {object} a
 * @param {ReturnType<typeof createKnownPeersSync>} a.general  the general persona's sync (the one today's callers know)
 * @param {() => Array<ReturnType<typeof createKnownPeersSync>>} a.others  every other held self's sync
 * @param {(reason: string, from: string) => void} [a.onRefused]
 */
export function routeKnownPeersBySender({ general, others, onRefused = null } = {}) {
  if (!general || typeof others !== 'function') throw new Error('routeKnownPeersBySender: `general` and `others` are required');
  const all = () => [general, ...(others() ?? []).filter(Boolean)];
  const owner = async (fromAddr) => { for (const s of all()) { try { if (await s.admits(fromAddr)) return s; } catch { /* next self */ } } return null; };
  const route = (subtype) => async (fromAddr, payload) => {
    if (payload?.subtype !== subtype) return;
    const s = await owner(fromAddr);
    if (!s) { try { onRefused?.('not-a-sibling', fromAddr); } catch { /* observability never throws */ } return; }
    await s.handlers[subtype](fromAddr, payload);
  };
  return {
    subtypes: general.subtypes,
    handlers: Object.fromEntries(Object.keys(general.handlers).map((st) => [st, route(st)])),
    onLanded: (fn) => { const offs = all().map((s) => s.onLanded(fn)); return () => offs.forEach((off) => off?.()); },
    /** A binding a greeting taught this device: the general persona's lane, as before. */
    fanPeer: (binding) => general.fanPeer(binding),
    /** A new sibling at `address`: the self whose sibling it is hands it that self's bindings. */
    pushTo: async (address) => { const s = await owner(address); return s ? s.pushTo(address) : { sent: false, reason: 'not-a-sibling' }; },
    async requestFromSiblings() {
      let requested = 0;
      for (const s of all()) { try { requested += (await s.requestFromSiblings())?.requested ?? 0; } catch { /* next self */ } }
      return { requested };
    },
  };
}
