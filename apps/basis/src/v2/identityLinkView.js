/**
 * identityLinkView — the app's side of `/koppel`: link this person's Basis identity to their row on a household bot.
 *
 * Opened from the bot's start link (`#koppel-bot=`, no secret in it): which bot. The offer is written with the person's
 * OWN key — the chat identity, the same on every device of theirs, so one link serves all of them — and pasted by the
 * person into their private chat with the bot, which asks there for the code shown here. The bot's statement (which
 * bot, which row, which key) is kept once it arrives: only from the bot the offer was for, only about this key. It
 * grants nothing by itself; it is what the app shows as "linked". An unlink statement drops it.
 *
 * Pure composition over a storage; the shell paints it, and its peer router hands it the bot's message.
 */
import { parseLinkStartLink, encodeLinkOffer, linkCode, IDENTITY_LINK_SUBTYPE } from './identityLink.js';

const PENDING = 'onderling.identityLink.pending';
const LINKED = 'onderling.identityLink.linked';
const read = (storage, k, d) => { try { return JSON.parse(storage.getItem(k) ?? 'null') ?? d; } catch { return d; } };
const write = (storage, k, v) => { try { storage.setItem(k, JSON.stringify(v)); } catch { /* kept for this visit only */ } };

/**
 * @param {object} a
 * @param {string} a.link  the address the app was opened at (its `#koppel-bot=` fragment), or '' (no link)
 * @param {string} a.personKey  this person's chat identity key
 * @param {{getItem: Function, setItem: Function}} a.storage
 */
export function createIdentityLinkView({ link, personKey, storage }) {
  const bot = parseLinkStartLink(link);
  return {
    /** Which bot the link names: `{ok, botAddress, relayUrl, botName}` or `{ok: false, reason}`. */
    bot,

    /** The line to paste into the private chat (`/koppel <offer>`) and the code the bot will ask for. */
    async offer() {
      if (!bot.ok) throw new Error('identityLinkView: not a link');
      const { offer, nonce } = encodeLinkOffer({ personKey, botAddress: bot.botAddress });
      write(storage, PENDING, { bot: bot.botAddress, botName: bot.botName ?? null });
      return { line: `/koppel ${offer}`, code: await linkCode(personKey, nonce) };
    },

    /**
     * The bot's message (from the peer router). Kept when it is the statement of the bot this app offered to, about this
     * key; an unlink drops the kept one. Returns whether it was taken.
     */
    received(from, payload) {
      if (payload?.subtype !== IDENTITY_LINK_SUBTYPE) return false;
      const st = payload.statement;
      if (!st || st.key !== personKey || st.bot !== from) return false;
      const linked = read(storage, LINKED, []);
      if (payload.unlinked) { write(storage, LINKED, linked.filter((l) => l.bot !== from)); return true; }
      const pending = read(storage, PENDING, null);
      if (!pending || pending.bot !== from) return false;
      write(storage, LINKED, [...linked.filter((l) => l.bot !== from), { bot: from, row: st.row, botName: pending.botName ?? null }]);
      try { storage.removeItem?.(PENDING); } catch { /* harmless */ }
      return true;
    },

    /** The bots this person's identity is linked to (what the app shows). */
    linkedTo: () => read(storage, LINKED, []),
  };
}
