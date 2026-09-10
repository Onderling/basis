/**
 * contactTurnFan — a contact-thread turn reaches the person's OWN OTHER DEVICES.
 *
 * A direct message is addressed to a PERSON, but it arrives at ONE DEVICE. The contact card carries
 * the profile's chat address, which every device of the profile derives from the same seed, and a
 * relay maps one address to one socket — so whichever device registered last receives the message
 * and the others never learn it happened. That is the gap this closes: the device that received a
 * turn (or sent one) hands it to its siblings, so the thread reads the same everywhere.
 *
 * It is deliberately the SAME shape as the grants lane's fan, and reuses its sibling set
 * (`siblingDeviceAddresses`): a sibling is reached exactly where a circle peer would be reached, at
 * its proven per-circle address, over hold-forward so a sleeping device gets it on reconnect. No new
 * address class, no new transport.
 *
 * ── Why an ADDRESS is enough of a gate here ──────────────────────────────────────────────────────
 * The grants lane signs its statements because a grant must stay verifiable after it has been
 * stored, re-fanned and folded — it outlives the hop it travelled. A turn travels exactly one hop,
 * device to sibling, so the envelope's own signature is the whole proof, and the security layer has
 * already checked it before this handler runs: an inbound envelope must carry the key that signed
 * it, that signature must verify against exactly that key, and the key must be the one already bound
 * to the sender's address (an unbound address is refused outright unless it is a first-contact
 * greeting). A per-circle address IS its signing key. So "this came from one of my own device
 * addresses" is a cryptographic statement, not a hint — and the profile address itself qualifies,
 * because only devices grown from the owner's seed can sign as it.
 *
 * What this does NOT do, said plainly: there is no pull to reconcile a device that was off longer
 * than the relay holds. The fan is hold-forward and that is the whole durability story here.
 *
 * Pure — no DOM, no RN, no transport import. Web and mobile share it; each shell injects its send,
 * its sibling lookup and what to do with a landed turn.
 */

/** The wire subtype for a turn fanned to the owner's own devices. */
export const CONTACT_TURN_BROADCAST = 'device-contact-turn';

/** A turn's direction as the ORIGINATING device saw it: one it received, or one it sent. */
export const TURN_DIRECTIONS = Object.freeze({ in: 'in', out: 'out' });

/**
 * Strip a file down to what may cross the fan: its description, never its bytes.
 *
 * A received photo's bytes live in the receiving device's blob store, keyed by the file id; they are
 * already kept out of the durable thread item for the same reason they are kept out of here. A
 * sibling therefore learns that a file arrived and what it is, and opens it on the device that holds
 * it. Carrying the bytes would put a photo on the fan for every device the person owns; dropping the
 * turn entirely would lose the message, which is worse than a card you cannot open yet.
 */
function fileDescription(file) {
  if (!file || typeof file !== 'object') return undefined;
  const { dataB64, ...rest } = file;   // eslint-disable-line no-unused-vars
  return rest;
}

/**
 * Project a turn onto the fan wire. Only the fields a sibling needs to reproduce the turn in its own
 * thread — the local presentation the originating device chose is its own business.
 *
 * @param {object} turn
 * @param {'in'|'out'} turn.direction  as the originating device saw it
 * @param {string} turn.contactId      the thread group id — the other party's address, so it is the
 *   SAME id on every device of the profile (threads are keyed by the person, not by a local handle)
 * @returns {object|null} the wire turn, or null when it carries nothing a sibling could use
 */
export function contactTurnToWire(turn) {
  const direction = turn?.direction === TURN_DIRECTIONS.out ? TURN_DIRECTIONS.out : TURN_DIRECTIONS.in;
  const contactId = typeof turn?.contactId === 'string' && turn.contactId ? turn.contactId : null;
  if (!contactId) return null;
  const file = fileDescription(turn.file);
  const text = typeof turn.text === 'string' ? turn.text : '';
  // A turn with neither words nor a file is nothing to show; the sibling would render an empty bubble.
  if (!text && !file) return null;
  return {
    direction,
    contactId,
    text,
    ...(typeof turn.messageId === 'string' && turn.messageId ? { messageId: turn.messageId } : {}),
    ...(typeof turn.peerAddr === 'string' && turn.peerAddr ? { peerAddr: turn.peerAddr } : {}),
    ...(typeof turn.fromAddr === 'string' && turn.fromAddr ? { fromAddr: turn.fromAddr } : {}),
    ...(typeof turn.replyTo === 'string' && turn.replyTo ? { replyTo: turn.replyTo } : {}),
    ...(typeof turn.ts === 'number' ? { ts: turn.ts } : {}),
    ...(Array.isArray(turn.buttons) ? { buttons: turn.buttons } : {}),
    ...(file ? { file } : {}),
  };
}

