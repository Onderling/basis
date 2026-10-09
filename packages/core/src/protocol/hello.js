/**
 * hello.js — bidirectional hello / key-exchange protocol.
 *
 * Purpose: let two agents introduce themselves without requiring pre-registration
 * via agent.addPeer(). After sendHello() resolves, the SecurityLayer on both
 * sides has the peer's pubKey registered and encrypted traffic can flow.
 *
 * Protocol:
 *   1. Alice calls sendHello(agent, bobAddress)
 *   2. Sends HI envelope: { pubKey, label?, ack: false }
 *      (HI is signed plaintext — SecurityLayer does not encrypt it)
 *   3. Bob's SecurityLayer auto-registers Alice's pubKey from the HI payload
 *   4. Agent._dispatch calls handleHello(agent, envelope)
 *   5. handleHello emits 'peer' on agent and sends HI back (ack: true)
 *   6. Alice's SecurityLayer receives Bob's HI, auto-registers Bob's pubKey
 *   7. sendHello() resolves (watches for 'peer' event for bobAddress)
 *
 * Both sides can initiate simultaneously without infinite loops because
 * ack:true responses are never re-responded-to.
 */
import { _snapshot } from '../skills/capabilities.js';

/**
 * The peers that hold OUR key in this process — they answered our hello, or we answered theirs. In memory only, so
 * empty at every start: a hello is about THEM knowing US, and knowing THEIR key (which a peer record restores across
 * a restart) says nothing about that. On phones the host agent's security layer is new at every start while the chat
 * agent kept the host's key; skipping the hello on "we know their key" left the host refusing every call as an unknown
 * sender, in silence (2026-10-09).
 * @type {WeakMap<object, Set<string>>}
 */
const acknowledged = new WeakMap();
const ackSet = (agent) => { let s = acknowledged.get(agent); if (!s) { s = new Set(); acknowledged.set(agent, s); } return s; };

/** They may not hold our key any more (a call to them timed out: they may have restarted) — hello again next time. */
export function forgetHello(agent, peerAddress) {
  acknowledged.get(agent)?.delete(peerAddress);
}

/**
 * Send a hello announcement and wait until we hear back.
 *
 * A no-op when the peer acknowledged our key in THIS process and we hold
 * theirs. When we already hold their key, our HI is sent without waiting
 * (their answer marks them); otherwise we wait for their answer.
 *
 * @param {import('../Agent.js').Agent} agent
 * @param {string}  peerAddress
 * @param {number}  [timeout=15000]
 */
export async function sendHello(agent, peerAddress, timeout = 15_000) {
  // They acknowledged our key in this process AND we hold theirs: nothing to do. (Without their key — forgotten since —
  // the hello is how we learn it again; an acknowledgement that lands after a forget must not stand in for it.)
  if (ackSet(agent).has(peerAddress) && agent.security.getPeerKey(peerAddress)) return;
  // We already know THEIR key: tell them ours, without waiting — their answer marks them (`handleHello`), and a peer
  // that is away costs nothing here (the send that follows is sealed to the key we hold, as before).
  if (agent.security.getPeerKey(peerAddress)) {
    try {
      const t = await agent.transportFor(peerAddress);
      await t.sendHello(peerAddress, { pubKey: agent.pubKey, label: agent.label ?? null, ack: false, capabilities: _selfCapabilities(agent) });
    } catch { /* best-effort: the key we hold still seals what follows */ }
    return;
  }

  let timer   = null;
  let handler = null;

  const waitForPeer = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      if (handler) agent.off('peer', handler);
      reject(new Error(`Hello timeout — no response from ${peerAddress}`));
    }, timeout);

    handler = ({ address }) => {
      if (address === peerAddress) {
        clearTimeout(timer);
        agent.off('peer', handler);
        resolve();
      }
    };
    agent.on('peer', handler);
  });
  // Attach a noop catch so a pending rejection (e.g. when sendHello throws
  // before we reach `await waitForPeer`) is not treated as unhandled.
  waitForPeer.catch(() => {});

  try {
    const t = await agent.transportFor(peerAddress);
    await t.sendHello(peerAddress, {
      pubKey:       agent.pubKey,
      label:        agent.label ?? null,
      ack:          false,
      capabilities: _selfCapabilities(agent),
    });
    await waitForPeer;
    ackSet(agent).add(peerAddress);
  } catch (err) {
    clearTimeout(timer);
    if (handler) agent.off('peer', handler);
    throw err;
  }
}

/**
 * Handle an inbound HI envelope. Called by Agent._dispatch.
 *
 * Registers the peer (SecurityLayer already did it from payload.pubKey)
 * and responds with our own HI if this is not itself an ack.
 *
 * @param {import('../Agent.js').Agent} agent
 * @param {object} envelope
 */
