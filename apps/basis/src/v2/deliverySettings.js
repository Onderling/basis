/**
 * basis v2 — the two delivery settings, and how a message row shows its state.
 *
 * Both settings are per user and per device, and they pull in opposite directions on purpose:
 *
 *   • **send delivery updates** (default ON) — whether MY app confirms to a sender that I stored their
 *     message. Turning it off is a privacy choice about what I emit.
 *   • **allow address fallback** (default OFF) — whether MY messages may route over my one global key when
 *     a per-circle address is unknown. Turning it on is a privacy cost I accept to be reachable.
 *
 * One is "say less about me", the other is "reveal more about me to be reachable". Keeping them in one
 * module is deliberate: they are the two knobs on the same question — *how much does the network learn in
 * exchange for the message getting there* — and a person deciding one is in the frame of mind to decide the
 * other.
 *
 * ── The rendering rule ───────────────────────────────────────────────────────────────────────────────────
 * `deliveryLabelFor` returns a locale key or **null**, and null means *render nothing*. It never returns a
 * "no information" label, because a persistent "unknown" badge on every message from a person who has
 * receipts off is precisely the disclosure `deliveryState.js` refuses to make — it would let anyone spot
 * the setting by looking at a conversation.
 */
import {
  DELIVERY, DELIVERY_LABELS, isDeliveryState, shouldSendReceipt, receiveReceipt, RECEIPT_MESSAGE,
} from './deliveryState.js';

/** Both settings, with their defaults. Only an explicit boolean changes one. */
export function deliverySettings(stored = {}) {
  return Object.freeze({
    // Default ON — useful, and the cost is small next to the message content the peer already has.
    sendReceipts: stored?.sendReceipts !== false,
    // Default OFF — the private behaviour is what you get without choosing (Frits, 2026-07-28).
    allowFallback: stored?.allowFallback === true,
  });
}

/** localStorage IO (web). One key, both settings — they are decided together. */
export function localStorageDeliveryIo(storage = globalThis.localStorage, key = 'cc.delivery') {
  return {
    load: () => { try { return JSON.parse(storage?.getItem(key) ?? '{}'); } catch { return {}; } },
    save: (v) => { try { storage?.setItem(key, JSON.stringify(v ?? {})); } catch { /* ignore */ } },
  };
}

/** AsyncStorage IO (mobile). */
export function asyncStorageDeliveryIo(AsyncStorage, key = 'cc.delivery') {
  return {
    load: async () => { try { return JSON.parse((await AsyncStorage?.getItem(key)) ?? '{}'); } catch { return {}; } },
    save: async (v) => { try { await AsyncStorage?.setItem(key, JSON.stringify(v ?? {})); } catch { /* ignore */ } },
  };
}

/**
 * A tiny store over that IO, mirroring `relayPref.js` so both shells wire it the same way.
 */
export function createDeliverySettingsStore({ load, save } = {}) {
  let current = null;
  return {
    async get() {
      if (current) return current;
      let stored = {};
      try { stored = (await load?.()) ?? {}; } catch { stored = {}; }
      current = deliverySettings(stored);
      return current;
    },
    async set(patch) {
      const base = await this.get();
      current = deliverySettings({ ...base, ...patch });
      try { await save?.({ ...current }); } catch { /* a failed save must not pretend it changed */ }
      return current;
    },
  };
}

/**
 * The label for a message's delivery state, or null when there is nothing honest to show.
 *
 * @param {string} state              from `deliveryState.js`
 * @param {object} [opts]
 * @param {boolean} [opts.mine=true]  only MY messages carry delivery state — showing it on someone else's
 *   would be reporting on their sending, which is not mine to display
 */
export function deliveryLabelFor(state, { mine = true } = {}) {
  if (!mine) return null;
  if (!isDeliveryState(state)) return null;   // unknown ⇒ show nothing, never an "unknown" badge
  return DELIVERY_LABELS[state] ?? null;
}

/**
 * Attach delivery state to chat rows.
 *
 * Rows come from the one projector; delivery lives beside them (it is about the send, not the entry), so
 * this joins the two rather than pushing delivery into the log — a message that was re-sent has one entry
 * and several attempts, and the log is not the place to record that.
 *
 * @param {object[]} rows
 * @param {Map<string,string>|object} deliveryById   messageId → state
 * @param {(row: object) => boolean} [isMine]
 */
