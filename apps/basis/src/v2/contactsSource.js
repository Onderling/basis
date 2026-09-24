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
 * The book's rows out of a `listContacts` reply, WHOLE. The waist answers with both `contacts` (the book's rows as
 * stored) and `items` (the chat projection — id, label, handle, trust, peerAddr, personKey, pairCircleId, and not
 * `persona`, `revealPreset`, `hidden` or `deletedAt`). A programmatic reader wants the rows: reading `items` first
 * made every row look persona-less, and the pair roster founded every pair circle with no release (2026-09-24).
 * `items` is read only when a reply has nothing else.
 */
export function bookRowsOf(reply) {
  if (Array.isArray(reply?.contacts)) return reply.contacts;
  if (Array.isArray(reply?.items)) return reply.items;
  return [];
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
    // Hidden (L106): the person took this contact out of their sight. The row stays — their circles, the thread and
    // the pair roster untouched — Contacten folds it away, and their next message brings them back.
    hidden:     c.hidden === true,
    // …and when the person DELETED them (L114: hidden + the pair circle left) — the return marker reads it
    ...(Number.isFinite(c.deletedAt) ? { deletedAt: c.deletedAt } : {}),
  };
}

/**
 * The roster in two: what Contacten lists, and what it folds away at the bottom ("verborgen (n)"). A bot is never
 * hidden here (a bot is removed, not hidden — a different act with a different word).
 * @param {Array<object>} rows
 * @returns {{ shown: Array<object>, hidden: Array<object> }}
 */
