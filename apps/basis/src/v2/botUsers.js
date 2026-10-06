/**
 * botUsers — the people a hosting bot serves: each is a contact with a channel (the door they came in by) and a role.
 *
 * A household bot runs as its own node and serves several people over its doors (Telegram, the web contact thread,
 * later WhatsApp). Each admitted person becomes one contact, keyed `<channel>:<uid>`, carrying:
 *   - `channel` — one of `CHANNELS` (a closed set, membership-tested);
 *   - `role` — from core's `ROLES`: `admin` for the bot's admin, `member` for everyone else.
 * The first person admitted is the admin, unless the bot was started naming its admin (`adminUid`), and then that
 * person is, whoever came first. Three levels exist on a bot: ROOT is whoever can open the machine's vault — never a
 * role, never reachable from a door; ADMIN is the admin-role contact; MEMBER is every other admitted contact.
 *
 * Pure over an injected store (`get`/`put`/`list` of rows by id): where the contacts are kept is the host's choice.
 */
import { ROLES } from '@onderling/core';
import { CHANNELS, isChannel } from '@onderling/item-types';

// The doors a person can be admitted by are the contact type's own closed set.
export { CHANNELS, isChannel };

/**
 * The admitted person a name or contact id means, among the book's rows: the id first, else the display name (any
 * case). One rule for the book's own changes and for the question that asks before one.
 * @param {Array<{id: string, displayName?: string}>} rows
 * @param {string} nameOrId
 * @returns {object|null}
 */
export function personNamed(rows, nameOrId) {
  const want = String(nameOrId ?? '').trim();
  if (!want) return null;
  return (rows ?? []).find((r) => r?.id === want) ?? (rows ?? []).find((r) => (r?.displayName ?? '').toLowerCase() === want.toLowerCase()) ?? null;
}

/**
 * A person's Basis key on the bot, or null: the key their `/koppel` linked (a door row: Telegram), or — on the inbox
 * door — the row's own id, which IS their key (the book does not repeat it as `pubKey`).
 */
export function linkedKeyOf(row) {
  if (!row || typeof row !== 'object') return null;
  if (typeof row.pubKey === 'string' && row.pubKey) return row.pubKey;
  return row.channel === 'web' && typeof row.id === 'string' && row.id ? row.id : null;
}

/**
 * @param {object} a
 * @param {{get: (id: string) => Promise<object|null>, put: (row: object) => Promise<object>, list: () => Promise<object[]>}} a.store
 * @param {string|null} [a.adminUid]  the uid (on any channel) the bot was started naming as its admin
 * @param {() => void} [a.onChange]  told when someone comes, goes or gets another role (Telegram's menus follow it)
 */
