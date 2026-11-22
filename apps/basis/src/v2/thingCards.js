/**
 * thingCards — how a toolbox's things are shown where a door shows pictures: per shop ONE group of pictures and ONE
 * message under it (Frits 2026-11-19: three photos one under the other came "loeigroot"; a lone photo is drawn at the
 * width of the chat). The decision lives here, once; a door only sends what it says (Telegram: an album, then a message).
 *
 * Per group (a shop, `rendered.groups`; things with no shop last):
 *   - the first TOOL_CARDS_PER_GROUP things are its cards: their pictures side by side, each captioned with its number;
 *   - FEWER THAN TWO pictures make no group of pictures at all (an album of one is refused by Telegram, and one photo
 *     alone is drawn huge again): the message alone;
 *   - the message: the shop's head, the cards' numbered lines, and the buttons: each card's own button with its number
 *     (one row), and ONE "meer" for the rest of the shop (its own row), a line the gate decides like a typed one.
 * Pure: the rendered reply in, the plan out. The number on a line is the number a tap or a typed '2' picks.
 */
import { TOOL_CARDS_PER_GROUP } from './toolboxClient.js';

/** Telegram carries a button's data in at most this many bytes; a "meer" whose line does not fit is not offered. */
const BUTTON_DATA_MAX = 64;

/**
 * @param {{items: Array<{id?: string, n?: number, label: string, group?: string, thumb?: {mime: string, data: string}, buttons?: Array<{label: string, callbackData: string}>}>, groups?: string[], title?: string, page?: {group: number, from: number}}} rendered
 * @param {{t: Function, offered?: (b: {callbackData: string}) => boolean, perGroup?: number}} o
 * @returns {Array<{pictures: Array<{n: number, caption: string, thumb: {mime: string, data: string}}>, text: string, buttons: Array<{id: string, label: string, row: number}>}>}
 */
export function thingCardGroups(rendered, { t, offered = () => true, perGroup = TOOL_CARDS_PER_GROUP } = {}) {
  const items = Array.isArray(rendered?.items) ? rendered.items : [];
  const groups = rendered?.groups ? [...rendered.groups, null] : [null];
  const out = [];
  for (const [gi, g] of groups.entries()) {
    const mine = items.map((it, i) => ({ it, n: it.n ?? i + 1 })).filter(({ it }) => (rendered.groups ? (it.group ?? null) === g : true));
    if (!mine.length) continue;
    const shown = mine.slice(0, perGroup);
    const withPicture = shown.filter(({ it }) => it.thumb);
    const pictures = withPicture.length >= 2 ? withPicture.map(({ it, n }) => ({ n, caption: `${n}. ${it.label}`, thumb: it.thumb })) : [];
    const lines = [...(g ? [`${g}:`] : []), ...shown.map(({ it, n }) => `${n}. ${it.label}`)];
    // a card's own button(s) with its number: 'Kies 2' (the row button the manifest declares), all on one row
    const buttons = shown.flatMap(({ it, n }) => (it.buttons ?? []).filter(offered).map((b) => ({ id: b.callbackData, label: `${b.label} ${n}`, row: 0 })));
    // the rest of the shop behind ONE "meer": the button names the kept list, the shop and where to go on
    const rest = mine.length - shown.length;
    const tag = String(mine[0].it.id ?? '').split('.')[0];
    const page = rendered.page ?? null;
    const more = `/meer ${tag} ${page ? page.group : gi} ${(page ? page.from : 0) + shown.length}`;
    if (rest > 0 && tag && new TextEncoder().encode(more).length <= BUTTON_DATA_MAX) {
      buttons.push({ id: more, label: t('circle.telegram.more_of', { shop: g ?? rendered.title ?? '', n: rest }), row: 1 });
    }
    out.push({ pictures, text: lines.join('\n'), buttons });
  }
  return out;
}
