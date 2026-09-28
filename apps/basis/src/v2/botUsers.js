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
 * @param {object} a
 * @param {{get: (id: string) => Promise<object|null>, put: (row: object) => Promise<object>, list: () => Promise<object[]>}} a.store
 * @param {string|null} [a.adminUid]  the uid (on any channel) the bot was started naming as its admin
 */
export function createBotUsers({ store, adminUid = null } = {}) {
  if (!store || typeof store.get !== 'function' || typeof store.put !== 'function' || typeof store.list !== 'function') {
    throw new TypeError('createBotUsers: a store with get/put/list is required');
  }
  const idOf = (channel, uid) => `${channel}:${uid}`;

  return {
    /**
     * Admit a person on a door: their contact, created on first sight. Admitting again keeps the contact and its
     * role, and takes a new display name when one is given.
     * @param {{channel: string, uid: string|number, displayName?: string|null}} who
     */
    async admit({ channel, uid, displayName = null } = {}) {
      if (!isChannel(channel)) throw new Error(`botUsers: unknown channel "${channel}" (one of ${CHANNELS.join(', ')})`);
      const u = uid == null ? '' : String(uid).trim();
      if (!u) throw new Error('botUsers: a uid is required');
      const id = idOf(channel, u);
      const name = typeof displayName === 'string' && displayName.trim() ? displayName.trim() : null;
      const known = await store.get(id);
      if (known) {
        if (name && name !== known.displayName) return store.put({ ...known, displayName: name });
        return known;
      }
      const named = adminUid != null && String(adminUid) === u;
      const anyAdmin = (await store.list()).some((r) => r?.role === ROLES.ADMIN);
      const role = named || (adminUid == null && !anyAdmin) ? ROLES.ADMIN : ROLES.MEMBER;
      return store.put({ id, type: 'contact', channel, uid: u, role, ...(name ? { displayName: name } : {}) });
    },
    /** Every admitted person, in the order they were admitted. */
    async list() { return (await store.list()).filter((r) => r && isChannel(r.channel)); },
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
    id: c.webid, type: 'contact', channel: c.channel, uid: String(c.webid).slice(c.channel.length + 1), role: c.role ?? null,
    ...(c.displayName ? { displayName: c.displayName } : {}),
  });
  return {
    async get(id) { return (await rows()).find((u) => u.id === id) ?? null; },
    async list() { return rows(); },
    async put(user) {
      const r = await callSkill('stoop', 'addContact', {
        webid: user.id, channel: user.channel, role: user.role, ...(user.displayName ? { displayName: user.displayName } : {}),
      });
      if (r?.ok === false || r?.error) throw new Error(`botUsers: the contact book refused ${user.id} (${r.error ?? 'refused'})`);
      return user;
    },
  };
}

/**
 * A door's admission: the person is admitted (their contact, created on first sight) and their role becomes their
 * tier in the host's gate. Returns the caller id every call of their turn carries. The tier is set again only when
 * the role changed, so a demotion reaches the gate on the person's next message.
 * @param {object} a
 * @param {ReturnType<typeof createBotUsers>} a.users
 * @param {(callerId: string, role: string) => Promise<void>} a.setDoorCaller  the host agent's
 * @returns {(who: {channel: string, uid: string, displayName?: string|null}) => Promise<string>}
 */
export function createDoorAdmit({ users, setDoorCaller }) {
  if (!users || typeof users.admit !== 'function') throw new TypeError('createDoorAdmit: users are required');
  if (typeof setDoorCaller !== 'function') throw new TypeError('createDoorAdmit: setDoorCaller is required');
  const tiered = new Map();   // callerId → the role last set in the gate
  return async (who) => {
    const row = await users.admit(who);
    if (tiered.get(row.id) !== row.role) {
      await setDoorCaller(row.id, row.role);
      tiered.set(row.id, row.role);
    }
    return row.id;
  };
}