export function createBotUsers({ store, adminUid = null, onChange = null } = {}) {
  if (!store || typeof store.get !== 'function' || typeof store.put !== 'function' || typeof store.list !== 'function') {
    throw new TypeError('createBotUsers: a store with get/put/list is required');
  }
  // A door-shaped id for a keyless person (`telegram:<uid>`); a web person's id IS their webid (the contact row the
  // card made), so both doors reach the gate with the row's own id.
  const idOf = (channel, uid) => (channel === 'web' ? uid : `${channel}:${uid}`);
  const changed = (out) => { try { onChange?.(); } catch { /* a listener must not undo the change */ } return out; };

  return {
    idOf,
    /**
     * Admit a person on a door: their contact, created on first sight. Admitting again keeps the contact and its
     * role, and takes a new display name when one is given.
     * @param {{channel: string, uid: string|number, displayName?: string|null}} who
     */
    async admit({ channel, uid, displayName = null, role: asked = null } = {}) {
      if (!isChannel(channel)) throw new Error(`botUsers: unknown channel "${channel}" (one of ${CHANNELS.join(', ')})`);
      const u = uid == null ? '' : String(uid).trim();
      if (!u) throw new Error('botUsers: a uid is required');
      const id = idOf(channel, u);
      const name = typeof displayName === 'string' && displayName.trim() ? displayName.trim() : null;
      const known = await store.get(id);
      if (known) {
        // Admitted again after a revoke (a new code): the row comes back, with the role it had.
        const back = known.hidden ? { ...known, hidden: false } : known;
        if (known.hidden && typeof store.unhide === 'function') await store.unhide(id);
        if (back !== known) return changed(await store.put({ ...back, ...(name ? { displayName: name } : {}) }));
        if (name && name !== back.displayName) return store.put({ ...back, displayName: name });
        return known;
      }
      const named = adminUid != null && String(adminUid) === u;
      const anyAdmin = (await store.list()).some((r) => r?.role === ROLES.ADMIN);
      // the admin is the named one, or the first; anyone else the role their code carried (an invite's), else a member
      const role = named || (adminUid == null && !anyAdmin) ? ROLES.ADMIN : (['member', 'coordinator', 'observer'].includes(asked) ? asked : ROLES.MEMBER);
      return changed(await store.put({ id, type: 'contact', channel, uid: u, role, ...(name ? { displayName: name } : {}) }));
    },
    /** Every admitted person (a revoked one is not), in the order they were admitted. */
    async list() { return (await store.list()).filter((r) => r && isChannel(r.channel) && !r.hidden); },
    /**
     * The admitted person behind a door's uid, or null (never admitted, or revoked). At the inbox door a uid is a key:
     * the row of that key, or the Telegram person's row that LINKED it (their Basis identity, `/koppel`) — one person.
     */
    async find(channel, uid) {
      const u = String(uid ?? '').trim();
      const row = await store.get(idOf(channel, u));
      if (row && !row.hidden) return row;
      if (channel !== 'web' || !u) return null;
      return (await store.list()).find((r) => r && !r.hidden && r.pubKey === u) ?? null;
    },
    /**
     * Link a person's Basis key to their row (the keyless row gains its key). One key per row, one row per key: a key
     * already on another row (or an inbox-door person's own) is refused; the same key on the same row is a no-op.
     * @returns {Promise<{ok: true, already?: true}|{ok: false, reason: 'no-row'|'key-on-another-row'|'row-has-a-key'}>}
     */
    async linkKey(id, key) {
      const k = String(key ?? '').trim();
      const rows = (await store.list()).filter((r) => r && !r.hidden);
      const row = rows.find((r) => r.id === id);
      if (!row || !k) return { ok: false, reason: 'no-row' };
      if (row.pubKey === k) return { ok: true, already: true };
      if (rows.some((r) => r.id !== id && (r.id === k || r.pubKey === k))) return { ok: false, reason: 'key-on-another-row' };
      if (row.pubKey) return { ok: false, reason: 'row-has-a-key' };
      await store.put({ ...row, pubKey: k });
      return { ok: true };
    },
    /** Drop a row's linked key (`/ontkoppel`): a turn from it is a stranger's again. */
    async unlinkKey(id) {
      const row = await store.get(id);
      if (!row?.pubKey) return { ok: false, reason: 'no-key' };
      const { pubKey: key, ...rest } = row;
      await store.put({ ...rest, pubKey: null });
      return { ok: true, key };
    },
    /**
     * Drop a person: they are no longer admitted and need a new code. Named by display name or contact id.
     * @returns {Promise<object|null>} the row that was revoked, or null when nobody matched
     */
    /**
     * Give an admitted person a role (below admin: coordinator · member · observer). Named by display name or id.
     * @returns {Promise<object|null>} the row as it is now, or null when nobody matched
     */
    async setRole(nameOrId, role) {
      const want = String(nameOrId ?? '').trim();
      if (!want || !['coordinator', 'member', 'observer'].includes(role)) return null;
      const row = personNamed((await store.list()).filter((r) => r && isChannel(r.channel) && !r.hidden), want);
      if (!row || row.role === ROLES.ADMIN) return null;
      return changed(await store.put({ ...row, role }));
    },
    async revoke(nameOrId) {
      const want = String(nameOrId ?? '').trim();
      if (!want) return null;
      const row = personNamed((await store.list()).filter((r) => r && isChannel(r.channel) && !r.hidden), want);
      if (!row) return null;
      if (typeof store.hide === 'function') await store.hide(row.id);
      else await store.put({ ...row, hidden: true });
      return changed(row);
    },
    /** @param {string} contactId */
    async roleOf(contactId) { return (await store.get(contactId))?.role ?? null; },
    /** @param {string} contactId */
    async isAdmin(contactId) { return (await store.get(contactId))?.role === ROLES.ADMIN; },
  };
}

/**
 * The bot's people kept where every contact is kept: the contact book, through the waist (`listContacts` /
 * `addContact`). A person is one keyless row there — the door-shaped webid (`telegram:<uid>`), the door, the role.
 * @param {(app: string, op: string, args: object) => Promise<any>} callSkill  the host's own (owner) callSkill
 */
