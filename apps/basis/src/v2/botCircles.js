/**
 * botCircles — the circles a household bot joined on its admin's word, and how it lets go of one.
 *
 * `/kring <invite>`, in the admin's PRIVATE chat: the bot reads the invite and asks there — the circle's name, its rules,
 * and what joining means for this box (it keeps that circle's data on this device) — with Ja / Nee. Only the yes joins,
 * with the rules accepted and a roster handle that names the bot's operator, so the circle knows whose bot it admits.
 * The bot keeps its own record of these circles (its pair circles with contacts are not among them): the circle door
 * answers in these only. `/kring los <naam>` leaves one and forgets its content on the box; being removed forgets it too.
 * A bot has no reason to keep what it left: a person's device keeps its history, a bot's is not its own.
 */
import { decodeInvite, summariseEmbeddedRules, initialState } from '../core/wizards/joinGroupState.js';

/** How long a pasted invite waits for its yes (the screen's ten minutes). */
const OFFER_FOR_MS = 10 * 60 * 1000;

/** The handle rule a roster row keeps (`isValidHandle`): lowercase, 3–30, letters/digits with `_`/`-` inside. */
const slug = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/^@+/, '').replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^[-_]+|[-_]+$/g, '');

/**
 * The bot's handle on a circle's roster: its name and its operator's (`huisbot-van-frits`), within the handle rule.
 * @param {string|null} botName
 * @param {string|null} operatorName
 */
export function botCircleHandle(botName, operatorName) {
  const bot = slug(botName) || 'huisbot';
  const op = slug(operatorName);
  const whole = op ? `${bot}-van-${op}` : bot;
  return whole.slice(0, 30).replace(/[-_]+$/, '') || 'huisbot';
}

/**
 * @param {object} a
 * @param {{get: Function, put: Function, list: Function, remove: Function}} a.store  the joined circles' rows (sealed on a box)
 * @param {(a: {inviteUri: string, handle: string, rulesAccepted: true}) => Promise<{ok?: boolean, circleId?: string, error?: string, reason?: string}>} a.join
 * @param {(circleId: string) => Promise<{ok: boolean, error?: string}>} a.leave   the local leave (statement, keys, presence)
 * @param {(circleId: string) => Promise<{ok: boolean}>} a.forget                 the circle's content off the box
 * @param {(person: string, q: {text: string, buttons: Array<{id: string, label?: string}>}) => Promise<{ok: boolean}>} a.ask
 * @param {() => string|Promise<string>} a.handle  the roster handle (names the operator)
 * @param {() => number} [a.now]
 * @param {() => string} [a.newId]
 */
export function createBotCircles({ store, join, leave, forget, ask, handle, now = Date.now, newId = () => Math.random().toString(36).slice(2, 8) }) {
  const pending = new Map();   // person → { id, inviteUri, circleId, name, until }
  const rows = async () => ((await store.list()) ?? []).filter((r) => r?.id);

  return {
    /** The circles this bot joined (its record), oldest first. */
    async list() {
      return (await rows()).sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0));
    },

    /** Is this one of the circles the bot joined by `/kring`? */
    async isJoined(circleId) {
      return Boolean(circleId) && Boolean(await store.get(circleId));
    },

    /**
     * `/kring <invite>`: read, then the question in the private chat. Refused before any question: not from the private
     * chat, not an invite; a circle it is in already says so.
     * @param {(q: {name: string, rules: string, id: string}) => {text: string, buttons: Array}} question
     */
    async offered(person, inviteText, question, { isPrivate = false } = {}) {
      if (!isPrivate) return { ok: false, reason: 'not-private' };
      const state = initialState();
      decodeInvite(String(inviteText ?? '').trim(), state);
      const inv = state.invite;
      if (state.inviteParseError || !inv || typeof inv.groupId !== 'string' || !inv.groupId || !inv.code) return { ok: false, reason: 'not-an-invite' };
      if (await store.get(inv.groupId)) return { ok: true, already: true, name: inv.name ?? null };
      const id = newId();
      const name = typeof inv.name === 'string' && inv.name.trim() ? inv.name.trim() : inv.groupId.slice(0, 8);
      const rules = inv.rules && typeof inv.rules === 'object' ? summariseEmbeddedRules(inv.rules) : '';
      // the handle it will carry there is said in the question: it is the admin's name going to the circle
      const h = await handle();
      pending.set(person, { id, inviteUri: String(inviteText).trim(), circleId: inv.groupId, name, handle: h, until: now() + OFFER_FOR_MS });
      const asked = await ask(person, question({ name, rules, id, handle: h }));
      if (!asked?.ok) { pending.delete(person); return { ok: false, reason: asked?.reason ?? 'not-reachable' }; }
      return { ok: true, pending: true, name };
    },

    /** `/kring ja|nee <id>`, from the private chat only: the yes joins; a no, or a late answer, drops the question. */
    async answer(person, yes, id, { isPrivate = false } = {}) {
      const p = pending.get(person);
      if (!p) return { ok: false, reason: 'nothing-pending' };
      if (!isPrivate) return { ok: false, reason: 'not-private' };
      if (String(id ?? '') !== p.id) return { ok: false, reason: 'replaced' };
      pending.delete(person);
      if (p.until < now()) return { ok: false, reason: 'expired' };
      if (!yes) return { ok: true, declined: true, name: p.name };
      // the handle the question named
      const r = await join({ inviteUri: p.inviteUri, handle: p.handle, rulesAccepted: true });
      if (!r?.ok || !r.circleId) return { ok: false, reason: r?.reason ?? r?.error ?? 'join-failed', name: p.name };
      await store.put({ id: r.circleId, name: p.name, joinedAt: now(), by: person });
      return { ok: true, joined: true, name: p.name, circleId: r.circleId };
    },

    /** `/kring los <naam>`, from the private chat only: leave, then forget its content; the record goes. */
    async leaveNamed(name, { isPrivate = false } = {}) {
      if (!isPrivate) return { ok: false, reason: 'not-private' };
      const want = String(name ?? '').trim().toLowerCase();
      const row = (await rows()).find((r) => String(r.name ?? '').toLowerCase() === want || r.id === String(name ?? '').trim());
      if (!want || !row) return { ok: false, reason: 'unknown-circle' };
      const left = await leave(row.id);
      if (!left?.ok) return { ok: false, reason: left?.error ?? 'leave-failed', name: row.name };
      await forget(row.id);
      await store.remove(row.id);
      return { ok: true, name: row.name };
    },

    /** The bot was removed from a circle: if it is one it joined, its content is forgotten and the record goes. */
    async removed(circleId) {
      const row = circleId ? await store.get(circleId) : null;
      if (!row) return { ok: false, reason: 'not-joined' };
      await forget(row.id);
      await store.remove(row.id);
      return { ok: true, name: row.name };
    },
  };
}
