# Convention: cross-pod references

> **Status:** deliverable (per transition doc §V.5). Documents the
> `embeds` field shape on canonical item types + the permission-
> failure rendering policy. Substrate primitives live in
> `@onderling/item-types` (schema) + `@onderling/item-store/embeds`
> (traversal).
>
> **Locked 2026-05-14.**

## `embeds` field shape

Every canonical item type carries an optional `embeds` field via
the BASE_PROPERTIES spread in `@onderling/item-types/src/baseSchema.js`:

```js
embeds: [
  { type: 'task',         ref: 'https://anne.pod/tasks/abc' },
  { type: 'photo',        ref: 'pseudo-pod://bob-device/photos/x.jpg' },
  { type: 'item',         ref: 'urn:dec:item:01HX9...' }
]
```

Each `embeds` entry has two required fields:

- **`type`** — the canonical item-type name of the referenced
  thing (from `@onderling/item-types`). Consumers use this to pick
  the right renderer (compact chip, full embed, …) without having
  to fetch the resource first.
- **`ref`** — the resource URI. Three accepted shapes:
  - `https://...` — real pod URI (fetched via `pod-client.read`).
  - `pseudo-pod://<deviceId>/...` — pseudo-pod URI (fetched via
    `pseudoPod.read`).
  - `urn:dec:item:<ulid>` — within-store item ID (looked up via
    the local `item-store`).

The schema lives at
`packages/item-types/src/embedsSchema.js`. Apps that emit canonical
items get the `embeds` field for free via the BASE_PROPERTIES
spread; apps that read it use `@onderling/item-store/src/embeds.js`'s
walker.

## What `embeds` is for

The original problem: a Pinboard post wants to attach a Tasks task; a
Folio note wants to reference a Pinboard supply-offer; a Tasks task
wants to attach a photo. Cross-app + cross-pod references are
**first-class** in the canonical model.

Three patterns:

1. **Compact-chip render** — the renderer for `type=task` knows how
   to render a one-line preview ("Anne's task — paint the fence —
   due Friday"). The reader doesn't have to fully load the
   referenced item to show the chip.
2. **Tap-through expand** — when the user taps the chip, the
   renderer fetches the full referenced item + opens it (in-app
   if the app handles `type=task`; via a deep link otherwise).
3. **Hard-dep walk** — for compound items (e.g., a Tasks task that
   `embeds` its work-log), the substrate walks `embeds` recursively
   to materialise the full graph. See `item-store/src/embeds.js`
   for the walker.

## Permission-failure rendering

A common case: Anne's item embeds a Bob-pod resource that Anne
doesn't have read access to. The fetch fails with 401/403. How
should the renderer behave?

**Lock 2026-05-14 — three-tier render fallback:**

| Fetch outcome | Renderer behaviour |
|---|---|
| 200 OK with body | Render the full embed (compact chip OR full expand per UX). |
| 304 Not Modified | Render the cached body if present; else 200-path. |
| 401 / 403 (permission denied) | Render a **redacted placeholder** with the item's `type` + the ref + a "request access" affordance. The reader sees that SOMETHING is embedded; the contents are not exposed. |
| 404 / 410 (gone) | Render a **broken-ref placeholder** with `type` + the ref + an "this content is no longer available" note. No retry. |
| Network / 5xx (transient) | Render a **loading placeholder** + retry on next render pass. After N retries, fall back to broken-ref shape. |
| Untrusted scheme / parse error | Render **nothing**; log a warning. Don't surface ill-formed embeds. |

The placeholders are app-rendered; the substrate's job is to
return a typed result (`{ok: true, body}` / `{ok: false, code: '...'}`)
so the renderer can switch on it cleanly.

## Walker semantics

`item-store/src/embeds.js`'s walker traverses two relation kinds:

- **`deps`** (hard dependencies — implicit `embeds: [{type,ref}]`
  entries where `type==='item'`)
- **`embeds`** (cross-type refs — every other entry)

The walker returns a tree (`{ id, deps[], embeds[] }`) rooted at
the starting item. Refs outside the local store appear as **leaf
nodes** with a `external: true` flag — the walker doesn't fetch
across pods automatically. Callers fetch externals explicitly when
they want them (and apply the permission-failure render fallback).

This means the walker is **cheap** (in-memory traversal of the
local store) and the **cost of cross-pod fetches is opt-in**.

## Bidirectional refs

A note: `embeds` is **forward-only**. The embedding item points at
the embedded item, not vice-versa. The embedded item doesn't know
who embeds it — fan-in is not tracked.

For bidirectional pointers (e.g., a task that points at its
parent work-log AND the work-log points at the task), use two
`embeds` entries — one on each side. The substrate doesn't
enforce consistency; it's the app's job to maintain both.

## Constraints + non-goals

- **No cycle detection in the walker.** Apps that embed cyclic
  graphs (item A embeds item B which embeds item A) MUST cap the
  walk depth themselves. The default walker has a depth limit
  (see `item-store/src/embeds.js`).
- **No automatic deep-fetch on read.** A `pod-client.read` of an
  item doesn't automatically fetch the items it embeds. Apps that
  want the deep tree call the walker + fetch externals explicitly.
- **No write-side enforcement.** When an app writes an item with
  `embeds: [{type, ref}]`, the substrate doesn't verify the ref
  resolves to an actual `type`-shaped item. Type drift between
  apps is a known cost; the type-schema versioning policy
  (§"Open questions" #6, ratified 2026-05-14) handles renames /
  additions.
- **No schema migration for `embeds` shape itself.** The
  `{type, ref}` shape is part of the BASE_PROPERTIES; changing it
  would be a versioning bump on every item type. Out of scope.

## Pointers

- `packages/item-types/src/embedsSchema.js` — schema definition
- `packages/item-types/src/baseSchema.js` — BASE_PROPERTIES spread
- `packages/item-store/src/embeds.js` — walker + tree-node shape
- `packages/item-types/README.md` — taxonomy + versioning policy
- Substrates-v2 functional design §II.4 — cross-pod refs design
  rationale
