// Feedback-thread chat-history persistence (cluster J) — restore the feedback transcript on reload.
//
// The feedback bot thread (web `circleApp.js` `_fbThreads`, mobile `FeedbackThreadScreen`) keeps its
// messages in memory, so a reload/reopen loses the conversation. This is a DEVICE-LOCAL persistence store
// for that transcript: pure + storage-injected so it's shared web ≡ mobile (localStorage on web,
// AsyncStorage on mobile). Mirrors `createFeedbackBotStore` (feedbackBots.js): every method is async so the
// one implementation serves both a sync (`localStorage`) and an async (`AsyncStorage`) adapter — awaiting a
// non-promise just resolves to the value, so callers `await` uniformly.
//
// PRIVACY: the persisted transcript is the participant's OWN feedback content (what they typed, the bot's
// curated points). It stays LOCAL — device storage only — and is NEVER sent anywhere. This is the SAME
// trust boundary as the already-persisted own-pod Stage-1 data (`fp.ownpod.${threadId}`) and the per-bot
// language choice (`fp.lang.${threadId}`): local convenience state, not a network surface.
//
// Only a WHITELIST of serializable render fields is stored (never a blind JSON of a message that could hold
// a function / surface / DOM ref); history is capped to the most recent HISTORY_CAP messages so storage
// can't grow unbounded; and malformed/absent stored JSON reads back as [] (never throws).

// Per-thread key. Mirrors the `fp.lang.${threadId}` / `fp.ownpod.${threadId}` convention (one key per thread).
const keyFor = (threadId) => `fp.history.${threadId}`;

import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

// Bound on stored history. The feedback thread is a short guided flow (greeting → a few turns → review
// cards), so 200 messages is generous headroom; beyond it we keep the MOST RECENT and drop the oldest.
// Truncation is deliberate and documented (not silent): keep newest, drop oldest.
// Parameter register (#36) — scope:device, kind:internal (a storage bound). `param()` returns 200 unchanged.
export const HISTORY_CAP = param({ key: 'feedback.historyCap', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 200 });

// The ONLY fields persisted for a message. Everything else (functions, surface/mount refs, DOM nodes,
// transient render flags) is dropped. Keep in sync with the render objects the shells build:
//   { id, origin, text?, buttons?, kind?, intro?, logText?, points?, labels? }
const MESSAGE_FIELDS = ['id', 'origin', 'text', 'buttons', 'kind', 'intro', 'logText', 'points', 'labels'];

/** Pick only the whitelisted, non-function fields off a message → a plain, serializable render object. */
function pickMessage(m) {
  if (!m || typeof m !== 'object') return null;
  const out = {};
  for (const f of MESSAGE_FIELDS) {
    const v = m[f];
    if (v === undefined || typeof v === 'function') continue;
    out[f] = v;
  }
  return out;
}

/** Serialize a message to a JSON string, or null if it holds something non-serializable (circular DOM ref). */
function safeMessageJson(m) {
  const picked = pickMessage(m);
  if (!picked) return null;
  try {
    // Replacer drops any nested function defensively; a circular ref (e.g. a DOM node smuggled into a
    // button) still throws → caught below and that message is skipped rather than losing the whole batch.
    return JSON.stringify(picked, (_k, v) => (typeof v === 'function' ? undefined : v));
  } catch {
    return null;
  }
}

/**
 * Device-local feedback-transcript store.
 * @param {{ storage: { getItem(k):any, setItem(k,v):any } }} deps  a localStorage/AsyncStorage-shaped adapter.
 * @returns {{ load(threadId): Promise<Array>, save(threadId, messages): Promise<void> }}
 */
export function createFeedbackHistoryStore({ storage } = {}) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    throw new Error('createFeedbackHistoryStore: { storage } with getItem/setItem is required');
  }
  return {
    /** Restore the persisted transcript for a thread. Absent/malformed → [] (never throws). */
    async load(threadId) {
      try {
        const raw = await storage.getItem(keyFor(threadId));
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        // Re-pick on read so an older/hand-edited blob can't reintroduce stray fields.
        return parsed.map(pickMessage).filter(Boolean);
      } catch {
        return [];
      }
    },
    /** Persist the transcript (whitelisted fields, capped to the most recent HISTORY_CAP). Best-effort. */
    async save(threadId, messages) {
      try {
        const arr = Array.isArray(messages) ? messages : [];
        const recent = arr.length > HISTORY_CAP ? arr.slice(arr.length - HISTORY_CAP) : arr;
        const jsons = recent.map(safeMessageJson).filter((s) => s !== null);
        await storage.setItem(keyFor(threadId), `[${jsons.join(',')}]`);
      } catch {
        /* quota / disabled — history is a convenience, never block the flow. */
      }
    },
  };
}
