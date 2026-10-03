/**
 * botThreads — each person's conversation with a door's assistant, kept across restarts.
 *
 * A door that is not a circle (the box's Telegram chat) had its memory in a Map inside the engine and its pending
 * ask in a Map inside the runner, so a restart forgot every conversation and every half-answered question. Now:
 *   - the TURNS are `chat-message` entries on the device log (the conversation's record, the kind that exists),
 *     carrying the thread id and `scope: 'self'` and no circle: nothing that re-sends a circle's chat picks them up,
 *     and on the box the log is sealed at rest. Memory is a PROJECTION over them — the last turns of one thread —
 *     the same shape web's circle memory reads from its rows.
 *   - the thread's SETTINGS — its memory mode, its language, the ask it is waiting on — are one `chat-thread` row
 *     per thread, in a store the host hands in (sealed on the box).
 * A thread is one person's: the door keys it by the person it admitted (their contact id), so what one person said
 * is never the memory of another's turn.
 *
 * MEMORY MODES (the person chooses; the admin's default is `assistant.memoryDefault`):
 *   - `short` — the last turns are sent with every call (the model remembers nothing between calls);
 *   - `off`   — no turn is kept and none is sent: every line stands alone. What the person adds to a list is still
 *               the household's and stays; only the conversation is not kept;
 *   - `long`  — short, plus what the bot knows about the household once that exists; until then it reads as short.
 */
import { SURFACE_PREFS } from './surfacePref.js';
import { ASSISTANT_MEMORY_TURNS } from './assistantEngine.js';

export const MEMORY_MODES = Object.freeze(['off', 'short', 'long']);
export const DEFAULT_MEMORY_MODE = 'short';
/** The admin's default mode — a parameter (`paramsService`), read by the door at each turn. */
export const ASSISTANT_MEMORY_DEFAULT_KEY = 'assistant.memoryDefault';
/** The languages a person can fix a thread to; `auto` clears it (the reply follows how they write). */
export const THREAD_LANGS = Object.freeze(['nl', 'en']);

const isMode = (m) => MEMORY_MODES.includes(m);

/**
 * Rows by id kept in a DataSource (a sealed one on the box), one path per row — the door's thread rows, its
 * admission state.
 * @param {{read:Function, write:Function, list:Function}} ds
 * @param {string} [prefix]
 */
export function dataSourceRowStore(ds, prefix = 'mem://basis/bot-threads/') {
  const pathOf = (id) => `${prefix}${encodeURIComponent(id)}`;
  const parse = (v) => { if (v == null) return null; try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; } };
  return {
    async get(id) { return parse(await ds.read(pathOf(id))); },
    async put(row) { await ds.write(pathOf(row.id), JSON.stringify(row)); return row; },
    async remove(id) { await ds.delete(pathOf(id)); },
    async list() {
      const rows = [];
      for (const p of await ds.list(prefix)) { const r = parse(await ds.read(p)); if (r?.id) rows.push(r); }
      return rows;
    },
  };
}

/** A store that keeps nothing past the process (tests, a door without a data dir). */
export function memoryThreadStore() {
  const m = new Map();
  return {
    async get(id) { return m.get(id) ?? null; },
    async put(row) { m.set(row.id, row); return row; },
    async remove(id) { m.delete(id); },
    async list() { return [...m.values()]; },
  };
}

/**
 * @param {object} a
 * @param {{append:Function, query:Function}} a.eventLog  the device log the turns are kept on
 * @param {{get:Function, put:Function, list:Function}} [a.store]  the thread rows
 * @param {() => unknown} [a.memoryDefault]  the admin's default mode (the parameter's value); invalid → `short`
 * @param {number} [a.memoryTurns]
 * @param {() => number} [a.now]
 * @param {(msg: string, err?: unknown) => void} [a.onWarn]
 */
