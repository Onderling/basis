# Extending Basis — the contract

How to add functionality to Basis without being Basis: what an extension is, what it may declare, what it
can reach, where it runs, and how it is checked. This is the third of three developer documents. The other
two are [`building-compatible-agents.md`](./building-compatible-agents.md) — how to *talk to* a Basis agent
from outside — and [`conventions/ports.md`](./conventions/ports.md) — how to *replace an adapter* (a
transport, a store) and stay compatible. This one is for the case in between: you want your code to run
*as part of* someone's Basis, on their data, under their control.

**How to read the status markers.** This document is a contract, and parts of it are ahead of the code.
Every section carries one of three marks:

- **`built`** — it runs today; the file or package is named.
- **`designed`** — decided and specified; not yet in the code. A section flips to `built` only with the
  commit that lands it, never on intent.
- **`direction`** — where this is heading; not a promise.

Tables in the `designed` sections will be generated from the declarations once they exist (the way
[`guards.md`](./guards.md) is generated from the guards), so that the contract and the code cannot drift.
Until then they are written by hand and marked.

---

## 1 · Two kinds of package `built` (the distinction) · `designed` (the split)

Basis separates what a thing *is* from how it is *shown*:

- An **extension** supplies **nouns and their verbs**: an item type — a schema in `packages/item-types` —
  plus any bespoke operations on it, plus flows. A noun gets `add · list · get · update · remove` for free
  from the substrate (`createGenericAtomHandlers`); those verbs are first-party code, run by the host,
  authorised per circle. **A noun with only the generic verbs contains no third-party code at all.**
- An **app** supplies **projections**: views and surface hints over nouns, possibly bringing nouns of its
  own. A view acts only through operations, but it *sees* what it paints.

Today one `manifest.js` carries both (the [manifest standard](./conventions/manifest-standard.md)). The
packaging split — an installer and a certifier that read which of the two you are — is designed. The rule
that follows from it is already worth following: **prefer nouns to verbs.** Every verb is code someone has
to trust; every noun is a schema nobody has to.

## 2 · What you build on today `built`

These exist and are the floor of the contract. Each is documented where it lives.

| you get | what it is | where |
|---|---|---|
| **one contract per app** | operations, nouns, views and surface hints declared once; projectors turn the declaration into chat, slash, gate, attach menu, peer-callable skills, web and mobile | `packages/app-manifest`; [manifest standard](./conventions/manifest-standard.md) |
| **the waist** | every interface compiles to `{opId, args}` → `callSkill`; one gate, `PolicyEngine.checkInbound` — trust tier, capability token, `policy: 'never'`, group role | `packages/core/src/protocol/taskExchange.js`, `packages/core/src/permissions/` |
| **nouns with verbs for free** | declare an item type, get the five atoms; add bespoke verbs where the type needs them | `packages/item-types`, `packages/item-store` |
| **three ways a write resolves** | content merges · a claim has one first-come winner · spine statements are equivocation-proof (membership, roles, keys, votes) | [architecture, the data plane](./architecture.md) |
| **flows** | a declared DAG of steps over existing ops, with `needs`/`produces`/`effects`; verified at declare time; secrets bind by reference only | `packages/app-manifest/src/flows.js`, `flowRunner.js` |
| **one table of entry kinds** | per kind: which lane (conversation or plumbing), may it wake a device, how long it is kept, is it immutable; an unregistered kind gets the conservative reading | `packages/item-store/src/entryKinds.js` |
| **namespacing** | many apps compose at runtime as `appId.opId`, with collision detection | `packages/manifest-host` |
| **an install door** | a consent card that refuses ops an app is not allowed to expose before any token is read (`NEVER_DELEGABLE`) | `apps/basis/src/v2/connections.js` |
| **the guard aggregate** | architecture kept by fitness functions, not review; a guard outside the aggregate does not exist | `npm run guards`; [`guards.md`](./guards.md) |
| **conformance harnesses** | for every port: implement it and pass the harness = compatible | `@onderling/core/conformance`; [`ports.md`](./conventions/ports.md) |

