/**
 * chatFilter — the VIEWER's own narrowing of a circle's conversation.
 *
 * Frits, 2026-07-28: *"everything should be filterable, even chat itself — in case you have an
 * automated agents' chat and you are not interested in their interactions."* That sentence settles the
 * long-open "what is a conversation?" question differently from either candidate answer: the
 * conversation is not a fixed set of kinds decided once, it is **a projection the reader narrows**.
 *
 * ── Two axes, because his example needs the second one ───────────────────────────────────────────────
 *   • **kinds** — chat / tasks / questions / offers …, i.e. what the row IS. `chat-message` is itself
 *     one of them: a conversation you can filter but never filter chat OUT of would be an odd
 *     half-measure.
 *   • **authors** — people vs agents. This is the axis his case actually needs, and no kind filter can
 *     express it: two rows of the identical kind differ only by who wrote them. `'people'` hides agent
 *     chatter; `'agents'` shows only it (useful when you DO want to audit what the bots said).
 *
 * ── Ceiling, not override ────────────────────────────────────────────────────────────────────────────
 * The circle's own `conversationKinds` (admin setting → template → permissive default) decides what
 * BELONGS in the conversation. This filter only narrows within that: a viewer can never surface a kind
 * the circle excluded. Same shape as every other layered decision here (default-strict + ceiling), and
 * it keeps "what the circle is" an admin question while "what I want to read" stays mine.
 *
 * Device-local and per-circle by design: this is a reading preference, not a disclosure. Nothing about
 * it is fanned to anyone — a filter that told the circle what you skip would be a new leak.
 */

/** Author axis values. */
export const CHAT_AUTHORS = Object.freeze(['all', 'people', 'agents']);

/** The default: show everything the circle allows. */
export const DEFAULT_CHAT_FILTER = Object.freeze({ kinds: null, authors: 'all' });

/**
 * Normalise a stored filter against the circle's allowed kinds (the ceiling).
 *
 * `kinds: null` means "every allowed kind" — stored as null rather than a copy of the list, so a circle
 * that later allows one more kind shows it instead of silently keeping the reader's old set. A stored
 * kind the circle no longer allows is dropped; if that empties the set, it falls back to null (showing
 * everything) rather than an empty conversation the reader cannot explain.
 *
 * @param {object} [stored]
 * @param {string[]} [allowedKinds]  the circle's conversation kinds; null/absent ⇒ no ceiling
 * @returns {{kinds: string[]|null, authors: 'all'|'people'|'agents'}}
 */
export function normalizeChatFilter(stored, allowedKinds = null) {
  const authors = CHAT_AUTHORS.includes(stored?.authors) ? stored.authors : 'all';
  let kinds = null;
  if (Array.isArray(stored?.kinds)) {
    const allowed = Array.isArray(allowedKinds) ? new Set(allowedKinds) : null;
    const kept = [...new Set(stored.kinds.filter((k) => typeof k === 'string' && k !== ''))]
      .filter((k) => (allowed ? allowed.has(k) : true))
      .sort();
    // An explicit set that still covers everything allowed is the same as "no filter" — store it as
    // null so the chips read "all" and a later-added kind is included.
    const coversAll = allowed != null && kept.length === allowed.size;
    kinds = (kept.length === 0 || coversAll) ? null : kept;
  }
  return Object.freeze({ kinds, authors });
}

/**
 * Apply the viewer's filter to already-projected chat rows.
 *
 * @param {object} a
 * @param {Array<object>} a.rows                      rows from `chatRows` (already circle-scoped)
 * @param {object} [a.filter]
 * @param {string[]} [a.allowedKinds]
 * @param {(actor: string|null, row: object) => boolean} [a.isAgentActor]
 *   host-injected: does this row's actor belong to an agent/bot? The host owns the roster, this module
 *   does not. Absent ⇒ nobody is an agent, so the author axis degrades to a no-op — never to hiding
 *   people, which would look like message loss.
 * @returns {Array<object>}
 */
