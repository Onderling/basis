/**
 * nearbyStream — Nearby's Conversation tab as one stream, and what is new on each tab. Decided once here, so the web
 * and the phone paint the same order and the same counts; a painter only draws the items it is given.
 *
 * The stream holds the room chat's lines and, between them, a card for each question someone here asked and each
 * circle offered here, oldest first like a chat. Each item carries `at`, the time it arrived on THIS device:
 *   - a chat line: when it was received here (my own line: when I said it) — `nearbyChatLines` gives it as `at`;
 *   - someone's question: when this device received it (`receivedAt`, stamped by the controller), never the time the
 *     sender claims, which a sender could set in the future to pin its card at the bottom of every room;
 *   - an offered circle: when this device received it (`receiveInvite` stamps `receivedAt`).
 * My own questions are not cards in the stream: they cannot be answered by me, and they stay in Questions with who
 * heard them and their answers.
 *
 * Not in the room chat, or hidden from the room (`nearbyChatOff`): no stream — the tab says why, and the way out.
 */

import { nearbyVisibilityKey } from './nearbyScreen.js';

const list = (v) => (Array.isArray(v) ? v : []);

/** The visibility states in which the person is not seen by the room: they have no conversation there. A line said
 *  while hidden would still go to everyone this device sees, from an address nobody here can see. */
const HIDDEN = Object.freeze(['hidden', 'not_chosen', 'radio_off']);

/**
 * Why the Conversation tab shows no stream, or null when it does. Hidden comes first: joining the chat would not
 * change that. `act` is the existing act that ends it — the radio switch when the radio is off, leaving "even stil"
 * when quiet, none when no level was chosen yet (the first-use question above is the way) — and `join` (the chat
 * allow) when the person is simply not in the chat.
 * @param {object|null} model
 * @returns {null | { reason: 'hidden', act: 'radio-on'|'unquiet'|null } | { reason: 'not-joined', act: 'join' }}
 */
export function nearbyChatOff(model) {
  const m = model && typeof model === 'object' ? model : {};
  if (HIDDEN.includes(nearbyVisibilityKey(m.visibility))) {
    return { reason: 'hidden', act: m.radioOff === true || m.visibility?.radioOff === true ? 'radio-on' : m.quiet === true ? 'unquiet' : null };
  }
  return Array.isArray(m.chat) ? null : { reason: 'not-joined', act: 'join' };
}
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

const askAt = (entry) => num(entry?.receivedAt);
const inviteAt = (entry) => num(entry?.invite?.receivedAt);

/**
 * @param {object|null} model  the Nearby model (`{ chat, asks, invites, … }`)
 * @returns {Array<{ kind: 'line'|'ask'|'invite', at: number, key: string, line?: object, entry?: object }>}
 */
export function nearbyStream(model) {
  const m = model && typeof model === 'object' ? model : {};
  if (nearbyChatOff(m)) return [];
  const items = [
    ...m.chat.map((line) => ({ kind: 'line', at: num(line?.at), key: `line:${line?.id ?? ''}`, line })),
    ...list(m.asks).map((entry) => ({ kind: 'ask', at: askAt(entry), key: `ask:${entry?.ask?.id ?? ''}`, entry })),
    ...list(m.invites).map((entry) => ({ kind: 'invite', at: inviteAt(entry), key: `invite:${entry?.invite?.circleId ?? ''}`, entry })),
  ];
  // stable: two items that arrived in the same millisecond keep lines, then questions, then circles
  return items.sort((a, b) => a.at - b.at);
}

/** The arrival times on each tab that can be new to the person. My own chat lines are never new to me. */
function arrivals(m) {
  const conversation = nearbyStream(m).filter((i) => !(i.kind === 'line' && i.line?.mine)).map((i) => i.at);
  const questions = [
    ...list(m.asks).map(askAt),
    ...list(m.invites).map(inviteAt),
    // an answer to my own question is the thing on this tab I most want to know about
    ...list(m.myAsks).flatMap((e) => list(e?.answers).map((a) => num(a?.receivedAt))),
  ];
  return { conversation, questions };
}

/**
 * What is new on each tab: how many items arrived after the tab was last seen, and the latest arrival on it (what a
 * shell records as seen while the tab is open, so it needs no clock of its own).
 *
 * @param {object|null} model
 * @param {{ conversation?: number, questions?: number }} [seen]  per tab, the latest arrival the person has seen
 * @returns {{ counts: { conversation: number, questions: number }, latest: { conversation: number, questions: number } }}
 */
export function nearbyTabNews(model, seen = {}) {
  const m = model && typeof model === 'object' ? model : {};
  const s = seen && typeof seen === 'object' ? seen : {};
  const counts = {};
  const latest = {};
  for (const [tab, ats] of Object.entries(arrivals(m))) {
    const since = num(s[tab]);
    counts[tab] = ats.filter((at) => at > since).length;
    latest[tab] = ats.reduce((mx, at) => Math.max(mx, at), since);
  }
  return { counts, latest };
}