## 3 · The contract for an extension `designed`

### 3.1 · The package

- **One self-contained module**, bundled by you with any dependencies you like (ordinary tooling — Rollup,
  esbuild). It exports `{ nouns, ops, flows }` and nothing else. It cannot import the host's SDK and
  cannot reach the host's modules: those are on the other side of a boundary (§4).
- **Content-addressed and signed.** The hash is over the bundle; the signature is your author key. Where
  the bundle is served from is irrelevant; the hash pins it.
- **Dependency-free by construction at runtime.** Your handlers receive one function, `invoke({ opId,
  args })`. That is the whole API surface between your code and the host.

### 3.2 · What it declares

| field | meaning |
|---|---|
| `nouns` | item-type schemas; each registered kind is declared through a **preset** (below) |
| `ops` | bespoke verbs: `{ opId, description, handler(args, invoke) }` — the description is read by people *and* by models |
| `flows` | declared step graphs over ops; a flow-only extension contains no code |
| `hosts` | every network host the extension may reach; an empty list means none |
| `hostRequirements` | what the running host must have — `ble`, `mdns`, `camera`, `location`, `always-on` |
| `realm` | always `'required'`; an extension never runs in-process with Basis |
| `lane` | the extension's own storage lane, removed on uninstall |

### 3.3 · Presets — the only three shapes a kind can have

Every registered kind declares one of three presets, and the preset fills in how the kind is signed, what it
is about, which verifier accepts it, and how it syncs between a person's own devices:

- **`CONTENT`** — merges. Chat, notes, offers, recipes. Signed as the person.
- **`CLAIM`** — one first-come winner. A task's assignee, a reservation. Signed as the person.
- **`SPINE`** — equivocation is an attack. Membership, roles, keys, votes. **Core only.** An extension that
  declares a spine kind is refused at install and at certification.

Kinds are namespaced `appId.kind` by the installer, the way ops already are, and composed into the one
kinds table at install. A kind that arrives undeclared is refused at the fold, not admitted with a guess.

### 3.4 · What an extension can reach — the complete list

Everything JavaScript normally has becomes an operation, or is absent. This table is the extension's entire
reach, which is what makes its consent card honest:

| it wants | how it gets it |
|---|---|
| read / write items | an op, authorised per circle and noun by the host's token |
| the network | `net.fetch`, only to the hosts it declared; the realm itself has no `fetch` |
| to reach a peer | `send × message`; the realm has no transport |
| storage of its own | its declared lane; nothing else |
| a secret (an API key) | never — it holds a handle; the host uses the credential |
| a language model | `llm.complete` through the person's chosen route; no model of its own |
| a timer | `when` on a task; the host runs the loop |
| a screen | a view paints inside its own frame; a verb has no UI |
| to sign | never — the host signs on its behalf, as whichever identity the person granted |

### 3.5 · What it cannot declare

Spine kinds. Root- or device-level acceptance. Both a data-read grant **and** a network host in one
extension — an extension that needs both must be two extensions joined by a flow, so the edge between "reads
your list" and "talks to api.example" is declared, visible on the consent card, and consented to as an
edge rather than hidden inside one package.

## 4 · Where it runs — the realm `designed`

**The rule:** code in the signed Basis bundle is the trusted computing base. Everything else runs in a
*realm* — an isolated JavaScript environment the platform provides — and arrives at the host's gate as a
peer would. A realm is not something Basis implements; it is configured:

| host | realm | what makes it bind |
|---|---|---|
| web | a cross-origin sandboxed iframe with a content-security policy that permits nothing | the same-origin policy — the web's own security model |
| mobile | a WebView per realm (later an embedded JavaScript interpreter) | process or context isolation; also the only shape app stores permit for downloaded JavaScript |
| an always-on device | a subprocess with network permission limited to the declared hosts | operating-system isolation; the permission flag *is* the `hosts` list |

