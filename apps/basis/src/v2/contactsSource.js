/**
 * contactsSource — the roster behind the Contacten tab (feedback-extension).
 *
 * Maps the agent's `PeerGraph` records into plain roster rows the contacts
 * screen renders, on BOTH web and mobile (pure: no DOM/RN). A "contact" here is
 * any known peer — a person (native) or a bot/agent (a2a/hybrid). Each row
 * carries what the roster + the DM thread need: a stable id, a display name, the
 * bot flag + skill count (so the registry's commands can be surfaced in that
 * thread), reachability, and the addresses to reach it:
 *   - `peerAddr` (the native pubKey) → the conversational channel over sa.peer
 *     (mdns/relay/nkn) — journey A;
 *   `url` (the A2A base URL) → the HTTP A2A path (skill dispatch) for a
 *     URL-only agent with no peer address.
 */

/** A peer is a bot/agent when it's an A2A/hybrid agent or exposes skills. */
function isBot(peer) {
  if (!peer) return false;
  if (peer.type === 'a2a' || peer.type === 'hybrid') return true;
  return Array.isArray(peer.skills) && peer.skills.length > 0;
}

/** One roster row from a PeerGraph record. */
export function peerToContactRow(peer) {
  if (!peer) return null;
  const contactId = peer.pubKey ?? peer.url;
  if (!contactId) return null;
  return {
    contactId,
    name:       peer.name ?? peer.label ?? contactId,
    isBot:      isBot(peer),
    skillCount: Array.isArray(peer.skills) ? peer.skills.length : 0,
    reachable:  peer.reachable !== false,
    peerAddr:   peer.pubKey ?? null,   // native address → sa.peer conversational channel
    redact:     peer.redact ?? null,   // the contact's declared pre-send floor (see presendFloor.js)
    url:        peer.url ?? null,      // A2A base URL → HTTP task path
  };
}

/**
 * One roster row from a stoop ContactBook entry (S1 #2 — member directory).
 * Stoop's `listContacts` returns MemberMap entries (`relation:'contact'`) with a
 * webid + pubKey + displayName/handle + trustLevel + tags. These are PEOPLE the
 * user added; they merge into the same Contacten roster as the PeerGraph bots.
 *
 * @param {object} c  a stoop ContactBook member entry
 * @returns {object|null}
 */
export function stoopContactToRow(c) {
  if (!c) return null;
  const contactId = c.webid ?? c.pubKey;
  if (!contactId) return null;
  return {
    contactId,
    name:       c.displayName ?? c.handle ?? c.webid ?? contactId,
    isBot:      false,
    skillCount: 0,
    reachable:  c.reachable !== false,
    // WHERE THEY ARE WRITTEN TO: the address the card names (`peerAddr` — the person's profile address, which
    // every device of theirs registers on the relay), and only for a book entry without one the `pubKey` — the
    // mesh-era shape, where a contact's key WAS its address. A card from an ENROLLED device carries that device's
    // own delegation key as `pubKey`, which is no address anywhere; taking it first sent every message to the
    // seeded alpha contact to a key nobody held (2026-09-18: "sealed to the device only", a HI never answered).
    peerAddr:   c.peerAddr ?? c.pubKey ?? null,
    url:        null,
    source:     'contact',                       // marks a ContactBook person (vs a discovered peer)
    trustLevel: c.trustLevel ?? null,            // 'bekend' | 'vertrouwd' | null
    tags:       Array.isArray(c.tags) ? c.tags : [],
    // The pair roster (L105): once it exists the row says "verbonden"; before, nothing.
    pairCircleId: typeof c.pairCircleId === 'string' && c.pairCircleId ? c.pairCircleId : null,
  };
}

/** Bots first, then people; alphabetical within each. Deterministic ordering. */
function sortContactRows(rows) {
  rows.sort((a, b) => {
    if (a.isBot !== b.isBot) return a.isBot ? -1 : 1;     // bots first
    return String(a.name).localeCompare(String(b.name));
  });
  return rows;
}

/**
 * Merge the PeerGraph roster (bots + discovered peers) with the stoop ContactBook
 * (added people), de-duped by `contactId` (the PeerGraph entry wins so a bot's
 * skills survive). One unified Contacten roster — the S1 #2 reconciliation.
 *
 * @param {Array<object>} peerRows   from `listContacts(peerGraph)`
 * @param {Array<object>} stoopRows  from stoop `listContacts` → `stoopContactToRow`
 * @returns {Array<object>}
 */
export function mergeContacts(peerRows = [], stoopRows = []) {
  const byId = new Map();
  for (const r of stoopRows) if (r?.contactId) byId.set(r.contactId, r);
  for (const r of peerRows) {
    if (!r?.contactId) continue;
    // peer wins — but what only the contact book knows (the trust level, the pair roster) rides along, and so
    // does the NAME when the graph has none: a peer row that only knows the address names itself by it, and
    // letting that win renamed the seeded contact to a key the moment a first message put them in the graph
    // (2026-09-19: "Wilfred is gone, a random-string contact instead").
    const book = byId.get(r.contactId);
    const nameless = !r.name || r.name === r.contactId || r.name === r.peerAddr;
    byId.set(r.contactId, book ? {
      ...r,
      ...(nameless && book.name && book.name !== book.contactId ? { name: book.name } : {}),
      ...(book.trustLevel && !r.trustLevel ? { trustLevel: book.trustLevel } : {}),
      ...(book.pairCircleId ? { pairCircleId: book.pairCircleId } : {}),
    } : r);
  }
  return sortContactRows([...byId.values()]);
}

/**
 * List the contact roster from a PeerGraph. Bots first (the actionable ones for
 * journey A), then by name; deterministic so the screen doesn't reshuffle on
 * every refresh.
 *
 * A PER-CIRCLE ADDRESS IS NOT A CONTACT. Every send populates the graph with the address it reached —
 * including a member's per-circle address, which the circle fan reaches constantly — so without this
 * the roster showed a member twice: once as themselves, once as a raw key that is where they are
 * reached in one circle. A direct message to that second row is signed as the person and refused on
 * arrival as a member's canonical key inside a circle (by design), and which of the two rows sorted
 * first depended on the key bytes — the "flaky DM" of 2026-09-10/13 in `two-relays.spec.js` STEP4,
 * seen in the trace as `refused a validly-signed envelope … canonical identity`. The shell hands in
 * the device's own address→person read (`agent.identityOfAddress`, the one place that links a
 * person's per-circle addresses back to one person — Frits, 2026-09-03: a surface that names a person
 * keys on it); an address that resolves to someone else is skipped.
 *
 * @param {{ all: () => Promise<object[]> } | null} peerGraph  the agent's `peers`
 * @param {object} [opts]
 * @param {(address: string) => string|null} [opts.identityOf]  the person behind an address (itself, or null, when it is nobody's alias)
 * @returns {Promise<Array<object>>}
 */
export async function listContacts(peerGraph, { identityOf = null } = {}) {
  if (!peerGraph || typeof peerGraph.all !== 'function') return [];
  let peers = [];
  try { peers = await peerGraph.all(); } catch { return []; }
  const isAlias = (peer) => {
    if (typeof identityOf !== 'function' || typeof peer?.pubKey !== 'string') return false;
    try { const owner = identityOf(peer.pubKey); return typeof owner === 'string' && owner !== '' && owner !== peer.pubKey; }
    catch { return false; }
  };
  const rows = peers.filter((p) => !isAlias(p)).map(peerToContactRow).filter(Boolean);
  return sortContactRows(rows);
}
