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
import { DELIVERY_LABELS, isDeliveryState } from './deliveryState.js';

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
