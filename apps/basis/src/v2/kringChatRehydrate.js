/**
 * basis v2 — kring-chat boot-time rehydrator.
 *
 * The kring view's GESPREK tab reads from `eventLog` which lives in
 * memory.  On page reload the log starts empty, so historical chats
 * (durable in stoop's itemStore from 's hybrid storage path)
 * wouldn't be visible until new chats arrived.
 *
 * Since ε.1, every kring-chat insert path routes through the shared
 * `chatMessageInbox`.  This rehydrator:
 *
 *   • fetches stored chats via the `listKringChats` skill
 *   • normalizes each `item` into the same envelope shape NKN delivers
 *     (`{ subtype, circleId, msgId, ts, text, fromActor }`)
 *   • hands the envelope to `inbox.ingestChatMessage(env, { source:
 *     'rehydrator' })`, which validates / dedupes / appends in the
 *     same way the receiver path does.
 *
 * Sharing the inbox's LRU with the receiver protects against the
 * boot-time race where a peer's envelope for msgId X arrives mid-boot,
 * ingest stores it, AND the rehydrator then re-reads it from itemStore
 * — without the shared gate that would render the bubble twice.
 *
 * Portable: no DOM, no RN, no module-level state.  Web + mobile boot
 * paths both call this once after the agent is ready.
 */

import { chatEnvelopeFromStoreItem, toEventLogItem } from '@onderling/item-store';

/**
 * Rehydrate chat history into the eventLog via the shared inbox.
 *
 * @param {object} args
 * @param {Function} args.callSkill           `(appOrigin, opId, args) => Promise<*>`
 * @param {{ingestChatMessage: Function}} [args.inbox]
 *                                            ε.1+ — preferred entry point.
 *                                            When omitted, an `eventLog` (+
 *                                            optional `dedup`) is required so
 *                                            existing call sites keep working.
 * @param {{append: Function}} [args.eventLog] legacy entry point.
 * @param {Set<string>} [args.dedup]          legacy shared msgId set.
 * @param {string} [args.groupId]
 * @param {number} [args.sinceTs]
 * @param {number} [args.limit]
 * @param {{warn?, info?, debug?}} [args.logger]
 * @returns {Promise<{rehydrated: number, skipped: number, error?: string}>}
 */
export async function rehydrateKringChatsFromStoop({
  callSkill,
  inbox    = null,
  eventLog = null,
  dedup    = null,
  groupId,
  sinceTs,
  limit,
  logger   = console,
} = {}) {
  if (typeof callSkill !== 'function') {
    return { rehydrated: 0, skipped: 0, error: 'callSkill required' };
  }

  // Resolve the insertion strategy.  Preferred: caller passed a shared
  // inbox so the rehydrator + receiver dedupe through ONE LRU.  Legacy:
  // caller passed `eventLog` (+ optional `dedup` Set) directly — we
  // keep that working so existing tests + transitional call sites
  // don't have to migrate in the same commit.
  let insert;
  if (inbox && typeof inbox.ingestChatMessage === 'function') {
    insert = async (env) => {
      const r = await inbox.ingestChatMessage(env, { source: 'rehydrator' });
      return r?.result === 'inserted';
    };
  } else if (eventLog && typeof eventLog.append === 'function') {
    insert = makeLegacyInsert({ eventLog, dedup });
  } else {
    return { rehydrated: 0, skipped: 0, error: 'eventLog.append required' };
  }

  let res;
  try {
    res = await callSkill('stoop', 'listKringChats', { groupId, sinceTs, limit });
  } catch (err) {
    logger.warn?.('[kring-chat] rehydrate failed:', err?.message ?? err);
    return { rehydrated: 0, skipped: 0, error: String(err?.message ?? err) };
  }
  const items = Array.isArray(res?.items) ? res.items : [];

  let rehydrated = 0;
  let skipped    = 0;
  for (const item of items) {
    const envelope = itemToEnvelope(item);
    if (!envelope) { skipped += 1; continue; }
    const inserted = await insert(envelope);
    if (inserted) rehydrated += 1;
    else          skipped    += 1;
  }
  logger.info?.(`[kring-chat] rehydrated ${rehydrated} (skipped ${skipped})`);
  return { rehydrated, skipped };
}

