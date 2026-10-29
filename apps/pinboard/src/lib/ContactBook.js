/**
 * ContactBook — the person's 1:1 contacts, as `contact` rows on their OWN-DEVICES store.
 *
 * One row per (self, contact): the self is the persona a contact is filed under (the one whose release their pair
 * roster carries, `persona` on the row; none recorded reads as the general persona), the row's id is
 * `<selfId>:<webid>`, and it is written AS that self, so it rides that self's own-devices lane only and reaches only
 * the devices that hold that self. No row names another self. Re-filing a contact under another self is the old self's
 * row deleted (the delete rides the old self's lane: its devices drop it) and a new row written as the new self.
 *
 * The row's field-sets that a person's devices change independently (the hidden mark, the persona and level, the
 * identity link, the delete mark) merge per set by their own times between the devices (the contact type's
 * `field-clock` declaration in `@onderling/item-types`); the rest of a row is last-writer-wins.
 *
 * Design choices kept from the MemberMap book it replaces:
 * - Contacts are per-WebID; `addContact` is upsert-shaped (a second add updates fields).
 * - No removal on the person's word: hiding (`setHidden`) is the act.
 * - Asymmetric and local-only: my trust level and my tags for Bob are mine; Bob is not told.
 *
 * The host injects the store and which self a row is written as; standalone (tests) both default to an in-memory store
 * and one self.
 */

import { REVEAL_PRESETS } from '@onderling/agent-registry';
import { isKnownRole } from '@onderling/core';
import { isChannel, channelOfWebid } from '@onderling/item-types';

const VALID_TRUST = new Set(['bekend', 'vertrouwd']);
const TYPE = 'contact';

/** The fields a contact row keeps — named here or dropped (the MemberMap whitelist's lesson). */
const FIELDS = Object.freeze([
  'webid', 'handle', 'displayName', 'avatarUrl', 'persona', 'revealPreset', 'personaAt', 'deletedAt', 'stableId',
  'pubKey', 'peerAddr', 'points', 'serves', 'bot', 'linkedRow', 'linkedRoot', 'linkedAt', 'personKey', 'pairCircleId',
  'channel', 'role', 'trustLevel', 'tags', 'shareLocation', 'allowAutomatching', 'hidden', 'hiddenAt', 'label',
  'externalIds',
]);

/** A row as the book reads it: every field present, defaults as the MemberMap book gave them. */
function normalise(r = {}) {
  return {
    webid:        r.webid,
    handle:       r.handle ?? null,
    displayName:  r.displayName ?? null,
    avatarUrl:    r.avatarUrl ?? null,
    persona:      r.persona ?? null,
    revealPreset: typeof r.revealPreset === 'string' ? r.revealPreset : null,
    personaAt:    Number.isFinite(r.personaAt) ? r.personaAt : null,
    deletedAt:    Number.isFinite(r.deletedAt) ? r.deletedAt : null,
    stableId:     r.stableId ?? null,
    pubKey:       r.pubKey ?? null,
    peerAddr:     r.peerAddr ?? null,
    points:       Array.isArray(r.points) ? r.points : [],
    serves:       r.serves ?? null,
    bot:          r.bot === true,
    linkedRow:    r.linkedRow ?? null,
    linkedRoot:   r.linkedRoot ?? null,
    linkedAt:     Number.isFinite(r.linkedAt) ? r.linkedAt : null,
    personKey:    r.personKey ?? null,
    pairCircleId: r.pairCircleId ?? null,
    channel:      r.channel ?? null,
    role:         r.role ?? null,
    trustLevel:   VALID_TRUST.has(r.trustLevel) ? r.trustLevel : null,
    tags:         Array.isArray(r.tags) ? r.tags.map(String) : [],
    shareLocation:     r.shareLocation === true,
    allowAutomatching: r.allowAutomatching !== false,
    hidden:       r.hidden === true,
    hiddenAt:     Number.isFinite(r.hiddenAt) ? r.hiddenAt : null,
    label:        r.label ?? null,
    externalIds:  r.externalIds ?? null,
    relation:     'contact',
  };
}