export function withDelivery(rows, deliveryById, isMine = (r) => r?.mine === true) {
  const get = deliveryById instanceof Map
    ? (id) => deliveryById.get(id)
    : (id) => deliveryById?.[id];

  return (Array.isArray(rows) ? rows : []).map((row) => {
    const mine = !!isMine(row);
    const state = get(row?.id);
    const labelKey = deliveryLabelFor(state, { mine });
    return labelKey ? { ...row, delivery: state, deliveryLabelKey: labelKey } : row;
  });
}

/**
 * How a state is PRESENTED — glyph, whether it is retryable, and whether it shows at all.
 *
 * Extracted 2026-07-28 from an if/else chain in `circleKring.js` that hardcoded three states and their
 * locale keys. That chain was the *second* implementation of state→label (the first being `DELIVERY_LABELS`)
 * and it had a concrete cost, not just a stylistic one: it knew nothing of the far-end states, so
 * `reached-device` and `stored` would have rendered as silence in the one place they matter.
 *
 * `show: false` is the happy path staying clean — `sent` and `pending`-after-success add nothing to a
 * timeline. `retryable` is the only state a tap can help.
 */
export const DELIVERY_PRESENTATION = Object.freeze({
  // ── The three ordinary states, as ONE mark that changes weight and colour ────────────────────────────
  // Decision 1's visual (Frits asked for "colours or symbols, your call"). The rule the design encodes:
  //
  //   **colour means somebody told us; shape alone never claims more than "it left here".**
  //
  // So the same mark carries all three: hollow while it is still here, filled once it has gone, and
  // accented only when a receipt the recipient CHOSE to send came back. Deliberately one glyph rather
  // than three, so the difference a reader has to notice is small and consistent — and so the accent is
  // the only thing that ever asserts arrival.
  pending:          { glyph: '○', tone: 'muted',  show: true,  retryable: false },
  // Filled, still neutral. This is where a message rests whenever the other side has not chosen to
  // confirm — identical whether they are offline or have receipts off, which is J-D5 (see deliveryState).
  'maybe-received': { glyph: '●', tone: 'neutral', show: true,  retryable: true },
  // The one positive rung, and the only one with colour.
  stored:           { glyph: '●', tone: 'accent',  show: true,  retryable: false },
  // ── Failure keeps its own shapes, so it can never be mistaken for a quiet state ─────────────────────
  failed:           { glyph: '⚠', tone: 'warn',   show: true,  retryable: true },
  // Permanent (e.g. a member has no published key). Shown, but no retry — retrying cannot help.
  undeliverable:    { glyph: '⊘', tone: 'warn',   show: true,  retryable: false },
});

/** How to draw one state, or null when it should not appear. Pairs with `deliveryLabelFor`. */
export function deliveryPresentation(state, { mine = true } = {}) {
  if (!mine || !isDeliveryState(state)) return null;
  const p = DELIVERY_PRESENTATION[state];
  if (!p?.show) return null;
  // `tone` is a NAME, not a colour value: the shells map it to their own palette, so web and mobile cannot
  // drift on which states are coloured even if their hues differ.
  return { state, glyph: p.glyph, tone: p.tone, retryable: p.retryable, labelKey: DELIVERY_LABELS[state] };
}

/**
 * ⚠️ **There is no `recordDelivery` here, deliberately.**
 *
 * Storing per-message delivery state already exists: `createDeliveryStateMap` in
 * `@onderling/kring-host/deliveryState`, shared by both shells since δ.2, with subscriptions and pruning.
 * A second store would be a third implementation of one idea — the exact failure
 * `docs/conventions/shared-vocabularies.md` was written about, found by following its own advice.
 *
 * That map now carries the full ladder and the forward-only rule. Use it:
 *
 *     import { createDeliveryStateMap } from '@onderling/kring-host/deliveryState';
 *     map.set(msgId, deliveryAfterSend(outcome));   // monotonic, retry-aware
 *     map.get(msgId);                               // → a state for `deliveryLabelFor`
 */

