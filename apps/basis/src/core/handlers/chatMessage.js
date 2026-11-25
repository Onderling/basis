/**
 * Inbound chat-message handler. Bundle H (2026-05-27)
 * lifted from `apps/basis/web/main.js:425` (, 2026
 * 05-24).
 *
 * Receives a peer's plain-text envelope and renders it in the DM
 * thread paired with `fromAddr`.  Auto-spawns the DM thread on
 * first contact.  Silently drops envelopes lacking a `body` field
 * (those are secure-agent infrastructure — HI handshakes, claims,
 * mute-list sync — and would otherwise paint UI garbage like
 * `📨 {"pubKey":"…"}`).
 *
 * Two injected deps draw the line between portable code and the
 * platform's UI:
 *
 *   - `ensureDmThread(peerAddr) → {id, ...}` — find OR create the
 *     DM thread paired with the peer; the implementation lives
 *     wherever the host's thread store does (web: store.createThread
 *     with filter.dm; mobile: ensureDmThread reducer on threadState).
 *   - `appendBubble(threadId, rendered) → void` — write a rendered
 *     bubble (output of `renderReply`) into the named thread.  Each
 *     platform wraps it in its native message shape (web:
 *     addShellMessage; mobile: {id, role:'bot', rendered}).
 *
 * Optional `updatePeerDisplay(peerAddr, displayName)` folds an
 * inbound `senderDisplay` into the DM thread name + anywhere else
 * the peer is shown.  No-op fallback is fine.
 *
 * @param {object} args
 * @param {(peerAddr: string) => ({id: string} | null)}                args.ensureDmThread
 * @param {(threadId: string, rendered: object) => void}                args.appendBubble
 * @param {(peerAddr: string, displayName: string) => void}             [args.updatePeerDisplay]
 * @param {(key: string, vars?: object) => string}                      args.t
 * @param {{info?: Function, warn?: Function, error?: Function, debug?: Function}} [args.logger]
 * @returns {(fromAddr: string, payload: object) => void}
 */
import { renderReply } from '../../renderer.js';
import { NOT_TAKEN } from './peerRouter.js';

export function makeHandleChatMessage({
  ensureDmThread,
  appendBubble,
  updatePeerDisplay,
  t,
  logger = console,
} = {}) {
  if (typeof ensureDmThread !== 'function') throw new Error('makeHandleChatMessage: ensureDmThread required');
  if (typeof appendBubble   !== 'function') throw new Error('makeHandleChatMessage: appendBubble required');
  if (typeof t              !== 'function') throw new Error('makeHandleChatMessage: t required');

  return function handleChatMessage(fromAddr, payload) {
    const hasBody = payload && typeof payload === 'object'
      && typeof payload.body === 'string' && payload.body !== '';
    if (!hasBody) {
      // Diagnostic only.  Infrastructure envelopes (HI/claims/handshake)
      // routinely arrive without a body — they're handled inside sa.peer.
      logger.debug?.('[peer] non-chat envelope from', String(fromAddr).slice(0, 16) + '…', payload);
      return NOT_TAKEN;   // not a chat turn: not taken, so a named subtype nobody handles is answered (not dropped)
    }
    if (payload.senderDisplay && typeof updatePeerDisplay === 'function') {
      updatePeerDisplay(fromAddr, payload.senderDisplay);
    }
    const thread = ensureDmThread(fromAddr);
    if (!thread) {
      logger.warn?.('[peer] no thread to deliver to — dropped:', payload.body);
      return;
    }
    const rendered = renderReply({
      payload:  `📨 ${payload.body}`,
      shape:    'text',
      threadId: thread.id,
    }, { t });
    appendBubble(thread.id, rendered);
  };
}
