/**
 * Who gets in at a function profile's inbox — decided BEFORE anything is kept. The box used to land every contact turn
 * first (the thread, the walk log with its text) and let the door decide afterwards, so a stranger who was turned away
 * still left the turn, its text and the "told you once" marker behind. Here the decision comes first and a refused
 * stranger leaves nothing: no row, no text, only a count line (kind + reason, never who).
 *
 * In order, cheapest first:
 *   1. the text's size, decrypted (the 256 KB envelope cap already ran on the wire): a stranger's over 16 KB is refused;
 *   2. a STRANGER's budgets — someone this device does not know and has not answered: a few turns a day per key, and a
 *      ceiling per hour for all strangers together (counts only). A known peer is no stranger and skips them;
 *   3. the door's own admission (`admit`: a code, its bootstrap ids, a linked person's device statement) — called here,
 *      once, so a code is consumed exactly once. An OPEN door (a persona taking anyone's first word, within budget)
 *      admits a stranger without one.
 * A refused caller is told the reason once; after that, silence. The per-key counts and the "told" set are in memory,
 * bounded: a restart may tell a stranger twice, and never keeps them.
 *
 * Pure: the admission, the "known" and "answered" checks and the clock are injected; the box composes it.
 */

const HOUR = 60 * 60 * 1000;
export const STRANGER_LIMITS = Object.freeze({
  /** the most a stranger's turn may weigh, decrypted, in bytes */
  maxBytes: 16 * 1024,
  /** turns per key within the window, until the person or persona answers */
  perKey: Object.freeze({ turns: 3, windowMs: 24 * HOUR }),
  /** turns from all strangers together per hour */
  globalPerHour: 200,
  /** keys remembered (budgets, "told once") — the oldest forgotten first */
  keysKept: 2000,
});

/** A Map used as a bounded LRU: touching a key moves it to the end; past `cap` the oldest goes. */
function lru(cap) {
  const m = new Map();
  return {
    get: (k) => { if (!m.has(k)) return undefined; const v = m.get(k); m.delete(k); m.set(k, v); return v; },
    set: (k, v) => { m.delete(k); m.set(k, v); while (m.size > cap) m.delete(m.keys().next().value); },
    has: (k) => m.has(k),
    get size() { return m.size; },
  };
}

/**
 * @param {object} a
 * @param {(who: object) => Promise<any>} a.admit   the door's admission: a refusal is `{ refused: reason }`, else the caller
 * @param {(key: string) => Promise<boolean>|boolean} [a.isKnown]     a peer this device knows (no stranger budgets)
 * @param {(key: string) => Promise<boolean>|boolean} [a.answered]    the person or persona already answered this key
 * @param {(contactId: string, o: {linkedRoot?: string}) => Promise<boolean>|boolean} [a.held]  the door already admitted
 *   this person (a code, a bootstrap id, a linked root): someone it holds is no stranger, whatever book or roster says
 * @param {boolean} [a.open]   an open door: a stranger within budget is admitted without a code
 * @param {Partial<typeof STRANGER_LIMITS>} [a.limits]
 * @param {(e: {kind: string, reason: string}) => void} [a.count]  a count line: kind and reason, never who
 * @param {() => number} [a.now]
 * @returns {(m: {contactId: string, fromAddr: string, text: string, admission?: string, linkedRoot?: string, displayName?: string, channel?: string}) =>
 *   Promise<{ admitted: true, result: any, stranger: boolean } | { admitted: false, reason: string, tell: boolean }>}
 */
export function createInboundAdmission({ admit, isKnown = null, answered = null, held = null, open = false, limits = {}, count = null, now = Date.now } = {}) {
  if (typeof admit !== 'function') throw new TypeError('createInboundAdmission: admit is required');
  const L = { ...STRANGER_LIMITS, ...limits, perKey: { ...STRANGER_LIMITS.perKey, ...(limits.perKey ?? {}) } };
  const turnsByKey = lru(L.keysKept);   // key → timestamps of recent stranger turns
  const seenIds = lru(L.keysKept);      // message ids already decided: a relay may deliver one twice, and a second pass
                                        // through the door would read a used code as 'code-used'
  const told = lru(L.keysKept);         // key → true: told the refusal once
  let hourStart = 0; let hourCount = 0;
  const yes = async (fn, key) => { try { return typeof fn === 'function' && (await fn(key)) === true; } catch { return false; } };
  const said = (reason) => { try { count?.({ kind: 'stranger-refused', reason }); } catch { /* a count never breaks a turn */ } };

  const refuse = (key, reason) => {
    said(reason);
    const tell = !told.has(key);
    if (tell) told.set(key, true);
    return { admitted: false, reason, tell };
  };

  return async function admitInbound({ contactId, fromAddr, text, admission, linkedRoot, displayName = null, channel = 'web', messageId = null } = {}) {
    // the PERSON, not the address: one person's turns may come from several of their addresses (the box resolves them)
    const key = String(contactId || fromAddr || '');
    if (!key) return { admitted: false, reason: 'no-sender', tell: false };
    if (typeof messageId === 'string' && messageId) {
      if (seenIds.has(messageId)) return { admitted: false, reason: 'duplicate', tell: false };
      seenIds.set(messageId, true);
    }
    const isHeld = async () => { try { return typeof held === 'function' && (await held(contactId, { linkedRoot })) === true; } catch { return false; } };
    // a stranger: not a peer this device knows, not someone it answered, and not someone the door already holds
    const stranger = !(await yes(isKnown, key)) && !(await yes(isKnown, contactId)) && !(await yes(answered, contactId)) && !(await isHeld());

    if (stranger) {
      let bytes = Infinity;
      try { bytes = new TextEncoder().encode(String(text ?? '')).length; } catch { /* unmeasurable → too large */ }
      if (bytes > L.maxBytes) return refuse(key, 'too-large');
      const t = now();
      const recent = (turnsByKey.get(key) ?? []).filter((ts) => t - ts < L.perKey.windowMs);
      if (recent.length >= L.perKey.turns) { turnsByKey.set(key, recent); return refuse(key, 'over-budget'); }
      if (t - hourStart >= HOUR) { hourStart = t; hourCount = 0; }
      if (hourCount >= L.globalPerHour) return refuse(key, 'busy');
      recent.push(t); turnsByKey.set(key, recent); hourCount += 1;
      if (open) return { admitted: true, result: { id: contactId, open: true }, stranger: true };
    }

    let r;
    try {
      r = await admit({ channel, uid: contactId, displayName, text,
        ...(typeof admission === 'string' && admission ? { admission } : {}),
        ...(typeof linkedRoot === 'string' && linkedRoot ? { linkedRoot } : {}) });
    } catch (err) { return { admitted: false, reason: 'failed', tell: true, error: String(err?.message ?? err) }; }
    if (r && typeof r === 'object' && r.refused) return refuse(key, String(r.refused));
    if (!r) return refuse(key, 'needs-code');
    return { admitted: true, result: r, stranger };
  };
}