/**
 * The receipt SENDER — wired to the inbox's `onStored` hook.
 *
 * Policy lives here, not in the inbox, and two refusals carry it:
 *
 *   • **only `source: 'receiver'`.** The inbox also inserts from the rehydrator, catch-up and pod replay —
 *     firing receipts there would confirm months of history to peers on every boot, and to people who have
 *     long since left. A receipt is about a message that just ARRIVED, once.
 *   • **the setting is read PER MESSAGE**, not captured at wiring time, so flipping "stop confirming"
 *     takes effect on the very next message — and reading it can fail without breaking the receive path.
 *
 * @param {object} deps
 * @param {() => Promise<object>|object} deps.getSettings   → `{ sendReceipts }` (the delivery store's get)
 * @param {(address: string, payload: object) => Promise<any>} deps.sendTo
 * @param {{warn?: Function}} [deps.logger]
 * @returns {(stored: { msgId, fromPeerAddr, source }) => Promise<void>}
 */
export function makeReceiptSender({ getSettings, sendTo, logger = console } = {}) {
  return async function onStored({ msgId, fromPeerAddr, source } = {}) {
    if (source !== 'receiver' || !msgId || !fromPeerAddr) return;
    // If the settings cannot be READ, no receipt goes out. The store's default is ON, but "we could not
    // check" is not "on": a user who turned receipts off and then hit a broken store would otherwise start
    // confirming again — an error leaking a choice. Silence is recoverable; a sent receipt is not.
    let settings;
    try { settings = await (typeof getSettings === 'function' ? getSettings() : getSettings); }
    catch { return; }
    if (!settings || !shouldSendReceipt(settings)) return;
    try { await sendTo(fromPeerAddr, { subtype: RECEIPT_MESSAGE, messageId: msgId }); }
    catch (err) { logger?.warn?.('[delivery] receipt send failed (best-effort):', err?.message ?? err); }
  };
}

/**
 * Apply an inbound receipt to the shared per-message map.
 *
 * Validation first (`receiveReceipt`: rebuilt, `from` off the wire), then advance to `stored` — the map's
 * own monotonic rule handles ordering.
 *
 * ── Why the id must already be known (S6 · J-A5, 2026-07-29) ─────────────────────────────────────────
 * `receiveReceipt` takes the sender off the wire, which stops a payload naming someone else. That is only
 * half the job: the sender was then **discarded**, and the receipt applied whatever it named. So anyone
 * able to send this device a peer message could mark any message id `stored` — and an id that did not
 * exist was created, which is attacker-controlled growth in a map that nothing bounds.
 *
 * The gate is the map's own key set. Every message this device SENDS is marked `pending` before the
 * fan-out starts, so the keys are exactly "messages I sent". A receipt for anything else — a message
 * somebody else sent, or one that never existed — is now refused rather than believed. That is the whole
 * of what a receipt is for: advancing my own send.
 *
 * What this does NOT close, stated plainly: a genuine recipient of my message can still send its receipt
 * early, so `stored` can be claimed before it is true by someone who really is in the circle. Closing
 * that needs the per-message recipient set, which this module does not hold — hence `isRecipient`, an
 * optional host-injected predicate. Absent, the check degrades to the id gate above rather than to
 * nothing, and never to refusing honest receipts.
 *
 * ⚠️ **Group semantics, stated rather than hidden:** the δ.2 map is per-MESSAGE, so in a circle of five,
 * `stored` means *at least one member's app stored it*. That is honest for a pairwise chat and an
 * approximation for a group; per-recipient states are a refinement recorded in DECISIONS-FOR-REVIEW, not
 * quietly implied by the label.
 *
 * @param {object} payload           the inbound wire payload
 * @param {string|null} fromAddress  the sender, off the wire — never from the payload
 * @param {{get:Function, set:Function}} deliveryMap
 * @param {{ isRecipient?: (from: string|null, msgId: string) => boolean }} [opts]
 * @returns {boolean} whether a valid receipt was applied
 */
export function applyReceipt(payload, fromAddress, deliveryMap, { isRecipient = null } = {}) {
  const receipt = receiveReceipt(payload, fromAddress);
  if (!receipt || typeof deliveryMap?.set !== 'function') return false;
  // A receipt may only advance a message THIS device sent. `get` returns null/undefined for an id the
  // map never had; both mean the same thing here.
  if (typeof deliveryMap.get !== 'function') return false;
  const known = deliveryMap.get(receipt.messageId);
  if (known === null || known === undefined) return false;
  // …and, where the host can tell us, only from someone the message actually went to.
  if (typeof isRecipient === 'function') {
    let ok = false;
    try { ok = isRecipient(receipt.from, receipt.messageId) === true; } catch { ok = false; }
    if (!ok) return false;
  }
  deliveryMap.set(receipt.messageId, DELIVERY.STORED);
  return true;
}
