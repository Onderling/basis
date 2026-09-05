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
    peerAddr:   c.pubKey ?? c.peerAddr ?? null,   // native address → DM channel
    url:        null,
    source:     'contact',                       // marks a ContactBook person (vs a discovered peer)
    trustLevel: c.trustLevel ?? null,            // 'bekend' | 'vertrouwd' | null
    tags:       Array.isArray(c.tags) ? c.tags : [],
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
  for (const r of peerRows)  if (r?.contactId) byId.set(r.contactId, r);   // peer wins
  return sortContactRows([...byId.values()]);
}

/**
 * List the contact roster from a PeerGraph. Bots first (the actionable ones for
 * journey A), then by name; deterministic so the screen doesn't reshuffle on
 * every refresh.
 *
 * @param {{ all: () => Promise<object[]> } | null} peerGraph  the agent's `peers`
 * @returns {Promise<Array<object>>}
 */
export async function listContacts(peerGraph) {
  if (!peerGraph || typeof peerGraph.all !== 'function') return [];
  let peers = [];
  try { peers = await peerGraph.all(); } catch { return []; }
  const rows = peers.map(peerToContactRow).filter(Boolean);
  return sortContactRows(rows);
}
