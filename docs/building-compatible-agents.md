# Building agents compatible with Onderling

How to build something — a bot, a drone, an app, another agent — that talks to a Onderling agent. The key idea up
front: **"a bot" and "a human app" are not two integrations.** Both target the same waist (`{opId, args}` →
`callSkill`) and the same discovery surface (the A2A agent card); a human comes in through a GUI projector, a
bot queries the card and calls ops directly. Target the waist, and both work.

> Status: the SDK packages (`@onderling/*`) are workspace-internal today; consuming them as published packages is
> in progress. This page is the intended interop surface — some of it goes live with the SDK publish.

## The model in three sentences

1. Every interface — AI, GUI, slash command, deterministic gate — compiles to the same `{opId, args}` and hands
   it to `callSkill`; an app's **`manifest.js` is the single contract**.
2. Pure projectors turn that one declaration into every surface, so **there is no per-integration API** — there
   is the manifest.
3. The functionality an `opId` names resolves *wherever it lives* — a local handler, an external agent, a model,
   the Solid pod, an MCP service — behind the same waist.

## 1. Discover — the A2A agent card

A Onderling agent advertises itself as a standards-shaped **A2A agent card** (`name`, `description`, `skills`,
`capabilities`, `authentication`, and an `x-onderling` block with `pubKey` / `groups` / `trustTiers`). Two things
to read:

- **`skills`** — the ops you can call, each already **filtered by your trust tier** (`public` /
  `authenticated` / `trusted` / `private`): a lower tier simply sees fewer skills.
- **`properties`** *(planned facet)* — queryable attributes (see
  [`conventions/property-vocabulary.md`](./conventions/property-vocabulary.md)), filtered by your tier at a
  **rung** (a coarsened value), not binary show/hide.

## 2. Query — call a skill or a property

- **A skill** is a call at the waist: `{ opId, args }`. The same shape a human's GUI or the AI classifier
  produces — you are just producing it directly.
- **A property** is a query for a declared attribute; you receive it at the **rung your tier is granted** (e.g.
  `municipality` rather than exact coordinates). A machine reads the JSON-LD `@type` to interpret it with no
  prior agreement.

Anything **not declared** on the card is *not* auto-answerable — it requires the owner's consent through a
separate (deferred) query path. Don't design around free-form querying of arbitrary attributes.

## 3. Authenticate — how you get a tier

Inbound callers are assigned a trust tier from their credentials: no auth → `public`; a valid bearer token →
`authenticated`; a verified group/circle membership → `trusted`; a signed capability token → the capability's
scope. Your tier decides which skills you see and which property rungs you get. Request the least you need.

## 4. Vocabulary

Properties use **open JSON-LD**: standard terms as the common baseline (schema.org / FOAF / vCard / OIDC for
people, W3C Web of Things for devices), extensible with any namespaced term, plus a thin onderling `cdi:` namespace
for the disclosure policy. Full rule: [`conventions/property-vocabulary.md`](./conventions/property-vocabulary.md);
rationale: [`decisions.md`](./decisions.md) (2026-07-14).

## 5. Be a *provider* — satisfy the port

To reimplement a piece of Onderling (a transport, a data source, an actor resolver) rather than call one:
**"compatible" means exactly "satisfies the port"** — implement the documented interface `@onderling/core` exports
and pass its conformance harness. See [`conventions/ports.md`](./conventions/ports.md). For building a whole app
that plugs into the waist, the fat facade is `@onderling/sdk` (one import, connect app functions to skills, done);
the manifest it must satisfy is in [`conventions/manifest-standard.md`](./conventions/manifest-standard.md).

## In short

- **Read** the agent card (skills + properties, tier-filtered).
- **Call** ops as `{opId, args}`; **query** declared properties (you get your tier's rung).
- **Authenticate** to raise your tier; request the minimum.
- **To provide**, satisfy the port + its conformance harness.
