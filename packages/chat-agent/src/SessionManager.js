/**
 * ⚠ DELETION CANDIDATE (decided: mark, don't delete — we may still learn from it). Superseded by
 * `core.StateManager.openSession`; `ChatAgent.js` contains zero references to Session. Successor named,
 * kept for reference. See the homes plan's decisions.
 * SessionManager — per-chat session state with TTL eviction.
 *
 * Internal to ChatAgent.  Pure in-memory; restart-survival is V1+
 * (per L1c sketch's "session-state restart-survival" open question).
 */

const DEFAULT_TTL_MS    = 30 * 60 * 1000;   // 30 min
const DEFAULT_HISTORY   = 10;

export class SessionManager {
  /** @type {Map<string, import('./types.js').Session>} */
  #sessions = new Map();

  #ttlMs;
  #historyDepth;

  /**
   * @param {object} [opts]
   * @param {number} [opts.ttlMs=DEFAULT_TTL_MS]
   * @param {number} [opts.historyDepth=DEFAULT_HISTORY]
   */
  constructor({ ttlMs = DEFAULT_TTL_MS, historyDepth = DEFAULT_HISTORY } = {}) {
    this.#ttlMs        = ttlMs;
    this.#historyDepth = historyDepth;
  }

  /**
   * Get the active session for a chat, or null if expired / absent.
   *
   * @param {string} chatId
   * @returns {import('./types.js').Session|null}
   */
  get(chatId) {
    const s = this.#sessions.get(chatId);
    if (!s) return null;
    if (this.#isExpired(s)) {
      this.#sessions.delete(chatId);
      return null;
    }
    return s;
  }

  /**
   * Create a new session.  Replaces any existing session for the chat.
   *
   * @param {string} chatId
   * @param {object} args
   * @param {string} args.memberWebid
   * @param {string} args.memberDisplayName
   * @param {string} [args.contextSnapshot]
   * @returns {import('./types.js').Session}
   */
  create(chatId, { memberWebid, memberDisplayName, contextSnapshot }) {
    /** @type {import('./types.js').Session} */
    const session = {
      chatId,
      memberWebid,
      memberDisplayName,
      history:        [],
      lastActivityAt: Date.now(),
      ...(contextSnapshot ? { contextSnapshot } : {}),
    };
    this.#sessions.set(chatId, session);
    return session;
  }

  /**
   * Append a message to a session's history; trims to historyDepth.
   *
   * @param {string} chatId
   * @param {import('./types.js').HistoryMessage} msg
   */
  appendHistory(chatId, msg) {
    const s = this.#sessions.get(chatId);
    if (!s) return;
    s.history.push(msg);
    if (s.history.length > this.#historyDepth) {
      s.history.splice(0, s.history.length - this.#historyDepth);
    }
    s.lastActivityAt = Date.now();
  }

  /**
   * Replace the session's contextSnapshot (e.g. after a pod refresh).
   *
   * @param {string} chatId
   * @param {string} snapshot
   */
  setContext(chatId, snapshot) {
    const s = this.#sessions.get(chatId);
    if (!s) return;
    s.contextSnapshot = snapshot;
  }

  /**
   * Evict expired sessions (called periodically by ChatAgent's
   * prune loop, or on-demand).
   *
   * @returns {number} number of sessions evicted
   */
  prune() {
    let evicted = 0;
    for (const [chatId, s] of this.#sessions) {
      if (this.#isExpired(s)) {
        this.#sessions.delete(chatId);
        evicted++;
      }
    }
    return evicted;
  }

  /**
   * Clear all sessions (used on stop).
   */
  clear() {
    this.#sessions.clear();
  }

  get size() {
    return this.#sessions.size;
  }

  #isExpired(s) {
    return Date.now() - s.lastActivityAt > this.#ttlMs;
  }
}