const pick = (o) => Object.fromEntries(FIELDS.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

/**
 * @param {object} [args]
 * @param {() => Promise<{put: Function, get: Function, delete: Function, listByType: Function}>} [args.store]
 *   the own-devices store (the host's); in memory when absent
 * @param {(persona: string|null) => ({id: string, writer: string}|null)} [args.selfFor]
 *   which self a row filed under `persona` is written as: its id (the row id's prefix) and its webid (`createdBy`);
 *   null when this device does not hold that self
 */
export function createContactBook({ store = null, selfFor = null } = {}) {
  let memory = null;
  const getStore = async () => {
    if (typeof store === 'function') return store();
    if (!memory) {
      const { createCircleStores, memoryDataSource } = await import('@onderling/item-store');
      memory = createCircleStores({ dataSource: memoryDataSource(), rootPrefix: 'mem://own/' }).getStore('own-devices');
    }
    return memory;
  };
  const self = (persona) => (typeof selfFor === 'function' ? selfFor(persona) : { id: 'default', writer: 'me' });
  const idOf = (selfId, webid) => `${selfId}:${webid}`;

  /** The row a webid is filed under here (a contact is filed under one self at a time), raw. */
  async function rowOf(webid) {
    const st = await getStore();
    const rows = ((await st.listByType?.(TYPE)) ?? []).filter((r) => r?.webid === webid);
    if (rows.length <= 1) return rows[0] ?? null;
    // two selves holding one person (a re-file whose delete has not landed yet): the newest filing is the one
    return rows.sort((a, b) => (b.personaAt ?? 0) - (a.personaAt ?? 0))[0];
  }
  const read = async (webid) => { const r = await rowOf(webid); return r ? normalise(r) : null; };

  /** Write `fields` as the row of `webid`, under the self its persona names; a change of self is a re-file. */
  async function write(webid, fields) {
    const st = await getStore();
    const before = await rowOf(webid);
    // a null clears the field: the row keeps no null (the type's fields are typed; an absent field is the cleared one,
    // which the field-clock merge carries as such)
    const next = Object.fromEntries(Object.entries({ ...(before ? pick(before) : {}), ...pick(fields), webid }).filter(([, v]) => v !== null));
    const to = self(next.persona ?? null);
    if (!to) throw new Error(`contacts: no self here for persona ${next.persona}`);
    const id = idOf(to.id, webid);
    if (before && before.id !== id) await st.delete(before.id);   // re-filed: the old self's row goes, on its lane
    const kept = before && before.id === id ? { createdAt: before.createdAt, createdBy: before.createdBy } : {};
    const row = await st.put({ ...kept, type: TYPE, id, ...next }, { by: to.writer });
    return normalise(row);
  }

  // ONE WRITE AT A TIME PER CONTACT (each reads the row the one before it wrote)
  const turns = new Map();
  const inTurn = (fn) => (webid, ...rest) => {
    const key = typeof webid === 'object' && webid ? webid.webid : webid;
    const prev = turns.get(key) ?? Promise.resolve();
    const run = prev.catch(() => {}).then(() => fn(webid, ...rest));
    const settled = run.catch(() => {});
    turns.set(key, settled);
    settled.then(() => { if (turns.get(key) === settled) turns.delete(key); });
    return run;
  };

  /**
   * Upsert a contact. A person admitted through a keyless door is ONE row, keyed by their door-shaped webid; a re-add
   * that does not name the door or the role keeps them.
   */
  async function addContact(args) {
    if (!args?.webid) throw new TypeError('addContact: webid required');
    if (args.channel !== undefined && args.channel !== null && !isChannel(args.channel)) {
      throw new TypeError(`addContact: unknown channel '${args.channel}'`);
    }
    if (args.role !== undefined && args.role !== null && !isKnownRole(args.role)) {
      throw new TypeError(`addContact: unknown role '${args.role}'`);
    }
    const fields = { ...args };
    if (args.trustLevel !== undefined) fields.trustLevel = VALID_TRUST.has(args.trustLevel) ? args.trustLevel : null;
    return write(args.webid, fields);
  }

  async function setTrustLevel(webid, level) {
    if (!VALID_TRUST.has(level) && level !== null) throw new TypeError(`setTrustLevel: invalid level '${level}'`);
    if (!(await rowOf(webid))) throw new Error('setTrustLevel: contact not found');
    return write(webid, { trustLevel: level });
  }

  /**
   * Hide or show a contact in Contacten — a mark on the book row, never on the roster or the thread. A webid the book
   * does not hold yet gets a placeholder row (`{ webid, pubKey: webid }`; a door-shaped webid names its door instead and
   * stays keyless). `hiddenAt` orders the marks between a person's devices (the field-clock merge, newest wins).
   */
  async function setHidden(webid, hidden, hiddenAt = Date.now(), { deleted = false, deletedAt = null } = {}) {
    if (!webid) throw new TypeError('setHidden: webid required');
    if (typeof hidden !== 'boolean') throw new TypeError('setHidden: hidden must be boolean');
    if (!Number.isFinite(hiddenAt)) throw new TypeError('setHidden: hiddenAt must be a time');
    const door = channelOfWebid(webid);
    const placeholder = (await rowOf(webid)) ? {} : (door ? { channel: door } : { pubKey: webid });
    // a DELETE is a hide that also left the pair circle: `deletedAt` stays on the row after a return
    const del = Number.isFinite(deletedAt) ? { deletedAt } : (deleted === true && hidden ? { deletedAt: hiddenAt } : {});
    return write(webid, { ...placeholder, hidden, hiddenAt, ...del });
  }

  /**
   * Change what a contact sees of you: the persona their pair roster carries a release of, and the level it discloses
   * to them. A change of persona RE-FILES the contact under that persona's self (its row moves to that self's lane).
   */
  async function setPersona(webid, persona, { revealPreset = null, personaAt = Date.now() } = {}) {
    if (!webid) throw new TypeError('setPersona: webid required');
    if (typeof persona !== 'string' || !persona.trim()) throw new TypeError('setPersona: persona required');
    if (revealPreset !== null && !REVEAL_PRESETS.includes(revealPreset)) throw new TypeError(`setPersona: invalid level '${revealPreset}'`);
    if (!Number.isFinite(personaAt)) throw new TypeError('setPersona: personaAt must be a time');
    if (!(await rowOf(webid))) throw new Error('setPersona: contact not found');
    return write(webid, { persona: persona.trim(), ...(revealPreset ? { revealPreset } : {}), personaAt });
  }

  async function setTags(webid, tags) {
    if (!Array.isArray(tags)) throw new TypeError('setTags: tags array required');
    if (!(await rowOf(webid))) throw new Error('setTags: contact not found');
    return write(webid, { tags: tags.map(String) });
  }

  /** Set one of the per-contact boolean flags. */
  async function setFlag(webid, flag, value) {
    const allowed = new Set(['shareLocation', 'allowAutomatching']);
    if (!allowed.has(flag)) throw new TypeError(`setFlag: invalid flag '${flag}'`);
    if (typeof value !== 'boolean') throw new TypeError('setFlag: value must be boolean');
    if (!(await rowOf(webid))) throw new Error('setFlag: contact not found');
    return write(webid, { [flag]: value });
  }

  /** Every contact this device holds, one per webid. */
  async function listContacts() {
    const st = await getStore();
    const byWebid = new Map();
    for (const r of (await st.listByType?.(TYPE)) ?? []) {
      if (!r?.webid) continue;
      const prev = byWebid.get(r.webid);
      if (!prev || (r.personaAt ?? 0) > (prev.personaAt ?? 0)) byWebid.set(r.webid, r);
    }
    return [...byWebid.values()].map(normalise);
  }

  async function listContactsByTag(tag) {
    return (await listContacts()).filter((m) => m.tags.includes(tag));
  }

  async function listContactsByMinTrust(minTrust) {
    if (!VALID_TRUST.has(minTrust)) throw new TypeError(`listContactsByMinTrust: invalid minTrust '${minTrust}'`);
    const all = await listContacts();
    if (minTrust === 'bekend') return all.filter((m) => m.trustLevel === 'bekend' || m.trustLevel === 'vertrouwd');
    return all.filter((m) => m.trustLevel === 'vertrouwd');
  }

  return {
    // contact CRUD — the writers one at a time per contact
    addContact:    inTurn(addContact),
    setTrustLevel: inTurn(setTrustLevel),
    setHidden:     inTurn(setHidden),
    setPersona:    inTurn(setPersona),
    setTags:       inTurn(setTags),
    setFlag:       inTurn(setFlag),
    /** The contact a webid is, or null — the one read of a single row. */
    get:           read,
    listContacts,
    listContactsByTag,
    listContactsByMinTrust,
  };
}

/**
 * THE ONE-TIME MOVE of the old contact book: a contact used to be a MemberMap entry marked `relation: 'contact'` (on a
 * box, the household bot's admitted people among them). Each such entry is written once into the book, as the self it is
 * filed under, and stops being a contact in the map (`group-member`: the marker, so a later boot moves nothing; the entry
 * itself stays for the rosters that read it). An entry filed under a self this device does not hold stays as it was.
 * Remove in the release after next, with the MemberMap.
 * @returns {Promise<{moved: number, kept: number}>}
 */
export async function moveContactsFromMemberMap({ members, contacts }) {
  let moved = 0; let kept = 0;
  for (const m of (await members?.list?.()) ?? []) {
    if (m?.relation !== 'contact' || !m.webid) continue;
    try {
      if (!(await contacts.get(m.webid))) {
        const { relation: _relation, ...fields } = m;
        await contacts.addContact(fields);
      }
      await members.addMember({ ...m, relation: 'group-member' });
      moved += 1;
    } catch { kept += 1; }
  }
  return { moved, kept };
}
