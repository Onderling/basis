/**
 * ContactBook — Stoop V2 Phase 24 (2026-05-07).
 *
 * Per-user 1:1 contact graph, layered on top of `MemberMap`.  A
 * contact is a `MemberMap` entry with `relation: 'contact'` and
 * the per-contact flags (trustLevel, tags, shareLocation,
 * allowHopThrough, allowAutomatching).  Group members and contacts
 * coexist in the same `MemberMap` — the `relation` field
 * distinguishes them.
 *
 * Contact lists (collections of contacts) live as separate blobs
 * under `mem://stoop/lists/<listId>.json` and write through the
 * same `CachingDataSource` path the rest of the cache uses.  No
 * extra sync wiring needed.
 *
 * **Substrate candidate** (rule of two — first consumer): when a
 * second app needs trust-graded 1:1 contacts (likely the planned
 * `apps/stoop-hobby` fork), lift this into `@onderling/contacts`.
 * Tracked in `Project Files/Substrates/substrate-candidates.md`.
 *
 * Design choices:
 * - Contacts are **per-WebID**.  Apps that need stableId-keyed
 *   contacts can lookup via `members.resolveByStableId` and pass
 *   the resulting `webid` into ContactBook methods.
 * - `addContact` is upsert-shaped — calling it twice with the same
 *   webid updates fields (trust level promotion, tag changes).
 *   There is no removal (retired 2026-09-22): the row is also the MemberMap entry every kring roster reads for
 *   the person, so dropping it degrades their row in every shared circle; hiding (`setHidden`) is the act.
 * - **Asymmetric.**  `addContact(bob, vertrouwd)` only changes
 *   *my* MemberMap entry for Bob.  Notifying Bob's agent so HE can
 *   choose to reciprocate is Phase 24.6's
 *   `contact-add-request`-envelope flow.  The lib here does the
 *   local mutation; the envelope-send happens in the skill layer.
 * - **Tags are local-only.**  My label `'koor'` for Bob is not
 *   visible to Bob.  Stored on Bob's MemberMap entry in MY map.
 */

import { REVEAL_PRESETS } from '@onderling/agent-registry';

const LISTS_PREFIX = 'mem://stoop/lists/';

const VALID_TRUST = new Set(['bekend', 'vertrouwd']);

/**
 * Generate a list id.  Uses `crypto.randomUUID()` — available on
 * both Node ≥14.17 and modern browsers.  No external deps.
 */
function freshListId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  // Fallback: 16 bytes of randomness, base64url-encoded.
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/**
 * @param {object} args
 * @param {import('@onderling/identity-resolver').MemberMap} args.members
 * @param {{read: Function, write: Function, delete: Function, list: Function}} args.dataSource
 *   The bundle's CachingDataSource (so list-CRUD writes through to
 *   the pod when one is attached).
 */
