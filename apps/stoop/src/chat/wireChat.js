/**
 * wireChat — thin Stoop shim around `@onderling/chat-p2p`.
 *
 * **2026-05-08:** the implementation lifted into the chat-p2p
 * substrate (Tasks V1 = rule-of-two consumer per
 * `Project Files/Stoop/migration-tasks-v1-lifts-2026-05-08.md`).
 *
 * The shim pre-binds Stoop's envelope knobs:
 *
 *   - `emitEnvelopeType: 'stoop-chat'` — Stoop continues to emit the
 *     legacy envelope type so peers running pre-lift code keep
 *     receiving messages. The substrate (and Tasks V1) emit
 *     `'p2p-chat'`. Both readers accept BOTH types via
 *     `acceptedEnvelopeTypes` so a mixed-version network stays
 *     interoperable.
 *
 *   - **No attachment bytes in chat.** Image attachments are SEALED end to
 *     end: the per-circle stoop wrapper (basis's `scopeStoopCallSkill`) seals
 *     bytes + thumbnail through the circle media gateway and stoop carries only
 *     the opaque pointer; recipients open it through their own gateway.  The
 *     older plaintext fetch route (the author answering an
 *     `attachment-request` with base64 bytes) was superseded by that path and
 *     removed from chat-p2p on 2026-10-07.
 *
 *   - All other Stoop-specific knobs (`itemStore`, `members`,
 *     `muted`, `evictionRoster`, `reliableSend`) pass through verbatim.
 */

import { wireChat as substrateWireChat } from '@onderling/chat-p2p';

export function wireChat(args) {
  return substrateWireChat({
    ...args,
    emitEnvelopeType:      'stoop-chat',
    acceptedEnvelopeTypes: ['p2p-chat', 'stoop-chat'],
  });
}
