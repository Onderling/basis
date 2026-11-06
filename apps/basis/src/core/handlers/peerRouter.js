/**
 * Inbound peer-message subtype router. Bundle H (2026-05-27)
 * — lifted from the inline `onPeerMessage` block in
 * `apps/basis/web/main.js:346`.
 *
 * Shape matches what `sa.peer.connect({onPeerMessage})` calls when
 * an envelope arrives:
 *
 *     onPeerMessage({ from, payload }) → Promise<verdict>
 *
 * The dispatch is keyed on `payload.subtype`.  Callers supply a
 * `handlers` map; missing subtypes fall through to `defaultHandler`
 * (typical use: plain chat-message bubbles).  Handlers can be sync
 * or async — the router awaits internally + logs on rejection so
 * the caller never sees an unhandled promise.
 *
 * The router is portable: zero DOM, zero RN, no module-level state.
 * Each platform passes its own handler-map flavoured for its UI
 * (web → DOM bubbles, mobile → React state updates).  This is the
 * abstraction that lets basis-mobile process inbound peer
 * envelopes without duplicating the 100-line `if (subtype === …)`
 * chain from web/main.js.
 */

/**
 * @typedef {object} PeerEnvelope
 * @property {string} from
 * @property {object} payload          must carry `subtype` to be routed
 *
 * @typedef {(fromAddr: string, payload: object) => (void | Promise<*>)} PeerHandler
 */

/**
 * Build a subtype-dispatched onPeerMessage callback.
 *
 * @param {object}                args
 * @param {Object<string, PeerHandler>} args.handlers       subtype → handler map
 * @param {PeerHandler}           [args.defaultHandler]    fired when subtype is missing OR not in `handlers`
 * @param {{info?: Function, warn?: Function, error?: Function, debug?: Function}} [args.logger]
 * @returns {(env: PeerEnvelope) => Promise<*>}  resolves to the handler's verdict (see `_runSafe`); never rejects
 */
export function makePeerRouter({
  handlers   = {},
  defaultHandler,
  logger     = console,
} = {}) {
  return function onPeerMessage(env) {
    const { from, payload: rawPayload } = env ?? {};
    logger.info?.('[peer] received from', from, rawPayload);

    // A chat turn rides the A2A message shape — `{ type:'message', parts:[{ type:'DataPart', data }] }`
    // with the subtype INSIDE the part (chat-p2p's `buildChatWire`). Dispatch on that inner payload, so
    // a reply to a noticeboard post reaches its handler; the flat shape every other subtype uses is
    // untouched. Found by browser story 4: "[peer] unhandled subtype undefined" for every reply.
    const payload = unwrapDataPart(rawPayload);
    const subtype = payload?.subtype;
    const h = (subtype && typeof handlers[subtype] === 'function')
      ? handlers[subtype]
      : null;
    if (h) return _runSafe(h, from, payload, subtype, logger);
    if (typeof defaultHandler === 'function') return _runSafe(defaultHandler, from, payload, 'default', logger);
    logger.debug?.('[peer] unhandled subtype', subtype, 'from', from);
    return Promise.resolve(NOT_TAKEN);
  };
}

function unwrapDataPart(payload) {
  if (!payload || typeof payload !== 'object' || payload.subtype) return payload;
  if (payload.type !== 'message' || !Array.isArray(payload.parts)) return payload;
  const part = payload.parts.find((p) => p?.type === 'DataPart' && p.data && typeof p.data === 'object');
  return part?.data?.subtype ? part.data : payload;
}

/** What a frame nobody took resolves to: the secure agent does not record it, so a repeat is handed on again. */
export const NOT_TAKEN = Object.freeze({ refused: true });

/**
 * Run one handler and resolve to its VERDICT, never reject: the handler's own result when it returned (a handler
 * that did not take the frame says so with `{ refused: true }`), `NOT_TAKEN` when it threw or rejected. The secure
 * agent records a message as taken only on a verdict that is not a refusal, so a frame a handler could not take
 * yet (its sender not folded, its circle not known) stays retryable.
 */
function _runSafe(handler, from, payload, label, logger) {
  try {
    const r = handler(from, payload);
    if (r && typeof r.then === 'function') {
      return r.catch((err) => { logger.error?.(`[peer] ${label} failed`, err); return NOT_TAKEN; });
    }
    return Promise.resolve(r);
  } catch (err) {
    logger.error?.(`[peer] ${label} threw`, err);
    return Promise.resolve(NOT_TAKEN);
  }
}
