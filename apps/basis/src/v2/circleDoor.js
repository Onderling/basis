/**
 * circleDoor — a household bot's door in a circle it joined.
 *
 * A circle message lands on the box like on any member's device. It reaches the bot only when it names the bot BY NAME
 * (`@huisbot`, or its roster handle `huisbot-van-…`): the generic forms (`@assistent`, `@bot`) are the sender's own
 * local engine's, so one line gets one answer. Who asks is the circle member — the author the chat rail verified — with
 * their role in THAT circle (the folded roster), not anyone's row in the bot's own book. The bot's answer goes back onto
 * the circle's chat, signed with its per-circle key like any member's line, and capped per circle per minute: a group
 * of thirty can name it thirty times.
 *
 * One runner per circle (the same runner and engine the private doors use), composed by the host with that circle's
 * own lists, so the model's lines, the word rules and the memory are the circle's and never the household's.
 */
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

/** How many replies the bot posts in one circle per minute; a reply past it is dropped (the line was still taken). */
export const CIRCLE_REPLIES_PER_MINUTE = param({ key: 'assistant.circleRepliesPerMinute', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 6 });

/** A line older than this when it lands (held by the relay while the box was down) is not answered: the moment passed. */
export const CIRCLE_ANSWER_WITHIN_MS = param({ key: 'assistant.circleAnswerWithinMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 15 * 60_000 });

const WINDOW_MS = 60_000;
const DOOR_ROLES = new Set(['admin', 'coordinator', 'member', 'observer']);
const CALLER_PREFIX = 'circle:';
const escape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The names that address the bot in a circle: its roster handle, and the bot's own name before `-van-` (`huisbot`).
 * @param {string|null} handle
 * @returns {string[]}
 */
export function botNamesFor(handle) {
  const h = String(handle ?? '').trim().toLowerCase();
  if (!h) return [];
  const short = h.split('-van-')[0];
  return [...new Set([h, short].filter(Boolean))];
}

/** A name as a whole word: `@name`, or the line opening with `name` and a comma, colon or space. */
const namePatterns = (names) => names.map((n) => new RegExp(`(?:^|\\s)@${escape(n)}(?![\\w-])|^${escape(n)}(?=[,:\\s])`, 'i'));

/** Does this line name the bot member? Longest names first, so `@huisbot-van-frits` is not read as `@huisbot`. */
export function namesTheBotMember(text, names) {
  const t = String(text ?? '').trim();
  if (!t || !names?.length) return false;
  return namePatterns([...names].sort((a, b) => b.length - a.length)).some((re) => re.test(t));
}

/** The line without the bot's name (and the comma or colon after a leading one). */
export function withoutBotName(text, names) {
  let t = String(text ?? '').trim();
  for (const n of [...(names ?? [])].sort((a, b) => b.length - a.length)) {
    t = t.replace(new RegExp(`^${escape(n)}\\s*[,:]?\\s*`, 'i'), '')
      .replace(new RegExp(`(^|\\s)@${escape(n)}(?![\\w-])[,:]?`, 'gi'), '$1');
  }
  return t.replace(/\s{2,}/g, ' ').trim();
}

/**
 * A circle roster's role as the door's role: core's four as they are; `external` (below an observer) is not a member
 * here — null, not fed; a word the door does not know reads, never more (`observer`).
 */
export function doorRoleForRosterRole(role) {
  if (role === 'external') return null;
  if (role == null) return 'member';   // a roster row without a role is a member (the join's default)
  return DOOR_ROLES.has(role) ? role : 'observer';
}

/**
 * The host gate's id for a member at a circle's door: scoped to the circle, so one person in two circles with two roles
 * is two callers. The member acts as their own ref (`circleCallerActor`) in the circle's data.
 */
export const circleCallerId = (circleId, ref) => `${CALLER_PREFIX}${circleId}:${ref}`;
/** The member's ref inside a circle caller id, or null for any other caller. */
export function circleCallerActor(callerId, circleId) {
  const head = `${CALLER_PREFIX}${circleId}:`;
  return typeof callerId === 'string' && callerId.startsWith(head) ? callerId.slice(head.length) || null : null;
}

/**
 * At most `perMinute` replies per circle in any minute.
 * @param {{perMinute?: number, now?: () => number}} [a]
 */
export function createReplyCap({ perMinute = CIRCLE_REPLIES_PER_MINUTE, now = Date.now } = {}) {
  const sent = new Map();   // circleId → timestamps in the window
  return {
    allow(circleId) {
      const t = now();
      const recent = (sent.get(circleId) ?? []).filter((at) => t - at < WINDOW_MS);
      if (recent.length >= perMinute) { sent.set(circleId, recent); return false; }
      recent.push(t);
      sent.set(circleId, recent);
      return true;
    },
  };
}

/**
 * One circle's MessagingBridge for the runner: the chat is the circle, the sender the member who wrote.
 * @param {{circleId: string, post: (circleId: string, text: string) => Promise<unknown>, cap: ReturnType<typeof createReplyCap>, onCapped?: (circleId: string) => void}} a
 */
function createCircleDoorBridge({ circleId, post, cap, onCapped = null }) {
  let handler = null;
  return {
    id: 'circle',
    channel: 'circle',
    async start() {},
    async stop() {},
    onMessage(h) { handler = h; },
    async sendReply({ text }) {
      if (typeof text !== 'string' || !text) return;
      if (!cap.allow(circleId)) { try { onCapped?.(circleId); } catch { /* a log never breaks a reply */ } return; }
      await post(circleId, text);
    },
    feed({ authorRef, text, msgId, displayName = null }) {
      if (typeof handler !== 'function') return false;
      // a circle's chat shows no buttons: a confirm is asked and answered in words ("@huisbot ja")
      handler({ bridgeId: 'circle', channel: 'circle', chatId: circleId, messageId: msgId, text, buttons: false, sender: { bridgeUid: authorRef, displayName } });
      return true;
    },
  };
}

/**
 * The bot's doors in its circles, one per circle, built on the first line that names it there.
 * @param {object} a
 * @param {(circleId: string) => Promise<Array<{webid: string, role?: string, handle?: string}>>} a.roster  the folded roster
 * @param {(circleId: string) => string|null} a.botRef      the bot's own author ref in that circle (its lines are skipped)
 * @param {(circleId: string) => string|null|Promise<string|null>} a.botHandle   the bot's handle on that roster (its names)
 * @param {(callerId: string, role: string) => Promise<void>} a.setDoorCaller  the host gate's tier for a caller
 * @param {(callerId: string) => Promise<void>} [a.clearDoorCaller]  …and its removal (the circle left, the member gone)
 * @param {(circleId: string, text: string) => Promise<unknown>} a.post   the bot's line onto the circle's chat
 * @param {(a: {circleId: string, bridge: object, roleOf: (callerId: string) => string|null}) => Promise<{start: Function, stop: Function, idle: Function}>|{start: Function, stop: Function, idle: Function}} a.makeRunner
 *        the host's runner for one circle (its catalogue, its lists' lines, its call pinned to the circle)
 * @param {number} [a.perMinute]
 * @param {number} [a.answerWithinMs]
 * @param {() => number} [a.now]
 * @param {(e: object) => void} [a.log]  what happened, never what was said
 */
export function createCircleDoors({ roster, botRef, botHandle, setDoorCaller, clearDoorCaller = null, post, makeRunner, perMinute = CIRCLE_REPLIES_PER_MINUTE, answerWithinMs = CIRCLE_ANSWER_WITHIN_MS, now = Date.now, log = null }) {
  const cap = createReplyCap({ perMinute });
  const doors = new Map();   // circleId → { bridge, runner, roles }
  const seen = new Set();
  const SEEN_MAX = 1000;
  const say = (e) => { try { log?.(e); } catch { /* a log never breaks a turn */ } };
  const clearCaller = async (caller) => { try { await clearDoorCaller?.(caller); } catch { /* the next turn tiers afresh */ } };

  async function doorFor(circleId) {
    let d = doors.get(circleId);
    if (d) return d;
    const roles = new Map();
    const bridge = createCircleDoorBridge({ circleId, post, cap, onCapped: (cid) => say({ kind: 'circle-reply-capped', circleId: String(cid).slice(0, 12) }) });
    const runner = await makeRunner({ circleId, bridge, roleOf: (callerId) => roles.get(callerId) ?? null });
    await runner.start();
    d = { bridge, runner, roles };
    doors.set(circleId, d);
    return d;
  }

  return {
    /**
     * A circle message landed on this box. Fed to the circle's door when a member names the bot; the bot's own lines,
     * a non-member's, a line that does not name it, and a message seen before are not.
     * @returns {Promise<boolean>} whether it went to the door
     */
    async landed({ circleId, msgId, authorRef, text, ts = null, displayName = null }) {
      if (!circleId || !authorRef || typeof text !== 'string' || !text.trim()) return false;
      if (authorRef === botRef(circleId)) return false;
      if (typeof ts === 'number' && now() - ts > answerWithinMs) return false;
      const names = botNamesFor(await botHandle(circleId));
      if (!namesTheBotMember(text, names)) return false;
      const key = `${circleId}:${msgId}`;
      if (msgId) {
        if (seen.has(key)) return false;
        seen.add(key);
        if (seen.size > SEEN_MAX) seen.delete(seen.values().next().value);
      }
      const member = ((await roster(circleId)) ?? []).find((m) => m?.webid === authorRef);
      if (!member) return false;
      const role = doorRoleForRosterRole(member.role);
      if (!role) return false;
      const caller = circleCallerId(circleId, authorRef);
      await setDoorCaller(caller, role);
      const d = await doorFor(circleId);
      d.roles.set(caller, role);
      say({ kind: 'circle-turn', circleId: String(circleId).slice(0, 12) });
      return d.bridge.feed({ authorRef: caller, text: withoutBotName(text, names), msgId, displayName: displayName ?? member.handle ?? null });
    },
    /** The circle's door goes (the bot left it, or was removed) — and every caller it tiered leaves the host gate. */
    async forget(circleId) {
      const d = doors.get(circleId);
      doors.delete(circleId);
      try { await d?.runner?.stop?.(); } catch { /* gone either way */ }
      for (const caller of d?.roles?.keys?.() ?? []) await clearCaller(caller);
    },
    /** A circle's roster changed: a member the door tiered who is no longer on it (or no longer a member here) leaves the gate. */
    async rosterChanged(circleId) {
      const d = doors.get(circleId);
      if (!d || !d.roles.size) return 0;
      const rows = (await roster(circleId)) ?? [];
      let cleared = 0;
      for (const caller of [...d.roles.keys()]) {
        const ref = circleCallerActor(caller, circleId);
        const row = rows.find((m) => m?.webid === ref);
        if (row && doorRoleForRosterRole(row.role)) continue;
        d.roles.delete(caller);
        await clearCaller(caller);
        cleared += 1;
      }
      return cleared;
    },
    /** The circles with a door open now. */
    open: () => [...doors.keys()],
    /** Resolves when every circle's turns are done. */
    idle: async () => { await Promise.all([...doors.values()].map((d) => d.runner?.idle?.())); },
  };
}
