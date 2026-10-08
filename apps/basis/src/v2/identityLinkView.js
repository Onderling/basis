/**
 * identityLinkView — the app's side of `/koppel`: link this person's Basis identity to their row on a household bot.
 *
 * Opened from the bot's start link (`#koppel-bot=`, no secret in it — the address bar on web, the link pasted on the
 * phone): which bot. The offer is a statement by THIS DEVICE (its delegation key, the root-signed delegation beside it),
 * so the bot records the person's ROOT: every device of theirs then speaks to the bot as them, and one they revoke stops
 * doing so. The person pastes the line into their private chat with the bot, which asks there for the code shown here.
 *
 * The bot's statement — which bot, which row, which root — makes the bot a CONTACT of the person: a keyed row in their
 * contact book, marked with the row (`linkedRow`), carried to their other devices like any contact. It is what the app
 * shows as "linked", whom its turns carry a device statement to, and whom a device revoke is told. It is kept only from
 * the bot an offer was made for, on this device, and only about this person's root; an unlink statement clears the mark.
 *
 * Platform-neutral: `createIdentityLinks` is composed once by the agent (its `identityLinks`), its peer handler rides
 * the shared lane table, and each shell paints `view(link)` — web in a sheet, mobile on My data.
 */
import { parseLinkStartLink, linkCode, IDENTITY_LINK_SUBTYPE } from './identityLink.js';

/**
 * What a shell paints for one start link: which bot, and the offer (the line to paste, the code the bot will ask for).
 * @param {{link: string, offerFor: (o: {botAddress: string, botName: string|null}) => Promise<{offer: string, nonce: string, root: string}|null>}} a
 */
export function createIdentityLinkView({ link, offerFor }) {
  const bot = parseLinkStartLink(link);
  return {
    /** Which bot the link names: `{ok, botAddress, relayUrl, botName}` or `{ok: false, reason}`. */
    bot,
    /** How the bot is named on screen: its name and the start of its address, or the start of its address. */
    label: bot.ok ? (bot.botName ? `${bot.botName} (${bot.botAddress.slice(0, 8)}…)` : `${bot.botAddress.slice(0, 10)}…`) : null,
    /**
     * The line to paste into the private chat (`/koppel <offer>`) and the code the bot will ask for — or
     * `{ok: false, reason: 'no-device-key'}` when this device cannot sign (no delegation).
     */
    async offer() {
      if (!bot.ok) return { ok: false, reason: 'not-a-link' };
      const made = await offerFor({ botAddress: bot.botAddress, botName: bot.botName ?? null });
      if (!made?.offer) return { ok: false, reason: 'no-device-key' };
      return { ok: true, line: `/koppel ${made.offer}`, code: await linkCode(made.root, made.nonce) };
    },
  };
}

/**
 * The person's identity links, composed once per agent.
 * @param {object} a
 * @param {(o: {botAddress: string}) => Promise<{offer: string, nonce: string, root: string}|null>} a.signOffer  this device's offer
 * @param {() => string|null} a.selfRoot   the root this device's delegation names (a statement about another root is not ours)
 * @param {(app: string, op: string, args: object) => Promise<any>} a.callSkill  the contact book, through the waist (it carries)
 * @param {() => number} [a.now]
 */
export function createIdentityLinks({ signOffer, selfRoot, callSkill, now = Date.now }) {
  const pending = new Map();   // bot address → { botName }
  const listeners = new Set();
  const emit = (e) => { for (const fn of listeners) { try { fn(e); } catch { /* a painter never breaks the link */ } } };
  const contacts = async () => {
    const r = await callSkill('stoop', 'listContacts', {}).catch(() => null);
    return Array.isArray(r?.contacts) ? r.contacts : (Array.isArray(r?.items) ? r.items : []);
  };

  /**
   * The bot's statement (from the peer router). Linked: kept as a contact row when this device made an offer to that
   * bot and the statement is about this person's root. Unlinked: the mark cleared on a bot already held as linked.
   * @returns {Promise<boolean>} whether it was taken
   */
  async function received(from, payload) {
    if (payload?.subtype !== IDENTITY_LINK_SUBTYPE) return false;
    const st = payload.statement;
    const mine = typeof selfRoot === 'function' ? selfRoot() : null;
    if (!st || st.bot !== from || typeof st.row !== 'string' || !st.row || !mine || st.root !== mine) return false;
    if (payload.unlinked) {
      if (!(await contacts()).some((c) => c?.webid === from && typeof c.linkedRow === 'string' && c.linkedRow)) return false;
      await callSkill('stoop', 'addContact', { webid: from, linkedRow: null, linkedAt: now() });
      emit({ bot: from, unlinked: true });
      return true;
    }
    const p = pending.get(from);
    if (!p) return false;
    pending.delete(from);
    const r = await callSkill('stoop', 'addContact', {
      webid: from, pubKey: from, peerAddr: from, ...(p.botName ? { displayName: p.botName } : {}), linkedRow: st.row, linkedAt: now(),
    });
    if (r?.error) return false;
    emit({ bot: from, row: st.row, botName: p.botName ?? null });
    return true;
  }

  return {
    /** The view a shell paints for a start link. Making the offer marks that bot as one this device waits to hear from. */
    view: (link) => createIdentityLinkView({
      link,
      offerFor: async ({ botAddress, botName }) => {
        const made = await signOffer({ botAddress });
        if (made?.offer) pending.set(botAddress, { botName });
        return made;
      },
    }),
    received,
    /**
     * This device just typed `/start <code>` to a bot (the admission by its card's code), signed: it waits for that
     * bot's statement as it does after a `/koppel` offer — the statement, not this guess, is what marks the contact.
     */
    expectAdmission(botAddress, { botName = null } = {}) {
      if (typeof botAddress === 'string' && botAddress && !pending.has(botAddress)) pending.set(botAddress, { botName, admission: true });
    },
    /** The peer router's entry (spread into the shared lane table, every shell). */
    handlers: { [IDENTITY_LINK_SUBTYPE]: (from, payload) => { received(from, payload).catch(() => {}); } },
    /** Told when a bot's statement was taken (`{bot, row, botName}` or `{bot, unlinked: true}`); returns the unsubscribe. */
    onLinked(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
