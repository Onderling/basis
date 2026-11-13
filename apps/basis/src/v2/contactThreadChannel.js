/**
 * contactThreadChannel — the CLIENT end of a contact/bot peer link
 * (feedback-extension, the platform half of "journey A").
 *
 * made a bot's named skills dispatchable (a slash command → a router). This
 * is the COMPLEMENT: a free-text conversation with a contact-bot in its own DM
 * thread — the participant sends a turn, the bot replies asynchronously, the
 * reply lands back in that thread. It is the client mirror of the feedback
 * repo's `PeerBridge` (which is the bot SIDE of the same link).
 *
 * TRANSPORT-AGNOSTIC by construction: it rides an injected `sendToPeer(addr,
 * payload)` — i.e. `agent.sendPeerMessage` / `sa.peer.sendTo`, which routes
 * through `core` `RoutingStrategy` (priority: internal > local > mdns >
 * rendezvous > relay > nkn > … > a2a). So the same channel reaches the bot over
 * mDNS on a LAN, a WebRTC rendezvous/relay link on the internet, or NKN as the
 * bootstrap/fallback rung — the channel never names a transport. Inbound replies
 * arrive via the shell's existing `makePeerRouter` subtype dispatch.
 *
 * SUBTYPE-INJECTABLE so the platform stays decoupled from any one bot's wire
 * shape (the repo-boundary rule: the platform ships the generic channel; a bot's
 * project wiring — e.g. feedback's `PeerBridge` with `fp-msg`/`fp-reply` — passes
 * its own subtypes). Defaults to the generic `contact-msg`/`contact-reply`.
 *
 * Pure: no DOM, no RN, no transport import — web and mobile share it; each shell
 * injects `sendToPeer` + registers `replyHandler(onReply)` in its peer router.
 */

import { createMessageRequestDoor } from './messageRequestDoor.js';
import { createAddressedDeliver, chatTurnsFromItems } from '@onderling/item-store';
import { cardNamesSender } from './contactCardLink.js';
import { applyPresendFloor } from './presendFloor.js';

/** Generic platform subtypes for a contact-thread turn / reply. */
export const DEFAULT_CONTACT_SUBTYPES = { out: 'contact-msg', in: 'contact-reply' };

/**
 * @param {object} deps
 * @param {(addr: string, payload: object) => any} deps.sendToPeer
 *   the shell's peer send (`agent.sendPeerMessage` / `sa.peer.sendTo`).
 * @param {{ out: string, in: string }} [deps.subtypes]
 *   wire subtypes for outbound turns / inbound replies. Default generic; a bot's
 *   project wiring overrides (e.g. `{ out:'fp-msg', in:'fp-reply' }`).
 * @param {() => number} [deps.now]   clock (injectable for tests).
 * @param {() => string} [deps.genId] message-id factory (injectable for tests).
 * @param {object | (() => object|Promise<object>) | null} [deps.itemStore]
 *   Connectivity Phase 2 (C3): an `{ addItems, listOpen }` store (wireChat's
 *   item-store surface). WHEN WIRED, every turn — outbound (`sendTurn`) and
 *   inbound (`persistInbound`) — is persisted to a durable thread + rehydratable
 *   (`rehydrate`), so the contact/bot DM survives a reload (**the G18 fix**).
 *   Omitted → today's ephemeral behaviour (fully back-compatible). May be a
 *   value / Promise / thunk so a shell can wire a store built asynchronously.
 * @param {(peerAddr: string, threadId: string) => object|null} [deps.floorFor]
 *   the PRE-SEND FLOOR a contact declares (see presendFloor.js): a redaction config, or null. Applied
 *   in `sendTurn` before the turn leaves the device; a turn may also carry its own `floor`.
 * @param {((turn: object) => any) | null} [deps.fanToOwnDevices]
 *   hand a turn to the person's OTHER DEVICES (`contactTurnFan.js`). A DM is addressed to a person
 *   but arrives at one device, so without this the thread reads differently on each of them. Wired
 *   HERE, at the one place every turn in either direction passes, so both shells get it by
 *   construction. Omitted → the turn stays on this device (today's behaviour, and the honest state
 *   for a composition with no peer transport).
 * @param {string | null} [deps.localActor]      my webid (persisted `source.fromWebid`).
 * @param {string | null} [deps.localStableId]
 * @returns {{
 *   sendTurn: (turn: object) => { messageId: string, sent: Promise<any> },
 *   persistInbound: (turn: object) => Promise<{ itemId: string|null }>,
 *   persistOutbound: (turn: object) => Promise<{ itemId: string|null }>,
 *   applyOwnDeviceTurn: (wire: object) => Promise<object>,
 *   rehydrate: (contactId: string) => Promise<Array<object>>,
 *   replyHandler: (onReply: (reply: object) => void) => ((fromAddr: string, payload: object) => void),
 *   messageHandler: (onMessage: (msg: object) => void) => ((fromAddr: string, payload: object) => void),
 *   subtypes: { out: string, in: string },
 * }}
 */
