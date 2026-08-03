# Shared vocabularies — check here before naming a new set of states

*Added 2026-07-28, after a run in which a second delivery-state vocabulary was nearly built beside the one
that already existed. This is the index that would have prevented it.*

## The failure this exists to stop

A vocabulary is any small closed set the product speaks in: delivery states, entry kinds, discoverability
states, roles, tiers. They are cheap to write and expensive to duplicate, because a duplicate does not
break anything — it just means two parts of the app describe the same fact differently, and nobody notices
until the words disagree in front of a user.

The near-miss: the chat bubble already had `pending / sent / failed / undeliverable` under
`circle.chat.delivery.*`. A new four-rung ladder was written under a different namespace, with `sent`
meaning something slightly different in each. Both were reasonable; together they were a bug.

**They composed into one ladder in the end** — the old states are the near end of the send, the new ones the
far end — which is usually the case. Duplicate vocabularies are nearly always two halves of one thing.

## Before adding one, check these

| what | where | guard |
|---|---|---|
| **Entry kinds** — what a logged event IS (lane · wakes · retention · audit) | `packages/item-store/src/entryKinds.js` | one table; `conversationKinds()` derives from it |
| **Delivery states** — how far a message got | `apps/basis/src/v2/deliveryState.js` → labels in `circle.chat.delivery.*` | `deliveryState.test.js` asserts one namespace |
| **Discoverability** — off / browse / browse+publish | `packages/core/src/transport/discoverability.js` | port property; adapters only say HOW |
| **Roles / tiers** | `packages/core/src/permissions/Roles.js`, `routing/ReachabilityTier.js` | `PolicyEngine` fails closed on unknown |
| **Disclosure axes** — disclosed / matchable / requestable | `apps/basis/src/v2/disclosure.js` | — |
| **Circle templates** — the policy axes a new circle starts from | `apps/basis/src/v2/kringTemplates.js` | template seeds, user overrides per key |
| **Action label maps** — action id → locale key | beside the logic that produces the actions | frozen + a test asserting exact membership |
| **Item types** | `packages/item-types/` | schema registry |

Two quick greps that answer "does this already exist":

```
grep -rE "^export const [A-Z_]+ = Object\.freeze\(\{" --include=*.js packages/*/src apps/*/src
grep -rn "<the-word-a-user-would-see>" apps/basis/src/locales/circle.en.json
```

The second is the more reliable one. **If a user-facing word already exists in the locale file, the concept
already exists in the code** — locales are the cheapest index of what the product can already say.

## The rule

**A new vocabulary needs a home and a guard.** Home: one module, exported, frozen. Guard: a test asserting
its exact membership, so adding a member is a deliberate act and a *second* vocabulary for the same concept
shows up as two tests describing the same thing.

If a vocabulary overlaps an existing one, **compose rather than replace** — the overlap usually means they
are two halves of one journey, and forcing a choice between them loses information one of them had.

## Related guards that already exist

- `apps/basis/test/fitness/localeNoDuplicateKeys.test.js` — a raw-text scan, because `JSON.parse` silently
  keeps the last of a duplicated key. **This caught a real duplicate on 2026-07-28**, which is the argument
  for the rest of this page.
- `scripts/lint-codenames.mjs` — names must read without the plans (invariant 9).
- `apps/basis-mobile/test/shellLayering.test.js` — a shell imports its composer and nothing else.

## Before you add one: the locale file is the fastest index

Before adding a set of states, a label map, or any small closed vocabulary, grep
`apps/basis/src/locales/circle.en.json` for the word a **user** would see. If the product can already say
it, the concept already exists in code — find it rather than inventing a second name for it.

Then check this file's index above.

**Why this needs a written rule at all:** a duplicate vocabulary breaks nothing. It compiles, it ships, and
it passes every test — it just makes two parts of the app describe one fact differently. Nothing fails, so
nothing catches it, which is why the check has to be a habit rather than a guard.
