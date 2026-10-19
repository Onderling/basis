/**
 * Button-tap special-case interceptor (step 7).
 *
 * Mirrors `apps/basis/web/main.js`'s `onButtonTap` short-circuits
 * for ops that should not go through the regular resolveDispatch path:
 *
 *   - `respondToItem` ([Help with]) — spawn a new mobile thread + park
 *     a `respondToItem` single-field follow-up there.  The user's first
 *     message in the new thread dispatches respondToItem with body=text.
 *   - `startDm`        ([Start DM])  — spawn a new mobile thread.  No
 *     substrate dispatch (chat-shell-internal).
 *   - `downloadFile`   ([Download])  — render a friendly text bubble
 *     in the current thread; mobile blob-download is not wired yet.
 *
 * Pure / portable.  Returns a declarative `action` shape — ChatScreen
 * decides how to apply it.  Keeps the interceptor unit-testable
 * without spinning up a React tree.
 *
 * Web reads `extra.embed.snapshot.dataB64` on downloadFile to trigger
 * a real blob download.  Mobile V1 simply explains the gap; a future
 * pass can wire expo-sharing / expo-file-system.
 */

/**
 * @typedef {object} InterceptResultPassThrough
 * @property {false} handled
 *
 * @typedef {object} InterceptResultSpawnThread
 * @property {true}  handled
 * @property {'spawn-thread' | 'spawn-thread-with-followup' | 'inline-text'} kind
 * @property {string} [threadName]
 * @property {object} [followUp]    pending single-field follow-up to park in the new thread
 * @property {string} [text]        text to render inline when kind === 'inline-text'
 * @property {string} [userBubble]  optional user-bubble text to append BEFORE the action
 *
 * @typedef {InterceptResultPassThrough|InterceptResultSpawnThread} InterceptResult
 */

/**
 * Try to handle a row-button tap with a special-case action.
 *
 * @param {object}   args
 * @param {string}   args.opId
 * @param {string}   args.itemId
 * @param {string}   args.buttonLabel
 * @param {function} args.t            localiser
 * @param {object} [args.embed] item.embed forwarded from the rendered list-row (followup-1)
 * @param {object} [args.extra] extra context a bubble attaches to its tap
 * @returns {InterceptResult}
 */
export function interceptButtonTap({ opId, itemId, buttonLabel, t, embed, extra, peerAddr }) {
  // [Help with] → spawn a thread + single-field follow-up for `body`.
  // The follow-up shape matches what `beginFollowUp` produces so
  // ChatScreen's existing single-field completion path picks it up
  // verbatim.  We hand-roll it here (instead of round-tripping through
  // resolveDispatch) because we already know the missing param.
  if (opId === 'respondToItem') {
    return {
      handled: true,
      kind:    'spawn-thread-with-followup',
      threadName: t('threads.help_with_thread_name', { itemId }),
      userBubble: t('chat.button_tap', { label: buttonLabel, item: itemId }),
      followUp: {
        kind:          'single',
        opId:          'respondToItem',
        appOrigin:     'pinboard',
        threadId:      null,
        replyShape:    'text',
        prefilledArgs: { itemId },
        missingParam:  'body',
        promptText:    t('chat.followup_prompt_respond_to_item_body'),
        // originMessageId is filled in by ChatScreen at apply time so
        // post-completion list refresh can still target the original
        // bubble in the ORIGINATING thread.
        originMessageId: null,
      },
    };
  }

  // [Start DM] → spawn a DM-flavoured thread.  The peerAddr field is
  // what makes free-text routing in that thread send a chat-message
  // envelope to the right peer (otherwise the thread is just an
  // unflagged container + parseInput rejects the text as unknown).
  // We prefer the row-supplied peerAddr (the contact's peer address
  // captured from /share-my-contact's card) over the row's itemId
  // (the contact's webid/stableId, which isn't an NKN destination).
  if (opId === 'startDm') {
    const target = (typeof peerAddr === 'string' && peerAddr) ? peerAddr : itemId;
    return {
      handled: true,
      kind:    'spawn-thread',
      threadName: t('threads.dm_thread_name', { peerId: target }),
      peerAddr:   target,
      userBubble: t('chat.button_tap', { label: buttonLabel, item: target }),
    };
  }

  // [Download] — when the rendered list-row carries an inline file
  // snapshot (embed.snapshot.dataB64), save it via expo-file-system
  // (followup-1). Without bytes — folio returning only a
  // pod-URL reference rather than inline bytes — fall back to the
  // friendly "not wired" bubble so the user sees something.
  if (opId === 'downloadFile') {
    const snap = embed?.snapshot;
    if (snap?.dataB64) {
      return {
        handled: true,
        kind:    'save-file',
        userBubble: t('chat.button_tap', { label: buttonLabel, item: itemId }),
        dataB64: snap.dataB64,
        name:    snap.name ?? snap.id ?? itemId,
        mime:    snap.mime ?? 'application/octet-stream',
      };
    }
    return {
      handled: true,
      kind:    'inline-text',
      userBubble: t('chat.button_tap', { label: buttonLabel, item: itemId }),
      text:    t('chat.download_not_wired', { fileId: itemId }),
    };
  }

  return { handled: false };
}
