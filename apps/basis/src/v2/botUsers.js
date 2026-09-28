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