export function createBotThreads({ eventLog, store = memoryThreadStore(), memoryDefault = () => DEFAULT_MEMORY_MODE, memoryTurns = ASSISTANT_MEMORY_TURNS, now = Date.now, onWarn = null } = {}) {
  if (!eventLog || typeof eventLog.append !== 'function' || typeof eventLog.query !== 'function') {
    throw new TypeError('createBotThreads: an event log with append + query is required');
  }
  const warn = typeof onWarn === 'function' ? onWarn : (m, e) => console.warn(m, e?.message ?? e ?? '');
  const rows = new Map();   // id → the thread row (the store's, kept here so a turn reads it without waiting)
  let seq = 0;

  const rowOf = (id) => rows.get(id) ?? { id, type: 'chat-thread', name: id };
  function save(row) {
    rows.set(row.id, row);
    Promise.resolve().then(() => store.put(row)).catch((e) => warn(`[bot-threads] ${row.id}: not saved`, e));
    return row;
  }
  const modeOf = (id) => {
    const own = rows.get(id)?.memory;
    if (isMode(own)) return own;
    const d = memoryDefault();
    return isMode(d) ? d : DEFAULT_MEMORY_MODE;
  };

  return {
    /** Read the stored rows once, before the door answers anyone. */
    async load() {
      for (const r of await store.list()) if (r?.id) rows.set(r.id, r);
      return rows.size;
    },
    modeOf,
    /** @param {string} id @param {string} mode */
    setMode(id, mode) {
      if (!isMode(mode)) throw new TypeError(`botThreads: unknown memory mode "${mode}" (one of ${MEMORY_MODES.join(', ')})`);
      return save({ ...rowOf(id), memory: mode });
    },
    /** The language a person fixed their thread to, or null (the reply follows how they write). */
    langOf: (id) => (THREAD_LANGS.includes(rows.get(id)?.lang) ? rows.get(id).lang : null),
    /** @param {string} id @param {string} lang  one of THREAD_LANGS, or `auto` to clear */
    setLang(id, lang) {
      if (lang === 'auto') { const { lang: _l, ...rest } = rowOf(id); return save(rest); }
      if (!THREAD_LANGS.includes(lang)) throw new TypeError(`botThreads: unknown language "${lang}"`);
      return save({ ...rowOf(id), lang });
    },
    /** Has this thread been greeted (the door says who it is and what it keeps, once per person)? */
    greeted: (id) => rows.get(id)?.greeted === true,
    markGreeted(id) { return save({ ...rowOf(id), greeted: true }); },
    /** Was this person, not admitted, already told they need a code (a door that says it once)? */
    refused: (id) => rows.get(id)?.refused === true,
    markRefused(id) { return save({ ...rowOf(id), refused: true }); },
    /** Reminders for this person: on unless they switched them off (`/herinneringen uit`). */
    remindersOn: (id) => rows.get(id)?.reminders !== 'off',
    setReminders(id, on) { return save({ ...rowOf(id), reminders: on ? 'on' : 'off' }); },
    /** The weekly overview: off until the person switches it on (`/overzicht aan`). */
    overviewOn: (id) => rows.get(id)?.overview === 'on',
    setOverview(id, on) { return save({ ...rowOf(id), overview: on ? 'on' : 'off' }); },
    /** Why the bot cannot write first to this person (a Telegram refusal), or null — kept until they next write. */
    unreachableOf: (id) => rows.get(id)?.unreachable ?? null,
    markUnreachable(id, reason) { return save({ ...rowOf(id), unreachable: reason }); },
    clearUnreachable(id) {
      if (!rows.get(id)?.unreachable) return rows.get(id) ?? null;
      const { unreachable: _u, ...rest } = rowOf(id);
      return save(rest);
    },
    /** Has this person had a reminder before (the first one says how to stop)? */
    remindedOnce: (id) => rows.get(id)?.reminded === true,
    markReminded(id) { return save({ ...rowOf(id), reminded: true }); },
    /** What was already said to this person: item id → the slot it was said for (the reminders' only state). */
    saidOf: (id) => ({ ...(rows.get(id)?.said ?? {}) }),
    setSaid(id, said) { return save({ ...rowOf(id), said: { ...said } }); },
    /** The ask this thread is waiting on (a form, a confirmation), or null. */
    pendingOf: (id) => rows.get(id)?.pending ?? null,
    setPending(id, pending) {
      const { pending: _p, ...rest } = rowOf(id);
      return save(pending ? { ...rest, pending } : rest);
    },
    /** How this person's menus are painted (`inline` · `screen` · `chat`, the surface preference words); default inline. */
    viewOf: (id) => (SURFACE_PREFS.includes(rows.get(id)?.view) ? rows.get(id).view : 'inline'),
    setView(id, view) {
      if (!SURFACE_PREFS.includes(view)) throw new TypeError(`botThreads: unknown view "${view}"`);
      return save({ ...rowOf(id), view });
    },
    /** The screen this person asked to connect (`/scherm`): `{hash, until}` of its one-time nonce, or null. */
    screenNonceOf: (id) => rows.get(id)?.screenNonce ?? null,
    setScreenNonce(id, nonce) {
      const { screenNonce: _n, ...rest } = rowOf(id);
      return save(nonce ? { ...rest, screenNonce: { hash: nonce.hash, until: nonce.until } } : rest);
    },
    /** A screen's offer waiting for this person's yes: `{viewPubKey, nonce, label, until}`, or null. */
    screenOfferOf: (id) => rows.get(id)?.screenOffer ?? null,
    setScreenOffer(id, offer) {
      const { screenOffer: _o, ...rest } = rowOf(id);
      return save(offer ? { ...rest, screenOffer: { viewPubKey: offer.viewPubKey, nonce: offer.nonce, label: offer.label ?? null, until: offer.until } } : rest);
    },
    /** Whose pending screen nonce has this hash (one pending per person), or null. */
    screenNonceOwner(hash) {
      for (const [id, r] of rows) if (r?.screenNonce?.hash === hash) return id;
      return null;
    },
    /** The engine's memory: what a thread remembers, and the last turns it reads. */
    memory: {
      remember(threadId, who, text) {
        const words = String(text ?? '').trim();
        if (!threadId || !words || modeOf(threadId) === 'off') return;
        const ts = now();
        const voice = who === 'assistant' ? 'assistant' : who === 'system' ? 'system' : 'you';
        seq += 1;
        eventLog.append({
          id: `bot-turn:${ts.toString(36)}:${seq}:${Math.random().toString(36).slice(2, 8)}`,
          type: 'chat-message', app: 'basis', ts, actor: voice === 'you' ? threadId : 'bot',
          payload: { kind: 'chat-message', scope: 'self', threadId, who: voice, text: words },
        });
      },
      recent(threadId) {
        if (!threadId || modeOf(threadId) === 'off') return [];
        const out = [];
        for (const e of eventLog.query({})) {   // most recent first
          const p = e?.payload;
          if (e?.type !== 'chat-message' || p?.threadId !== threadId || typeof p.text !== 'string') continue;
          out.push(`${p.who}: ${p.text}`);
          if (out.length >= memoryTurns) break;
        }
        return out.reverse();
      },
    },
  };
}
