/**
 * addBot — get a bot/contact into the app PeerGraph (feedback-extension).
 *
 * The Contacten roster reads the app-owned PeerGraph; this is how a bot GETS
 * there. Three inputs, each landing a record the unified roster picks up:
 *
 *   - a **`onderling-contact://` contact card** → the C13 FAST rung: routed to stoop's
 *     `addContactFromQr` (asymmetric add, no consent gate — the card's decoding stays in stoop, the
 *     ONE decoder). The card carries the person's `peerAddr`, so their DM thread is deliver-ready
 *     immediately; a `onderling-invite://` in the same box is refused with `code:'circle-invite'` (that is
 *     the VERIFIED rung — the circle-join flow with its consent gate);
 *   - an **https URL** → REUSES core `discoverA2A(coreAgent, url, {peerGraph})`,
 *     which fetches the bot's `/.well-known/agent.json` agent card, upserts an
 *     `a2a` peer (skills become SkillCards → commands), and — if the card
 *     carries `x-onderling.pubKey`+`peerAddr` — transparently upgrades to a native
 *     peer so the conversational channel reaches it over sa.peer (mdns/relay/nkn);
 *   - a **raw peer address** (NKN/pubKey, optionally `addr|Name`) → a manual
 *     `hybrid` upsert, for a peer-only bot with no HTTP card.
 *
 * Pure of any transport/DOM: deps are injected (`discover` = core `discoverA2A`,
 * `coreAgent` = the underlying chat agent `agent.sa.agent`), so web + mobile share
 * it and it's testable with a fake discover.
 */

/** The two stoop URI schemes this decoder tells apart — the URI names the rung (C13). */
export const CONTACT_CARD_PREFIX  = 'onderling-contact://';
export const CIRCLE_INVITE_PREFIX = 'onderling-invite://';

/**
 * @param {object} deps
 * @param {string}  deps.input       an https URL, a peer address (`addr` | `addr|Name`), or a
 *   `onderling-contact://` contact card (the C13 FAST rung — asymmetric add, DM-ready immediately).
 * @param {{ upsert: (rec: object) => Promise<object> }} deps.peerGraph  the app PeerGraph.
 * @param {object}  [deps.coreAgent] the core chat agent (for `discover`); required for URL input.
 * @param {(agent: object, url: string, opts: object) => Promise<object>} [deps.discover]
 *   core `discoverA2A`; required for URL input.
 * @param {(payload: string) => Promise<object>} [deps.addContact]
 *   the shell's stoop dispatch for a contact card — `(payload) => callSkill('stoop',
 *   'addContactFromQr', { payload })`. Required for `onderling-contact://` input. The card's decoding and
 *   the ContactBook write stay in stoop (the ONE decoder); this routes by prefix only.
 * @returns {Promise<object>} the upserted peer record, or the added contact row for a contact card.
 * @throws an Error with `code: 'circle-invite'` when the input is a `onderling-invite://` — that is the
 *   VERIFIED rung (circle-join with its consent gate); the caller sends the user to the join flow
 *   rather than silently adding a "contact" out of a circle invite.
 */
export async function addBotToGraph({ input, peerGraph, coreAgent, discover, addContact } = {}) {
  const s = String(input ?? '').trim();
  if (!s) throw new Error('addBot: empty input');
  if (!peerGraph || typeof peerGraph.upsert !== 'function') {
    throw new Error('addBot: a PeerGraph with upsert() is required');
  }

  // C13 — one decoder, two rungs: the URI names the rung. A contact card takes the FAST rung
  // (asymmetric add, no consent gate — deliver-ready immediately, over the card's peerAddr); a circle
  // invite belongs to the VERIFIED rung and is refused here with a typed error, never half-added.
  if (s.startsWith(CIRCLE_INVITE_PREFIX)) {
    const err = new Error('addBot: a circle invite — use the circle join flow (the verified rung)');
    err.code = 'circle-invite';
    throw err;
  }
  if (s.startsWith(CONTACT_CARD_PREFIX)) {
    if (typeof addContact !== 'function') {
      throw new Error('addBot: an `addContact` (stoop addContactFromQr dispatch) is required for a contact card');
    }
    const res = await addContact(s);
    if (res?.error) {
      const err = new Error(`addBot: contact add failed (${res.error})`);
      err.code = res.error;
      throw err;
    }
    return res?.contact ?? res;
  }

  if (/^https?:\/\//i.test(s)) {
    if (typeof discover !== 'function') throw new Error('addBot: a `discover` (discoverA2A) is required for URL input');
    // discoverA2A upserts into peerGraph itself + returns the record.
    return discover(coreAgent, s, { peerGraph });
  }

  // Raw peer address (NKN/pubKey). Optional `addr|Display Name`.
  const [addr, ...rest] = s.split('|');
  const name = rest.join('|').trim();
  const cleanAddr = addr.trim();
  if (!cleanAddr) throw new Error('addBot: empty address');
  return peerGraph.upsert({ type: 'hybrid', pubKey: cleanAddr, name: name || cleanAddr, reachable: true });
}
