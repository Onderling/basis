/**
 * wireChat — thin Stoop shim around `@onderling/chat-p2p`.
 *
 * **2026-05-08:** the implementation lifted into the chat-p2p
 * substrate (Tasks V1 = rule-of-two consumer per
 * `Project Files/Stoop/migration-tasks-v1-lifts-2026-05-08.md`).
 *
 * The shim pre-binds three Stoop-specific knobs:
 *
 *   - `emitEnvelopeType: 'stoop-chat'` — Stoop continues to emit the
 *     legacy envelope type so peers running pre-lift code keep
 *     receiving messages. The substrate (and Tasks V1) emit
 *     `'p2p-chat'`. Both readers accept BOTH types via
 *     `acceptedEnvelopeTypes` so a mixed-version network stays
 *     interoperable.
 *
 *   - **No `attachmentSupport` (2026-07-11 — sealed-media).** Image
 *     attachments are now SEALED end to end: the per-circle stoop wrapper
 *     (basis's `scopeStoopCallSkill`) seals bytes + thumbnail through the
 *     circle media gateway and stoop carries only the opaque manifest-line
 *     pointer; recipients open it through their own gateway.  Stoop therefore
 *     no longer injects the Phase-39 plaintext helpers, which makes the
 *     chat-p2p `attachment-request`/`-response` + inline-`dataB64` handlers
 *     STRUCTURALLY INERT (their `if (!dataSource || !readAttachmentBytesB64)
 *     return;` guards short-circuit) — no plaintext bytes are ever served.
 *
 *   - All other Stoop-specific knobs (`itemStore`, `members`,
 *     `muted`, `evictionRoster`, `dataSource`) pass through verbatim.
 */

import { wireChat as substrateWireChat } from '@onderling/chat-p2p';

export function wireChat(args) {
  return substrateWireChat({
    ...args,
    emitEnvelopeType:      'stoop-chat',
    acceptedEnvelopeTypes: ['p2p-chat', 'stoop-chat'],
    // attachmentSupport intentionally OMITTED — see the module doc: sealed media
    // makes the chat-p2p plaintext attachment path inert.
  });
}