export function createContactThreadChannel({
  sendToPeer,
  // THE PERSON SEAL (2026-09-16): `sealFor(peerAddr, content)` → `{ to, from, sealed, nonce }` or null; `openFor(sealed, fromAddr)` →
  // the content or null. Absent, or null for a contact whose key is unknown, the turn goes as before — sealed to the device only.
  sealFor = null,
  openFor = null,
  subtypes = DEFAULT_CONTACT_SUBTYPES,
  now = () => Date.now(),
  genId,
  itemStore = null,
  localActor = null,
  localStableId = null,
  blobStore = null,
  floorFor = null,
  fanToOwnDevices = null,
  // THIS DEVICE'S SELECTION (sync-policy §11): `holds()` — does this device keep contact turns at all (off: hold
  // nothing, still carry to the siblings); `keepsBytes()` — a received file's bytes in full, or its description.
  selection = null,
  // THE PAIR ROSTER (L105, `pairRoster.js`): `prepare(peerAddr)` says what this turn carries to make the roster
  // (`{ pairInvite }` from the founder, `{ pairRequest }` from the other side, or nothing); `onInvite(fromAddr, uri)` /
  // `onRequest(fromAddr)` land the other side's. Inside the seal when the turn is sealed; a turn with only the
  // roster material and no text is consumed here and never shown.
  pair = null,
  // WHO I AM TO THIS CONTACT: `selfFor(peerAddr)` → `{ webid, displayName?, sendAs, personaId }` for a contact filed
  // under a PERSONA — the turn is authored by and sent as that persona, carries the PERSONA's card (`myCard(personaId)`),
  // is sealed from the persona's person key, and nothing of the default rides along (no linked-bot statement, no fan to
  // the default's devices). Null → the default.
  selfFor = null,
  // THE SENDER BECOMES A CONTACT ROW: `(address) => void`, the shell's peer-graph upsert — what Contacten lists.
  // Called for every inbound turn that lands, whether it arrived directly or CARRIED by one of my own devices.
  // Until 2026-09-18 only the direct handlers did this, so a turn the box took and carried to the web app was
  // stored under a sender the roster had no row for: a thread nobody could open, a message nobody read.
  notePeer = null,
  // THE THREAD KEY IS THE PERSON: `(address) => identity`, the shell's read of who is behind an address (its
  // rosters, its contact book). A sibling may have keyed a thread by the wire address a message came from — the
  // box, by the visitor's person-key address — while this device keys by identity (Frits, 2026-09-03); a carried
  // turn is resolved through it on landing, so every device of the person opens the same thread (2026-09-19).
  identityOf = null,
  // A HIDDEN CONTACT WHO WRITES AGAIN COMES BACK (L106, Frits 2026-09-19: "requiring the other person to text you
  // again to become activated again"). The channel does not know the book: the shell hands in `isHidden(contactId)`
  // and `onReturned(contactId)`. A turn that LANDS from a hidden contact — directly, or carried by my own device —
  // calls `onReturned` once; the shell unhides the row. The turn itself carries `returned: true` from then on
  // (stored, fanned, rehydrated), and the thread's one-line marker is painted from that, on every device. My own
  // outbound turn to someone I hid brings nobody back: that is my act, and Tonen is its word.
  isHidden = null,
  onReturned = null,
  // MY CARD RIDES A MESSAGE WHENEVER THE CONTACT DOES NOT HAVE THIS ONE (2026-09-21; Frits 09-18: "they exchange
  // their cards, and then there is a contact"; 09-21: "aren't card updates fanned out anyway?"). `myCard()` → this
  // person's `onderling-contact://…` card (name, handle, where to write back, the person key), or null. It rides
  // the first message to a contact, the next message after it changed (a name set under Mij), and once per session
  // — inside the seal when there is one. `onCard({ contactId, fromAddr, card })`
  // is called for a card that ARRIVES and names the sender (checked here against the shell's `identityOf`, so a
  // stranger cannot put a name on someone else's address); the shell adds it to the book, and the book carry names
  // the person on every device. Both optional: without them a message carries no name, as before.
  myCard = null,
  onCard = null,
  // A TURN TO A BOT MY IDENTITY IS LINKED TO CARRIES ITS PROOF (`/koppel`): `authFor(peerAddr, {text, messageId})` →
  // a statement from THIS DEVICE over exactly that turn (its delegation key; the root-signed delegation beside it), or
  // null for anyone else — the bot accepts a turn as the person only by it, so a device the person revoked is a
  // stranger there. It rides inside the seal when there is one. Absent: turns carry none, as before.
  authFor = null,
  // A FIRST MESSAGE FROM SOMEONE THE PERSON DID NOT CHOOSE IS A REQUEST (Frits 2026-11-12): `messageRequests` is the
  // agent's door (`agent.messageRequests`: `policy()`, `isKnown(key)`, `hold(turn)`). Each inbound turn is decided BEFORE
  // anything is kept (messageRequestDoor.js): a known sender's turn goes on as below; anyone else's is held on their
  // request and nothing else happens (no card into the book, no pair roster, no thread turn, no receipt). A persona
  // whose policy is 'open' (anyone may write; a bot's by default) lets a stranger's turn go on, within the stranger
  // budgets. Absent: every turn goes on, as before.
  messageRequests = null,
  // `onDoor({ verdict })`: told each door decision that kept a turn from the thread ('held' | 'dropped'), the verdict
  // only, never who or what (a host's walk log counts them). Optional.
  onDoor = null,
  // A RECEIPT ONLY TO SOMEONE THE PERSON KEPT (Frits 2026-11-11): `isKept(contactId)` → true when the person holds a
  // non-hidden row for them in the contact book (the agent's `isKeptContact`, which also follows a contact's other device
  // through the identity link). Kept means accepted: a circle member who wrote first is not kept until the person answers.
  // A receipt is a read and online signal; anyone the shell cannot vouch for gets none. Absent: none.
  isKept = null,
} = {}) {
  const keptNow = async (contactId) => {
    if (typeof isKept !== 'function' || !contactId) return false;
    try { return (await isKept(contactId)) === true; } catch { return false; }
  };
  // the person wrote to them first (an outbound turn of theirs in the thread): chosen, so their answer is never a request
  const wroteTo = async (contactId) => {
    if (!contactId) return false;
    try { return (await rehydrateAll()).some((t) => t.contactId === contactId && t.origin === 'user'); } catch { return false; }
  };
  let requestDoor = null;
  // a circle member's card, held until the person answers them (answering makes the contact)
  const memberCards = new Map();
  const MEMBER_CARDS_MAX = 500;
  /** The person writes to `peerAddr`: a member's held card goes into the book now (their answer is the choice). The
   *  turn waits for it: the send gate asks the book, and an answer judged before the card landed was held as unknown. */
  const adoptMemberCard = (peerAddr) => {
    const id = resolveId(peerAddr);
    const held = memberCards.get(id) ?? memberCards.get(peerAddr);
    if (!held || typeof onCard !== 'function') return null;   // nothing to adopt: the send is not delayed a tick
    memberCards.delete(id); memberCards.delete(peerAddr);
    return Promise.resolve(onCard({ contactId: id, fromAddr: held.fromAddr, card: held.card })).catch(() => {});
  };
  const doorFor = () => (requestDoor ??= createMessageRequestDoor({
    isKnown: (key) => messageRequests.isKnown(key),
    iWrote: wroteTo,
    isMember: (m) => (typeof messageRequests.isMember === 'function' ? messageRequests.isMember(m) : false),
    useLink: typeof messageRequests.useLink === 'function' ? (m) => messageRequests.useLink(m) : null,
    letOnByLink: typeof messageRequests.letOnByLink === 'function' ? (m) => messageRequests.letOnByLink(m) : null,
    hold: (turn) => messageRequests.hold(turn),
    now,
  }));
  /** The policy for first messages of the persona a turn was written to (`to`): 'open' or 'request' (the default). */
  const policyNow = async (to = null) => {
    if (typeof messageRequests?.policy !== 'function') return 'request';
    try { return (await messageRequests.policy(to)) === 'open' ? 'open' : 'request'; } catch { return 'request'; }
  };
  /**
   * Whether a sender is KNOWN to this person (the door's question, without holding anything): asked by the other doors
   * into a contact thread (a file, a threaded answer), which keep nothing from someone the person did not choose.
   * True when there is no door (or it is inactive: a function profile).
   */
  async function knownSender(contactId, fromAddr, to = null) {
    if (await blockedNow(contactId, fromAddr)) return false;   // a block refuses every direct door, first
    if (!messageRequests || typeof messageRequests.isKnown !== 'function') return true;
    if ((await policyNow(to)) === 'open') return true;
    for (const k of [fromAddr, contactId]) {
      try { if (k && (await messageRequests.isKnown(k)) === true) return true; } catch { /* next */ }
    }
    if (await wroteTo(contactId)) return true;
    try { return typeof messageRequests.isMember === 'function' && (await messageRequests.isMember({ contactId, fromAddr, to })) === true; } catch { return false; }
  }
  /** On the person's block list (by either the sender's address or the person behind it)? Asked first, by every direct door. */
  async function blockedNow(contactId, fromAddr) {
    if (typeof messageRequests?.isBlocked !== 'function') return false;
    for (const k of [fromAddr, contactId]) {
      try { if (k && (await messageRequests.isBlocked(k)) === true) return true; } catch { /* next */ }
    }
    return false;
  }
  /** 'known' when this turn goes on; 'held' or 'dropped' when the door kept it from everything else; 'blocked' first. */
  const decideAtDoor = async (m) => {
    if (await blockedNow(m.contactId, m.fromAddr)) return 'blocked';
    if (!messageRequests || typeof messageRequests.hold !== 'function') return 'known';
    return doorFor()({ ...m, policy: await policyNow(m.to ?? null) });
  };
  const hiddenNow = async (contactId) => {
    if (typeof isHidden !== 'function' || !contactId) return false;
    try { return (await isHidden(contactId)) === true; } catch { return false; }
  };
  const returned = async (contactId) => {
    if (typeof onReturned !== 'function' || !contactId) return;
    try { await onReturned(contactId); } catch { /* the row is a convenience; the turn is stored regardless */ }
  };
  // the (contact, self) pairs that had that self's card this session (see `myCard`): a contact switched to another
  // persona hears THAT persona's card on the next turn, not in a next session
  const cardSentTo = new Set();
  const cardKey = (peerAddr, self) => `${peerAddr}|${self?.personaId ?? ''}`;
  const resolveId = (id) => { if (typeof identityOf !== 'function' || !id) return id; try { return identityOf(id) || id; } catch { return id; } };
  const holdsHere = () => (selection && typeof selection.holds === 'function' ? selection.holds('contacts') !== false : true);
  const keepsBytes = () => (selection && typeof selection.keepsBytes === 'function' ? selection.keepsBytes() !== false : true);
  const fileToKeep = (file) => {
    if (!file || typeof file !== 'object') return file;
    if (keepsBytes()) return file;
    const { dataB64, ...description } = file;   // eslint-disable-line no-unused-vars
    return description;
  };
  const mkId = typeof genId === 'function'
    ? genId
    : () => `ct-${now()}-${Math.random().toString(36).slice(2, 8)}`;

  /**
   * Hand a turn to the owner's other devices. Never throws and never delays the caller's own
   * result: a sibling that misses a turn has an incomplete thread, which must not become a failed
   * send or a message this device refuses to store.
   */
  async function fanOwn(turn) {
    if (typeof fanToOwnDevices !== 'function') return;
    if (turn?.direction === 'in') Object.assign(turn, takeHeardAsMessage(turn.fromAddr, turn.messageId));
    try { await fanToOwnDevices(turn); }
    catch (err) {
      if (typeof console !== 'undefined') {
        console.warn(`[contact-turns] could not reach my own devices with this turn: ${err?.message ?? err}`);
      }
    }
  }

  // WHAT A TURN ARRIVED AS, for the carry. A sibling that is the person's primary answers a person's MESSAGE carried
  // to it the way it answers one that came direct — and must never answer a bot's REPLY. The shells land both through
  // `persistInbound` with the same picked fields, so the handler notes here which arrived as a message (and the door's
  // admission code and linked-person proof beside it), and the fan takes the note with the turn. Bounded: a note
  // whose turn never landed ages out.
  const heardAsMessage = new Map();
  let landedHook = null;   // `setLandedHook` — the receipt back to a sender whose turn landed here
  // WHICH CONTACT A TURN OF MINE WENT TO, by message id, this boot (the delivery map that a receipt advances is per boot
  // too). It is what lets the receipt RECEIVER refuse a receipt for my DM from anyone but that contact: a contact turn
  // never reaches the event log with a circle id, so the circle-roster gate has no opinion on it, and without this a
  // stranger who learns the id could paint "their app has it" on my bubble.
  const sentTo = new Map();   // msgId → { contactId, peerAddr }
  const rememberSentTo = (msgId, contactId, peerAddr) => {
    if (typeof msgId !== 'string' || !msgId) return;
    sentTo.set(msgId, { contactId: contactId ?? peerAddr ?? null, peerAddr: peerAddr ?? null });
    if (sentTo.size > 2000) sentTo.delete(sentTo.keys().next().value);   // bounded: the oldest goes
  };
  /** The contact a turn of mine went to, or null (not mine, or not this boot). */
  const contactOfMessage = (msgId) => (typeof msgId === 'string' && sentTo.get(msgId)) || null;
  /**
   * Whether, and inside which circle, a landed turn is answered with a receipt (see the landed hook for the why).
   * `{ send: true }` plainly for a turn from the contact's canonical address; `{ send: true, circleId }` for a per-circle
   * address the pair roster knows; `{ send: false }` for a per-circle address nothing explains.
   */
  const receiptScopeFor = async ({ who, fromAddr }) => {
    if (typeof fromAddr !== 'string' || !fromAddr) return { send: false };
    // Their CANONICAL address: the resolver binds no identity behind it (`identityOfAddress` returns a per-circle alias's
    // person key, and the address itself otherwise). A per-circle address resolves to someone else.
    if (resolveId(fromAddr) === fromAddr) return { send: true, circleId: null };
    let known = null;
    if (pair && typeof pair.rosterAddressesFor === 'function') {
      try { known = await pair.rosterAddressesFor(who); } catch { known = null; }
    }
    if (known?.addresses?.has?.(fromAddr) && typeof known.circleId === 'string') return { send: true, circleId: known.circleId };
    return { send: false };
  };
  const noteHeardAsMessage = (fromAddr, messageId, extra) => {
    if (typeof messageId !== 'string' || !messageId) return;
    heardAsMessage.set(`${fromAddr}\n${messageId}`, extra);
    while (heardAsMessage.size > 200) heardAsMessage.delete(heardAsMessage.keys().next().value);
  };
  const takeHeardAsMessage = (fromAddr, messageId) => {
    const key = `${fromAddr}\n${messageId}`;
    const extra = heardAsMessage.get(key);
    heardAsMessage.delete(key);
    return extra ? { message: true, ...extra } : {};
  };

  // The shared addressed-send core (C3). `sendTurn` now routes through this
  // instead of a bare ephemeral peer-send: it still sends over the injected
  // `sendToPeer`, but ALSO persists the turn (when an itemStore is wired) — the
  // durable half lifted from wireChat. `toWire` reproduces the EXACT legacy
  // contact payload so existing receivers/bots are byte-unaffected; the
  // Envelope's `kind` carries the caller's configured `subtypes.out`.
  const core = createAddressedDeliver({
    // The bytes of a received file go HERE, not into the thread's snapshot item.
    blobStore,
    send:    (addr, payload, sendOpts) => (sendOpts ? sendToPeer(addr, payload, sendOpts) : sendToPeer(addr, payload)),
    toWire:  (env) => buildContactWire(env),
    itemStore,
    localActor,
    localStableId,
  });

  /** Project a canonical Envelope onto the legacy contact wire payload. */
  function buildContactWire(env) {
    const payload = {
      subtype:   env.kind,
      threadId:  env.extras?.threadId,
      text:      env.body ?? '',
      messageId: env.id,
      replyTo:   env.extras?.replyTo,
      ts:        env.ts,
    };
    if (env.extras?.displayName) payload.displayName = env.extras.displayName;
    if (env.extras?.webid)       payload.webid       = env.extras.webid;
    // The pair roster's material rides in the clear only when the turn does (else it is inside the box below).
    if (typeof env.extras?.pairInvite === 'string' && !env.extras?.sealed) payload.pairInvite = env.extras.pairInvite;
    if (env.extras?.pairRequest === true && !env.extras?.sealed) payload.pairRequest = true;
    if (typeof env.extras?.card === 'string' && !env.extras?.sealed) payload.card = env.extras.card;
    if (typeof env.extras?.admission === 'string' && !env.extras?.sealed) payload.admission = env.extras.admission;
    if (env.extras?.auth && typeof env.extras.auth === 'object' && !env.extras?.sealed) payload.auth = env.extras.auth;
    // Sealed to the PERSON: the wire carries the box and no text — a device that holds the profile key but not the
    // person key (a revoked one) receives an envelope it cannot read.
    if (env.extras?.sealed) { payload.sealed = env.extras.sealed; payload.text = ''; }
    return payload;
  }

  /**
   * Send one conversational turn to the contact's bot over the peer transport,
   * AND (when an itemStore is wired) persist it to the durable thread.
   *
   * @param {object} turn
   * @param {string}  turn.peerAddr     the bot's peer address (from the contact record).
   * @param {string}  turn.threadId     the contact-thread id (so the reply routes back here).
   * @param {string}  turn.text         the user's message.
   * @param {string}  [turn.messageId]  caller-supplied id (else generated) — echoed on the reply's `replyTo`.
   * @param {string}  [turn.replyTo]    id of a prior bot message this answers (for IR round-trips).
   * @param {object}  [turn.sender]     `{ displayName?, webid? }` so the bot knows who it's talking to.
   * @param {object|null} [turn.floor]  a pre-send redaction config for THIS turn (else `floorFor` decides).
   * @returns {{ messageId: string, sent: Promise<any>, text: string, redacted: number }}
   *   the (possibly generated) message id + a promise for the SEND-AND-PERSIST
   *   (not the reply, which arrives asynchronously through `replyHandler`), plus the text that
   *   actually left the device (redacted when a floor applied) and how many items the floor took.
   */
  function sendTurn({ peerAddr, threadId, text, messageId, replyTo, sender, floor, admission } = {}) {
    if (!peerAddr) throw new Error('contactThreadChannel.sendTurn: peerAddr is required');
    if (typeof sendToPeer !== 'function') throw new Error('contactThreadChannel: sendToPeer is required');
    // answering a circle member who wrote first is choosing them: their held card goes into the book
    const adopted = adoptMemberCard(peerAddr);
    const id = messageId ?? mkId();
    rememberSentTo(id, threadId, peerAddr);
    // The pre-send floor: what a contact declared is applied HERE, the one place every shell's turn
    // passes, so nothing raw leaves the device for such a contact — and the durable copy below is the
    // redacted one, so the thread remembers what actually went out.
    const cfg = floor !== undefined ? floor : (typeof floorFor === 'function' ? floorFor(peerAddr, threadId) : null);
    const floored = applyPresendFloor(text ?? '', cfg);
    const envelope = {
      id,
      kind:   subtypes.out,
      ts:     now(),
      author: sender?.webid ?? localActor ?? null,
      body:   floored.text,
      extras: {
        threadId,
        threadKey: threadId,     // the LOCAL thread group id (the contact id)
        replyTo,
        ...(sender?.displayName ? { displayName: sender.displayName } : {}),
        ...(sender?.webid       ? { webid: sender.webid }             : {}),
        // A code for a bot's door (from its card), on the first message to it.
        ...(typeof admission === 'string' && admission ? { admission } : {}),
      },
    };
    // The fan rides the SEND's promise, after the turn has actually gone out and been stored — so a
    // sibling is never shown a message that this device failed to send. What it carries is the
    // redacted text, the same bytes the contact received and the same bytes stored here.
    const sent = (async () => {
      if (adopted) await adopted;   // the answer's card is in the book before the gate judges the send
      // a person on the block list gets no direct message from this device: refused with its reason, nothing on the wire
      if (typeof messageRequests?.isBlocked === 'function' && await blockedNow(resolveId(peerAddr), peerAddr)) return { held: false, delivered: false, refused: 'blocked', reason: 'blocked' };
      let self = null;
      if (typeof selfFor === 'function') { try { self = (await selfFor(peerAddr)) ?? null; } catch { self = null; } }
      if (self?.webid) {
        envelope.author = self.webid;
        envelope.extras.webid = self.webid;
        if (self.displayName) envelope.extras.displayName = self.displayName; else delete envelope.extras.displayName;
      }
      // The pair roster: what THIS turn carries to make it (the founder's invite, or the other side's request).
      if (pair && typeof pair.prepare === 'function') {
        try {
          const p = await pair.prepare(peerAddr, { name: sender?.displayName ?? null });
          if (typeof p?.pairInvite === 'string') envelope.extras.pairInvite = p.pairInvite;
          if (p?.pairRequest === true) envelope.extras.pairRequest = true;
        } catch { /* the roster is made on a later turn; the message goes regardless */ }
      }
      // THE ROUTE: a contact with a pair roster is written to at their primary per-circle address there, over the
      // pair circle (as my per-circle address) — never at the profile address once the roster exists.
      let route = null;
      if (pair && typeof pair.routeFor === 'function') { try { route = await pair.routeFor(peerAddr); } catch { route = null; } }
      // My card rides on the FIRST message to this contact each session — the introduction: name, handle, where to
      // write back, the person key — inside the seal when there is one (below), in the clear otherwise. A name
      // changed later travels as my `member-props` on the pair roster's lane, which every device of theirs folds; the
      // card is not re-sent for it (it was, 2026-09-21, for one release, before the lane carried names).
      // A bot my identity is linked to: this device's statement over exactly this turn (after the floor: the words
      // that leave are the words it covers).
      if (typeof authFor === 'function' && !self) {
        try { const a = await authFor(peerAddr, { text: floored.text, messageId: id }); if (a && typeof a === 'object') envelope.extras.auth = a; } catch { /* the turn goes without it: a stranger's there */ }
      }
      let cardOnBoard = null;
      // the card of the self I am to this contact: a persona's own card (`myCard(personaId)`), never the default's
      if (typeof myCard === 'function' && (!self || self.personaId) && !cardSentTo.has(cardKey(peerAddr, self))) {
        try { const c = await myCard(self?.personaId ?? null); if (typeof c === 'string' && c) { envelope.extras.card = c; cardOnBoard = c; } } catch { /* no card, no name — the message goes regardless */ }
      }
      // A SHARED LINK'S TOKEN (L806): the contact came from a link they shared, so the first turn to them carries its
      // one-time token, INSIDE THE SEAL ONLY (never in the clear), and the row drops it once the turn has left.
      let linkToken = null;
      if (typeof messageRequests?.linkTokenFor === 'function' && typeof sealFor === 'function') {
        try { const tk = await messageRequests.linkTokenFor(peerAddr); linkToken = typeof tk === 'string' && tk ? tk : null; } catch { linkToken = null; }
      }
      let tokenSealed = false;
      // Sealed to the PERSON when their current key is known — the wire carries the box, not the text (and the
      // pair roster's material with it: an invite is a join secret).
      // (the seal is the self's: a persona's contact is sealed from the persona's person key — `sealFor` resolves it)
      if (typeof sealFor === 'function') {
        try {
          const content = { text: floored.text, ...(linkToken ? { linkToken } : {}), ...(envelope.extras.pairInvite ? { pairInvite: envelope.extras.pairInvite } : {}), ...(envelope.extras.pairRequest ? { pairRequest: true } : {}), ...(envelope.extras.card ? { card: envelope.extras.card } : {}), ...(envelope.extras.admission ? { admission: envelope.extras.admission } : {}), ...(envelope.extras.auth ? { auth: envelope.extras.auth } : {}) };
          const s = await sealFor(peerAddr, content);
          // Sealed: the code travels inside the box only (it admits whoever holds it), and the turn's proof with it.
          if (s) { envelope.extras.sealed = s; delete envelope.extras.admission; delete envelope.extras.auth; tokenSealed = !!linkToken; }
        } catch { /* unsealed, as before */ }
      }
      const res = await core.deliver(envelope, {
        to: peerAddr,
        ...(route?.to ? { deliverTo: route.to, sendOpts: { circleId: route.circleId } }
          : (self?.sendAs ? { sendOpts: { sendAs: self.sendAs } } : {})),
      });
      if (cardOnBoard) cardSentTo.add(cardKey(peerAddr, self));   // it left (delivered or held): they have it
      if (tokenSealed && !res?.error) { try { await messageRequests.linkTokenSent?.(peerAddr); } catch { /* the next turn carries it again; the door lets the same opener on twice */ } }
      // A resend of a turn already stored has already been fanned once; fanning it again would put a
      // second copy on every sibling's wire for nothing.
      // the fan carries a persona's contact to THAT persona's devices only (the agent's fan is per self)
      if (!res?.deduped) {
        await fanOwn({
          direction: 'out', contactId: threadId, peerAddr, replyTo,
          text: floored.text, messageId: id, ts: envelope.ts,
        });
      }
      return res;
    })();
    return { messageId: id, sent, text: floored.text, redacted: floored.hits.length };
  }

  /**
   * Persist an INBOUND turn (a bot reply or a peer DM) so the thread is durable
   * in BOTH directions (the shell's inbound router forwards to `onReply`/
   * `onMessage` for the live render, and calls this for durability). Dedup is
   * shared with `sendTurn` so a relay-replayed inbound never double-persists.
   *
   * @param {object} turn
   * @param {string}  turn.contactId    the LOCAL thread group id (== the contact).
   * @param {string}  [turn.fromAddr]   the sender's peer address.
   * @param {string}  [turn.text]
   * @param {string}  [turn.messageId]  the sender's msg id (dedup key).
   * @param {Array}   [turn.buttons]
   * @param {string}  [turn.replyTo]
   * @param {number}  [turn.ts]
   * @param {boolean} [turn.viaOwnDevice]  this turn ARRIVED from one of my own devices' fan — store
   *   it, do not send it onward. Without this the two devices would hand the same turn back and
   *   forth: each hand-off looks like a fresh arrival to the other.
   * @returns {Promise<{ itemId: string|null, deduped?: boolean }>}
   */
  async function persistInbound({ contactId, fromAddr, text, messageId, buttons, replyTo, ts, file, viaOwnDevice = false, returned: carriedReturned = false } = {}) {
    // THE TURN THAT BRINGS A HIDDEN CONTACT BACK IS MARKED AS SUCH (L106). Decided where the turn first lands
    // (the contact is hidden here as it arrives), and then carried with the turn — stored, fanned, rehydrated —
    // so every device paints the one-line marker above THIS bubble, whether the row there was unhidden by the
    // turn itself or, moments earlier, by the carried mark. A transient signal here would have raced the mark's
    // own carry (measured 2026-09-19: the box unhid and fanned, the laptop's row was shown before the turn came).
    // THE THREAD IS THE PERSON'S: whatever key the caller hands in — an older shell passing the wire address, a
    // sibling's carry keyed as that device saw it — the turn is stored under the identity behind it, so the one
    // thread a row opens holds every message, whichever address the sender used. Unknown ⇒ the key as given.
    const who = resolveId(contactId || fromAddr);
    const key = who;
    const isReturn = carriedReturned === true || (!viaOwnDevice && await hiddenNow(who));
    const envelope = {
      id:     messageId ?? mkId(),
      kind:   subtypes.in,
      ts:     typeof ts === 'number' ? ts : now(),
      author: fromAddr ?? null,
      body:   text ?? '',
      extras: {
        threadKey: who,
        peerAddr:  fromAddr,
        replyTo,
        ...(Array.isArray(buttons) ? { buttons } : {}),
        // A received peer-wire file (photo, document) — the thread is its durable home; the bytes as this
        // device keeps them (full, or the description only — the file's own choice on Mij / My data).
        ...(file && typeof file === 'object' ? { file: fileToKeep(file) } : {}),
        ...(isReturn ? { returned: true } : {}),
      },
    };
    // Hold nothing, still carry: a device that does not keep contact turns fans the turn (bytes included) to
    // its siblings and stores nothing — the turn is not lost, it lives on the devices that hold the silo.
    const persisted = holdsHere() ? Promise.resolve(core.persistInbound(envelope, { to: fromAddr })) : Promise.resolve({ itemId: null, held: false });
    return persisted.then(async (res) => {
      // A turn that landed makes its sender a row — once; a duplicate was noted when it first landed. The row
      // is the PERSON (the thread's key), not whichever address the message came from.
      if (!res?.deduped && typeof notePeer === 'function' && key) {
        try { await notePeer(key); } catch { /* the row is a convenience; the turn is stored regardless */ }
      }
      // …and a landed turn from a contact the person had hidden brings that contact back (both paths share this):
      // the shell unhides the row. A carried return whose row is already shown here (the mark got here first)
      // still says so, so the roster repaints; the marker is the turn's own.
      if (!res?.deduped && (isReturn || await hiddenNow(who))) await returned(who);
      // Only a turn that actually landed is worth fanning: a duplicate has already been fanned once,
      // and re-fanning it would put a second copy on every sibling's wire for nothing.
      if (!viaOwnDevice && !res?.deduped) {
        await fanOwn({ direction: 'in', contactId: who, fromAddr, text, messageId, replyTo, ts, buttons, file, ...(isReturn ? { returned: true } : {}) });
        // …and the sender hears that it landed, the way a circle member does: the SAME receipt, the same per-person
        // setting (the hook is `makeReceiptSender`'s `onStored`; it decides whether anything goes). Only a turn that
        // came straight from them and carries their id — a carried copy or a duplicate confirms nothing new.
        if (typeof messageId === 'string' && messageId && typeof landedHook === 'function') {
          // The receipt goes back the way the turn came, or not at all. A turn from the contact's CANONICAL address
          // (the address is the identity) is answered plainly. A turn from a PER-CIRCLE address of theirs is answered
          // inside the pair circle — signed as my per-circle self, as a circle receipt is — when that address is on
          // the pair circle's roster (any of their devices, not only the one my router would pick). An unscoped answer
          // to a per-circle address is refused by their authorizer (measured 2026-11-07 on two web apps: "delivered",
          // never applied) AND hands the relay the link canonical-me ↔ their per-circle address, which that address
          // exists to withhold — so a per-circle address no pair roster explains gets NO receipt rather than that.
          const scope = (await keptNow(who)) ? await receiptScopeFor({ who, fromAddr }) : { send: false };
          if (scope.send) {
            try { await landedHook({ msgId: messageId, fromPeerAddr: fromAddr, source: 'receiver', ...(scope.circleId ? { circleId: scope.circleId } : {}) }); } catch { /* best-effort, as the circle's */ }
          }
        }
      }
      return { ...res, ...(isReturn ? { returned: true } : {}) };
    });
  }

  /**
   * Persist an OUTBOUND turn that already went out by another path — a reply to a
   * noticeboard post travels through the chat op, and this records our side of it in
   * the poster's thread so the conversation it starts is visible here too. No send.
   *
   * @param {object} turn
   * @param {string}  turn.contactId    the LOCAL thread group id (== the contact).
   * @param {string}  [turn.peerAddr]   the recipient's peer address.
   * @param {string}  [turn.text]
   * @param {string}  [turn.messageId]  dedup key (else generated).
   * @param {string}  [turn.replyTo]    what this answers (a post id).
   * @param {number}  [turn.ts]
   * @param {boolean} [turn.viaOwnDevice]  arrived from my own device's fan — store, do not re-send.
   * @returns {Promise<{ itemId: string|null, deduped?: boolean }>}
   */
  function persistOutbound({ contactId, peerAddr, text, messageId, replyTo, ts, file, viaOwnDevice = false } = {}) {
    if (!viaOwnDevice) rememberSentTo(messageId, contactId, peerAddr);   // a sent file (the "+") is mine too; a sibling's carry is not this device's send
    const envelope = {
      id:     messageId ?? mkId(),
      kind:   subtypes.out,
      ts:     typeof ts === 'number' ? ts : now(),
      author: localActor ?? null,
      body:   text ?? '',
      // A file this person sent from the thread's "+" (it went out by the send-file op) is kept on our side as a
      // received one is on theirs, so the thread shows what was sent.
      extras: { threadId: contactId, threadKey: contactId, peerAddr, replyTo, ...(file && typeof file === 'object' ? { file: fileToKeep(file) } : {}) },
    };
    const persisted = holdsHere() ? Promise.resolve(core.persistOutbound(envelope, { to: peerAddr ?? contactId })) : Promise.resolve({ itemId: null, held: false });
    return persisted.then(async (res) => {
      if (!viaOwnDevice && !res?.deduped) {
        await fanOwn({ direction: 'out', contactId, peerAddr, text, messageId: envelope.id, replyTo, ts: envelope.ts, ...(file ? { file } : {}) });
      }
      return res;
    });
  }

  /**
   * Land a turn that one of MY OWN DEVICES fanned here (`contactTurnFan.js` verified the sender
   * before calling this). One function rather than a direction branch in each shell: which of the
   * two persist paths a fanned turn takes is this module's business, not a projector's.
   *
   * It answers what the shell needs to PAINT — the thread it belongs to, which side of the
   * conversation it is, and whether it was already known — so the shell adds a bubble or does
   * nothing, and never has to work out either from the wire.
   *
   * @param {object} wire  a turn from the fan (`contactTurnToWire`'s shape)
   * @returns {Promise<{ contactId: string, origin: 'user'|'bot', deduped: boolean, itemId: string|null,
   *   text: string, messageId?: string, replyTo?: string, ts?: number, buttons?: Array, file?: object,
   *   fromAddr?: string }>}
   */
  async function applyOwnDeviceTurn(wire = {}) {
    const { direction, peerAddr, fromAddr, text = '', messageId, replyTo, ts, buttons, file } = wire;
    const contactId = resolveId(wire.contactId);
    const outbound = direction === 'out';
    const res = outbound
      ? await persistOutbound({ contactId, peerAddr, text, messageId, replyTo, ts, file, viaOwnDevice: true })
      : await persistInbound({ contactId, fromAddr, text, messageId, buttons, replyTo, ts, file, viaOwnDevice: true, returned: wire.returned === true });
    return {
      contactId,
      origin:  outbound ? 'user' : 'bot',
      deduped: res?.deduped === true,
      itemId:  res?.itemId ?? null,
      text, messageId, replyTo, ts, buttons, file, fromAddr, peerAddr,
      ...(res?.returned === true ? { returned: true } : {}),
      ...(!outbound && wire.message === true ? { message: true } : {}),
      ...(!outbound && wire.message === true && typeof wire.admission === 'string' ? { admission: wire.admission } : {}),
      ...(!outbound && wire.message === true && wire.auth && typeof wire.auth === 'object' ? { auth: wire.auth } : {}),
    };
  }

  /**
   * Rehydrate a contact's durable thread from the itemStore — the ordered turns
   * (`{ origin:'user'|'bot', text, … }`) the contact-thread UI renders. Empty
   * when no itemStore is wired (ephemeral mode) or the thread has no history.
   *
   * @param {string} contactId
   * @returns {Promise<Array<object>>}
   */
  async function rehydrate(contactId) {
    let store = typeof itemStore === 'function' ? itemStore() : itemStore;
    store = await store;
    if (!store || typeof store.listOpen !== 'function') return [];
    let items = [];
    try { items = await store.listOpen({}); } catch { return []; }
    // Re-attach each file's bytes from the blob store, so a renderer reading `turn.file.dataB64`
    // is unchanged by the fact that the item never held them.
    return core.attachBytes(chatTurnsFromItems(items, { threadKey: contactId }));
  }

  /**
   * Every durable turn of every thread, each with its `contactId` — one read of the store, for what is NEW in
   * Contacten (`contactUnread.js`): per contact, the inbound turns newer than the person last opened that thread.
   * Empty in ephemeral mode. Bytes are not re-attached (a count needs none).
   * @returns {Promise<Array<{contactId: string|null, origin: 'user'|'bot', ts: number, messageId: string}>>}
   */
  async function rehydrateAll() {
    let store = typeof itemStore === 'function' ? itemStore() : itemStore;
    store = await store;
    if (!store || typeof store.listOpen !== 'function') return [];
    let items = [];
    try { items = await store.listOpen({}); } catch { return []; }
    return chatTurnsFromItems(items);
  }

  /**
   * Build a `makePeerRouter`-compatible handler for the inbound reply subtype.
   * Register it under `subtypes.in` in the shell's peer router; it normalises
   * the bot's reply envelope and forwards it to `onReply`.
   *
   * @param {(reply: { fromAddr: string, threadId?: string, text: string, buttons?: object[], replyTo?: string, messageId?: string }) => void} onReply
   * @returns {(fromAddr: string, payload: object) => void}
   */
  function replyHandler(onReply) {
    return makeInboundHandler(subtypes.in, onReply);
  }

  /**
   * Build a `makePeerRouter`-compatible handler for an INBOUND PEER TURN (S1 #3 —
   * peer↔peer DM). A bot answers with `subtypes.in` (`contact-reply`); a PERSON
   * DMs you with the SAME `subtypes.out` (`contact-msg`) they'd send anywhere —
   * peer DM is symmetric. Register this under `subtypes.out` so a peer's message
   * lands in your thread with them (routed by sender address, since their
   * `threadId` is their own view, not yours). Same normalised shape as a reply.
   *
   * @param {(msg: { fromAddr: string, threadId?: string, text: string, buttons?: object[], replyTo?: string, messageId?: string }) => void} onMessage
   * @returns {(fromAddr: string, payload: object) => void}
   */
  function messageHandler(onMessage) {
    return makeInboundHandler(subtypes.out, onMessage);
  }

  /** The founder's answer to a pair request: a turn carrying the invite and no words (consumed, never shown). */
  async function answerPairRequest(peerAddr, threadId, prepared) {
    if (!prepared?.pairInvite) return;
    const envelope = { id: mkId(), kind: subtypes.out, ts: now(), author: localActor, body: '', extras: { threadKey: peerAddr, threadId: threadId ?? peerAddr, peerAddr, pairInvite: prepared.pairInvite } };
    try {
      // to a contact filed under a persona: as that persona, without the default's seal (as `sendTurn`)
      let self = null;
      if (typeof selfFor === 'function') { try { self = (await selfFor(peerAddr)) ?? null; } catch { self = null; } }
      if (self?.webid) envelope.author = self.webid;
      if (typeof sealFor === 'function') { const s = await sealFor(peerAddr, { text: '', pairInvite: prepared.pairInvite }); if (s) envelope.extras.sealed = s; }
      if (self?.sendAs) await sendToPeer(peerAddr, buildContactWire(envelope), { sendAs: self.sendAs });
      else await sendToPeer(peerAddr, buildContactWire(envelope));
    } catch { /* the next turn carries it again */ }
  }

  function makeInboundHandler(subtype, cb) {
    return async function onContactInbound(fromAddr, payload, ctx = {}) {
      if (!payload || payload.subtype !== subtype) return;   // not ours
      if (typeof cb !== 'function') return;
      let text = payload.text ?? '';
      let pairInvite = typeof payload.pairInvite === 'string' ? payload.pairInvite : null;
      let pairRequest = payload.pairRequest === true;
      let card = typeof payload.card === 'string' ? payload.card : null;
      // A code for a bot's door (from its card), riding the first message beside the text.
      let admission = typeof payload.admission === 'string' ? payload.admission : null;
      // A linked person's proof over this turn (their device's statement) — for a bot's door to check, never trusted here.
      let auth = payload.auth && typeof payload.auth === 'object' ? payload.auth : null;
      // a shared link's one-time token: read from INSIDE the seal only (L806)
      let linkToken = null;
      if (payload.sealed && typeof payload.sealed === 'object') {
        // sealed to the person: open with my key for the version it names, or drop — never hand a box up as text
        const content = typeof openFor === 'function' ? await openFor(payload.sealed, fromAddr).catch(() => null) : null;
        if (!content || typeof content.text !== 'string') return;
        text = content.text;
        if (typeof content.pairInvite === 'string') pairInvite = content.pairInvite;
        if (content.pairRequest === true) pairRequest = true;
        if (typeof content.card === 'string') card = content.card;
        if (typeof content.admission === 'string') admission = content.admission;
        if (content.auth && typeof content.auth === 'object') auth = content.auth;
        if (typeof content.linkToken === 'string' && content.linkToken) linkToken = content.linkToken;
      }
      // THE DOOR, before anything is kept: a sender the person did not choose is held as a request, and nothing below
      // runs for them (no card into the book, no pair roster, no thread turn, no receipt)
      if (messageRequests) {
        const verdict = await decideAtDoor({ contactId: resolveId(fromAddr), fromAddr, text, card, messageId: payload.messageId ?? null, ts: Number.isFinite(payload.ts) ? payload.ts : null, to: ctx?.to ?? null, linkToken });
        if (verdict !== 'known' && verdict !== 'member') { try { onDoor?.({ verdict }); } catch { /* a count never breaks a turn */ } return; }
        // a circle member writing first: a thread, but NOT a contact until the person answers. Their card waits for that
        // answer (bounded, in memory: a later turn carries it again); the pair roster is left until they are a contact.
        if (verdict === 'member') {
          if (card) memberCards.set(resolveId(fromAddr), { card, fromAddr });
          while (memberCards.size > MEMBER_CARDS_MAX) memberCards.delete(memberCards.keys().next().value);
          card = null; pairInvite = null; pairRequest = false;
        }
      }
      // The sender's card — taken only when it names the person this message is from (the shell's read of the
      // address); the shell adds it to the book. Never on the thread; the words go on regardless.
      if (card && typeof onCard === 'function') {
        const contactId = resolveId(fromAddr);
        if (cardNamesSender(card, contactId)) { Promise.resolve(onCard({ contactId, fromAddr, card })).catch(() => {}); }
      }
      // The pair roster's material lands on its seam (never on the thread); the turn's words go on as always.
      if (pair) {
        if (pairInvite && typeof pair.onInvite === 'function') { Promise.resolve(pair.onInvite(fromAddr, pairInvite)).catch(() => {}); }
        if (pairRequest && typeof pair.onRequest === 'function') { Promise.resolve(pair.onRequest(fromAddr, { name: payload.displayName ?? null })).then((r) => (r ? answerPairRequest(fromAddr, payload.threadId, r) : null)).catch(() => {}); }
      }
      if (!text && !Array.isArray(payload.buttons) && (pairInvite || pairRequest)) return;   // roster material only: nothing to show
      if (subtype === subtypes.out) noteHeardAsMessage(fromAddr, payload.messageId, { ...(admission ? { admission } : {}), ...(auth ? { auth } : {}) });
      cb({
        fromAddr,
        // THE PERSON behind the sender address — the thread's key (Frits 2026-09-03: threads are keyed by identity).
        // A turn over the pair route arrives from the contact's per-circle address there; keyed by that address it
        // sat in a thread no row opens, since the roster folds the address under the person (measured on two web
        // apps, 2026-09-19: every message after the first was invisible). Unknown ⇒ the address, as before.
        contactId: resolveId(fromAddr),
        threadId:  payload.threadId,
        text,
        buttons:   Array.isArray(payload.buttons) ? payload.buttons : undefined,
        replyTo:   payload.replyTo,
        messageId: payload.messageId,
        ...(admission ? { admission } : {}),
        ...(auth ? { auth } : {}),
      });
    };
  }

  /** What runs when a contact's turn LANDS here (the shells hand it the delivery receipt sender). One; null unsets. */
  function setLandedHook(fn) { landedHook = typeof fn === 'function' ? fn : null; }

  return { sendTurn, persistInbound, persistOutbound, applyOwnDeviceTurn, rehydrate, rehydrateAll, replyHandler, messageHandler, knownSender, setLandedHook, contactOfMessage, subtypes };
}