export function splitShownHidden(rows = []) {
  const shown = []; const hidden = [];
  for (const r of rows ?? []) { if (r?.hidden === true && !r.isBot) hidden.push(r); else shown.push(r); }
  return { shown, hidden };
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
      // the hidden mark is the book's alone — a graph row (a greeting, a first message) never un-hides what the person
      // hid — and a row the book knows says so (`source`), which is what makes it hideable at all
      source: 'contact',
      hidden: book.hidden === true,
      ...(Number.isFinite(book.deletedAt) ? { deletedAt: book.deletedAt } : {}),
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
 * I AM NOT MY OWN CONTACT (2026-09-19). The graph also collects the addresses MY OWN DEVICES speak as: the person-key
 * address every device of mine shares (the box greets the phone with it on enrol; the carried turns ride it), the
 * static profile key, a sibling's per-circle address the fan reaches. None resolves to a roster member — a person
 * is not on their own rosters as an alias — so each was a nameless row named by its key, sorted by key bytes.
 * Measured in the feedback walk: the maker's own person address was the FIRST person row on the maker's Contacten,
 * and an answer sent to it went nowhere; Frits' phone: "a random string named contact". The shell hands in what the
 * device knows itself as (`ownAddresses`); an address in that set is skipped.
 *
 * @param {{ all: () => Promise<object[]> } | null} peerGraph  the agent's `peers`
 * @param {object} [opts]
 * @param {(address: string) => string|null} [opts.identityOf]  the person behind an address (itself, or null, when it is nobody's alias)
 * @param {() => (Array<string>|Promise<Array<string>>)} [opts.ownAddresses]  every address this person's devices speak as (person, profile, per-circle)
 * @returns {Promise<Array<object>>}
 */
export async function listContacts(peerGraph, { identityOf = null, ownAddresses = null } = {}) {
  if (!peerGraph || typeof peerGraph.all !== 'function') return [];
  let peers = [];
  try { peers = await peerGraph.all(); } catch { return []; }
  const isAlias = (peer) => {
    if (typeof identityOf !== 'function' || typeof peer?.pubKey !== 'string') return false;
    try { const owner = identityOf(peer.pubKey); return typeof owner === 'string' && owner !== '' && owner !== peer.pubKey; }
    catch { return false; }
  };
  let mine = new Set();
  if (typeof ownAddresses === 'function') { try { mine = new Set(((await ownAddresses()) ?? []).filter((a) => typeof a === 'string' && a)); } catch { mine = new Set(); } }
  const isMe = (peer) => mine.has(peer?.pubKey) || mine.has(peer?.url);
  const rows = peers.filter((p) => !isMe(p) && !isAlias(p)).map(peerToContactRow).filter(Boolean);
  return sortContactRows(rows);
}

/**
 * THE BOOK READS THE ROSTER (2026-09-21). A contact with a pair roster on this device is named by what THEY SAID on
 * it — their `member-props` on the pair circle's membership lane (displayName, then handle), folded on every device
 * like the rest of the roster — and by the card only where the roster says nothing yet (the first exchange, or a
 * contact from before the lane). The card was a name's only road before, so a rename never reached a contact who
 * already had one; the lane is the road now, and this is where the book reads it. Every device of the person is in
 * every pair circle since the siblings follow a circle, so the laptop reads the same roster the box does.
 *
 * A bot is never renamed (its name is the registry's); a roster that cannot be read leaves the row as it was.
 *
 * @param {Array<object>} rows  merged Contacten rows (`pairCircleId` from the book)
 * @param {object} [opts]
 * @param {(circleId: string, webid: string) => Promise<object|null>} [opts.rosterRow]  the folded member row on that circle
 * @returns {Promise<Array<object>>}  the rows, re-sorted on what is painted
 */
export async function nameContactsFromRosters(rows = [], { rosterRow = null } = {}) {
  if (typeof rosterRow !== 'function') return rows;
  const named = await Promise.all(rows.map(async (r) => {
    if (!r || r.isBot || typeof r.pairCircleId !== 'string' || !r.pairCircleId) return r;
    let m = null;
    try { m = await rosterRow(r.pairCircleId, r.contactId); } catch { m = null; }
    const said = m?.said && typeof m.said === 'object' ? m.said : null;
    const name = (typeof said?.displayName === 'string' && said.displayName) ? said.displayName
      : (typeof said?.handle === 'string' && said.handle) ? said.handle : null;
    // …and their FACE, from the release on the pair circle. A contact's picture is a persona attribute they
    // disclosed to THIS pair circle, re-sealed for it — so its presence on the row is already the permission,
    // and it reaches this device exactly the way their name does.
    const face = said?.personaProperties?.profilePicture ?? null;
    if (!name && !face) return r;
    return { ...r, ...(name ? { name, namedBy: 'roster' } : {}), ...(face ? { face } : {}) };
  }));
  return sortContactRows(named);
}

/** The book's rows, through the one row mapper. */
export async function loadBookRows(callSkill) {
  if (typeof callSkill !== 'function') return [];
  try {
    const res = await callSkill('stoop', 'listContacts', {});
    return (Array.isArray(res?.contacts) ? res.contacts : []).map(stoopContactToRow).filter(Boolean);
  } catch { return []; }
}

/**
 * THE CONTACTEN READ, composed once for every shell (web's roster, mobile's Contacten and its share picker): the
 * graph's rows with aliases and my own addresses skipped, the book's rows, merged (the graph wins the row, the book
 * the name and the marks), then named from the pair rosters. A shell hands in its agent and `callSkill` and paints.
 * Each pair roster is read once per call, whatever the number of rows.
 *
 * @param {object} a
 * @param {{ all: () => Promise<object[]> } | null} a.peerGraph
 * @param {object|null} a.agent  `identityOfAddress(addr)` and `ownAddresses()` are read off it when present
 * @param {(app: string, op: string, args?: object) => Promise<any>} a.callSkill
 */
export async function loadContactRoster({ peerGraph = null, agent = null, callSkill = null, names = null } = {}) {
  const [peerRows, bookRows] = await Promise.all([
    listContacts(peerGraph, {
      identityOf: (a) => agent?.identityOfAddress?.(a) ?? null,
      ownAddresses: () => agent?.ownAddresses?.() ?? [],
    }).catch(() => []),
    loadBookRows(callSkill),
  ]);
  const merged = mergeContacts(peerRows, bookRows);
  if (typeof callSkill !== 'function') return withNameMarkers(merged, names);
  const rosters = new Map();   // circleId → the members read (one read per roster per call)
  const rosterRow = async (circleId, webid) => {
    if (!rosters.has(circleId)) rosters.set(circleId, callSkill('stoop', 'listGroupMembers', { groupId: circleId }).then((r) => (Array.isArray(r?.members) ? r.members : [])).catch(() => []));
    return (await rosters.get(circleId)).find((m) => m?.webid === webid) ?? null;
  };
  return withNameMarkers(await nameContactsFromRosters(merged, { rosterRow }), names);
}

/**
 * The two name markers, applied where every shell reads: who cannot be told apart by name, and who has
 * renamed themselves since this device last looked. Both are projections over the rows — nothing on the lane,
 * nothing stored but what this device painted.
 */
async function withNameMarkers(rows, names) {
  if (!names || typeof names.read !== 'function') return markLookalikes(rows);
  let lastSeenNames = {};
  try { lastSeenNames = await names.read(); } catch { lastSeenNames = {}; }
  const marked = markLookalikes(markRenames(rows, { lastSeenNames }));
  try { await names.remember?.(marked); } catch { /* the marker is a courtesy; a failed write costs nothing else */ }
  return marked;
}

/** The key a name collides on: what a person READS, so case and stray space do not make two names different. */
const nameKey = (name) => String(name ?? '').trim().toLowerCase();

/**
 * TELLING TWO CONTACTS APART (2026-09-23). Since the book reads the roster a contact is named by
 * what THEY said on the pair roster — so a contact can take the name of another of your contacts, and Contacten
 * would show two identical rows with the thread opening under the name.
 *
 * When two or more SHOWN rows read the same, each of them carries `lookalike`: their handle, or the last four of
 * their key when they have none. EVERY row of the set is marked, never just the newcomer — a person cannot guess
 * which one moved, and marking one implies the other is "the real one", which this device cannot know. A bot is
 * left alone: its name is the registry's, not a claim someone made about themselves.
 *
 * @param {Array<object>} rows  merged Contacten rows
 * @returns {Array<object>}     the same rows; colliding ones carry `lookalike`
 */
export function markLookalikes(rows = []) {
  const counts = new Map();
  for (const r of rows) {
    if (!r || r.isBot || r.hidden === true) continue;          // hidden rows are not on screen: they collide with nobody
    const k = nameKey(r.name);
    if (!k) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return rows.map((r) => {
    if (!r || r.isBot || r.hidden === true) return r;
    const k = nameKey(r.name);
    if (!k || (counts.get(k) ?? 0) < 2) return r;
    const tell = (typeof r.handle === 'string' && r.handle) ? r.handle : String(r.contactId ?? '').slice(-4);
    return tell ? { ...r, lookalike: tell } : r;
  });
}

/**
 * A CONTACT WHO RENAMED THEMSELVES. A rename arrives from the roster with no announcement: a row simply
 * reads differently the next time you look. So a row whose lane-borne name differs from the one this device last
 * PAINTED carries `wasName` — the old one — until the thread is opened (the same per-device mark the unread count
 * keeps). A first sighting is not a rename.
 *
 * @param {Array<object>} rows
 * @param {{lastSeenNames?: Object<string, {name: string}>}} [opts]
 */
export function markRenames(rows = [], { lastSeenNames = {} } = {}) {
  return rows.map((r) => {
    if (!r || r.isBot) return r;
    const was = lastSeenNames?.[r.contactId]?.name;
    if (typeof was !== 'string' || !was) return r;              // never seen here: nothing to have changed
    if (nameKey(was) === nameKey(r.name)) return r;
    return { ...r, wasName: was };
  });
}

/** Where the last-painted names live (device-local, like the seen-marks: `cc.contactNames`). */
export const CONTACT_NAMES_KEY = 'cc.contactNames';

/**
 * The per-device memory of what each contact's row LAST READ — the left-hand side of `markRenames`. Duck-typed
 * io (`localStorage` on web, AsyncStorage on mobile), exactly like `makeContactSeenStore`.
 */
export function makeContactNameStore(io) {
  async function read() {
    try {
      const raw = await io.getItem(CONTACT_NAMES_KEY);
      const v = raw ? JSON.parse(raw) : {};
      return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
    } catch { return {}; }
  }
  async function write(map) {
    try { await io.setItem(CONTACT_NAMES_KEY, JSON.stringify(map)); } catch { /* quota / disabled: the marker simply does not show */ }
  }
  return {
    read,
    /** Remember the names as painted — for rows that carry NO rename marker (a marked row is not "seen" yet). */
    async remember(rows = []) {
      const map = await read();
      let changed = false;
      for (const r of rows) {
        if (!r || r.isBot || typeof r.contactId !== 'string' || !r.contactId) continue;
        if (r.wasName) continue;                                 // still to be acknowledged — keep the old name
        const name = typeof r.name === 'string' ? r.name : '';
        if (!name || map[r.contactId]?.name === name) continue;
        map[r.contactId] = { name, at: Date.now() };
        changed = true;
      }
      if (changed) await write(map);
    },
    /** The thread was opened: this name is now the one this device knows. */
    async seen(contactId, name) {
      if (typeof contactId !== 'string' || !contactId || typeof name !== 'string' || !name) return;
      const map = await read();
      map[contactId] = { name, at: Date.now() };
      await write(map);
    },
  };
}

