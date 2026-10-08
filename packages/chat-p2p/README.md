# `@onderling/chat-p2p`

> **Layer:** substrate. Cross-platform.
> **Distinct from `@onderling/chat-agent`** (LLM-mediated chat).
> Lifted from `apps/stoop/src/chat/wireChat.js` 2026-05-08 (Tasks
> V1 = rule-of-two consumer per
> `Project Files/Stoop/migration-tasks-v1-lifts-2026-05-08.md`).

Peer-to-peer chat over `agent.transport.sendOneWay`.

## What's in scope

- Send + receive of chat messages between agents.
- Thread bookkeeping by `threadId` (a string the sending app
  picks; Stoop uses the originating post's id).
- Reveal handshakes (`reveal-request` / `reveal-accept`) on top of
  the same envelope.
- Optional broadcast-post fan-out (Stoop's contact-broadcast
  pattern; opt-in via the `broadcast-post` subtype).
- Optional contact-add hint (`contact-add-request` subtype).
- Optional in-message attachment passing (`attachment-request` /
  `attachment-response` subtypes), with attachment-ref helpers
  injected by the app.

## What's NOT in scope

- LLM mediation (that's `@onderling/chat-agent`).
- The skill set (`sendChatMessage`, `getChatThread`,
  `listChatThreads`, etc.) — those are app-level for now. Tasks V1
  may lift them in a follow-up.

## Envelope wire shape

```js
{
  type:         'p2p-chat' | 'stoop-chat' (legacy),
  subtype:      'chat-message' | 'reveal-request' | 'reveal-accept'
                | 'broadcast-post' | 'contact-add-request'
                | 'attachment-request' | 'attachment-response',
  threadId:     <string>,
  body:         <string>,
  fromWebid:    <string>,
  fromStableId: <string|null>,
  sentAt:       <ms epoch>,
  nonce:        <base64url>,
  // ... subtype-specific extras
}
```

## Envelope-type config (mixed-version interop)

```js
import { wireChat } from '@onderling/chat-p2p';

// Stoop's back-compat configuration:
const chat = wireChat({
  agent, itemStore, members, muted, metrics,
  localActor:    'urn:me',
  localStableId: 'me-stable',
  emitEnvelopeType:      'stoop-chat',           // legacy sender
  acceptedEnvelopeTypes: ['p2p-chat', 'stoop-chat'],
});

// New deployments (Tasks V1, future apps):
const chat = wireChat({
  agent, itemStore, members,
  localActor:    'urn:me',
  // emitEnvelopeType + acceptedEnvelopeTypes left default →
  // emit 'p2p-chat', accept BOTH 'p2p-chat' and 'stoop-chat'.
});
```

The double-accept default keeps a mixed-version network working: a
Stoop-V1 peer sending `'stoop-chat'` is still readable by a peer
running the new substrate, and vice versa.

## Attachment support (optional)

Apps that ship in-message attachments wire helpers in:

```js
import { wireChat } from '@onderling/chat-p2p';
import { attachmentPath, readAttachmentBytesB64, MAX_CHAT_BYTES_PER_ATT }
       from './lib/Attachments.js';

const chat = wireChat({
  ...,
  attachmentSupport: {
    attachmentPath,             // (itemId, attId, mime) → string
    readAttachmentBytesB64,     // ({dataSource, ref}) → base64
    maxBytesPerAttachment:      MAX_CHAT_BYTES_PER_ATT,
  },
});
```

When `attachmentSupport` is absent, the attachment-related code
paths silently no-op — the substrate's chat surface is unaffected.

## Tests

5 substrate-side smoke tests pin the envelope-type contract.
End-to-end behaviour (send/receive, dedup, thread isolation,
reveal, broadcast-post, attachments, eviction) is exercised by
Stoop's existing 429-test suite via the shim in
`apps/stoop/src/chat/wireChat.js`.

## Origins

Stoop V1 Phase 14 invented `wireChat` — peer chat over
`core.taskExchange` + `agent.sendOneWay`. Phase 24/27 added contact
broadcast + auto-skill-match notifications. Phase 35 added the
eviction filter. Phase 39 added attachment support. Tasks V1
needs the same wire shape, so the rule-of-two trigger fires and
the substrate is born.
