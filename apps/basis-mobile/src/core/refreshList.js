/**
 * State-morphing helper for step 3.
 *
 * After a row-button-tap dispatch completes successfully, we want
 * the ORIGINATING list bubble to refresh in place so its rows
 * reflect the post-dispatch item state (e.g. [Claim] → [Mark
 * complete]).  Without this, the user sees a fresh bubble pair
 * (their tap + the response) but the source list stays frozen in
 * its pre-tap shape — confusing.
 *
 * Mirrors `apps/basis/web/main.js`'s
 * `refreshListMessageInPlace`, scoped to what the mobile shell
 * needs.  Portable: no RN, no DOM.  ChatScreen wires it into its
 * messages-state reducer.
 *
 * What this file does NOT cover (deferred):
 *   - thread-scoped refresh (we don't have threads on mobile yet)
 *   - eventRouter fan-out across multiple list messages with the
 *     same source-op (web fans, mobile only re-renders one bubble)
 *   - tearing on rapid concurrent taps (V1: last-write-wins; if
 *     two taps race the second's render replaces the first)
 */
import {
  runDispatch, renderReply, resolveDispatch,
} from '@onderling-app/basis';

import { dlog } from './devLog.js';

/**
 * Re-execute the dispatch that produced an original list bubble and
 * return a fresh RenderedReply.  The caller mutates the messages
 * array, replacing the bubble's `rendered` field.
 *
 * @param {object} args
 * @param {object} args.sourceDispatch     the original dispatch (with
 *                                          kind:'ready', opId, args, appOrigin)
 * @param {object} args.catalogue            from bundle.catalogue
 * @param {object} args.manifestsByOrigin  from bundle.manifestsByOrigin
 * @param {function} args.callSkill        from bundle.callSkill
 * @param {function} [args.t]              localiser for sync hints + button labels
 *
 * @returns {Promise<object|null>}  fresh RenderedReply, or null when
 *   the source dispatch can't be re-run (missing op, non-ready, etc.).
 */
export async function refreshList({
  sourceDispatch, catalogue, manifestsByOrigin, callSkill, t,
}) {
  if (!sourceDispatch || sourceDispatch.kind !== 'ready') {
    dlog.warn('refreshList: skip, sourceDispatch not ready', sourceDispatch?.kind);
    return null;
  }
  if (!catalogue?.opsById?.get(sourceDispatch.opId)) {
    dlog.warn('refreshList: skip, opId not in catalogue', sourceDispatch.opId);
    return null;
  }
  try {
    const reply = await runDispatch(sourceDispatch, callSkill);
    // runDispatch catches internal throws + surfaces them as
    // `reply.error`.  For state-morphing we want to KEEP the
    // pre-existing bubble untouched on any failure, so coerce
    // an error reply back into "no update".
    if (reply?.error) {
      dlog.warn('refreshList: dispatch returned error reply', reply.error);
      return null;
    }
    const rendered = renderReply(reply, {
      t,
      appOrigin:         sourceDispatch.appOrigin,
      manifestsByOrigin,
    });
    dlog.render('refreshList', {
      opId:        sourceDispatch.opId,
      kind:        rendered.kind,
      itemCount:   rendered.items?.length ?? 0,
      buttonCount: (rendered.items ?? [])
        .reduce((n, it) => n + (it.buttons?.length ?? 0), 0),
    });
    return rendered;
  } catch (err) {
    dlog.warn('refreshList threw', err?.message ?? err);
    return null;
  }
}

/**
 * Synthesize a source dispatch from a list-shape dispatch's
 * `opId` + `args`.  Used by the row-tap handler to remember
 * "what produced this bubble" without storing the full dispatch
 * object (simpler messages-state shape).
 *
 * Returns a ready dispatch that, when re-run, hits the same op
 * with the same args.  Pure — no I/O.
 */
export function snapshotSourceDispatch({ opId, args, appOrigin, threadId, replyShape }) {
  return {
    kind:       'ready',
    opId,
    args:       { ...(args ?? {}) },
    appOrigin,
    threadId:   threadId ?? null,
    replyShape: replyShape ?? 'list',
  };
}

/**
 * Resolve the source dispatch from a list bubble's reply context
 * via the catalogue (alternative to snapshotSourceDispatch when we
 * only have opId + args at the call site).  Mostly here as a seam
 * for tests.
 */
export function resolveSourceDispatch({ opId, args, catalogue, threadId }) {
  return resolveDispatch({
    kind: 'slash', opId, args: args ?? {}, threadId: threadId ?? null,
    command: '(refresh)', body: '',
  }, catalogue);
}