/**
 * The live fan: hand a turn to every sibling device. Best-effort and REPORTING — a failed hand-off
 * says so in the log, because nothing else will notice a thread that quietly stopped agreeing.
 *
 * @param {object} a
 * @param {() => Promise<string[]>} a.siblings   the owner's other device addresses
 * @param {(addr: string, payload: object) => any} a.sendToPeer  hold-forward send
 * @returns {(turn: object) => Promise<{ attempted: number }>}
 */
export function makeContactTurnFan({ siblings, sendToPeer }) {
  if (typeof siblings !== 'function') throw new Error('makeContactTurnFan: a `siblings` lookup is required');
  if (typeof sendToPeer !== 'function') throw new Error('makeContactTurnFan: `sendToPeer` is required');
  return async function fanContactTurn(turn) {
    const wire = contactTurnToWire(turn);
    if (!wire) return { attempted: 0 };
    let addrs = [];
    try { addrs = (await siblings()) ?? []; } catch { addrs = []; }
    await Promise.all(addrs.map(async (addr) => {
      try { await sendToPeer(addr, { subtype: CONTACT_TURN_BROADCAST, turn: wire }); }
      catch (err) {
        console.warn(`[contact-turns] fan to own device failed — that device's thread will be missing this turn: ${err?.message ?? err}`);
      }
    }));
    return { attempted: addrs.length };
  };
}

/**
 * Peer handler for a fanned turn: the sibling gate, then the shell's apply.
 *
 * The gate admits exactly two senders, and both are proofs of key-holding (see the header): the
 * profile address itself — what a device sends as when it speaks as the person — and any address in
 * the owner's own proven sibling set. Everything else is dropped without a trace, the way every
 * other lane's ingest drops what it cannot bind.
 *
 * @param {object} a
 * @param {() => Promise<string[]>} a.siblings
 * @param {string} a.selfPubKey   the profile's chat pubKey
 * @param {(turn: object, ctx: { fromAddr: string }) => any} a.applyTurn
 *   what the shell does with a landed turn: persist it in the thread and paint it if that thread is
 *   open. The same two things the shell already does for a turn that arrived directly.
 * @param {(reason: string, fromAddr: string) => void} [a.onRefused]  observability seam (tests/logging)
 * @returns {(fromAddr: string, payload: object) => Promise<void>}
 */
export function makeContactTurnPeerHandler({ siblings, selfPubKey, applyTurn, onRefused = null } = {}) {
  if (typeof siblings !== 'function') throw new Error('makeContactTurnPeerHandler: a `siblings` lookup is required');
  if (typeof selfPubKey !== 'string' || !selfPubKey) throw new Error('makeContactTurnPeerHandler: selfPubKey required');
  if (typeof applyTurn !== 'function') throw new Error('makeContactTurnPeerHandler: `applyTurn` is required');
  const refuse = (reason, fromAddr) => { try { onRefused?.(reason, fromAddr); } catch { /* observability never throws */ } };

  return async function onOwnDeviceContactTurn(fromAddr, payload) {
    if (!payload || payload.subtype !== CONTACT_TURN_BROADCAST) return;   // not ours
    const wire = contactTurnToWire(payload.turn);
    if (!wire) { refuse('malformed', fromAddr); return; }
    if (fromAddr !== selfPubKey) {
      let addrs = [];
      try { addrs = (await siblings()) ?? []; } catch { refuse('siblings-unavailable', fromAddr); return; }
      if (!addrs.includes(fromAddr)) { refuse('not-a-sibling', fromAddr); return; }
    }
    try { await applyTurn(wire, { fromAddr }); } catch { /* a landed turn never throws into the router */ }
  };
}
