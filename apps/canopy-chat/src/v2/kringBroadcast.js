// canopy-chat v2 — kring chat SEND primitives, shared by web (circleApp.js) and mobile
// (CircleLauncherScreen.js). The optimistic-append EVENT shape and the best-effort fan-out (with δ.2
// delivery-state transitions) were duplicated near-identically on both platforms; this is the one copy
// (web↔mobile consolidation Phase 2). Platform-neutral: the caller injects the RAW 3-arg callSkill, the
// δ.2 deliveryState map, and an `onChange` rerender hook (web `rerender()` / RN `setDeliveryTick`).

/**
 * Build the optimistic kring chat-message event for the local (append-only) EventLog. The same `msgId`
 * is later passed to `broadcastKringFanOut`, so receiver-side dedup suppresses any mirrored echo.
 *
 * @param {{msgId:string, ts:number, circleId:string, actor:string, text:string, buttons?:Array}} a
 */
export function kringChatMessageEvent({ msgId, ts, circleId, actor, text, buttons }) {
  return {
    id: msgId, ts, app: 'kring', type: 'chat-message', actor,
    payload: { circleId, text, kind: 'chat-message', ...(buttons?.length ? { buttons } : {}) },
  };
}

/**
 * Best-effort fan-out of a kring chat message to the circle's members via stoop's
 * `broadcastKringMessage`, tracking δ.2 delivery state (pending → sent | failed). Uses the RAW 3-arg
 * callSkill (app-targeted at stoop) — the 2-arg *resolving* callSkill arg-shifts (op→'stoop') and never
 * delivers. Fire-and-forget for callers; returns the promise so tests can await it.
 *
 * @param {object} a
 * @param {(app:string, op:string, args:object)=>Promise<any>} a.rawCallSkill
 * @param {string} a.circleId
 * @param {string} a.msgId
 * @param {string} a.text
 * @param {number} a.ts
 * @param {{set:(id:string, state:string|null)=>void}} a.deliveryStateMap
 * @param {()=>void} [a.onChange]   rerender hook fired on each state transition
 * @returns {Promise<void>}
 */
export function broadcastKringFanOut({ rawCallSkill, circleId, msgId, text, ts, deliveryStateMap, onChange }) {
  if (typeof rawCallSkill !== 'function') return Promise.resolve();
  const mark = (state) => { deliveryStateMap.set(msgId, state); onChange?.(); };
  mark('pending');
  return Promise.resolve()
    .then(() => rawCallSkill('stoop', 'broadcastKringMessage', { groupId: circleId, text, msgId, ts }))
    .then((r) => {
      if (r?.error) { console.warn('[kring-chat] fan-out skipped:', r.error); mark('failed'); }
      else if ((r?.errors?.length ?? 0) > 0) { console.info('[kring-chat] fan-out partial:', r); mark('failed'); }
      else { mark('sent'); }
    })
    .catch((err) => { console.warn('[kring-chat] fan-out failed:', err?.message ?? err); mark('failed'); });
}