export function createContactBook({ members, dataSource }) {
  if (!members) throw new TypeError('createContactBook: members (MemberMap) required');
  if (!dataSource) throw new TypeError('createContactBook: dataSource required');

  /* ── Contact CRUD ──────────────────────────────────────────── */

  /**
   * Upsert a contact.  Sets `relation: 'contact'` on their MemberMap
   * entry plus any supplied flags.  Idempotent.
   *
   * @param {object} args
   * @param {string} args.webid                  REQUIRED
   * @param {string} [args.pubKey]
   * @param {string} [args.handle]
   * @param {string} [args.displayName]
   * @param {string} [args.avatarUrl]
   * @param {'bekend'|'vertrouwd'|null} [args.trustLevel]
   * @param {string[]} [args.tags]
   * @param {boolean} [args.shareLocation]
   * @param {boolean} [args.allowHopThrough]
   * @param {boolean} [args.allowAutomatching]
   * @param {string[]} [args.points]   where this person can be found (relay urls) — from their card
   */
  async function addContact(args) {
    if (!args?.webid) throw new TypeError('addContact: webid required');
    const existing = (await members.resolveByWebid(args.webid)) ?? {};
    const merged = {
      ...existing,
      ...args,
      relation: 'contact',
    };
    if (args.trustLevel !== undefined) {
      merged.trustLevel = VALID_TRUST.has(args.trustLevel) ? args.trustLevel : null;
    }
    return members.addMember(merged);
  }

  async function setTrustLevel(webid, level) {
    if (!VALID_TRUST.has(level) && level !== null) {
      throw new TypeError(`setTrustLevel: invalid level '${level}'`);
    }
    const existing = await members.resolveByWebid(webid);
    if (!existing) throw new Error('setTrustLevel: contact not found');
    return members.addMember({ ...existing, relation: 'contact', trustLevel: level });
  }

  /**
   * Hide a contact from sight, or show them again — the row stays either way (L106, 2026-09-19). A re-added
   * card leaves the mark alone (`addContact` merges over the existing row); only this, or a message from them,
   * changes it. `hiddenAt` records the change in both directions, so a device that learns of a newer change
   * from a sibling can tell it is newer.
   *
   * Someone the book does not know yet — a stranger who wrote to me, a row Contacten shows from the peer graph
   * — becomes a contact row by being hidden: the mark has to live where it carries to the person's other
   * devices, and that is here. Their key is their address, the same value the graph keys them by.
   *
   * @param {string} webid
   * @param {boolean} hidden
   */
  /**
   * Hide or show a contact in Contacten — a mark on the book row, never on the roster or the thread. A webid the book
   * does not hold yet (someone who wrote to me and was never added) gets a placeholder row `{ webid, pubKey: webid }`
   * (in this binding a sender's webid IS its chat key), so the mark has a row to sit on; when they write again the
   * shell shows the row, named by the ladder (what they said on the pair roster → the card → the key).
   *
   * `hiddenAt` orders the marks between a person's devices (newest wins on landing) and is each device's own clock —
   * a wall-clock race, stated in the manifest row and accepted until the book is an item type on the log (L97).
   */
  async function setHidden(webid, hidden, hiddenAt = Date.now(), { deleted = false, deletedAt = null } = {}) {
    if (!webid) throw new TypeError('setHidden: webid required');
    if (typeof hidden !== 'boolean') throw new TypeError('setHidden: hidden must be boolean');
    if (!Number.isFinite(hiddenAt)) throw new TypeError('setHidden: hiddenAt must be a time');
    const existing = (await members.resolveByWebid(webid)) ?? { webid, pubKey: webid };
    // A DELETE is a hide that also left the pair circle (L114): `deletedAt` stays on the row after a return, so the
    // returning turn can say "you had deleted this contact". A landing carries the sibling's time.
    const del = Number.isFinite(deletedAt) ? { deletedAt } : (deleted === true && hidden ? { deletedAt: hiddenAt } : {});
    return members.addMember({ ...existing, relation: 'contact', hidden, hiddenAt, ...del });
  }

  /**
   * Change what a contact sees of you (L125): the persona their pair roster carries a release of, and the level
   * that persona discloses to them. `personaAt` orders the change between a person's devices, the newer one wins
   * — the same device-clock preference as `hiddenAt`, stated there. The level is kept when the change names none.
   * Only a contact the book holds: the lens has nothing to sit on for a stranger.
   * @param {string} webid
   * @param {string} persona
   * @param {{revealPreset?: 'handle'|'profile'|'full', personaAt?: number}} [opts]
   */
  async function setPersona(webid, persona, { revealPreset = null, personaAt = Date.now() } = {}) {
    if (!webid) throw new TypeError('setPersona: webid required');
    if (typeof persona !== 'string' || !persona.trim()) throw new TypeError('setPersona: persona required');
    if (revealPreset !== null && !REVEAL_PRESETS.includes(revealPreset)) throw new TypeError(`setPersona: invalid level '${revealPreset}'`);
    if (!Number.isFinite(personaAt)) throw new TypeError('setPersona: personaAt must be a time');
    const existing = await members.resolveByWebid(webid);
    if (!existing) throw new Error('setPersona: contact not found');
    return members.addMember({
      ...existing, relation: 'contact', persona: persona.trim(),
      ...(revealPreset ? { revealPreset } : {}), personaAt,
    });
  }

  async function setTags(webid, tags) {
    if (!Array.isArray(tags)) throw new TypeError('setTags: tags array required');
    const existing = await members.resolveByWebid(webid);
    if (!existing) throw new Error('setTags: contact not found');
    return members.addMember({ ...existing, relation: 'contact', tags: tags.map(String) });
  }

  /**
   * Set one of the per-contact boolean flags.
   *
   * @param {string} webid
   * @param {'shareLocation'|'allowHopThrough'|'allowAutomatching'} flag
   * @param {boolean} value
   */
  async function setFlag(webid, flag, value) {
    const allowed = new Set(['shareLocation', 'allowHopThrough', 'allowAutomatching']);
    if (!allowed.has(flag)) throw new TypeError(`setFlag: invalid flag '${flag}'`);
    if (typeof value !== 'boolean') throw new TypeError('setFlag: value must be boolean');
    const existing = await members.resolveByWebid(webid);
    if (!existing) throw new Error('setFlag: contact not found');
    return members.addMember({ ...existing, relation: 'contact', [flag]: value });
  }

  /** All contacts (entries with `relation: 'contact'`). */
  async function listContacts() {
    const all = await members.list();
    return all.filter(m => m.relation === 'contact');
  }

  /** All contacts whose `tags` array includes `tag`. */
  async function listContactsByTag(tag) {
    const all = await listContacts();
    return all.filter(m => m.tags.includes(tag));
  }

  /** All contacts at trust level `>= minTrust`. */
  async function listContactsByMinTrust(minTrust) {
    if (!VALID_TRUST.has(minTrust)) {
      throw new TypeError(`listContactsByMinTrust: invalid minTrust '${minTrust}'`);
    }
    const all = await listContacts();
    if (minTrust === 'bekend') {
      return all.filter(m => m.trustLevel === 'bekend' || m.trustLevel === 'vertrouwd');
    }
    return all.filter(m => m.trustLevel === 'vertrouwd');
  }

  /* ── Lists ─────────────────────────────────────────────────── */

  /**
   * @typedef {object} ContactList
   * @property {string} listId
   * @property {string} name
   * @property {string[]} contactWebids
   */

  function pathFor(listId) { return `${LISTS_PREFIX}${encodeURIComponent(listId)}.json`; }

  async function saveList(list) {
    await dataSource.write(pathFor(list.listId), JSON.stringify(list));
    return list;
  }

  async function createList(name) {
    if (typeof name !== 'string' || !name.trim()) {
      throw new TypeError('createList: name required');
    }
    const list = {
      listId: freshListId(),
      name:   name.trim(),
      contactWebids: [],
    };
    return saveList(list);
  }

  async function deleteList(listId) {
    if (!listId) throw new TypeError('deleteList: listId required');
    await dataSource.delete(pathFor(listId));
  }

  async function getList(listId) {
    if (!listId) throw new TypeError('getList: listId required');
    const raw = await dataSource.read(pathFor(listId));
    if (raw == null) return null;
    try { return typeof raw === 'string' ? JSON.parse(raw) : raw; }
    catch { return null; }
  }

  async function listLists() {
    const paths = await dataSource.list(LISTS_PREFIX);
    const out = [];
    for (const p of paths) {
      const raw = await dataSource.read(p);
      if (raw == null) continue;
      try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (parsed && parsed.listId) out.push(parsed);
      } catch { /* skip corrupt */ }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async function addToList(listId, webid) {
    const list = await getList(listId);
    if (!list) throw new Error('addToList: list not found');
    if (list.contactWebids.includes(webid)) return list;
    return saveList({
      ...list,
      contactWebids: [...list.contactWebids, webid],
    });
  }

  async function removeFromList(listId, webid) {
    const list = await getList(listId);
    if (!list) throw new Error('removeFromList: list not found');
    return saveList({
      ...list,
      contactWebids: list.contactWebids.filter(w => w !== webid),
    });
  }

  async function renameList(listId, name) {
    const list = await getList(listId);
    if (!list) throw new Error('renameList: list not found');
    if (typeof name !== 'string' || !name.trim()) {
      throw new TypeError('renameList: name required');
    }
    return saveList({ ...list, name: name.trim() });
  }

  return {
    // contact CRUD
    addContact,
    setTrustLevel,
    setHidden,
    setPersona,
    setTags,
    setFlag,
    listContacts,
    listContactsByTag,
    listContactsByMinTrust,
    // lists
    createList,
    deleteList,
    getList,
    listLists,
    addToList,
    removeFromList,
    renameList,
  };
}