export function applyChatFilter({ rows, filter, allowedKinds = null, isAgentActor = null } = {}) {
  const f = normalizeChatFilter(filter, allowedKinds);
  const list = Array.isArray(rows) ? rows : [];
  const wanted = f.kinds ? new Set(f.kinds) : null;
  const isAgent = typeof isAgentActor === 'function' ? isAgentActor : () => false;

  return list.filter((r) => {
    if (wanted && !wanted.has(r?.event?.type ?? r?.type)) return false;
    if (f.authors === 'all') return true;
    let agent = false;
    try { agent = isAgent(r?.actor ?? null, r) === true; } catch { agent = false; }
    return f.authors === 'agents' ? agent : !agent;
  });
}

/**
 * The chip model both shells render — one chip per allowed kind plus the author chips, each with its
 * on/off state and the next filter a tap produces. Pure: the shells add only markup.
 *
 * Kind chips toggle membership; the author chips are a 3-way cycle rendered as three chips. A tap
 * returning the SAME filter (e.g. turning off the last kind) is prevented here rather than in the UI —
 * a reader must not be able to construct an empty conversation and wonder where it went.
 *
 * @param {object} a
 * @param {string[]} a.allowedKinds   the circle's conversation kinds (the ceiling)
 * @param {object} [a.filter]
 * @returns {{kindChips: Array<object>, authorChips: Array<object>, active: boolean}}
 */
export function chatFilterChips({ allowedKinds = [], filter } = {}) {
  const f = normalizeChatFilter(filter, allowedKinds);
  const on = f.kinds ? new Set(f.kinds) : new Set(allowedKinds);

  const kindChips = (allowedKinds ?? []).map((kind) => {
    const selected = on.has(kind);
    const next = selected ? [...on].filter((k) => k !== kind) : [...on, kind];
    return {
      id: kind,
      kind,
      selected,
      // Never let a tap empty the conversation: the last remaining kind is not switchable off.
      disabled: selected && on.size <= 1,
      nextFilter: (selected && on.size <= 1)
        ? { ...f }
        : normalizeChatFilter({ ...f, kinds: next }, allowedKinds),
    };
  });

  const authorChips = CHAT_AUTHORS.map((authors) => ({
    id: `authors:${authors}`,
    authors,
    selected: f.authors === authors,
    disabled: false,
    nextFilter: normalizeChatFilter({ ...f, authors }, allowedKinds),
  }));

  return { kindChips, authorChips, active: f.kinds != null || f.authors !== 'all' };
}

/** localStorage-backed per-circle filter store (web). */
export function localStorageChatFilterIo(storage = globalThis.localStorage) {
  const key = (circleId) => `cc.chatFilter.${circleId}`;
  return {
    load: (circleId) => {
      try { return JSON.parse(storage?.getItem(key(circleId)) ?? 'null'); } catch { return null; }
    },
    save: (circleId, v) => {
      try {
        if (v?.kinds == null && (v?.authors ?? 'all') === 'all') storage?.removeItem(key(circleId));
        else storage?.setItem(key(circleId), JSON.stringify(v));
      } catch { /* ignore */ }
    },
  };
}

/** AsyncStorage-backed per-circle filter store (mobile). Same keys, same defaulting. */
export function asyncStorageChatFilterIo(AsyncStorage) {
  const key = (circleId) => `cc.chatFilter.${circleId}`;
  return {
    load: async (circleId) => {
      try { return JSON.parse((await AsyncStorage?.getItem(key(circleId))) ?? 'null'); } catch { return null; }
    },
    save: async (circleId, v) => {
      try {
        if (v?.kinds == null && (v?.authors ?? 'all') === 'all') await AsyncStorage?.removeItem(key(circleId));
        else await AsyncStorage?.setItem(key(circleId), JSON.stringify(v));
      } catch { /* ignore */ }
    },
  };
}
