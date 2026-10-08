/**
 * feedCompanion — WHERE a household bot's agenda links are served: the companion it holds as a CONTACT.
 *
 * A household's companion (the node that keeps each person's sealed agenda file) hands out a contact card like a
 * person does, and its card says where its links are served (`serves`: the public address of the relay it is found
 * on, which forwards `/feed/<node>/<id>.<k>.ics` to it). The bot reads that from its contact book when it makes or
 * re-fills a link — never from configuration — so the companion its owner gives it is the one it uses, and a bot with
 * no such contact simply has no links. Read at the moment it is needed: a contact added while the bot runs counts.
 */
import { LINK_NODE } from '@onderling/blob-gateway';

const HTTP = /^https?:\/\/[^\s]+$/;

/**
 * The companion among these contact rows: the last one added whose card says where it serves and whose address is a
 * node's (and that the person has not hidden). `{ node, base }` or null.
 * @param {Array<{webid?: string, peerAddr?: string, serves?: string, hidden?: boolean}>} contacts
 */
export function feedCompanionOf(contacts) {
  const all = companionsOf(contacts);
  return all.length ? all[all.length - 1] : null;
}

/**
 * Every companion among these contact rows, in the order they were added: a row whose card says where it serves and
 * whose address is a node's (and that the person has not hidden). `[{ node, base }]`.
 * @param {Array<{webid?: string, peerAddr?: string, serves?: string, hidden?: boolean}>} contacts
 */
export function companionsOf(contacts) {
  const out = [];
  for (const c of (Array.isArray(contacts) ? contacts : [])) {
    if (!c || c.hidden === true || typeof c.serves !== 'string' || !HTTP.test(c.serves)) continue;
    const node = [c.peerAddr, c.webid].find((a) => typeof a === 'string' && LINK_NODE.test(a));
    if (node) out.push({ node, base: c.serves.replace(/\/+$/, '') });
  }
  return out;
}

/**
 * The bot's companion, read from its contact book through the waist. Null when there is none (or the book is down).
 * @param {{ callSkill: (app: string, op: string, args: object) => Promise<any> }} a
 */
export async function loadFeedCompanion({ callSkill }) {
  const all = await loadCompanions({ callSkill });
  return all.length ? all[all.length - 1] : null;
}

/**
 * Every companion the bot holds as a contact, read through the waist (`[]` when there is none, or the book is down).
 * @param {{ callSkill: (app: string, op: string, args: object) => Promise<any> }} a
 */
export async function loadCompanions({ callSkill }) {
  try {
    const r = await callSkill('stoop', 'listContacts', {});
    return companionsOf(Array.isArray(r?.contacts) ? r.contacts : (Array.isArray(r?.items) ? r.items : []));
  } catch { return []; }
}
