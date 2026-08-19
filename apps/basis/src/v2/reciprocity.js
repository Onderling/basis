/**
 * basis v2 — reciprocity (chat-off consumer side).
 *
 * When member Bob has `memberOverride.chatOff === true` for circle Selwerd,
 * member Anne attempting to DM Bob in that circle's context should see an
 * inline "Bob doesn't receive chat in Selwerd" notice — NOT a "blocked"
 * red flag. Design boundary ("TWEE DINGEN DIE HIER NIET GEBEUREN"):
 *   1. Bob does NOT get a "Anne tried to reach you" notification.  The
 *      attempt is invisible to him on purpose; otherwise "chat-off" would
 *      really be "chat-block".
 *   2. Anne does NOT see WHY Bob has chat off.  No reason, no timeline.
 *
 * Pure / DI: the host wires `getRecipientChatOff({recipientId, circleId})`
 * to whatever substrate becomes available for the cross-device read (a
 * future peer ping, a pod-published presence doc, …); today the default
 * returns false (best-effort: never block UI on a missing substrate).
 *
 * The chat-compose integration (compose notice + Save/Withdraw buttons +
 * actually re-routing the typed message into the queue) lives in the
 * follow-up — this slice ships the model + the save-for-later
 * queue substrate.
 */

/**
 * Resolve whether `recipientId` is reachable via chat in `circleId`.
 * Tolerant: any throw / non-boolean response collapses to "available".
 *
 * @param {object} args
 * @param {string} args.recipientId
 * @param {string} args.circleId
 * @param {(q: {recipientId:string, circleId:string}) => (Promise<boolean|null>|boolean|null)} [args.getRecipientChatOff]
 * @returns {Promise<{available: boolean, reason: 'chat-off'|null}>}
 */
export async function isRecipientUnavailable({ recipientId, circleId, getRecipientChatOff } = {}) {
  if (typeof recipientId !== 'string' || !recipientId) return { available: true, reason: null };
  if (typeof circleId !== 'string'    || !circleId)    return { available: true, reason: null };
  if (typeof getRecipientChatOff !== 'function')        return { available: true, reason: null };
  let off = false;
  try {
    const v = await getRecipientChatOff({ recipientId, circleId });
    off = v === true;
  } catch {
    return { available: true, reason: null };
  }
  return off
    ? { available: false, reason: 'chat-off' }
    : { available: true,  reason: null };
}

/**
 * Localized notice text used by the chat-compose area when the recipient
 * is unavailable.  Format: "<Name> doesn't receive chat in <Circle>."
 *
 * Falls back to an opaque "This person doesn't receive chat in this circle."
 * when names aren't available — never leaks an id.
 */
export function buildUnavailableNotice({ recipientName, circleName, t } = {}) {
  const tr = typeof t === 'function' ? t : (k) => k;
  if (recipientName && circleName) {
    return tr('circle.reciprocity.unavailable', {
      name: recipientName, circle: circleName,
    });
  }
  return tr('circle.reciprocity.unavailable_anon');
}

/* ──────────────────────────────────────────────────────────────────
 * Save-for-later queue: messages Anne writes while Bob has chat-off.
 * ────────────────────────────────────────────────────────────────── */

const STORE_KEY = 'cc.reciprocityQueue';

/**
 * Create a queue over a pluggable IO adapter ({load(key),save(key,value)},
 * same shape as createProposalStore).  Layout:
 *   Record<`${circleId}:${recipientId}`, QueuedMessage[]>
 * Each message: { id, circleId, recipientId, text, savedAt }
 *
 * @returns {{
 *   add: (msg: object) => Promise<object>,
 *   listFor: (recipientId: string, circleId: string) => Promise<object[]>,
 *   remove: (id: string) => Promise<void>,
 *   countFor: (recipientId: string, circleId: string) => Promise<number>,
 *   flushFor: (recipientId: string, circleId: string) => Promise<object[]>,
 * }}
 */
export function createMessageQueue({ io, storeKey = STORE_KEY } = {}) {
  if (!io || typeof io.load !== 'function' || typeof io.save !== 'function') {
    throw new TypeError('createMessageQueue: io must provide load + save');
  }

  async function readAll() {
    const raw = await io.load(storeKey);
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
    return {};
  }
  async function writeAll(map) { await io.save(storeKey, map); }

  function bucket(recipientId, circleId) { return `${circleId}:${recipientId}`; }

  async function add({ recipientId, circleId, text, savedAt = Date.now() } = {}) {
    if (typeof recipientId !== 'string' || !recipientId) throw new TypeError('add: recipientId required');
    if (typeof circleId    !== 'string' || !circleId)    throw new TypeError('add: circleId required');
    if (typeof text        !== 'string' || !text.trim()) throw new TypeError('add: non-empty text required');
    const msg = {
      id:    `wq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      recipientId, circleId,
      text:  text.trim(),
      savedAt,
    };
    const all = await readAll();
    const key = bucket(recipientId, circleId);
    const list = Array.isArray(all[key]) ? all[key] : [];
    list.push(msg);
    all[key] = list;
    await writeAll(all);
    return msg;
  }

  async function listFor(recipientId, circleId) {
    const all = await readAll();
    const list = Array.isArray(all[bucket(recipientId, circleId)]) ? all[bucket(recipientId, circleId)] : [];
    return [...list].sort((a, b) => (a.savedAt ?? 0) - (b.savedAt ?? 0));
  }

  async function remove(id) {
    const all = await readAll();
    let touched = false;
    for (const key of Object.keys(all)) {
      const list = all[key];
      if (!Array.isArray(list)) continue;
      const next = list.filter((m) => m.id !== id);
      if (next.length !== list.length) { all[key] = next; touched = true; }
      if (next.length === 0) delete all[key];
    }
    if (touched) await writeAll(all);
  }

  async function countFor(recipientId, circleId) {
    const list = await listFor(recipientId, circleId);
    return list.length;
  }

  /** Read + clear the bucket atomically — used when Bob re-enables chat. */
  async function flushFor(recipientId, circleId) {
    const all = await readAll();
    const key = bucket(recipientId, circleId);
    const list = Array.isArray(all[key]) ? all[key] : [];
    if (list.length === 0) return [];
    delete all[key];
    await writeAll(all);
    return [...list].sort((a, b) => (a.savedAt ?? 0) - (b.savedAt ?? 0));
  }

  return { add, listFor, remove, countFor, flushFor };
}

export const RECIPROCITY_STORE_KEY = STORE_KEY;