export async function handleHello(agent, envelope) {
  const { pubKey, label, ack, capabilities } = envelope.payload ?? {};

  // ── What this gate IS (and is NOT) — the enforcement split, stated ──────────────────────────
  // This is NOT the authorization boundary. WHO may send you messages is enforced where it BINDS no
  // matter what client the other side runs: the roster-authorize port + the seal, on the receive path,
  // on EVERY transport (see security/senderAuthorization.js + the enforceability convention). This
  // hello gate is a FIRST-CONTACT filter on the handshake, and its always-on job is the MUTE-BLOCK drop:
  // a muted/blocked peer's HELLO is dropped HERE, before it registers/acks/emits — the only point that
  // can, because the receive-path gates act on decrypted MESSAGES, not the plaintext HI. It is INACTIVE
  // on transports that do not run the handshake (NKN's addresses are self-authenticating; the relay binds
  // `_from` itself) — that is a transport fact, not a dead gate. (What this gate does NOT yet do: BOUND
  // the RATE of first-contact registrations from unknown senders — a resource/DoS concern distinct from
  // authorization; tracked as a hardening.)
  //
  // Hello gate (Group W): if the agent has installed a gate and it
  // returns false (or throws — fail closed), drop this HI silently:
  //   • don't emit 'peer'
  //   • don't send ack
  //   • undo the SecurityLayer auto-register that happened during
  //     decryptAndVerify — but ONLY if this envelope is what registered them.
  //     Until 2026-08-02 this unregistered unconditionally, on the premise that a
  //     handshake was the only way we could hold their key. The 2026-07-30 roster
  //     fix made that false: a mute could delete a binding proved at join, breaking
  //     verification of that member's past messages and making an unmute require a
  //     fresh handshake. A mute says "I do not want to hear from you"; it does not
  //     say "destroy what you learned about them elsewhere".
  // From the sender's perspective, the hello simply times out.
  const gate = agent.helloGate;
  if (typeof gate === 'function') {
    let accepted = false;
    try {
      accepted = await gate(envelope);
    } catch {
      accepted = false;                    // fail-closed on thrown errors
    }
    if (!accepted) {
      // Falls back to the blunt behaviour only on a SecurityLayer too old to answer — there is no
      // such build in this tree, but the optional-call chain would silently do nothing otherwise.
      if (typeof agent.security?.unregisterPeerIfEstablishedBy === 'function') {
        agent.security.unregisterPeerIfEstablishedBy(envelope._from, envelope._id);
      } else {
        agent.security?.unregisterPeer?.(envelope._from);
      }
      return;
    }
  }

  // Store the peer's advertised capabilities on their PeerGraph record
  // so routing / upgrade logic can consult it without re-querying. Missing
  // field = peer pre-dates the capability protocol; leave record.capabilities
  // untouched (no clobber of anything we learned earlier).
  if (capabilities && typeof capabilities === 'object' && agent.peers?.upsert) {
    await agent.peers.upsert({
      pubKey:       envelope._from,
      capabilities,
    }).catch(() => { /* non-fatal */ });
  }

  // An ack answers our hello: they hold our key now. (An initial HI is answered below with ours.)
  if (ack) ackSet(agent).add(envelope._from);

  // SecurityLayer already registered sender.pubKey when it processed the HI.
  // We emit 'peer' so sendHello() above and application code know about it.
  agent.emit('peer', {
    address:      envelope._from,
    pubKey:       pubKey ?? null,
    label:        label  ?? null,
    ack:          !!ack,
    capabilities: capabilities ?? null,
  });

  // Respond with our own hello if this is the initial (non-ack) announcement.
  if (!ack) {
    const t = await agent.transportFor(envelope._from);
    // The ack names what it answers (`re`). A peer that reciprocates every HI it cannot tie to one of
    // its own (the secure agent does) would otherwise answer this ack with a fresh HI, which we would
    // ack again — a hello storm at round-trip cadence (seen phone↔companion over mDNS, 2026-08-30).
    await t.sendHello(envelope._from, {
      pubKey:       agent.pubKey,
      label:        agent.label ?? null,
      ack:          true,
      capabilities: _selfCapabilities(agent),
    }, { re: envelope._id ?? null }).then(() => { ackSet(agent).add(envelope._from); }).catch(err => agent.emit('error', err));
  }
}

/**
 * Snapshot the agent's currently-enabled capability flags.
 * Keep this small — only things peers need to decide "should I attempt an
 * upgrade / call this skill?" Feature-flag style; fields are opt-in and
 * unrecognised fields must be ignored by older receivers.
 *
 * @param {import('../Agent.js').Agent} agent
 * @returns {object}
 */
function _selfCapabilities(agent) {
  // Delegate to the full capabilities snapshot so every opt-in feature
  // flag (relay, tunnel, oracle, groups, …) travels in the HI payload.
  // Previously this was a reduced set containing only rendezvous +
  // originSig — which meant `tunnel:true` agents looked like
  // `tunnel:false` to anyone who picked caps off the peer graph.
  return _snapshot(agent);
}
