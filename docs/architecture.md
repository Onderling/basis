# Architecture

The deep version of how onderling fits together. If you only need the summary, the one-sentence model +
invariants in [`CLAUDE.md`](../CLAUDE.md) and the [project overview](../README.md) are enough. Read this when
you need to *understand the whole system* — why it's shaped this way, and how a request actually flows.

**The model in one sentence.** Every interface — AI, GUI, slash command, deterministic gate — compiles to the
same `{opId, args}` and hands it to `callSkill`; an app's `manifest.js` is the single contract, and pure
projectors turn that one declaration into every surface. Interfaces are pass-throughs; the manifest is the
contract; the functionality the op names resolves *wherever it lives*.

**How this document is organised.** Five parts, front to back — the model, then how it runs, then the domain
it models, then the system it runs on, then where it's going. Each part assumes the one before it:

| Part | Sections | What you get |
|---|---|---|
| **1 · The model** | The one idea · The manifest is the contract | the thin waist, and the single declaration every surface reads |
| **2 · How it runs** | How a request flows · The event log · Retrieval (RAG) · The help bot · Chat and screens compose | a request end to end, the record it is written into and read back from, how answers are grounded, the standing bot, and how surfaces trigger each other |
| **3 · The domain** | Circles/types/capabilities · The data plane · Tasks/roles/grants · Offerings/disclosure · Sharing | the one `(circle, type, verb)` algebra, the stores and typed items it lands on, the task + delegation substrate, the offering model, and how sealed sharing rides on it |
| **4 · The system** | The layers · Placement by trust+latency · Agents interacting · Reachability · Consistency & governance | kernel/adapters/substrates, where compute is placed, the inter-agent axis, and how a circle's state stays consistent |
| **5 · Direction** | Where this is going · Where to go next | what's being enforced next, and pointers onward |

---

## 1 · The model

*The thin waist, and why the two consequences that fall out of it are the whole architecture.*

### The one idea

Every way a user can ask for something — a chat/LLM turn, a GUI tap, a slash command, a deterministic phrase
gate — **compiles down to the same intermediate**, `{opId, args}`, and hands it to `callSkill`. That shared
intermediate is the **thin waist**.

```
  AI (LLM)  ─┐
  GUI tap   ─┤→   { opId, args }   →  resolveDispatch → runDispatch → callSkill  →  functionality
  slash     ─┤         ▲ the manifest is the contract         (local handler · agent · model · pod · MCP · job)
  gate verb ─┘
```

Two consequences follow from the waist, and they are the whole architecture:

1. **Interfaces are peer compilers, not privileged front-ends.** AI and GUI both *compile to* `{opId, args}`;
   neither owns the logic. They are pass-throughs. Adding a surface never means adding a `switch` over apps;
   it means projecting the manifest onto that surface.
2. **Where an op resolves is a separate axis from how it was invoked.** `callSkill` runs the op; the
   functionality it names can live *anywhere* — a local handler, an external agent, a model, the user's Solid
   pod, an MCP service, a scheduled job. The interface doesn't know or care.

This is the seam the repo will eventually split on: **interface clients above the waist**,
**functionality/substrate below it**, the **manifest between**.

### The manifest is the contract

An app declares its surface **once, as data**, in a `manifest.js`: its item types, operations, views, and
per-operation surface hints. It is the single source of truth every surface reads. Pure **projectors**
(`@onderling/app-manifest`) turn that one declaration into every surface:

