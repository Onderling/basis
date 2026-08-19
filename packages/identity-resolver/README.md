# @onderling/identity-resolver

> **Layer: substrate.** Composes the `@onderling/core` SDK. Substrates MUST NOT reinvent SDK primitives (transports, vaults, auth, merge contracts, push, skill registries, identity, emitters, ULID); when the SDK *almost* fits, extend it additively rather than forking. See [`Project Files/conventions/architectural-layering.md`](../../docs/conventions/architectural-layering.md).

Member-webid map (light) + cross-source Person graph (heavier).
Two complementary classes for **identity reconciliation across
systems**.

This is **L1h** in the substrate-first plan
(`Project Files/Substrates/L1h-identity-resolver.md`).

## When to use which

- **`MemberMap`** — H2/H4/H5 use this.  Maps webid ↔ external-id
  (`telegramUid`, `email`, ...) ↔ display name ↔ role.  Single household
  / single closed group.
- **`Reveals` + `resolve()`** — Stoop / social-shaped apps.  Layer
  *on top of* `MemberMap`: per-group + per-peer "show real name"
  state, plus a pure resolution function that returns the right
  rendered name for a (viewer, target, group?) tuple.  Powers
  Telegram-style "handle by default, displayName after a reveal
  handshake".  See `Project Files/Stoop/advice-2026-05-05.md` §
  "Handle / nickname design" for the design.
- **`PersonGraph`** — H7 uses this.  Aggregates identifiers across
  sources (Gmail, WhatsApp, iCloud, ...).  Auto-link on identifier
  collision; manual `link()` for user-asserted merges.

## MemberMap quick start

```js
import { MemberMap } from '@onderling/identity-resolver';

const map = new MemberMap();
await map.addMember({
  webid:       'https://id.inrupt.com/anne',
  handle:      'oosterpoort-bird-23',  // Stoop-shape: lowercase primary UI id
  displayName: 'Anne',                 // shown after reveal (see Reveals)
  avatarUrl:   'https://anne.example/avatar.jpg',
  externalIds: { telegramUid: '12345', email: 'anne@example.com' },
  role:        'admin',
});

const fromTelegram = await map.resolveByExternalId('telegramUid', '12345');
// → {webid, handle, displayName, avatarUrl, externalIds, role}

const fromWebid = await map.resolveByWebid('https://id.inrupt.com/anne');

map.on('member-added',   (m) => ...);
map.on('member-updated', (m) => ...);
map.on('member-removed', ({webid}) => ...);
```

**`handle` and `avatarUrl` are optional.**  Legacy consumers (H2/H4)
that don't use them can omit them; absent fields normalise to `null`.

> **Inbound substrate candidate (2026-05-06):** `apps/stoop` has a
> small `hydrateItem` / `hydrateItems` helper that maps items'
> `addedBy` / `completedBy` / `assignee` WebIDs through `resolve()`
> into a `display` block.  When a second app needs the same shape,
> promote it into this substrate as `hydrate(items, { memberMap,
> reveals, groupId })`.  See `Project Files/Substrates/substrate-
> candidates.md`.

## Reveals + resolve() quick start

For Stoop-shape apps where the UI shows `@<handle>` by default and
only surfaces `displayName` after a per-group or per-peer reveal:

```js
import { MemberMap, Reveals, resolve } from '@onderling/identity-resolver';

const map = new MemberMap();
await map.addMember({
  webid:       'https://id.inrupt.com/anne',
  handle:      'oosterpoort-bird-23',
  displayName: 'Anne van Dijk',
});

const reveals = new Reveals();

// Default: show @handle, not the real name.
let r = await resolve({ memberMap: map, targetWebid: 'https://id.inrupt.com/anne' });
// r.render === '@oosterpoort-bird-23'
// r.isRevealed === false

// Group-wide reveal: e.g. inside the family group, real names visible.
reveals.setGroupReveal('familie-jansen', true);
r = await resolve({
  memberMap: map, reveals,
  targetWebid: 'https://id.inrupt.com/anne',
  groupId:     'familie-jansen',
});
// r.render === 'Anne van Dijk'
// r.isRevealed === true
// r.revealSource === 'group'

// Per-peer override (e.g. after a chat-agent reveal handshake).
reveals.setPeerReveal('https://id.inrupt.com/anne', true);
// peer override beats group default in either direction.
```

Resolution order: per-peer override → per-group default → fallback to
`@<handle>` → fallback to a webid-tail label.  Pure function; no
state, no I/O.  Composes any `MemberMap` with any `Reveals`
instance.

## PersonGraph quick start

```js
import { PersonGraph } from '@onderling/identity-resolver';

const graph = new PersonGraph();

// Observe identifiers as data flows in (e.g. from H6 imports).
// Observations of the same identifier auto-merge into one Person.
await graph.observe({
  identifier: { kind: 'email', value: 'alice@example.com' },
  observedIn: { source: 'gmail', sourceId: 'msg-abc' },
});
await graph.observe({
  identifier: { kind: 'email', value: 'alice@example.com' },
  observedIn: { source: 'icloud', sourceId: 'mail-def' },
});
// graph.size === 1

// User asserts that two identifiers are the same person.
await graph.link(
  [
    { kind: 'email', value: 'alice@example.com' },
    { kind: 'phone', value: '+31612345678' },
  ],
  { confidence: 'user-asserted' },
);

// Query
const person = await graph.findByIdentifier({ kind: 'email', value: 'alice@example.com' });
// → {id, identifiers: [...], observations: [...], linkMeta: [...]}
```

## V0 simplifications

- Pure in-memory.  Apps wanting persistence wrap with their own
  pod-backed adapter.
- `findByName` uses substring match on `kind: 'name-*'` identifiers.
  Apps that need richer name-search build on top of L1i (pod-search).
- No identifier-confidence gradient on auto-links beyond the single
  `confidence` field on linkMeta.
- No identifier-changes-over-time tracking (someone changes phone
  number).  V1+.
- No multiple-people-with-same-name disambiguation.  V0 punts (per H7's deferred-to-V2 stance).

## See also

- `Project Files/Substrates/L1h-identity-resolver.md` — sketch.
- `Project Files/Substrates/apps/H4-tasks.md` + `H5-neighbourhood.md` + `H7-archive.md` — primary consumers.