export function contactBookStore(callSkill) {
  const rows = async () => {
    const r = await callSkill('stoop', 'listContacts', {});
    const list = Array.isArray(r) ? r : (r?.contacts ?? r?.items ?? []);
    return list.filter((c) => c && isChannel(c.channel)).map(toUser);
  };
  const toUser = (c) => ({
    id: c.webid, type: 'contact', channel: c.channel, uid: c.channel === 'web' ? c.webid : String(c.webid).slice(c.channel.length + 1), role: c.role ?? null,
    ...(c.displayName ? { displayName: c.displayName } : {}),
    ...(c.hidden ? { hidden: true } : {}),
    // a door row that linked its person's Basis key (`/koppel`); an inbox-door row's key is its id
    ...(c.channel !== 'web' && typeof c.pubKey === 'string' && c.pubKey ? { pubKey: c.pubKey } : {}),
  });
  return {
    async get(id) { return (await rows()).find((u) => u.id === id) ?? null; },
    // A revoked person's row is HIDDEN in the book (the book's own flag), not deleted: a new code brings it back.
    async hide(id) { await callSkill('stoop', 'setContactHidden', { webid: id, hidden: true }); },
    async unhide(id) { await callSkill('stoop', 'setContactHidden', { webid: id, hidden: false }); },
    async list() { return rows(); },
    async put(user) {
      const r = await callSkill('stoop', 'addContact', {
        webid: user.id, channel: user.channel, role: user.role, ...(user.displayName ? { displayName: user.displayName } : {}),
        ...('pubKey' in user ? { pubKey: user.pubKey ?? null } : {}),
      });
      if (r?.ok === false || r?.error) throw new Error(`botUsers: the contact book refused ${user.id} (${r.error ?? 'refused'})`);
      return user;
    },
  };
}

/**
 * A door's admission: who may talk to the bot, and their tier in the host's gate.
 *
 * With `admission` (the box): an admitted person goes on; a bootstrap uid (the admin named at start, a configured
 * allow-list) is admitted without a code; anyone else must send `/start <code>` — a valid, unspent code of the open
 * cohort admits them (the line is consumed), anything else is refused with the reason. A revoked person is not
 * admitted and their tier is cleared from the gate. Without `admission`, everyone the door is handed is admitted.
 * The role becomes the tier (set again only when it changed, so a demotion reaches the gate on the next message).
 * @param {object} a
 * @param {ReturnType<typeof createBotUsers>} a.users
 * @param {(callerId: string, role: string) => Promise<void>} a.setDoorCaller  the host agent's
 * @param {(callerId: string) => Promise<void>} [a.clearDoorCaller]  the host agent's: a revoked person's tier goes
 * @param {ReturnType<import('./botAdmission.js').createBotAdmission>} [a.admission]
 * @param {Array<string|number>} [a.bootstrapUids]
 * @returns {(who: {channel: string, uid: string, displayName?: string|null, text?: string}) =>
 *           Promise<string | {id: string, consumed: true} | {refused: string}>}
 */
export function createDoorAdmit({ users, setDoorCaller, clearDoorCaller = null, admission = null, bootstrapUids = [] }) {
  if (!users || typeof users.admit !== 'function') throw new TypeError('createDoorAdmit: users are required');
  if (typeof setDoorCaller !== 'function') throw new TypeError('createDoorAdmit: setDoorCaller is required');
  const tiered = new Map();   // callerId → the role last set in the gate
  const bootstrap = new Set(bootstrapUids.filter((u) => u != null && String(u).trim()).map((u) => String(u).trim()));
  const tier = async (row) => {
    if (tiered.get(row.id) !== row.role) {
      await setDoorCaller(row.id, row.role);
      tiered.set(row.id, row.role);
    }
    return row.id;
  };
  const admit = async (who) => {
    // Without admission (a door that admits everyone it is handed), every person is admitted.
    if (!admission) return tier(await users.admit(who));
    const uid = String(who?.uid ?? '').trim();
    const known = typeof users.find === 'function' ? await users.find(who.channel, uid) : null;
    // a row found through ANOTHER door (a Telegram person's row that linked this key) is never re-admitted here: that
    // would make the key a second row, a second person
    if (known) return tier(known.channel !== who.channel || known.displayName || !who.displayName ? known : await users.admit(who));
    // Not admitted (never, or revoked): the gate forgets any tier they had.
    const id = typeof users.idOf === 'function' ? users.idOf(who.channel, uid) : `${who.channel}:${uid}`;
    if (tiered.has(id)) { tiered.delete(id); if (typeof clearDoorCaller === 'function') await clearDoorCaller(id); }
    if (bootstrap.has(uid)) return tier(await users.admit(who));
    // The code: a field on the message (the bot's inbox — from the card), or `/start <code>` (Telegram's link).
    const m = /^\/start(?:@\S+)?\s+(\S+)/.exec(String(who?.text ?? '').trim());
    const code = typeof who?.admission === 'string' && who.admission ? who.admission : m?.[1];
    if (!code) return { refused: 'needs-code', id };
    const r = await admission.redeem(code);
    if (!r.ok) return { refused: r.reason, id };
    return { id: await tier(await users.admit({ ...who, role: r.role ?? null })), consumed: true };
  };
  /** The role this door last gave a person (their thread's tools follow it), or null (not admitted here). */
  admit.roleOf = (id) => tiered.get(id) ?? null;
  /** At start: every admitted person (the book; a revoked one is not in it) goes into the host's gate with their
   *  role, before they write — the box calls ops as a person (a reminder, the Sunday overview) after a restart too. */
  admit.atStart = async () => { let n = 0; for (const row of await users.list()) if (row?.id && row.role) { await tier(row); n += 1; } return n; };
  return admit;
}