The channel between a realm and the host is a transport in the ordinary sense — it implements the same port
every network adapter does ([`ports.md`](./conventions/ports.md)) and passes the same harness. So from the
host's point of view an extension is an external agent that happens to run locally, and the gate it meets
is the one that already exists. The realm holds no keys and no transport; it holds one function.

A token says what code *may* do. The realm is what makes sure code *cannot* do anything else. Both are
needed; a token over code running in the host's own realm is a convention, not a boundary (the
[enforceability test](./conventions/enforceability.md)).

## 5 · Installing, consenting, updating `built` (the card) · `designed` (the rest)

- **The consent card exists.** It refuses withheld ops before any token is read.
- **Install** (designed): fetch by hash, verify the author's and any certifier's signatures, choose the
  realm by host policy, inject `invoke`, register the manifest. A phone's default policy is *certified
  only*; the person can override it.
- **The card shows edges, not packages** (designed): "sends *your shopping list* to api.example", or the
  absence of any such edge.
- **A default expiry** for a participant's allow — one day — after which the extension stops unless renewed.
- **Updates are a new hash** (designed). The person's remit pins the old one until they re-approve; the card
  shows the *diff of declared scope*. Same author, certified, no scope change may auto-accept.

## 6 · Who it acts as — the remit `designed`

A **remit** is to a subject what a manifest is to an app: which ops, in which circles, via which adapters,
until when — for one subject. A shareable, unminted remit is a **template**; it becomes someone's when their
key signs it. The remit decides which identity the host signs with when the extension acts:

- **as the person** — the person's own signature; only their own trail knows it was the extension;
- **as a member of its own** — the extension has its own address on the circle's roster, and everyone sees
  the bot act.

Either way the extension never holds a key. Minting a remit is a ceremony-class act on the person's own
device; the recovery phrase is never typed for it.

## 7 · How it is verified `built` (the harnesses) · `designed` (the rest)

Three places a wrong declaration fails loudly, none of them in a person's circle:

1. **Declare time** (designed) — a verifier beside `verifyFlows`: every kind an op appends is registered with
   a preset; `hosts` and `realm` are present; no spine kind, no privileged acceptance.
2. **The seam** (harness built, extension use designed) — the conformance harness runs the extension's ops
   against a *second* agent and asserts each appended statement folds there. A wrong declaration is refused
   at the far end, and the harness goes red.
3. **Certification** (designed) — a signature from the foundation over the bundle's hash: the guards passed,
   including the rules in §3.5. Host policy decides what a host accepts without it.

What holds the host to its side (designed, three lints in the guard aggregate): every rail is constructed
with a named verifier; no lane signs with a static identity; every registered kind has every cell filled.

## 8 · Direction `direction`

- A registry of extension descriptors — `{ hash, author, certs }` — as a projection, possibly a circle whose
  items are descriptors. There is no store and no market until there is supply; certification is the mark.
- The same contract for physical things: a sensor or a thermostat is a member of a circle with exactly one
  noun.

## 9 · Status, in one table

| section | state |
|---|---|
| the manifest as contract, projectors, namespacing | built |
| nouns with generic verbs; the three write channels | built |
| flows, `verifyFlows`, secrets by reference | built |
| the kinds table (lane · wakes · retain · audit) | built |
| the waist gate: tiers, tokens, `policy: 'never'` | built |
| the consent card, `NEVER_DELEGABLE` | built |
| conformance harnesses for the ports | built |
| the extension/app packaging split | designed |
| presets `CONTENT · CLAIM · SPINE`; kinds columns `signs · subject · accepts · syncPolicy` | designed |
| `hosts`, `hostRequirements`, `realm`, `lane` in the manifest | designed |
| the realm transport + installer | designed |
| the remit; template vs minted | designed |
| edges on the card; scope diff on update; one-day default expiry | designed |
| the declare-time verifier; the extension harness; certification; the three lints | designed |
| the registry as a projection; physical members | direction |

*When a `designed` row lands, the commit hash goes in this table and the row's section drops its marker.
When the declarations exist, this table and the ones in §3 are generated from them with a `--check`, and
hand edits to them stop.*