/**
 * Convert a stoop `listKringChats` item into the NKN envelope shape
 * the inbox expects.  Returns `null` for items that are missing
 * msgId / circleId / text so the caller counts them as skipped.
 *
 * Connectivity Phase 2 — this is the strict (`lenient:false`) caller of the
 * ONE canonical `chatEnvelopeFromStoreItem` projection (`@onderling/item-store`),
 * the ONE canonical store-item→envelope reshaper. The
 * hand-maintained copy that used to live here is gone.
 */
function itemToEnvelope(item) {
  return chatEnvelopeFromStoreItem(item);
}

/**
 * Pre-ε.1 insertion path: append straight to eventLog with an optional
 * shared dedup Set.  Kept so tests + transitional callers that pass an
 * `eventLog` (without an inbox) still work.  When all callers route
 * through the inbox this branch can be deleted.
 *
 * Connectivity Phase 2 — the append is a projection of the ONE canonical
 * chat Envelope via `toEventLogItem` (byte-identical: rehydrate carries
 * `senderDisplay: actor`, no media/presentation extras).
 */
function makeLegacyInsert({ eventLog, dedup }) {
  return async function legacyInsert(envelope) {
    if (dedup && dedup.has(envelope.msgId)) return false;
    if (dedup) dedup.add(envelope.msgId);
    const actor = envelope.fromActor ?? null;
    eventLog.append(toEventLogItem({
      msgId:    envelope.msgId,
      ts:       envelope.ts,
      circleId: envelope.circleId,
      actor,
      text:     envelope.text,
      senderDisplay: actor,
    }));
    return true;
  };
}

/**
 * THE ONE-TIME CHAT-HISTORY MIGRATION (store copy → persisted device log).
 *
 * The blessed exception to the no-backwards-compatibility rule: chat history is the one place a clean
 * break would break the product promise ("pod kwijt = ongemak, geen verlies"), so the store-era history
 * gets a REAL migration. Mechanically it is the rehydrator, run ONCE: every stored chat lands on the
 * device log through the shared inbox — and since the log persists, landing it once is migrating it.
 * A device-local MARKER latches success; later boots skip straight past. The marker is only set when the
 * pass reported no error, so a failed read retries on the next boot instead of silently losing history.
 * Store-era entries are unsigned render events — the record as it was; signed entries begin at the lane
 * cutover. After the latch, nothing reads the store's chat rows again on this device.
 *
 * @param {object} args
 * @param {Function} args.callSkill
 * @param {{ingestChatMessage: Function}} args.inbox   the shared inbox (ONE dedup domain)
 * @param {{get: () => Promise<string|null>|string|null, set: (v: string) => Promise<void>|void}} args.marker
 *   the device-local latch (web: localStorage; mobile: AsyncStorage)
 * @param {{warn?, info?}} [args.logger]
 * @returns {Promise<{migrated: boolean, alreadyDone?: boolean, rehydrated?: number, error?: string}>}
 */
export async function migrateKringChatHistory({ callSkill, inbox, marker, logger = console } = {}) {
  if (!marker || typeof marker.get !== 'function' || typeof marker.set !== 'function') {
    return { migrated: false, error: 'marker required' };
  }
  let done = null;
  try { done = await marker.get(); } catch { done = null; }
  if (done) return { migrated: false, alreadyDone: true };
  const res = await rehydrateKringChatsFromStoop({ callSkill, inbox, logger });
  if (res?.error) {
    logger?.warn?.('[chat-migration] history pass failed — will retry next boot:', res.error);
    return { migrated: false, error: res.error };
  }
  try { await marker.set(String(Date.now())); } catch { /* an unset latch just re-runs the idempotent pass */ }
  logger?.info?.(`[chat-migration] store history → device log: ${res.rehydrated} message(s), one-time`);
  return { migrated: true, ...res };
}

/** The migration latch's storage key — one per device, versioned with the migration itself. */
export const CHAT_MIGRATION_MARKER_KEY = 'cc.chatHistoryMigrated.v1';
