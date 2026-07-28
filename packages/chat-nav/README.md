# `@onderling/chat-nav`

> **Layer: substrate.** Tiny helper substrate for the basis
> ⇄ side-panel navigation protocol (design choice B.1).

| | |
|---|---|
| **Status** | v0.1.0 — shipped in basis v0.3.3 |
| **Companion docs** | `/DESIGN-basis.md` § "Chat ⇄ side-panel navigation (B.1)", `/DESIGN-basis-journeys.md` design choice B.1 |
| **Conventions** | [`architectural-layering.md`](../../docs/conventions/architectural-layering.md) — substrate layer; pure utilities, no app coupling |

---

## The protocol it implements

Per the journeys doc choice B (and its B.1 sub-decision):

- **Chat → side surface**: chat replies can carry navigation links
  to settings / logs / file-dir pages.  Every such link is built
  with `?returnTo=<threadId>` so the destination knows who sent
  the user.
- **Side surface → chat**: every page that the chat shell may link
  to renders a **floating "back to chat" button** when arrived from
  chat, returning to the originating thread.

## API

```js
import {
  getReturnTo, useReturnToChat, buildChatUrl,
  renderFloatingButton, removeFloatingButton,
} from '@onderling/chat-nav';
```

### Reading the param (on a side-panel page)

```js
const ret = getReturnTo();              // → 'main' | null

// React-flavoured alias (still vanilla JS):
const back = useReturnToChat({ chatPath: '/chat' });
// → { threadId: 'main', chatHref: '/chat?focus=main' } | null

if (back) renderFloatingButton(document.body, {
  returnTo: back.threadId,
  chatPath: '/chat',
});
```

### Generating chat-side links

```js
import { buildChatUrl } from '@onderling/chat-nav';

const settingsHref = `/settings?returnTo=${encodeURIComponent(thread.id)}`;
const chatHref     = buildChatUrl('/chat', thread.id);
// → '/chat?focus=main'
```

### Floating button

```js
renderFloatingButton(document.body, {
  returnTo: 'main',
  chatPath: '/chat',
  label:    '← back to chat',     // default label; override per app
  onNavigate: (href) => router.push(href),   // SPA-friendly
});
```

Inline-styled out of the box (no CSS dependency); apps with a design
system override via the `.basis-nav-back-button` class.

Idempotent — calling `renderFloatingButton` twice replaces the
existing button rather than stacking.

`removeFloatingButton(host)` removes it (e.g. on navigation away
from the side-panel page).

## Why a substrate, not an app-internal helper

Every Onderling app's settings / logs / file-dir page needs this
behaviour.  Lifting it to a substrate means:

- One code path for the protocol (no per-app drift)
- Easy to upgrade later (e.g. add a transition animation)
- RN apps can compose the same returnTo + button pattern via a
  parallel `@onderling/chat-nav/rn` export when that ships

## What it isn't

- **Not a router.** It assigns to `location.href` by default; SPA
  apps pass `onNavigate` to integrate with their router.
- **Not a state container.** Threads + chat state live in the
  basis app; this just shuttles a threadId through URL params.
- **Not React-bound.** The `useReturnToChat` name is a hint; the
  function works in any JS context that can read `globalThis.location`.

## Tests

```bash
pnpm --filter @onderling/chat-nav test
```

Coverage: 22 tests — query-param parsing, URL building, floating
button render + click + replace + remove + onNavigate override.
