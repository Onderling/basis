/**
 * basis v2 — AN UNKNOWN SUBTYPE IS ANSWERED, NOT DROPPED (home: Connectivity). A newer build may send a kind of message
 * an older one has no handler for. The older device answers ONE `not-understood` frame naming the subtype (no content),
 * and the sender's contact row says the other side cannot receive it yet, instead of the message vanishing in silence.
 *
 * The three limits, each held here or by construction:
 *   • a `not-understood` is NEVER answered (no loops): it is taken before the router, so it can never be "unknown";
 *   • it goes only to a sender that passed the receive gate: the router only ever sees envelopes the security layer
 *     verified and authorized (a refused envelope never reaches it), and HI never reaches it at all;
 *   • at most ONCE per peer and subtype per start (`createNotUnderstood`, in memory).
 * Pure apart from the memory it is handed; the agent (realAgent's receive wrapper) does the sending.
 */

/** The subtype of the answer. */
export const NOT_UNDERSTOOD_SUBTYPE = 'not-understood';

/** The longest subtype name an answer carries or a notice keeps (a name off the wire is bounded). */
const MAX_SUBTYPE_CHARS = 64;

const cleanSubtype = (s) => (typeof s === 'string' && s && s.length <= MAX_SUBTYPE_CHARS ? s : null);

/**
 * The per-start memory of both directions: what this device answered (so it answers once), and what each peer told this
 * device it could not receive (the words on that peer's row).
 */
export function createNotUnderstood() {
  const answered = new Set();          // `${from}\n${subtype}`
  const told = new Map();              // peer address → Set<subtype>
  return {
    /**
     * The answer to send for a frame the router named not understood, or null (already answered, no name, or itself an
     * answer). Marks it answered.
     * @param {string} from
     * @param {unknown} subtype
     * @returns {{subtype: string, of: string}|null}
     */
    answerFor(from, subtype) {
      const of = cleanSubtype(subtype);
      if (typeof from !== 'string' || !from || !of || of === NOT_UNDERSTOOD_SUBTYPE) return null;
      const k = `${from}\n${of}`;
      if (answered.has(k)) return null;
      answered.add(k);
      return { subtype: NOT_UNDERSTOOD_SUBTYPE, of };
    },
    /**
     * A peer's answer arrived: keep which subtype it could not receive. True when it is new (said once).
     * @param {string} from
     * @param {unknown} payload
     */
    noteAnswer(from, payload) {
      const of = cleanSubtype(payload?.of);
      if (typeof from !== 'string' || !from || !of) return false;
      let set = told.get(from);
      if (!set) { set = new Set(); told.set(from, set); }
      if (set.has(of)) return false;
      set.add(of);
      return true;
    },
    /** The subtypes this peer said it could not receive, in this start (a copy). */
    toldBy(address) {
      return [...(told.get(address) ?? [])];
    },
  };
}

/** Is this payload a `not-understood` answer (flat: the answer never rides the A2A message shape)? */
export function isNotUnderstood(payload) {
  return !!payload && typeof payload === 'object' && payload.subtype === NOT_UNDERSTOOD_SUBTYPE;
}