| Projector | Produces | Family |
|---|---|---|
| `renderChat` | LLM tool definitions + system prompt | affordance |
| `renderGate` | deterministic pre-LLM token-gate rules (from each op's `surfaces.slash.match` verbs) | affordance |
| `renderSlash` | `/commands` + grammar | affordance |
| `renderAttachments` | the attach ("+") menu (from each op's `surfaces.attach`) | affordance |
| `renderWeb` | DOM pages + forms | shell |
| `renderMobile` | a React Native NavModel (screens/nav) | shell |

#### Two projector families

Read the projectors as **two families, not a flat list** — the flat list quietly mixes two categories, which
is what makes a reader ask "why is `renderAttachments` a peer of the chat shell?" It isn't:

- **Affordance projectors** (`renderChat` · `renderSlash` · `renderGate` · `renderAttachments`) turn ops into
  **one invocation surface each**. A tool-call, a `/command`, a gate phrase, or an attach-menu tap all compile
  to the same `{opId, args}` → `callSkill` — the surfaces are interchangeable at the waist (this *is* the
  `web ≡ mobile` invariant on the input side). `renderAttachments` sits **next to `renderSlash`**: an
  attach-menu entry fires exactly like a slash command ("attach a photo" = the `embed-file` op), driven by a
  `surfaces.attach` declaration that mirrors `surfaces.slash`. One op declaration → chat + slash + attach-menu
  automatically.
- **Shell projectors** (`renderWeb` · `renderMobile`) render the **whole platform UI** — screens and nav —
  from the same manifest. `renderMobile` is literally a re-export of `renderWeb`'s NavModel, differing only in
  the platform adapter.

(`renderCoverage` is the *meta*-projector — a matrix **over** the surfaces, not a surface of its own.)

`@onderling/manifest-host` composes *N* apps' manifests at runtime
(namespaced `appId.opId`, collision detection). Because every surface is a projection, **adding an op to a
`manifest.js` makes it reachable from chat, slash, gate, web, and mobile at once** — and the coverage snapshot
(`npm run coverage` → `apps/basis/docs/surface-coverage.md`) records which surfaces each op is wired for,
so the map can't drift from the manifests.

#### Flows — declared multi-step processes

Some things a person does are not one op but a **process**: restoring settings on a new device, enrolling
a second device, pairing a view. A manifest declares these as **`flows[]`** beside `operations[]` — a flow
is a **DAG of steps** where every step references an existing op (anything effectful *is* an op — flows add
no second way to act) or, one level deep, another flow. Routing is declared per step as **outcome → next**
edges (`null` = the flow ends; `else` = fallback), which is how one declaration covers a probe that can
branch four ways.

A flow declares three distinct faces:

- **`needs`** — its inputs and preconditions;
- **`produces`** — its outputs, bound by declared path references to step results;
- **`effects`** — the world-changes that are *not* return values (writes, key rotations, sends). Effects
  exist for honesty: they are the consent/review surface ("this flow will: …") and what the trail records.

Steps wire together by **declared path bindings** (`$flow.needs.x` / `$steps.<id>.<name>`), never an
expression language — the moment something is computational it becomes an op. Secret-kind values obey one
hard rule end to end: they bind **by reference only**, ride a caller-held transient map at runtime, and
never enter the persisted instance record — so a resumable, saved-after-every-step flow instance provably
never contains key material.

One **runner** (`createFlowRunner`) executes any flow as a resumable instance (pausing as
`awaiting-input` when a step's declared required params aren't satisfied; restarting on version drift),
and one **projector** (`renderFlow`) turns flow + instance into the view model both shells paint — a step
gets a bespoke form only the way a screen does, as a registered override beside the generic one. A
**verifier** (`verifyFlows`) checks the whole grammar — acyclicity, binding resolvability, the secrets
rule — loud at declare time, cheap at run time.

Composite ops (an op whose `steps` chain existing ops — the extension arc's linear mini-pipelines) are the
**linear sugar** over this: a composite compiles to a flow and executes on the same runner. There is
exactly one pipeline engine.

That is the whole of the model. The rest of this document is what happens when it runs.

---

## 2 · How it runs

*The waist in motion: a request end to end, the record everything is written into and read back from, how the
circle bot's answers are grounded, and how the two surface families compose.*

### How a request flows, end to end

1. **Invocation** — the user types in chat, taps a button, runs `/command`, or hits a gate phrase ("add milk").
2. **Compile to the waist** — the interface's projector turns that into `{opId, args}`. The gate resolves
   common phrases *without* the model; anything else goes through the LLM (`renderChat`) or the GUI form.
3. **Dispatch** — `resolveDispatch` maps `{opId, args}` to a handler via the merged manifest; `runDispatch`
   invokes it.
4. **`callSkill`** — the single entry point that runs the op. This is also the **security boundary**: an op
   only runs if it's in the caller's effective capability set (see *Circles, types, and capabilities* in
   Part 3).
5. **Functionality resolves** — wherever it lives: a local skill handler, a peer agent over a transport, an
   LLM, a read/write against the Solid pod, an MCP tool, or a scheduled job.
6. **Result** — flows back to the invoking surface. Verify the *result*, not just that dispatch fired: a gate
   can route correctly while the op silently fails.

### The event log — one record, many projections

Underneath that flow there is one **append-only event log per device** — not one per circle, and not one per
surface. It is a *substrate*, not a feature of any surface: any part of the app can append to it, and the
chat, the cross-circle stream and the activity views are projections over it rather than stores of their own.
Every entry carries a **kind**, an **actor**, and (usually) a `circleId`; the log is the canonical record.

**Writes go through one path — the rail.** Since the convergence work (decision A, 2026-08) an entry is
not simply appended: it is **signed with the circle-scoped key, chained (parent + causal deps), appended to
the device log, and handed to the exchange** — one route, per circle, for every kind of content. That is what
makes the log a *record* rather than a cache: an entry carries who said it, provably, and a receiver folds it
only after verifying the signature and the key↔member binding. Ordering is derived at the fold from the
chain, not from arrival or from a wall clock.

Three further properties are worth knowing before you write to it:

- **Append-only, and auditable entries are immutable.** An entry is de-duplicated on the caller's id; for the
  kinds marked auditable, a repeat id is first-write-wins — a delegated agent cannot rewrite a row it already
  wrote. Ordering is a storage-assigned sequence, never a caller-supplied one.
- **Kind-classified.** Behaviour is carried by the entry's **kind**, in one shared table
  (`ENTRY_KINDS` in `@onderling/item-store`), which answers four separate questions: does it show in a
  conversation or is it system plumbing (`lane`), may it wake an offline device (`wakes`), how long is it
  kept (`retain`), and is it immutable once written (`audit`). The kind is also what the attention gate keys
  off: the silent system kinds — membership, key events, delivery state, a roster ping — never wake an
  offline device, and only human-facing kinds may. Deriving that from the kind, rather than stamping a flag
  at each write site, is what keeps the rule from drifting. An unregistered kind gets the conservative
  reading — system lane, never wakes, shortest retention — so a new kind cannot accidentally reach a phone.
  The table lives in a substrate package precisely so two apps cannot each derive the wake rule differently
  (→ [`shared-vocabularies.md`](conventions/shared-vocabularies.md)).
- **Retention is per class, not one number.** "Retention of what?" is the right question: plumbing
  (roster pings, delivery state) is kept days, the conversation longer, and the **audit** class does not
  expire by dropping — entries past the detail window **compact** into a summary that says how many it folded
  and of what. A trail that forgets silently looks complete, which is worse than one that is honestly short.

The log is deliberately a record of *pointers*, not a second copy of the data: the agent-trail entry shape is
a whitelist (`{op, target, outcome, via}`) with no arguments, message bodies or file contents. The trail says
*that* an agent wrote to something and under whose authority; the thing itself says what.

#### Three append channels for devs — spine, content, claim (plus the audit chain)

A dev's item lands on one of **three generalized channels**, chosen by how concurrent writes to it must
resolve. Each is extensible — a new item type or a plugin opts into a channel rather than inventing a fourth
mechanism (the survey that found three parallel "signed causal log" shapes is exactly the drift this names
away):

- **The spine chain** (`createAuthorChain` + the generic `signSpine`) — for events where **EQUIVOCATION is an
  attack**: governance (proposals/votes), **roles** (admin promote/demote), **membership** (join/leave/evict),
  **key rotations**. A per-author hash-chain with fork-proofs, filterable by `kind`: each entry points at its
  author's previous spine head (`parentHash`), so two entries off the same parent with different content are a
  self-verifying FORK-PROOF anyone recomputes. Append a **signed spine statement of your `kind`** — signed by
  the **circle-scoped** key; any kind, *including one a third party adds*, signs/verifies the same way, and
  **only the FOLD is kind-aware**, so the primitive never changes to admit a new kind. Over the one chain sit
  materialised HEADS — the roster head (membership), a governance head, a roles head, the `Peer` projection.
  Realises principle 6 ("membership is proof-derived + tamper-evident: a per-author hash-chain over
  membership/key events") and principle 10 (who-is-in / who-is-admin folds identically everywhere, deny-wins).
- **Content merge** (the per-circle item-store, `wireCircleStoreInbound` / `causalMerge` by origin-timestamp +
  writer-id) — for content where **FORKING IS NORMAL**: chat, tasks, offerings, prikbord posts. Append a typed
  item; concurrent edits merge.
- **The single-writer claim fold** (`causalMerge`'s immutable-once-set path) — for a field that must have **ONE
  first-come winner** across devices: a task's `assignee`, an offering's reservation, a lend's borrower. An
  item type **declares** a field uses this fold — it is **pluggable, not task-specific**: any dev item can opt
  a field into single-writer semantics (generalising the fold beyond tasks — offerings, lending — is planned).

Plus, **not a dev channel: the audit chain** (`auditLog`, `@onderling/secure-agent`) — the security layer's
own signed LINEAR record of key ceremonies/crypto (one author, per-entry signatures, `verify()` walks every
sig + link). It may SHARE the chain primitive, never the log; its retention COMPACTS rather than drops.

Rule of thumb: **concurrent writes must be equivocation-proof → spine · they merge → content · exactly one
must win → claim fold** (and the security layer's own integrity record → audit). A new cross-cutting ordering
need extends one of these — never a fifth mechanism.

Because the log is complete and local, the redaction question lives at the **export** boundary — a support
bundle or bug report is where identities are stripped or pseudonymised, not at the point of writing. The
device-local structured logger (`@onderling/logger`) takes the opposite approach for the layers below the
app, where there is no circle scope to key on: it is PII-safe *by construction*, accepting only event codes
and scalar fields and rejecting identifier-shaped values whatever field they arrive under.

**Reading it back is a projection, never a second store.** A projection selects on two axes, and it is worth
naming them because the function names alone do not:

- **scope** — one circle, or all of them;
- **content** — which entry *kinds* (`chat-message`, `task`, `governance`, `report`, …), and therefore which
  lane: the human-facing kinds, or also the silent system ones.

So the per-circle chat is `scope = this circle, content = the conversation kinds`, and the cross-circle
stream is `scope = all, content = everything`. A combine-and-filter surface is just a control that sets those
two arguments — not a new query path.

*(Being completed: the projector functions and the kind registry are converging on exactly this shape — see
the private roadmap. The principle above is the design of record.)*

### The personal history mirror — the record, kept and portable

The log is the record, which raises the obvious question: what happens to it when the device is gone. The
answer is a **sealed follower**. Turned on (it is off by default), the mirror copies the device log outward,
batch by batch, into storage the person controls — the pod first, though any read/write/delete/list backend
fits. It adds no second authority: it follows, and restore hydrates those batches back through the *same*
verify-on-ingest gates a peer's statements pass, so a tampered mirror can corrupt nothing — it can only fail
to verify.

Three properties make it worth knowing:

- **Sealed by the source, per device lane.** Batches are written under `log/<deviceId>/…` and sealed to the
  owner's own derived key, identical across their devices and re-derivable from the recovery phrase. Lanes
  never clobber each other; restore merges them by entry id.
- **Restore is a ladder, not a wait.** A fresh install hydrates the *recent window first* (last N days, or
  the newest M per circle — whichever is larger) so conversations open live, and the long tail lands in the
  background. Folds are deterministic, so arrival order cannot change any outcome.
- **Export is the same mechanism pointed at a file** — one sealed archive, opened again by the same hydrate
  door, and tested by actually re-opening it rather than by checking the file exists.

The same sealed lanes are what lets a **connection** (below) read while the acting device sleeps.

### Retrieval (RAG) — grounding the circle bot

Projections are one way a circle's own material is read back. Grounding a model in it is another. Each circle
has an assistant (the "circle bot"); before it answers via the LLM, it retrieves the circle's own relevant
items and weaves them into the prompt, so answers are grounded in the circle's real data (chores, tasks,
notes, messages) rather than the model's guesses.

**Flow.** The pre-LLM gate (`tokenGate.js`) routes each message: a deterministic command (`/done milk`) fires
directly with no model; anything else takes the `via:'llm'` path, where the gate calls `retrieve(text, ctx)`,
slices to `maxContext` (5), and injects the results as context.

**Two tiers** (`circleRetriever.js`):
- **Tier-1 lexical** — keyword match, always available, no model needed.
- **Tier-2 semantic** — ranks by meaning (a query for "car" finds "automobile"). Needs an embedder.

**Engine.** Tier-2 is backed by a per-circle `@onderling/pod-search` hybrid index (`makePodSearchRetriever`),
scoped `circle-rag/<circleId>` so circles never bleed into each other. Items are embedded once (content-hash
cache — unchanged items are never re-embedded) and each turn runs `query({mode:'hybrid'})` — reciprocal rank
fusion (k=60) over the lexical and cosine rankings. A `vectorStore` seam holds the vectors: both shells inject
a **persistent** one — web via `pickWebBackend` (IndexedDB, `@onderling/pseudo-pod/browser`), mobile via
`createAsBackend` (RN AsyncStorage) — scoped `circle-rag/<circleId>`, with an in-memory fallback under SSR / the
test env. So vectors (and the circle **items** they index, on the same persistent backend) **survive a hard
restart** instead of re-embedding; within a session, retriever rebuilds hydrate from the store (embed-once).
This closes cross-restart survival on the standalone (no-pod) posture. The other persistence path — a real
**signed-in Solid pod** — is **live-validated** too, against a local Community Solid Server: an infra-gated
`.css.test.js` (runs when a CSS is present, skipped from the default suite) confirms a circle with its items
survives an app restart on a signed-in pod, and exercises the ACP grant path against real CSS.

**Policy & privacy** (an instance of placement by trust — see Part 4):
- Gated by `llmTool: 'off'` ⇒ no LLM and no semantic retrieval.
- The embedder is policy-resolved (local Ollama / attested enclave); no embedder ⇒ tier-1 lexical only, zero
  embed calls — a graceful degrade, never an error.
- Retrieval is local; embeddings run only through the configured provider, so nothing leaves the device unless
  that provider's base URL says so. Vectors live under `private/state/search-index/`, never under `sharing/`.

### The standing help bot and onboarding

The circle bot answers inside a circle the user already has. A first run has none, so it is met by a different
standing bot: the user is dropped into a help circle ("Uitleg") whose only other member is the **Onderling
bot** — a real peer member of the circle, not a modal overlay. Onboarding is therefore *just the bot's chat*:
a guided conversation whose copy is resolved in the active language at the moment it starts (not frozen at
import), and whose "make my own circle" branch hands off to the create-circle wizard.

Two rules make the bot honest and unobtrusive:

- **Answer deterministically first, LLM only on consent.** The bot answers from a pure in-app card deck
  (`answerHelp` over `helpDeck`, ported from the onderling.org site — no DOM, no network, no storage). On a miss
  it *offers* to forward the question to an LLM; only after consent does it take the grounded help-answer path
  (`answerHelpViaLlm` — retrieval over the same cards, a plain chat call, no tool list, `null` on any failure).
  The wording is **conditional on the resolved route**: it says "via de vertrouwelijke assistent" only when a
  confidential route is actually in effect, plain wording otherwise (see `decisions.md`, 2026-07-18).
- **Tag-to-address.** Because the bot is a genuine circle member, it answers *every* line only in a real
  1:1-with-a-bot chat; in a circle with other people it answers only when the message names or @-tags it
  (`botIsAddressed`). The same gate drives the 1:1 assistant-header strip. One shared gate, both platforms.

### Chat and screens compose (and trigger each other)

Both bots live on the conversational side of the waist — which is only one of the two surface *families* over
it, and the two are not independent. There is **conversational** (chat/gate/slash) and **screen** (the
web/mobile GUI), and they don't merely render the same op in parallel — they **compose and trigger each
other**. Today, in the web shell: an op that declares `surfaces.ui.screen` gets an **"Open" button** that opens
a full-screen panel (`openCircleScreenPanel`); conversely a **row action inside a screen posts `{opId, args}`
back through the same waist** (`dispatchReady`). So a chat command can open a screen, and a screen action can
drive a chat flow. Three treatments — **inline menu · full-screen panel · chat** — are chosen per user.

*Current state:* the flat **list** surface (contacts/prikbord) is manifest-projected on both platforms — the
hardcoded `LIST_SCREENS` map is **retired**; `openCircleScreenPanel` reads its config from the projected
`NavModel.sections`. **Nav chrome has dissolved the same way and is now complete:** both the **tab bar** and the
**detail action-bar** project from one nav-chrome `NavModel` kind — `manifest.tabs[]` → `NavModel.tabs[]` and
`manifest.actions[]` → `NavModel.actions[]`, a small shared `NavItem`/`NavTarget` vocabulary (`tabProjection.js`
· `actionProjection.js`) that both shells render from. Every consumer reads the *same* roster: web's tab bar
(`web/v2/circleTabBar.js`), web's circle detail *and* the **live web kring (circle) ⋯ menu** (`circleDetail.js` ·
`circleKring.js`), and the mobile tab bar + **live mobile kring ⋯ menu** (`CircleTabBar.js` ·
`CircleLauncherScreen.js` via `circleTabsMobile`/`circleActionsMobile`) — the duplicated `TABS`/action literals
are gone, and each shell only *filters* the identical roster by an action's `platforms` + `requires` gate.
A tested generic side-panel (`openPagePanel`) is the live renderer for simple `surfaces.page` ops on **web**
(e.g. the docked `set-relay` panel); the RN sibling that maps `surfaces.page` to native nav screens is still
pending (mobile has the per-op page *header* projection but not the generic side-panel yet).
Still bespoke **by design**: the settings-hub panels (my-data, advisor) and the **circleFolio browser** (a
separate surface KIND, parked). The compose/trigger loop (open-screen button ↔ `dispatchReady`) is wired in
**web**; mobile now shares the projected nav chrome but keeps its own screen renderers.

---

## 3 · The domain

*What the system actually models: one algebra of circles, types, and capabilities; the stores and typed items
that algebra lands on; and how every kind of sharing is a move over a single sealed resource.*

### Circles, types, and capabilities — one algebra

A few concepts are deliberately *the same thing*, so that data, permissions, and audience line up instead of
drifting apart:

- A **circle** is one scope worn several ways at once: the **audience** of an item (who may see it), the
  **storage key** (data is keyed by `circle + type`), the **capability-policy scope** (permissions are
  per-circle), and the **pod routing key** — all one `circleId`. (A circle is itself an item type.)
- A **capability** is a **`(verb × noun)`** pair — the **verb** is a canonical **atom** (`add` · `list` ·
  `update` · `remove` · `complete` · `claim` · `share` · …) and the **noun** is an **item type** (`task` ·
  `note` · `offer` · `contact` · …). So "who may do what" is a set of `(atom × item type)` pairs, authorized
  **per circle at `callSkill`** (default-deny).
- A manifest **declares** its `nouns` (its capability surface); its ops just fill in the implementing `opId`.
  The same item-type registry that validates stored data supplies the nouns.

The upshot: the **type axis** (item types), the **verb axis** (atoms), and the **scope axis** (circles) compose
— **storage, permissions, and surfaces are all projections of one `(circle, type, verb)` space.** That is why a
new noun added to a manifest becomes storable, gate-able, and renderable at once.

### The data plane — circles, stores, items, verbs

The algebra says which axes exist. The data plane is where they land in the running code. Parts 1 and 2
describe how a *request* travels; this is what it travels **to**: one sentence, then the parts.

> **A circle owns one store; a store holds typed items; a type gets the standard verbs for free and adds
> its own where it needs them; and whatever the store holds is what syncs to the circle's other members.**

**Circle → store.** The scope axis is also the storage axis: a circle's items live in one
`CircleItemStore` (`packages/item-store`), rooted per circle. "Which circle" is not a filter applied to a
shared pile — it is which store you are holding. Two stores for one circle is a defect, not a design.

**Store → items.** Items are typed, and the types are declared, not implied — `packages/item-types`
carries a schema per canonical type:

> `task` · `note` · `chat-message` · `chat-thread` · `offer` · `request` · `claim` · `contact` ·
> `calendar-event` · `announcement` · `media` · `view` · `circle` · `shared-ref` · `neighbourhood-job` ·
> `reveal-request`

**A message and a task are siblings.** Both are typed items in a circle's store; `chatEnvelope.js` sits
beside `taskLifecycle.js` in the same package. Neither is privileged, and neither belongs to an "app".

**Items → verbs.** Every type gets the canonical atoms for free — `add · list · get · update · remove`
(`createGenericAtomHandlers`: *declare a noun → get CRUD*). A type that needs more declares bespoke ops,
and `resolveAtom` lets those win over the generic ones. So `task` adds `claim` · `submit` · `approve` ·
`reassign` over its DAG (`dag.js`, `taskLifecycle.js`), while `note` needs nothing beyond the atoms. This
is what makes "one algebra" affordable: **unify the store and the transport, never the operations.**

**State is derived, not stored.** A task's status comes from `effectiveStatus(task, …)` over its
dependencies — the row is the materialised head, the transitions are the history. Same shape as the event
log in Part 2: durable records, derived views.

**Store → the wire — READ THIS TWICE, it changed.** The sentence that used to stand here ("a store is
bridged to the circle's peer mirror by `wireStoreMirror`… this is the only fan-out path") described the
pre-convergence world and is no longer how production carries anything.

What is true now: **the device log is the record, and the rail is the carry.** Every store type publishes as
a **signed lane statement** on the rail; a receiver verifies it and folds it into its own log, and the store
row is the materialised head of that fold. The routing is decided **per composition, not per type** — when a
device log is composed (which is every production shell) everything goes as a signed statement and the legacy
mirror is never touched; only a legacy or test composition without a device log still carries over the mirror
itself.

The mirror machinery has not vanished, and knowing why avoids a wrong conclusion when you read the code:
`wireStoreMirror` is still *wired*, but for production what flows through it is the rail's own publish valve
(`routeTaskMirror` is deliberately mirror-SHAPED so the wrapper is unchanged). So the mirror is the plumbing
*shape*, not the path. Its full dissolution needs a device log in every composition, and is parked as hygiene
rather than pretended done.

**The rule survives the change, and is what matters:** there is ONE fan-out path per circle. A type that
reaches a peer some other way is a second implementation of sync and will drift from this one.

**Two axes, declared.** How an item *reaches* peers and how concurrent writes *reconcile* are separate, declared
choices — **delivery** and **resolution**. Delivery is the live fan-out above plus the companions for what it
misses: a reconnecting device **catches up** (a request/response replay, or a pod range-query for a pod-backed
circle), and a message to one named peer takes the **addressed** point-to-point path instead of the circle
mirror. Resolution — how a receiver merges concurrent writes to the same item — is the consistency layer's
concern (§4 · Consistency & governance).

#### Where the runtime does NOT match this yet

Written down on 2026-08-03 because all four were live, and because prose that flatters the code is worse than
no prose. **Reconciled twice since — wave 2 (2026-08-11) and the convergence re-root (2026-08-14): all four
are now resolved, verified against the code rather than claimed.** The durable fix for this section is to make
each row a guard (fail-until-built) rather than prose that drifts; until then it is maintained by hand, and
the honest tail is named below the table rather than dropped.

| | state |
|---|---|
| Chat messages live in **both** an `EventLog` and as a `chat-message` item type | ✅ RESOLVED (the content re-root) — the log entry IS the render event: one signed entry serves both roles, what you see and the proof of who said it. The duplication is gone, and the log is the record |
| `addTask` exists on the `tasks` app-origin **and** in `HOUSEHOLD_WIRED_OPS` over the circle store | ✅ RESOLVED — the lightweight `{text, completedAt}` model folded onto the rich shape (`555bdbd5`), and the lane set then closed over every store type, so the route is decided per COMPOSITION rather than per type |
| Tasks are correctly per-circle, and their store is **not** on the fan-out path | ✅ RESOLVED (wave 2) — the one-store collapse put the tasks store on the `ensureCircleSync` fan-out; a task now crosses A→B, proven + guarded by `appTaskFanTwoDevice` (one store per circle + per-type sync arrival) |
| `household` names circle-level machinery throughout (`addHouseholdPeer`, `getHouseholdScope`) | ✅ RESOLVED (wave 2) — the circle-infra was renamed (`addCirclePeer`, `getCircleScope`, `ensureCircleSync`, …); the remaining `household` is a legitimate template/app name, not circle machinery |

**The honest tail, so the table is not read as "finished":** the mirror OBJECT and the peer-roster machinery
still serve compositions that have no device log (test fixtures, the manual-pairing skills). Full dissolution
needs a device log everywhere; it is parked as hygiene, not claimed done.

**The rule these violations share:** each is a place where the code can no longer tell "did not happen"
from "happened fine". That is the failure mode this architecture is most exposed to — everything here is
composed of best-effort seams — so **a seam is not done until something crosses it**, and the guard for
this section is a per-type sync matrix: one item of every canonical type, two real peers, asserted arrival.

### Tasks, roles, and task-scoped grants

Tasks are the worked example of the algebra above, and their substrate is deliberately thin. The canonical store
is **`CircleItemStore`** (`@onderling/item-store`) — a generic, per-circle, type-indexed item store over an
injected `DataSource`; the older monolithic `ItemStore` is **retired** (kept only as a parity reference for
migration tests and the pure `computeStatus`). Every task behaviour is a **pure function over that store**, not a
method on a god-object: the lifecycle verbs (`claim` · `reassign` · `markComplete` · `submit` · `approve` ·
`reject` · `revoke`) live in `taskLifecycle`, CRUD/query in `taskCrud`, and `createTaskStore` wraps the pair back
into an ergonomic (emitter + audit + sync) surface for callers that want one.

Three capabilities fall out of that shape:

- **Co-ownership.** A task's owners are an `assignees[]` array capped by `maxAssignees` (default 1); the singular
  `assignee` is a mirror of `assignees[0]`. `claim` compare-and-swap-appends the actor, so several people can own
  one task without a second code path.
- **Cross-circle "my tasks".** A pure aggregator walks a user's circle bundles and projects a per-circle
  `{open, overdue, awaitingApproval, mine}` roll-up (mine = `assignees` includes you), sorted busiest-first — one
  view across every circle without merging their stores.
- **Sendable lists.** A whole container subtree can travel into another circle: a pre-order subtree walk
  (`collectSubtree`, depth-guarded) fans the single-item in-place share over every node
  (`shareContainerTree`), so sending a list is the sharing primitive applied N times, not a bulk copy.

Authority over tasks rides on two capability-token primitives, both enforced by the one `PolicyEngine`:

- **Roles as capability bundles.** A role is a `RoleBundle` — a named, frozen set of grant-templates; assigning
  it calls `RoleGrantManager.materializeBundle`, which signs each template into a real `CapabilityToken` scoped to
  the member and group. The display role and the enforced authority are the same object.
- **Task-scoped grants (the mandate / *entrust* primitive).** `TaskGrantManager.attachGrant` issues **one**
  capability token equal-or-narrower than the granter's, stamped `constraints.task = taskId`, **off by default**;
  `revokeTaskGrants(taskId)` revokes it on task complete/cancel. In the UI this is **entrust** (NL
  *toevertrouwen*): a task owner delegates "act as me" or "use this offering" for just this task, chosen from an
  extensible grant-kind taxonomy and routed through the confirm gate. The kring **Taken** tab surfaces both the
  task list and the entrust picker; the grant/legibility logic is shared, the web and mobile pickers are thin
  projectors over it.

### Offerings and the three disclosure axes

Not everything a person can do arrives as a task someone already wrote down. Alongside the *invocable* skills an
agent advertises (the A2A sense — see `decisions.md`, 2026-07-17), a person's own "I can do X" is an
**offering** (NL *aanbod*) — a disclosure-controlled profile property, held on the roster as `MemberMap.offerings`
and normalised against a fixed taxonomy in `@onderling/agent-registry`. It is *data*, not a callable, and it
becomes reachable to others only through the disclosure policy.

That policy is **three independent axes** per property, not one show/hide flag:

- **disclosed** `{enabled, rung}` — the only axis that releases a value, at a chosen rung on the coarsening
  ladder.
- **matchable** — may participate in on-device matching *without* being disclosed (`matchable` can be true while
  `disclosed` is false). Matching runs on the matchable set (`matchProfilesMatchable`) and never forces a
  disclosure.
- **requestable** — another person's agent may invoke or ask about it (default false).

All three persist independently across a registry round-trip. The **requestable bridge** is where an offering
crosses into the invocable world without becoming a remote function call: the `requestOffering` dispatcher on the
host agent, guarded by the requestable axis, does **not** execute the offering — it **mints a `request`-kind
task** the owner can accept, adapt, or refuse. So "ask a neighbour to do X" converges on the same task substrate
above, with the owner's consent step intact.

### Sharing — in place, across circles, and beyond them

Tasks, offerings, and every other item type share one further problem: how an item crosses from one circle to
another without being copied, and how that crossing is taken back.

Sealed circles (postures p2/p3) encrypt content under a per-circle **group key**, kept in a *versioned*
**group-key resource** on the pod — each version wrapped to the then-current members' keys. Membership **is**
the gate: a member proves they belong by unwrapping the current version; a revoked/never member can't, so
they're denied (`readGroupKey` throws — they never see ciphertext, let alone plaintext). Every kind of sharing
is a move over this one resource, so it never copies data it needn't and revocation is real.

The same group-key seal also gates a circle's **chat history at rest**: under the `pod-signal`/`pod-only`
data-move (Part 4), each message is sealed with this exact `{seal, open}` and written to a range-queryable
per-circle log (`@onderling/pod-client` `sealedMessageLog`, over the blind `StorageBackend` port) — the store
moves opaque ciphertext, the seal is the gate, and a circle whose key can't be resolved is refused rather than
written in plaintext (invariant #7).

- **Canonical (in-place) sharing.** To share an item to another *circle* without minting a copy, the origin
  re-wraps the item's group key to the recipient and grants ACP read on the canonical resource; the recipient
  reads the single copy in place through a `shared-ref` pointer. **Revoke = rotate**: a fresh group-key version
  is wrapped to the *remaining* recipients — forward secrecy, since content sealed after revocation is
  unreadable to the dropped member. One resource, one copy, revocable.
- **Historic keys, cross-version read.** A rotation *retains* the outgoing version (appended to the resource's
  `history[]`, still wrapped to its own recipients) instead of discarding it, so an entitled member can open
  content sealed under an older version they lived through — resolved by *authenticated trial* across the
  versions their key can unwrap. Forward secrecy is untouched: a revoked member is absent from every later
  envelope, and the live reader is gated on *current* membership — so a drop-out gets **no** historic access.
- **Out-of-circle sharing (to a person).** A recipient who is in *no* circle can be granted access, identified
  by their **published network key**. No new cipher: their X25519 sealing key is derived from their Ed25519
  network identity via the same `ed2curve` map the agent already uses for `nacl.box`, then the same re-wrap
  primitive applies. A per-circle **`shareOutOfCircle` policy** governs it — `prohibit` (blocked), `notify` (a
  revocable canonical grant **plus** a notice to the circle: its admins, or a `permission-log`-tagged pinboard
  post), or `silent` (a **copy** sealed to the recipient, leaving no ACP/pointer trace in the circle — more
  private). Pre-grant history is never handed to a new out-of-circle recipient unless explicitly opted in.
- **The receiver — "shared with me".** A silent copy is pushed over the relay straight to the recipient's peer;
  their device receives it into a per-user, *tiered* store (local, mirrored to the pod when signed in) surfaced
  on the **Mij** screen. Opening it needs the device's own sealing key — derived from its network secret, which
  stays **encapsulated** in the agent identity: the kernel exposes only an opener *closure* (`sharedCopyOpener`
  hands the secret to an injected builder internally and returns just the closure), and the pod-client adapter
  supplies the derivation. The secret never leaves the identity.

---

## 4 · The system

*What it all runs on: the layer stack, the rule for where compute is placed, the inter-agent axis with the
paths that carry it, and how a circle's state stays consistent without a server.*

### The layers — kernel, adapters, substrates, apps

Code depends downward only — a project-wide invariant (full detail:
[`conventions/architectural-layering.md`](./conventions/architectural-layering.md)):

```
apps/                        thin compositions — per-app glue + UI
  ↓
packages/{substrates}        reusable building blocks — item-store, offering-match, notifier, app-manifest,
                             pod-client, sync-engine, … (a gradient: runtime-foundation → feature → facade)
  ↓
packages/core                the KERNEL — a lean set of PORTS + kernel logic
```

- **The kernel (`packages/core`) is lean.** It holds the `Agent`, envelope/parts, the skill registry, the
  inbound-permission gate (`PolicyEngine`), the inter-agent invoke (`invokeAgentSkill`), `InternalTransport`, and
  the **ports** — `Transport` · `DataSource` · `ActorResolver`, plus the narrower `StorageBackend` (a **blind
  ciphertext store**: opaque `put`/`get`/`list`, no plaintext read — see *Sharing* in Part 3 for why the seal,
  not the store's access control, is the gate).
  The ports are the **named compatibility contract**: *implement the port + pass its conformance harness =
  compatible with the kernel* ([`conventions/ports.md`](./conventions/ports.md)). The concrete **adapters** live
  OUTSIDE the kernel — network transports in **`@onderling/transports`**, Solid-pod storage + on-pod identity in
  **`@onderling/pod-client`**, the vault family in **`@onderling/vault`** — and nothing in the kernel depends *up* on an
  adapter (guarded by `test/layering.enforcement.test.js`).
- **The developer SDK is `@onderling/sdk`** — the fat, batteries-included facade, **layered**: a *low* layer
  re-exports the kernel + default adapters (pass your own explicitly → maximal clarity/compatibility), and a
  *high* layer adds `createAgent()` (run-as-agent, defaults injected) + `connectSkill(agent, name, appFn)` (map any
  app function to a skill). "Import one thing, done"; drop a layer for full control. Defaults (e.g. `VaultMemory`)
  live in the facade, never the kernel.
- **Substrates** compose the kernel + adapters into reusable pieces, building on kernel primitives rather
  than reinventing them — a parallel transport or vault implementation would drift away from the security and
  compatibility guarantees the kernel carries. They form a **gradient**: *runtime-foundation* (vault, oidc-session, pod-client — near-required for a networked
  agent) → *feature* (offering-match, notifier, pod-search — optional) → *facade* (secure-agent, agent-provisioning —
  compose others). Extracted under a **rule of two** — generalise on the second independent need, not the first.
- **Apps** compose substrates (or `@onderling/sdk`), using the kernel directly only with a justification in the app
  README.

See [`repository-layout.md`](./repository-layout.md) for the full apps + packages map.

**How the monorepo resolves — the workspace + the two scopes.** All the code lives in one pnpm **workspace**:
many packages in one repo, linked to each other on disk (not downloaded). Two npm scopes make the layer stack
visible in every import — **`@onderling/*` are the substrate PACKAGES** (`packages/*` — item-store, core,
circles, sdk, …), **`@onderling-app/*` are the APPS** (`apps/*` — basis, stoop, tasks, folio, …). "`@onderling-app`"
is NOT a second repo; it is the app scope. An app importing `@onderling/item-store` resolves to a **symlink**
pointing at the sibling `packages/item-store`, never a published copy. The tree is deliberately **FLAT**
(`.npmrc` `node-linker=hoisted`, per-app lockfiles) because Metro/Vite + the relative cross-package imports
need packages sitting at their real locations. Caveat worth knowing before you touch installs: a partial
`pnpm install --filter …` can **shred those symlinks repo-wide** (replacing links with copies, pruning
siblings you never named) — the deterministic fix is **`node scripts/relink-workspace.mjs`**, NOT a reinstall
(full trap + tells in [`agent-notes-known-gotchas.md`](./agent-notes-known-gotchas.md)). A green test suite
means the tree is healthy; a flood of "cannot resolve `@onderling/x`" in apps you did not change is the relink
tell — not a "broken tree". Note many substrate packages are **pure DI** (they import almost nothing;
consumers inject the store/fan-out — e.g. `@onderling/circles`), so "this package doesn't resolve `@onderling/y`"
usually means y is simply not its dependency, not that resolution is broken.

**A fourth region the diagram omits: the deployment / hosting layer.** Client apps host nothing. Server-side
services — **pod-HOSTING**, relay/proxy, the private-LLM enclave, rollout — form a separate layer, placed by
trust + latency (below), that sits *outside* the client apps. The `feedback` deployment occupies it today (it
runs a live Solid-pod host, HTTP services, and a container stack that no client app has). This is where the
eventual repo split's server side lives.

### Placement by trust + latency

*Where* functionality runs is decided by **trust and latency, not convenience** — the default is never
"put it on a server". Sensitive compute (pod
access, sealing, the confidential LLM transport) stays client-side or in an **attested enclave** (TEE);
"server-side" means *extracting* code that is already server-side (pod-hosting, relay/proxy, private LLM), not
moving private data onto an untrusted host. Correspondingly:

- **Local-only mode is the floor; the pod is portability.** Every app works fully without an authenticated
  pod. Shared-state apps without a pod replicate P2P via kernel `MergeContracts` + per-member relay
  forwards. (The relay's `group-publish` fan-out was removed 2026-07-31: the frame named a circle in
  cleartext on the wire. The sender holds the roster and addresses each member.)
- **Pod is truth, local cache is reality.** When a pod is configured it's authoritative but slow; the UI reads
  the local cache and syncs on a cadence with optimistic, queued writes, so a pod outage never breaks the app.

### Agents interacting (the inter-agent axis)

The request flow in Part 2 is **intra-agent**: one interface → the waist → dispatch → functionality. Equally
fundamental is the **inter-agent** axis — agents as **peers exchanging over a transport**, carried by an
**envelope**. One wire carries three things: it **syncs circle stores** (with no pod, a write fans out to circle
members as envelopes), it carries **direct exchanges** (offer→claim, request→respond), and it enables **remote
skill-acquisition** — an agent authenticates into *another* agent's gated skill surface over a transport, with
identity, permission, and validation travelling **in the envelope**. This is what lets functionality resolve on
an external agent (consequence #2 in Part 1), and it's the substrate the developer-integration on-ramps (a
connected bot, a remote handler) build on.

**One send waist (`deliver`).** Every message a circle emits — a chat line, a broadcast, a 1:1 DM — funnels
through one primitive rather than the parallel send paths that used to exist. There is **one canonical chat
`Envelope`** (`@onderling/item-store/chatEnvelope.js`) with declared, pure projections — `toEventLogItem`
(the in-memory render event), `toWireEnvelope` (the peer fan-out shape), and `chatEnvelopeFromStoreItem` (the
durable stored item) — so the three shapes that used to be hand-reshaped (and drift) are now views of one datum,
proven byte-identical to their old producers by round-trip tests. Over that envelope: **one circle-broadcast**
(`broadcastToCircle`) fans to a circle's members, and **one addressed send** (`addressedDeliver.js`) folds the
two former 1:1 DM paths (the ephemeral contact-thread channel and wireChat's persisted `chat.send`) into a
single `deliver` — a DM is just `deliver` to an audience-of-one. That fold also made the contact/bot thread
**durable** (it was in-memory only, lost on reload): each turn persists to a durable thread keyed by the
envelope id, which doubles as the DM dedup nonce. `wireChat` now routes through the same core. Membership is
**proof-derived** from a per-circle signed log — a member is targeted for fan-out because the log proves they
belong, not because an ambient list names them.

**Where a message moves is a policy branch.** A circle's data-policy (`policy.pod`) selects one of three
send-path branches, resolved in one place (`circleDataPolicy.js`, which derives the store mode and catch-up
strategy off the same posture):

- **`fan-out-full`** (no-pod) — the full-body envelope fans to every member. This is also the **honest degrade
  target** for the other two.
- **`pod-signal`** (shared / hybrid pod) — the body is written once to the circle's shared pod as a sealed row,
  and members receive a lightweight **ref** envelope pointing at that row.
- **`pod-only`** (pod-only) — the row is written and *no* fan happens; members read the pod on catch-up.

**Honest degrade — read this before assuming pod-signal is on.** `pod-signal`/`pod-only` take effect only when
a real shared-pod writer is wired *and* the write succeeds. That writer is wired in the **web** shell today
(`circleApp.js`, over a per-circle `podStorageBackend` with **live member-side key custody** — this device's
vault-backed X25519 identity unwraps the circle group key); **mobile is not wired and stays on `fan-out-full`**.
The write is **seal-or-refuse**: a sealed circle whose group key can't be resolved *throws* rather than write
plaintext (invariant #7). Whenever the writer is absent, the pod has no backend, or the seal is unavailable, the
branch **degrades loudly to `fan-out-full`** (logged, never silent) so the message still reaches every member.
The pod round-trip is proven against a MockPod and with live member keys in tests; on-device verification against
a live running pod is still forward work.

The paths that carry the envelope are below.

### Reachability

Two peers exchange over whichever path is currently usable; a **per-peer picker** chooses
(`RoutingStrategy.selectTransport`), no app code does. A peer is **one `Peer` with an address map**, not a scatter
of per-transport handles: `PeerGraph` holds each peer's `transports` (name → config), and
`PeerGraph.addressesOf(peerId)` flattens it to `{ transport → wire address }`, so the picker resolves the
transport-appropriate address for the peer it already knows.

The picker classifies its choice into **reachability tiers** (`ReachabilityTier`), an ordered ladder from
closest to most indirect:

- **direct** — WebRTC / BLE / mDNS / Local / Internal: no third party between the two agents once the link is up.
- **mesh** — relay (`@onderling/relay`) / NKN (the public messaging network, no operator to run) / MQTT /
  offline store-and-forward: an indirect, third-party-mediated link.
- **hop** — peer-as-relay (a third agent forwards a sealed or plaintext payload, hop-count + policy gated); a
  *routing* decision, not a transport class.
- **companion** — a user-hostable node that consent-grants "route through me"; the last-resort carry when no
  closer rung reaches the peer.

**Per-peer is not enough for a circle.** The picker answers *"how do I reach this person?"*, which is the
wrong question for circle traffic: a circle is reached the way **that circle** is reached. Left per-person,
circle content rides whatever transport wins for that peer — including one the circle does not live on,
where its per-circle address means nothing and the message is undeliverable.

So circle traffic carries a **scope**: the circle's own **connection points**. The constraint travels as
points (urls), never as a circle id downward or a transport name upward — the app owns points, the transport
layer owns transports, and neither learns the other's vocabulary. A circle with no recorded point rides the
deployment default; *"unconfigured"* means the default, never nowhere.

The scope **narrows** the candidate set; reachability still decides. (Replacing selection rather than
narrowing it makes an offline peer look routable and silently disables hold-forward.)

**What the scope refuses, and why it is a user's choice.** Per-circle addressing only works where a
transport can bind aliases — a relay can; NKN cannot, because an NKN client *is* an address, so per-circle
addresses would mean one client per circle. Routing a circle over a transport that cannot carry them does
not fail loudly: it silently strips **member-level unlinkability**, since everyone in two of your circles
would route to the same address. That is not a decision the router should take, so it is bound to the
existing **per-user address fallback** (default off, offered with its cost): with the fallback off a circle
whose points cannot carry per-circle addressing is honestly undeliverable; with it on, the user has
accepted the trade and an NKN circle works. Same vocabulary as every other fallback in the product — no new
concept, and the cost is stated where it is incurred.

**A different address is not enough on its own: a circle also signs with its own key.** A member holds a
**per-circle identity** derived from the profile seed (`circleIdentity`), and it is that key — not the
profile's global one — that signs a circle envelope and that content is sealed to. Without this the routing
address differs per circle while the keys in the header do not, so anything carrying the traffic can line the
circles up by key alone and the per-circle address buys nothing. Selection is by address: the transport
stamps one of its own bound addresses on the envelope and the security layer picks the identity that answers
there, so nothing below the app learns that a circle exists. Contact and pairing traffic still uses the
profile identity — there is no circle to speak as.

`RoutingStrategy.routeLadder(peer)` exposes the full `direct → mesh → hop → companion` ladder. **Built vs.
forward:** direct + mesh resolve from real transports (NKN end-to-end, relay, `InternalTransport`); the **hop**
rung resolves only when a peer-as-relay bridge resolver is wired, else it reports itself unavailable; the
**companion** rung is a declared **seam — its adapter is not built**, so it degrades honestly rather than
pretending to carry. Offline **hold-and-forward** exists today as a send *guarantee* (`sendTo(…,
{guarantee:'hold-forward'})` — a briefly-offline member has the message held and flushed on reconnect); a
*dedicated* hold-and-forward port is forward work.

**Two unrelated "hop"s — don't conflate them.** The **transport-hop** above (the `hop` rung) is peer-as-relay
*routing*: forwarding a payload through an intermediary peer to reach a target. The **social match-hop**
(`@onderling/kring-host` `circleHop.js`) is *discovery*: relaying a skill query one degree further through a
contact who allows it — it never appears in this reachability ladder.

Transport details: [project overview → Reachability](../README.md#reachability--transports).

### Consistency & governance

Reachability gets a message to a peer. What happens when several peers write at once, or when one of them lies,
is the last system-level concern.

A circle's state lives in **one signed log stream** (the `EventLog`) — chat, membership, key rotations, and
governance events all ride it; no central server arbitrates. Four layers keep it consistent under partitions
and bad actors, weakest concern to strongest:

- **L1 · concurrent edits** — benign divergence (two people editing offline) is a deterministic merge, not a
  conflict; eventual connectivity converges. The merge is a **declared resolution policy** per
  `(item-type, field)`, receiver-enforced so a sender cannot pick a weaker one: **content** (last-writer-wins —
  posts, notes, task text) · **claim** (first-wins / immutable-once-set — a task's assignee, a reservation) ·
  **spine** (deny-wins — membership, roles, keys; enforced by the L3 hash-chain below). (Rich collaborative
  content-merge — sequences, text — lands later with folio versioning.)
- **L2 · forgery** — every event is signed by the author's **per-circle key** + proof-of-membership, so
  non-members can't inject and members can't forge each other's events.
- **L3 · equivocation** — a member signing two contradictory events (telling different peers different things —
  double-voting, key-splitting) is caught by a **per-author hash-chain**: each governance-spine event carries a
  `parentHash`, so two events sharing a parent are a self-verifying **fork-proof**. Any replica holding both
  halves mints it; the fold marks the author **disputed**, which resolves via the governance layer below.
  *Scope: the hash-chain covers only the governance/membership/key event types — chat stays on the mergeable
  concurrent-edit path (forking chat isn't an attack).*
- **L4 · governance** — each governed action maps to a **decision-class** in the circle policy
  (`governance: { removeMember, rotateKey, changeRule, changePolicy } → any-admin | admin-quorum | member-vote`).
  A `member-vote` tallies `governance` events over the **full proof-derived membership** (not the reachable
  subset), so a partition can't unilaterally decide; an unreachable threshold **pends** (safety over liveness),
  with an **admin-override** valve once a vote sits past its deadline. If the **last admin** departs, a
  **deterministic caretaker** is appointed — the member the whole circle independently computes from the log (a
  hash-of-the-departure pick, next-in-line if unreachable), never a locally-rolled random that would itself fork.

Anything that must be *agreed* is computed identically everywhere (the tally, the caretaker), never decided
locally — the same discipline the hash-chain enforces. Full record: [decisions.md](decisions.md) (2026-07-25).

---

## 5 · The five homes

*The system organised by **place**: Agent · Circle · Pod · Surfaces · Connectivity, plus the shared type
dictionary. Everything above describes mechanisms; this section describes where each mechanism lives and
what its home guarantees. Written chapter by chapter, only as each home's description matches the running
code — a chapter here is a claim about reality, not a plan.*

### The Agent home

*Your agent is the thing that acts as you: it holds your identity, signs what you say, remembers what
other agents did with your things, and can always be rebuilt from one secret you keep.*

**One secret, everything derived.** An account has exactly one root secret, shown once to its owner as a
24-word recovery phrase (the *herstelzin*). Every key the agent uses derives from it deterministically:
the default profile's chat identity, a **distinct signing key per circle** (so two circles cannot
correlate you by pubkey — see the Connectivity notes on the limits of this today), and the key that
encrypts the agent's stored secrets at rest. Owning the phrase *is* owning the account; the phrase alone
recovers the same identities, the same per-circle addresses, on any device.

**The phrase is never stored.** What a device persists is the 32-byte root **seed**, kept behind the
strongest door the platform offers: the OS keystore on mobile (Android Keystore / iOS Keychain,
device-only — never a cloud keychain backup, because the phrase re-derives it anywhere and a synced copy
would be one more place the secret lives); on the web, the seed sits in IndexedDB only encrypted under a
**non-extractable** WebCrypto key, so copying the browser profile yields ciphertext plus a key handle
that cannot travel. Stated honestly: the web door protects against disk and backup readout, not against
code running inside the same origin; and on hosts with no key door at all (a headless Node agent), the
gain is containment — the recovery artifact the product promises "exists only in your hands" is off the
disk — not hardware secrecy. An install that predates this custody model has its stored phrase adopted
into the door on first boot, read-back-verified before the cleartext is deleted: a keystore that loses
the write keeps the phrase rather than losing the only copy of an identity.

**Everything else the agent stores is sealed.** Vaults holding key material or capability tokens — chat
seed, host identities, per-app identities, token registry — read and write encrypted under a key derived
from the root each boot (never persisted). The seal is bound to the root's fingerprint: restoring a
*different* phrase is an identity switch, and those vaults start clean rather than carrying the previous
person's seeds, tokens, or mute lists — entries sealed to the old root are undecryptable to the new one
by construction. Trust levels and the audit log stay deliberately plain: sealing them buys no secrecy
and widens the blast radius of an unlock problem.

**Two records of what happened, one retention vocabulary.** The agent keeps two append-only records with
different readers: the **security audit** (a signed hash chain of key ceremonies and crypto events — its
`verify()` walks every signature and link) and the **agent trail** (the record that an agent *acted*:
which op, on what pointer, under which authority, with what outcome — never arguments or content,
because a trail that carries content becomes a second copy of the data under different access rules).
The trail is fed at the one dispatch membrane every skill exercise crosses, in-process and remote alike;
the owner's own surfaces are filtered out — a bot-audit surface must not become self-surveillance — and
the per-agent activity card opens one deliberately chosen actor's trail, never a firehose. Both records
derive their retention window from the **same** shared class table, and audit-class entries never
silently drop: past the detail window they **compact** into a summary that says how many entries it
folded and of what, because a trail that forgets silently looks complete, which is worse than honestly
short. Compacting the signed chain re-chains it so verification still passes end to end.

**Profiles and delegation.** The registry (the single write-truth for a user's agents, with a derived
A2A card per agent) records which profiles exist; a full-trust device loads the root and can run any of
them, while a low-trust device receives a revocable delegation of one profile — never the root, so it
cannot derive or reach the others. Restore is two writes in a fixed order: the root seed into the key
door first (a failed second step still leaves the next boot able to recover everything from the door),
then the default profile's identity re-derived from it — never from the phrase's raw entropy, which
would mint a different key than the roster knows.

### The Circle home

*A circle is a group that shares one store and agrees on what happened in it — without any member's
device being the boss.*

**One circle, one store, one log.** A circle owns exactly one item store; whatever that store holds is
what syncs to the members. Underneath, the source of truth is each device's append-only event log: circle
statements are **signed and chained** (each carries its author's per-circle signature, a parent link, and
causal dependencies), and ingest verifies before anything lands — the signature itself, that the signed
kind matches the declared kind, and that the signing key belongs to the roster member it claims to be.
Nothing a peer sends is trusted for *being sent*; it is trusted for *verifying*.

**The lanes.** Four kinds of circle state ride the same rail with per-lane semantics: **membership**
(catch-up is pull-everything, because completeness is the point of a roster), **governance** (proposals
and votes as typed events; a changed vote supersedes along its author's own chain), **chat** (one entry
per message *is* the conversation's record — see retention below), and **tasks** (full-item snapshots,
so a late joiner needs no verb replay). Conflicts resolve **identically on every device**: ordering
rides one logical clock rather than wall clocks, same-author revisions resolve by chain ancestry, and
genuinely concurrent writes settle by deterministic tiebreaks — never "whoever heard it first wins."

**Membership is proof, not an admin table.** Joining is a redemption against a signed invite; an invite
admits at most its own cap, within the circle's ceiling, within a system-wide cap — three levels, each
only stricter than the one above. Eviction is a **signed, replayable statement** that rotates the
circle's group key (what's shared after the eviction is unreadable to the evicted). Membership
transitions are signed with a **circle-scoped identity carrying the member's verified ref**, and the
roster is the **authoritative causal fold** over those statements: ordered by causal depth over the
statement graph, authority checked at the fold point, deny-wins applied only to genuinely concurrent
acts — so a causally later re-join re-admits, a concurrent evict-vs-rejoin resolves to the eviction,
and every device computes the same roster. An equivocating author (two statements off one parent) is
discounted wholesale. Compositions without the log rail keep a strengthen-only fallback (drop or
demote, never admit) — safe, and honestly weaker. A founder is never evictable.

**Mute hides, eviction refuses.** Muting a person is a view-time filter at the one projection every chat
surface reads: their messages still land on the log (an append-only record never silently discards), and
unmuting restores the history intact. Eviction and blocking, by contrast, refuse at the door. Chat
entries are record-class — nothing auto-deletes; the only way messages leave a device is the owner's
explicit delete-older-than action.

### The Pod home

*The pod is where your data can live so it survives your devices — storage and transport, never
authority.*

**Authority stays on the device log; the pod carries and keeps.** A sealed pod row transports the
*signed statement itself*, so whatever comes back from a pod re-enters through the same verification
gate as a peer message — a pod (or whoever operates one) cannot originate circle truth. Pod-only
circles never fan peer-to-peer at all: members read the statement rows back with a watermark and verify
each on ingest.

**Sealed by default, keyed to people.** The sealing envelope encrypts every resource under a fresh
content key, wrapped either to each recipient's public key (the writer needs only public keys; the host
is blind) or to a circle **group key** that is itself distributed by recipient-wrapping — one resource,
O(1) per member, rotation on eviction. Portable crypto, one implementation across Node, browser, and
mobile.

**The store rides the pod as a cache feed.** A pod-backed circle's store attaches the pod as a
read-through, write-behind medium: local is reality, the pod catches up. For the owner's own settings
the same idea gets a **restoration gate**: before the attach's bulk flush may touch the pod, a
read-only probe classifies the blob — openable, missing, sealed-under-another-key, or unreachable —
and only the first two attach. A key mismatch (a fresh install without the phrase) *holds*, surfaces a
three-choice dialog (recover with the phrase / this device only / explicit overwrite), and a transport
error is never treated as a mismatch. When both sides hold different values, the pod's copy is captured
*before* the local-wins flush, so a per-setting merge list can still honour "use the pod's value."

### The Surfaces home

*Everything a person (or model) touches compiles to the same `{opId, args}` — the manifest is the
contract, and every surface is a projection of it.*

**One declaration, five projections.** An app's manifest declares its operations once; pure projectors
turn that declaration into the chat tool, the slash command, the deterministic gate verbs, the attach
menu, and the web/mobile screens. Neither AI nor GUI is privileged — both are compilers to the waist.
Screens, list→detail drill-downs, and record views render generically from the declaration; a
capability matrix (circle policy × app) decides what shows. The coverage snapshot records which op has
which surface, and CI fails when it drifts from the manifests.

**Every op has a default place, by construction.** An op with no bespoke screen is still visible and
reachable: the **advanced surface** (Mij → Geavanceerd, both platforms) lists exactly the
coverage-matrix's complement — a no-argument op runs straight through the waist from there; an
argument-taking op shows its chat form, because the chat route is the argument-taking executor every op
already has. The same surface exposes the parameter register: every user-tunable value, editable
through the one kind-gated `set-param` (which refuses internal params and unknown keys, and routes the
new value to its scope's sync home). A registered param nobody reads fails CI; so does a user-facing
param with no UX home.

**Parity is structural, not disciplined.** Web and mobile shells are thin composition-and-paint layers
over shared projections — the same rows, the same locale source (every user-facing string through
`t()`, Dutch and English), the same manifest. A capability that exists on one shell and not the other
is a finding, not an idiom.


**Connections — a screen that is yours, somewhere else.** A paired view (a browser tab, a client on a machine
you host) is not a device and not a member: it holds no ceremony, no roster row, and signs no circle
statements. It holds a **standing grant** — one signed capability token per operation its owner ticked — and
it works on two separate rails that are deliberately not one:

- **Acting** travels as a signed envelope carrying `{opId, args}` plus the presented token, verified at the
  acting agent's door and dispatched through the ordinary waist. There is no second dispatch path. The
  view's code is untrusted by construction: it may send anything, and nothing outside its picks verifies.
- **Reading** does not travel at all — the view hydrates a **filtered lane of the sealed history mirror**,
  sealed to its key, containing only the sections the owner granted. What crosses the network is a
  **contentless nudge** carrying a lane id and nothing else.

The gate is where it binds: revoking a connection is the owner's act, the door refuses while its grant
state is still loading rather than guessing, and telling the view to drop is a convenience — never the
gate. What the view already read, it read — the honest semantics of stopping a subscription, not of
erasing the past.

**A connection belongs to the person, not to the device that paired it** (decided 2026-08-19). Grants
and revocations are entries on the device log's **grants lane** — the active-grant set is a projection
folded from those entries (never a separate store), which makes revocation survive a restart by
construction and makes restore carry it for free. A person's own devices exchange the grants lane the
way circle peers exchange circle lanes, so a revoke made on the phone reaches the laptop's door live —
"unpairing the kitchen tablet on your phone must not leave your laptop still admitting it." The trust
base for that exchange is the add-a-device enrollment: a grant or revoke statement counts only when
signed by one of the owner's enrolled, unrevoked devices, and on any ordering conflict **revoke wins**.
This is the running model: the grant registry is a projection folded from the device log's grants
lane, statements sign with the device-derivation key (the delegation key on an enrolled device; the
profile key itself on an unenrolled first one — the binding floor every sibling verifies locally),
an enrolled device's statements carry their root-signed delegation record so a sibling verifies the
chain without the owner's registry (the registry supplies only the deny-wins tombstone), and the
fan targets the proven per-circle address set the owner's own roster rows carry. Revoke-wins is
CAUSAL: a grant stands only when every revoke of that view is in its causal past, so a concurrent
re-grant loses to the revoke it never saw, and re-admitting the view is a deliberate new grant made
after the merge. One honest edge: a person in no circles has no live fan target between their
devices — restore-time (the log itself) is the designed floor there.

### The Connectivity home

*How agents reach each other: transports are adapters behind one surface, and every hop is designed
around "who learns what."*

**Routes, not reach-arounds.** Apps never construct a transport; the mesh builder composes them
(local network, BLE, NKN, relay) behind one agent and a peer surface. In a circle, **your address is
your signing key** — one derivation, so knowing where to reach someone *is* holding the key that
verifies them: no directory, and deliberately no key-id resolver, because a resolver is an observer
that learns who asks about whom. The full key rides the wire (~14% overhead on a minimal message) as
the price of first-contact verifiability.

**Contact reveals, so contact is minimised.** A sender uses the *fewest* connection points that achieve
delivery — sequential fallback, sticky on what worked, backing off from what fails — never race-them-all,
because every point tried is an extra observer. A member may sit on one point or several (resilience is
a member's choice, not a circle-wide tax), and "I could not reach them" is a real outcome the UI is
allowed to say. The relay holds messages 24 hours — an agreement pinned by a test that reads both the
relay's and the app's value, so the two cannot silently disagree.

**Catch-up is windowed and consented.** A peer rejoining a lane sends its frontier (the head-hashes it
knows); what comes back is chunked and receiver-limited, and above a threshold the sender first asks —
"there are N messages (~X MB), download?" — with the thresholds as tunable params and the allowance
remembered per peer and circle. Membership is the exception: rosters always pull everything.

**Stated gaps, on purpose.** Per-circle *keys* are unlinkable today, but roster and fan-out still ride
the profile's webid — so a co-member who is also your direct contact **can** link the two identities;
the per-circle transport/rendezvous cutover that closes this is designed, tracked, and not built.
Similarly, NKN's addressing cannot alias, so an NKN-carried circle currently trades member-level
unlinkability for that transport. Writing these down here is the contract that they are gaps, not
choices.

### The dictionary

*The shared nouns every home speaks — one table per vocabulary, one home per table, a guard on each.*

**Entry kinds** classify every log entry once: its lane (human conversation vs silent system), whether
it may wake an offline device (silent kinds never do), whether it is auditable, and its **retention
class** — `short` (housekeeping, drops), `chat` (windowed by the person's one retention setting),
`audit` (never drops — **compacts** into a summary that says how many entries it folded and of what),
and `record` (membership, chat messages: the entry *is* the record; pruning one would silently rewrite
history). **Resolution policies** classify every (item-type, field) write: `content` (last-writer-wins,
the conservative default), `claim` (first-wins, immutable-once-set — a task's assignee), `spine`
(deny-wins — membership and authority), each implying its delivery tier (best-effort / at-least-once /
reliable). The policy is declared by the app's manifest but **enforced by the receiver** against the
substrate's table, so a sender cannot shape an item to dodge the intended merge. Item types get the
standard verbs for free and add their own; new closed vocabularies need a home and a guard before they
ship — the locale file is the fastest index of what already exists.

## 6 · Direction

*Where this is going, and where to read next.*

### Where this is going

> **The five-homes reorganisation has begun** (§5): the system's description by *place* — Agent · Circle ·
> Pod · Surfaces · Connectivity, plus the shared type dictionary. Chapters land **only as each matches the
> running code** — the Agent home is written; the rest follow, and this pointer goes when the last one does.

Two directions are settled and already shaping the work described above:

- **Apps consolidate into the Basis shell.** The manifest-per-app split is an *engineering*
  boundary, not a product one: each `manifest.js` stays the source of truth every projector reads,
  while the app names become navigation labels inside one unified surface. New functionality means
  adding manifests and projectors to Basis, not standing up new app silos.
- **The platform is a published surface.** The kernel and substrates ship as versioned
  `@onderling/*` packages on npm, consumed by external applications — the
  [feedback app](https://github.com/Onderling/feedback) is the first external tenant and the
  permanent proof that the public surface suffices. More packages publish as their APIs settle;
  the invariants above are enforced by CI fitness functions rather than review discipline.
  Settled choices and their reasoning live in [`decisions.md`](decisions.md).

### Where to go next

- [`principles.md`](./principles.md) — the *why* behind all of the above: the load-bearing values + the rule
  for deriving a design fork from them. Read it first when a decision needs a value, not a mechanism.
- [`CLAUDE.md`](../CLAUDE.md) — the working conventions + the invariants, for agents editing code here.
- [`conventions/`](./conventions/) — the detailed project-wide rules.
- [`glossary.md`](./glossary.md) — every term used above, defined.
- [project overview](../README.md) — the apps, the status, how to run things.
