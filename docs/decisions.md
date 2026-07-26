# Decisions log — code & architecture (ADRs)

Short, dated records of settled technical/architectural choices, so the *why* survives after the choice is baked
into the code. One entry per decision, **newest at the bottom**. How/when to add one:
[`conventions/decision-log.md`](./conventions/decision-log.md). Organization/strategy decisions live privately
in `plans/strategy/decisions.md`.

---

## 2026-07-01 — Base platform: React Native + Expo (not Electron / Tauri / Capacitor)

**Status:** settled and shipped (`packages/react-native` + `apps/`).

**Context:** one JavaScript base had to run on both web and mobile, and carry NKN, mDNS, BLE, WebRTC, and decent
background tasks.

**Decision:** React Native, starting with Expo (new project; migrate the useful old parts).

**Alternatives / why RN won:** over Electron / Tauri / Capacitor — RN runs the **NKN client** directly (plain
JS); **mDNS** via `react-native-zeroconf` (iOS Bonjour / Android NSD); **better background tasks** than
Capacitor; **WebRTC** via `react-native-webrtc`.

---

## 2026-07-01 — Docs are private-by-function; private docs kept in an overlay repo (task #66)

**Status:** settled and implemented.

**Context:** plans/designs churn and shouldn't clutter the public repo, but moving them fully out breaks
in-repo references and fresh-clone usability.

**Decision:** a file's **function is encoded in its name/location**, and that drives git: tracked/public =
`docs/**` + `README`/`QUICKSTART` + `CLAUDE.md`/`AGENTS.md`; ignored/private = `plans/` + `_archive/` + root
private-prefix docs. Private docs are versioned + backed up in a **separate private repo** mounted as an overlay
(`git --git-dir` external, work-tree = the repo) — never on the public remote. A CI lint (`npm run lint:docs`)
enforces the split.

**Alternatives / why:** over a git submodule (ceremony; agents stumble on submodules) and a full
file-move-into-a-sibling-repo (symlink/gitignore friction) — the overlay keeps files in place, needs no moves,
and can't leak to the public remote.

**Consequences:** the doc-structure + doc-org conventions (`conventions/doc-structure.md`); the public plan
history was purged from all branches.

---

## 2026-07-02 — Decisions logged in one running file per domain (not a file-per-ADR directory)

**Status:** settled.

**Context:** setting up a decisions log (Phase 1 of the roadmap/docs restructure).

**Decision:** one running ADR-lite file per domain — `docs/decisions.md` (code, public) and
`plans/strategy/decisions.md` (org, private) — newest at the bottom, governed by
[`conventions/decision-log.md`](./conventions/decision-log.md).

**Alternatives / why:** over a `docs/decisions/NNNN-*.md` directory of one-file-per-decision (the classic ADR
layout) — a single running file is lower-ceremony and reads as a history top-to-bottom, which fits a small team.

## 2026-07-02 — Capability surface is DECLARED-AUTHORITATIVE (a manifest's `nouns` curates it)

**Status:** settled and shipped (`@onderling/app-manifest` `capabilitiesOf`, commit `f8d659dc`).

**Context:** B's gate authorises `(verb × noun)` capabilities. `capabilitiesOf(manifest)` can get a manifest's
capability set two ways: DECLARED (`manifest.nouns[noun].atoms`) and DERIVED (read off each op's verb + the noun
it names via `appliesTo.type` or a `type`-enum param). Deriving from ops is convenient but noisy — a broad
`appliesTo` mints phantom capabilities (basis `submit·nkn` / `List·en` from value-enum params; stoop
`cancelRequest {type:'*'}` blasting `remove` onto internal itemTypes) that cluttered the freedom matrix.

**Decision:** when a manifest DECLARES `nouns`, that declaration IS its member-facing capability surface — the
returned set is exactly the declared `(noun × atom)` pairs; ops only fill in the implementing opId. A pair an op
would derive but the author didn't declare is DROPPED. Without a `nouns` declaration, ops remain the surface
(derived) — the fallback for un-migrated manifests, so the gate works app-wide before every app declares nouns.

**Alternatives / why:** over an additive UNION (declared ∪ derived) — the union can't curate: noise has to be
chased per-op (as the stoop `cancelRequest` narrowing had to). Declared-authoritative lets the manifest author
own the surface, and is inert at ship (household's nouns already equalled its derived set; the other real
manifests have no `nouns` yet, so unchanged).

**Consequences:** the gate is default-deny, so under this model **omitting a noun DENIES its ops** — to make an
action ungated (e.g. "leave group"), reclassify its op to a DOMAIN verb, don't just drop the noun. The per-app
`nouns` migration (declare = the current clean derived set, then curate) is tracked as the `#72`/`#81` tail. Both
the freedom matrix (`buildCapabilityMatrix`) and the gate (`effectiveCapabilityKeys`) route through
`capabilitiesOf`, so it applies to enforcement AND UI consistently.

---

## 2026-07-05 — One uniform invocation route (internal transport is a fast-path), over one pure core

**Status:** settled + **implemented** (2026-07-08). `wireSkill(coreFn, manifestOp)` in `@onderling/sdk`; **household
runs the uniform wired path by default — the legacy `HouseholdAgent` is retired** (cores registered via `wireSkill`
on a dedicated in-process agent in `realAgent.js`). **Workstream B done:** `tasks-v0` and `stoop` now call their
pure `(store,args,ctx)` cores directly on BOTH routes — the local route (`callSkill`) no longer builds a synthetic
single-`DataPart` round-trip; wire and local share one `TASK_CORES`/`STOOP_CORES` registry, and the A2A wire route
is byte-identical. The anti-drift guard the brief demanded ships as `@onderling/sdk/testing`'s `describeLocalWireFitness`
(`local ≡ wire` equivalence + manifest-op⟷core⟷wire parity), driven for tasks-v0 and stoop. *Follow-up:* add a
household fitness driver (its cores already run the uniform path).

**Context:** functions were reachable two ways that had drifted apart — a legacy A2A/`defineSkill`/envelope **wire**
route (tasks, stoop) and a direct in-process **store** route (household). An earlier framing proposed keeping *two
co-equal projections* of every function (a local caller + a wire wrapper), which invites drift and forces a
synthetic self-to-self envelope round-trip for local calls.

**Decision:** every function is **one pure core** `(store, args, ctx) → result`, invoked through **one uniform
route** — always `invoke(op, args, target)` via the transport — where the **internal transport is a fast-path**
that keeps the `callSkill` security gate and the uniform interface but **skips serialization for in-process
calls**. The separate direct-core-call route is **dropped**; the pure core survives only as the implementation the
wire-wrapper wraps (plus a unit-test / composition surface), not an app-facing route. The wire wrapper is
**generated** from the manifest op (`wireSkill(coreFn, manifestOp)` supplies args/validation/scope).

**Alternatives / why:** over "two co-equal projections" (the earlier framing, now **superseded**) — two routes
drift, and a local call shouldn't build an envelope to talk to itself. A uniform route with a local fast-path is
both cheap and singular, so there is one code path to keep correct.

**Consequences:** the inter-agent **wire is permanent** — it carries remote skill-acquisition, circle-sync, and
the bot / remote-handler integration tiers (identity + permission live in the envelope); "apps dissolve into
basis" is a **UI** consolidation, not removal of the serialization substrate. Follow-on: household regains a
first-class wire route via the uniform route (retire the legacy household agent); tasks/stoop extract pure cores
over their stores (dropping the synthetic-envelope round-trip).

---

## 2026-07-05 — Feedback is a deployment/hosting layer, not a peer client app

**Status:** settled (architectural classification; the code carve is tracked in the roadmap).

**Context:** the apps roster listed `feedback-pipeline` alongside client apps like household. But feedback hosts a
**live Solid-pod server**, runs HTTP services (portal / activation / MCP), has a TEE aggregation boundary, and
ships a full Docker deploy stack — none of which client apps have; basis only *consumes* it. The flat "apps"
picture hid this.

**Decision:** treat feedback as a **deployment / hosting layer** — server-side services + pod-hosting + rollout —
architecturally distinct from client apps, and the concrete instance of *placement by trust + latency* (extract
what is already server-side; keep private compute client-side or in an enclave). It is destined for its **own
repo**.

**Alternatives / why:** over keeping it a peer "app" — that flattening put a full-stack deployment next to a thin
client app, obscuring the client/server boundary the eventual repo split runs along.

**Consequences:** a clear-splits-now step (before the repo split): carve **`feedback-core`** (browser-safe, with
an `exports` surface so basis stops deep-relative-importing) → **`feedback-server`** → **`feedback-deploy`**.
Recorded as a distinct layer in the architecture + repository-layout docs.

---

## 2026-07-09 — Agent registry is the single write-truth; per-agent A2A cards are derived projections

**Status:** settled and shipped (`packages/agent-registry` — `projectAgentCard` in `src/agentCard.js`).

**Context:** a user's agents need one authoritative record (ownership · grants · revocation · liveness) *and*
an externally-interoperable A2A Agent Card per agent. Two writable representations of the same agent would
drift; and the coarse `capabilities[]` display list could diverge from what an agent is actually authorized
to do.

**Decision:** the **`@onderling/agent-registry` list resource** (one pod resource holding all of a user's agent
entries) is the **single write-truth**; every per-agent **A2A Agent Card is a derived read/interop
projection** of its registry entry (`projectAgentCard(entry)`) — one truth, one view, never written directly.
And within an entry, the **signed capability token (`grants[]`) is the enforced authority**; `capabilities[]`
is only its mirrored display — `applyGrant`/`revokeGrant` update grant + mirror atomically in one write.

**Alternatives / why:** over reusing core's `AgentCardBuilder` for the card — it projects a *live in-process
Agent*, not a stored registry record; same card format, different source, so the registry gets its own
projector. Over per-agent card files as co-equal writable records — a second writable copy is a drift engine;
a projection is always re-derivable. Over making `capabilities[]` authoritative — an unsigned display list
can't be an authority; the signed token can, and the mirror keeps display cheap.

**Consequences:** card fields the registry doesn't store yet (skill descriptions, streaming capability) project
as absent/static defaults until the entry carries them; revocation is purely registry-side (`revokedAt` →
`status: "revoked"` on the next projection); serving the projected card at the A2A `.well-known/agent`
discovery path is follow-on work.

---

## 2026-07-14 — Agent property vocabulary: open JSON-LD (schema.org / FOAF / vCard / OIDC claims + W3C WoT), thin canopy policy namespace

**Status:** adopted direction (design agreed; the properties system is not yet built). See
[`conventions/property-vocabulary.md`](./conventions/property-vocabulary.md) for the how-to rule.

**Context:** alongside requestable *skills* (things you can do) and *data* (things you hold), an agent will
expose queryable **properties** — attributes about the user or their possessions/devices (age, place,
availability; a tool to lend; a robot's battery), legible to both humans and bots/drones. The stack is already
JSON-LD/RDF (Solid pods + the A2A agent card), and the A2A `AgentCardBuilder` already advertises tier-filtered
*skills* — properties are the missing sibling facet on the same card.

**Decision:** properties are **JSON-LD typed terms**, and the vocabulary is **OPEN, not a closed enum** — a
property key is a namespaced URI, so it is self-describing and a bot can resolve it with no prior agreement.
Standard terms are the **common baseline** (so the frequent properties are mutually understood), and any JSON-LD
term may extend it:
- **Human/personal:** schema.org (incl. `Offer`/`Product` for shareable possessions), FOAF + vCard (Solid-native
  people/contact), OIDC standard-claim *names* (`birthdate`, `address`, …).
- **Device/robot:** W3C **Web of Things Thing Description** (a thing's queryable properties/actions/events —
  "battery left", status).
- **Canopy's own thin namespace** (`cdi:` — canopy disclosure) carries only the *policy* layer no standard
  specifies: the disclosure **ladder** (coarsening rungs), **persona**, **disclosure level**.

Anything **not pre-declared** is reachable only through a consent-gated query path (deferred; the highest-risk
surface).

**Alternatives / why:** over a **bespoke canopy vocabulary** — kills interop (another app/bot/agent can't
understand our terms). Over **W3C Verifiable Credentials + DIDs as the base** — heavy, and verification /
attestation is deliberately out of scope (properties are self-asserted; VC selective-disclosure is a clean
*later* add-on at the predicate rung if a real verification need appears). Standard self-describing terms for the
*what*; a thin canopy namespace for the *policy*.

**Consequences:** properties attach as a facet to the A2A agent card, filtered by the caller's trust tier but at
a **rung** (coarsened value) rather than binary show/hide; persona / disclosure-level / ladder live under `cdi:`;
open/semantic queries over non-declared attributes are a separate, deferred, consent-gated path.

---

## 2026-07-14 — Identity: one owner root; profiles unify agent/persona via own-vs-inherit; per-circle addresses

**Status:** adopted direction (designed with the owner; not yet built). Minimal-first slice defined.

**Context:** every in-process sub-agent (`cc-chat-id:` / `cc-stoop-id:` / …) currently has its own independent
random 32-byte seed — no shared root — so "one phrase = whole agent" does not exist, and the existing web mnemonic
reveal/restore is bound to a *different* sub-agent than the one a given feature (e.g. the feedback pseudonym) signs
with. A phrase-based backup would restore the wrong identity. Three needs share this substrate: cross-device recovery
of a no-login pseudonym, "log in to my agent from anywhere," and exporting a profile to a non-pod store.

**Decision:** a single **owner root** (a `Bootstrap` phrase) is the recovery unit. From it, per-**profile** keys are
HKDF-derived, and per-**circle** addresses are HKDF-derived from the profile key
(`root → profile → per-circle address`). A **profile is one concept that unifies "agent" and "persona"**: it carries
an open property graph (the JSON-LD [property vocabulary](./conventions/property-vocabulary.md)) where each property
(settings, relay, storage, contacts, circle memberships) is either **`own`** or **`inherit`(from a parent/default
profile)**. A persona-face inherits everything but its label/key/disclosure; a separate device-agent owns its
substrate; flipping `inherit ↔ own` re-scopes later with no migration. The set of profiles is a **registry**
(canonical on the pod as `agents/<id>.json`; exportable as one sealed file/DB). **Infrastructure attaches to a
profile-in-the-registry, never to a loaded instance** — so declining to reload a profile onto a device can never
orphan your relays/settings. Isolation for low-trust devices is a **revocable scoped delegation of one profile —
never the root key**. Every `(profile, circle)` gets a distinct derived address → **unlinkable-by-default,
linkable-by-choice**; the presented identity is a per-join **disclosure lens**, not baked into the profile.

**This reverses `Bootstrap`'s original "Track B" intent** — its docstring keeps the root deliberately independent of
the per-device agent signing identity; here the owner root becomes the **parent** of those identities. Intentional.

**Alternatives / why:** over *N independent per-app-role random seeds* (today) — no single recovery, wrong-identity
backups. Over *a rigid account→sub-agent hierarchy the user manages* — too complex; the own/inherit graph + an
invisible default profile collapse it to "just me" for the common case. Over *one profile blob shipped to every
device* — leaks high-trust keys onto low-trust gadgets (a light switch would hold your admin key). Over *one stable
address per profile* — cross-circle correlation by any software.

**Consequences:** unblocks feedback cross-device recovery as a consumer of the owner root; full unlinkability also
requires a per-circle **transport/rendezvous** address (a phased follow-on at the relay layer — the key layer alone
is necessary but not sufficient); migration is a pre-launch clean reset (no dual-mode). Builds on existing
primitives (`Bootstrap`, `AgentIdentity`, HKDF, `restoreFromMnemonic`) — no new cryptography.

---

## 2026-07-16 — Publish from the monorepo; the clients-vs-substrate repo split is superseded

**Decision.** The platform ships as versioned `@onderling/*` npm packages published *from this
monorepo*. The earlier plan (2026-06-13) to physically split the repo into thin **clients** vs a
**substrate/functionality** repo is **not pursued**; publishing achieves the same seam without it.

**Why.** A repo boundary is an *organizational* boundary (Conway's law). The feedback split was
justified by a real one — its own product identity and first external tenant — and it happened
(github.com/Onderling/feedback). No such boundary exists between "platform" and "clients": the same
person edits `@onderling/core` and the basis app in one change; a repo split would turn every such
change into a publish-bump-consume loop. The substrate seam is now *more* real than the split
imagined — a stranger can `npm install @onderling/sdk` — enforced by the manifest contract, the
package boundary, and pod ACPs, with the feedback repo as the permanent external canary.

**Reversible by.** Organizational pressure, not architecture: external platform contributors who
should not wade through app code, a second serious tenant needing platform stability at a different
cadence, or governance placing the platform under different rules. The `filter-repo` mechanics are
proven (twice), so a later split stays a cheap afternoon. Standing policy: every package publishes
eventually, in waves, when its API settles. Supersedes the "clients/substrate" carve in the former
`REMAINING-WORK.md` "Architectural spine"; the gated `kring-host` carve follows the same logic.

---

## 2026-07-17 — "Skill" is the invocable capability (A2A-aligned); a person's offering is a property

**Decision.** The word *skill* names the **invocable capability** an agent advertises — matching the
[A2A](https://github.com/google/A2A) `AgentCard.skills` sense the platform already builds on. What a
person *can do* ("I fix leaks") is a **profile property** (an *offering*), disclosure-controlled like
any other. A person's offering becomes an advertised skill only when their **companion agent**
projects it, under that person's disclosure policy. Every advertised skill carries an **execution
mode**: `immediate` (a device/agent acts on invocation — no consent step), `requestable` (the default
for a person — invocation raises a consent/judgment step they can accept, adapt, negotiate, or
refuse), or `standing` (a person who pre-consented via a role, so the judgment step collapses to an
urgent obligation).

**Why.** Two unrelated subsystems currently share the noun "skill": the kernel's
`defineSkill`/`callSkill` capability dispatch, and `MemberMap.skills` / persona skill-drivers (offering
data). Left ambiguous, the code actively misleads. A2A is our discovery anchor, so its usage wins:
skill = invocable. The person/device difference is then not a separate subsystem but a **mode tag** on
one advertised-skill shape — and the offering stays distinct as privacy-controlled data that only
*becomes* a skill through the companion + disclosure gate. This keeps the persona/disclosure model as
the single permission layer over capability, rather than bolting on a second one. Observability
(watchdog, confirmation, sensor) is an **orthogonal** instrumentation choice applied to whichever
actuator is used — not what distinguishes person from device; the honest distinction is
consent+judgment vs automatic execution, and *neither* guarantees the action.

**Consequences / not yet built.** The offering→skill bridge and member-to-member invocation in a
circle are **design-together, deferred** (`plans/NOTE-skills-vs-capabilities.md`). Before that bridge
is built, the naming is paid down: rename so "skill" = the invocable/A2A sense throughout and the
person-profile datum reads as *offering*/property. Compatibility for third-party companions is the
**published contract** (AgentCard + the execution-mode extension + disclosure-gated invocation), not
the Basis UI — Basis ships the default and lets others build the fine-grained (e.g. professional /
emergency) workflows. The skills→property fold-in already shipped (persona layer) is the offering
half; this decision fixes the vocabulary and the bridge's shape for when it lands.

---

## 2026-07-18 — The skill/offering rename is executed; the requestable bridge is live

**Status:** settled and shipped (`packages/agent-registry`, `packages/identity-resolver`,
`packages/offering-match`, `apps/basis`, `apps/stoop`).

**Context:** the 2026-07-17 decision fixed the *vocabulary* (skill = the invocable/A2A capability; a
person's "I can do X" is a disclosure-controlled **offering**, NL *aanbod*) but left the rename and the
offering→skill bridge as paydown / deferred. Both have now landed.

**Decision:** "skill" means the invocable capability throughout the code; the human offering is a
profile property. Concretely: `MemberMap.skills` → `MemberMap.offerings` (transitional `skills`
read-alias); `@onderling/skill-match` → `@onderling/offering-match` (class `OfferingMatch`); the profile
driver kind is `offering`; the fixed offerings taxonomy lives in `agent-registry`
(`OFFERINGS_TAXONOMY`). The offering→skill **bridge** is the `requestOffering` dispatcher on the host
agent: invoking a *requestable* offering does **not** execute it — it mints a `request`-kind task the
owner can accept, adapt, or refuse (the consent/judgment step from the 2026-07-17 execution-mode model).

**Alternatives / why:** over leaving the two "skill" meanings colliding — the code actively misled.
Over building member-to-member direct invocation now — a requestable offering is a *request for a task*,
not a remote function call, so it converges on the existing task substrate rather than standing up a
second invocation path.

**Consequences:** legacy `skills` fields and op ids are read-accepted (the `skills` alias, the
`listSkillCategories` legacy op id) so stored data and third-party callers keep working; the disclosure
axes (below) decide whether an offering is *requestable* at all.

---

## 2026-07-18 — Kernel agent-to-agent invocation renamed `callSkill` → `invokeAgentSkill`

**Status:** settled and shipped (`packages/core`, commit `b8457e56`).

**Context:** two unrelated functions were both named `callSkill`: the kernel's outbound A2A capability
dispatch (`protocol/taskExchange.js`, wrapped by the public `Agent.call()`) and the app-dispatch **thin
waist** every interface compiles to (`web-adapter`'s `callSkill`, injected into `runDispatch`). One
symbol, two concerns — the kernel one even collided with the app-dispatch parameter of the same name.

**Decision:** rename the *kernel* export to `invokeAgentSkill`; the app-dispatch / manifest-waist
`callSkill` keeps its name. So: inter-agent, over-the-wire invocation = `invokeAgentSkill`; the local
`{opId, args}` → dispatcher the architecture calls the "waist" = `callSkill` (unchanged). Public
`Agent.call()` is unchanged.

**Alternatives / why:** over renaming the waist instead — the waist name is load-bearing across these
docs and app dispatch, whereas the kernel export was the newer, narrower, core-internal one (only
`Agent.call` and the index re-export consumed it). Over leaving them ambiguous — a shared symbol across
two subsystems misleads every reader.

**Consequences:** no external consumer changed (no package or app imported the kernel function). The
"which `callSkill`?" ambiguity the glossary and architecture carried is resolved; the enforced
per-inbound permission check on the invoke path remains `PolicyEngine.checkInbound`.

---

## 2026-07-18 — Roles are capability bundles that materialize signed cap-tokens on grant

**Status:** settled and shipped (`packages/core/src/permissions` — `RoleBundle`, `RoleGrantManager`).

**Context:** role names (admin / coordinator / member) gated actions via a per-skill `requiredRole`
check, but a "role" was not a first-class object you could grant and revoke as a unit, and nothing bound
a role to the capability tokens the security gate actually enforces.

**Decision:** a role is a **`RoleBundle`** — a named, frozen bundle of capability grant-templates
(`defineRoleBundle` / `registerRoleBundle`). Assigning a role calls `RoleGrantManager.materializeBundle`,
which **signs each template into a real `CapabilityToken`** scoped to the member and group. Granting a
role therefore produces the same enforced cap-tokens as any other grant; `PolicyEngine` stays the single
enforcement point.

**Alternatives / why:** over keeping `requiredRole` string-matching as the whole story — it couldn't
express "grant this whole role to this member" or revoke it atomically, and left the *display* role
disconnected from the *signed* authority (the drift the 2026-07-09 registry decision warned about, now
closed on the enforcement side too).

**Consequences:** roles compose with the task-scoped grant primitive below (both mint attenuated
cap-tokens through the same substrate); `ADMIN_ROLE_BUNDLE` ships as the built-in.

---

## 2026-07-18 — A property carries three independent disclosure axes: disclosed / matchable / requestable

**Status:** settled and shipped (`packages/agent-registry` — `disclosure.js`, `resource.js`).

**Context:** "what I share" had been a single knob. But three genuinely different questions hang off one
property: may its *value* be shown, may it participate in on-device *matching* without being shown, and
may another agent *invoke or ask* about it.

**Decision:** three independent axes on each property. **disclosed** = `{enabled, rung}` — the only
value-releasing axis (`rung` is the coarsening ladder). **matchable** — may be used in on-device
matching while staying undisclosed (`matchable` can be true while `disclosed` is false). **requestable**
— another's agent may invoke or ask about it (default false; this is the axis the `requestOffering`
bridge reads). The three are preserved **independently** across a registry round-trip.

**Alternatives / why:** over collapsing them into one show/hide flag — that conflates "you may see it",
"you may match on it", and "you may act on it", which users want to set separately (match me without
revealing my location; let a neighbour request my drill without publishing that I own one).

**Consequences:** matching runs on the *matchable* set (`matchProfilesMatchable`) and never requires
disclosure; the *requestable* axis gates whether `requestOffering` will mint a task; the persistence
allowlist was widened so `matchable` / `requestable` stop being silently dropped on save.

---

## 2026-07-18 — Task-scoped delegation: code term "mandate", UI term "entrust" (NL *toevertrouwen*)

**Status:** settled and shipped (`packages/core/src/permissions/TaskGrant.js` + the basis mandate UI).

**Context:** to hand someone authority to act on *one specific task* — act as you, or use one of your
offerings — without granting a standing capability, the delegation must be attenuated, task-scoped, and
auto-revoked when the task closes.

**Decision:** the primitive is **`TaskGrantManager`**. `attachGrant` issues **one** cap-token
equal-or-narrower than the granter's, stamped `constraints.task = taskId`, **off by default**;
`revokeTaskGrants(taskId)` revokes every token minted for the task and is called on complete/cancel. The
user-facing concept is **entrust** (NL *toevertrouwen*); the code / domain term is **mandate**. The
picker's "what for" is an extensible **grant-kind taxonomy** (act-as, an offering, and a not-yet-active
resource kind), and the grant is routed through the same confirm/consent gate as any sensitive action.

**Alternatives / why:** over a standing role grant — too broad, and it doesn't self-expire. Over a
bespoke per-feature permission — this reuses the one cap-token / `PolicyEngine` substrate, so the
delegation is enforced and revocable like everything else.

**Consequences:** the grant / legibility logic lives once (the shared basis mandate module) with web and
mobile pickers as thin projectors; the kring Taken tab exposes *entrust* per task to the task owner.

---

## 2026-07-18 — The help assistant's wording is conditional on the resolved LLM route

**Status:** settled and shipped (`apps/basis` — `helpChat.js`, `userLlmRuntime.js`).

**Context:** the standing help bot answers first from a deterministic in-app card deck; on a miss it can,
**with consent**, forward the question to an LLM. Whether that LLM is *confidential* depends on the
resolved route (a confidential enclave proxy vs a plain provider).

**Decision:** the assistant never claims confidentiality it does not have. The consent card and
provenance wording are chosen by the route's **actual** confidentiality — a confidential preset in effect
picks the "via de vertrouwelijke assistent" copy; otherwise the plain wording, with **no** confidential
claim. The LLM forward is consent-gated per question.

**Alternatives / why:** over a fixed "confidential assistant" label — it would lie whenever the
confidential route is not the one actually in effect. Honesty about the route is a privacy property, not
cosmetic copy.

**Consequences:** the label keys are route-derived (`helpLlmLabelKeys`), so a deployment not wired to a
confidential proxy automatically shows honest wording rather than an aspirational claim.

---

## 2026-07-19 — The bot is addressed directly only in a 1:1; in a group it must be tagged

**Status:** settled and shipped (`apps/basis` — `botAddress.js`, `botChat.js`).

**Context:** the Onderling bot is a **real peer member** of a circle (e.g. the help circle "Uitleg"). In
a 1:1 with the bot every line is for it; in a circle with other people, treating every message as
bot-directed would make the bot talk over the humans.

**Decision:** the **tag-to-address** gate. In a genuine 1:1-with-a-bot (you + exactly one agent member)
the bot always answers. In a circle with two or more members it answers **only** when the line names or
@-tags it; otherwise it stays silent. The same rule drives the 1:1 assistant-header strip — shown only
in a real 1:1-bot chat.

**Alternatives / why:** over always-on in every circle — the bot would spam group chat. Over never-auto
in a 1:1 — you would have to tag a bot you are plainly talking to alone.

**Consequences:** one shared gate (`botIsAddressed` / `oneToOneBotLabel`) is used by both web and mobile,
so the addressing behaviour and the header cannot drift between platforms.

---

## 2026-07-25 — Circle consistency & governance: one log, four layers, decision-classes

**Status:** settled (design of record); building (Wave C — L4 first, then L3). Substrate: the one-stream
`EventLog`, the per-circle signing key, key-rotation-on-membership-change (Phases 1–3) already exist.

**Context:** a circle's shared state is a signed log with **no central arbiter**. It must stay consistent
under network partitions and misbehaving members, and a circle must be able to *govern itself* — remove a
member, rotate a key, change a rule — without a server to adjudicate and without deadlocking.

**Decision.** State lives in **one log stream**; consistency is four layers (weakest concern → strongest):
- **L1 concurrent edits** — deterministic merge (full content-merge deferred to folio versioning).
- **L2 forgery** — every event signed by the author's per-circle key + proof-of-membership. (Already true.)
- **L3 equivocation** — a **per-author hash-chain**: each governance-spine event carries a `parentHash`; two
  events sharing a parent are a self-verifying **fork-proof**, folded → author **disputed** → resolved by L4.
  **Scope: only the governance / membership / key event types are chained** — chat stays on the mergeable L1
  path (forking chat is normal, not an attack), so the machinery sits exactly where equivocation does harm.
- **L4 governance** — a per-action **decision-class** map in the circle policy: `governance = { removeMember,
  rotateKey, changeRule, changePolicy }`, each `any-admin | admin-quorum | member-vote`. So "an admin removed
  someone" and "the circle voted someone out" are the **same action** with a different *who-decides* knob —
  not two features. A `member-vote` tallies signed `governance` events over the **full proof-derived
  membership** (not the reachable subset) so a partition can't unilaterally decide; an unreachable threshold
  **pends** (safety over liveness), with an **admin-override valve** once the vote passes its deadline.
- **Last-admin** — if the last admin departs (self-removal or vote-out), a **deterministic caretaker** is
  appointed immediately (not a fresh vote — that needs quorum and leaves an adminless gap). The successor is
  computed identically by every replica from the log (member whose per-circle address hashes closest to the
  departing admin's final event hash; next-in-line if that member is unreachable/declines), so the appointment
  can never itself fork. It is a **caretaker** — a member-vote circle can reassign admin afterward.

**Alternatives / why.** Central-server arbitration — rejected (the whole point is no central trust).
Hash-chaining *all* events including chat — rejected: cost with no security gain, and it complicates the
mergeable chat path; equivocation only harms decisions, so chain the decisions, not the conversation.
Reachable-subset thresholds — rejected: a partition could then railroad a decision. Pure pend with no valve —
rejected: a sparse circle would deadlock on governance; the deadline + admin-override trades a small trust
cost for liveness. Truly-random caretaker — rejected: independent local dice diverge, so the *fix* would be a
new fork; deterministic-agreed is the only partition-safe pick.

**Consequences.** The **guiding invariant**: anything that must be *agreed* — the tally, the caretaker, the
fork verdict — is computed identically everywhere from the log, never decided locally. The decision-class map
is admin-set per circle and defaults to `removeMember/rotateKey → any-admin`, `changeRule/changePolicy →
admin-quorum`, member-vote opt-in. Reporting (a member↔admin lane → ban) is a governance action, so it rides
L4. This layer is invisible to `deliver`/the `Peer`/the event shapes — it's how the fold resolves, plus a
`parentHash` field on the governance-spine events.

---

## 2026-07-26 — Three decisions from the three-device adversarial stories

**Status:** settled + built (`58a085fc`). Each closed off a live alternative, so each is recorded rather than
left in a commit message. All three surfaced the same way: a multi-actor story exposing a promise that was
never kept, invisible to 4000+ single-actor tests.

### 1. A governed decision has a DEADLINE by default — `circlePolicy.decisionDeadlineDays`, default 7

**Context.** The L4 design (above) specifies an "admin-override valve once the vote passes its deadline" as
the answer to a sparse circle deadlocking. It was built and role-gated correctly — and was unreachable: no
shell ever passed a `deadline` to `propose()`, so `expired` was never true, `canOverride` never true, and a
proposal short of quorum stayed open **forever**. The valve existed and could never open.

**Decision.** The default lives in the circle policy and is applied in `makeGovernanceOrchestrator.propose`.
**Amended same day:** it is an ENUM axis `decisionDeadline` ∈ `1d|3d|7d|14d|30d|open-ended` (default **7d**),
resolved to days by `decisionDeadlineDays(policy)` — not a raw number. The reason is reachability: a bare
number needs a bespoke control, so it would have stayed admin-INVISIBLE, which is the same failure as the
unreachable valve this decision exists to fix. The enum drops into the shared settings radio/consequence
renderer, so an admin can actually change it. `open-ended` disables the hatch.

**Alternatives / why.** A hardcoded constant in the orchestrator — rejected: circles differ (a household
decides in a day, a neighbourhood association in a month), and this is exactly the kind of knob an admin
should own. Per-action deadlines — rejected for now: no evidence anyone wants `removeMember` and `changeRule`
to expire differently, and the axis can be widened later without a migration. **Passing it from the shells —
rejected outright: that is how it broke.** Three call sites each had to remember; none did. Deriving it in
the model keeps web ≡ mobile by construction (invariant 1/2) rather than by vigilance.

**Consequences.** Every member-vote/admin-quorum proposal now carries a deadline unless a circle opts out, so
the override valve is live for the first time. Existing open proposals (deadline `null`) stay open-ended —
the default applies at propose time, not retroactively. The enum trades expressiveness (a circle cannot ask
for exactly 5 days) for a surface an admin can reach; **the DEFAULT VALUE itself is still Frits' call** —
tracked as REMAINING-WORK P4 item 12a.

### 2. A report is fanned to the admins UNION the reporter — never to the person reported

**Context.** §8 reporting fanned each report event to **every** circle member, and every device ingested it.
The person being reported therefore held the reporter's identity and the free-text reason about themselves;
the only thing between them and it was an `if (isAdmin)` in each shell. That is presentation, not access
control — the same class as the members-list name leak and the profile-picture leak.

**Decision.** Two layers. **Routing:** `appendReportEvent` fans only to the circle's admins ∪ the reporter
(`opts.to` → `broadcastKringReport`'s `to` → `only` in the fan-out helpers). **Access:** `reports.list` is
viewer-scoped — admin sees all, anyone else only what they filed — and returns `scope: 'all' | 'own'`.

**Alternatives / why.** Fan to admins ALONE — rejected once it broke a real property: the reporter never
receives the `actioned`/`dismissed` event, so their own report sits open on their device forever. Sealing
reports to the admin set instead of narrowing the fan — rejected as heavier for the same result, and it does
not survive the admin set changing (a key sealed to yesterday's admins is the wrong shape for a mutable
role). Filtering only in `list` — rejected: the payload would still be on the reported person's disk, which
is the actual leak. Filtering only in the fan — rejected: a demoted admin or a replayed log still holds it,
so the read path must refuse independently.

**Consequences.** The shells' `isAdmin` check is now redundant rather than load-bearing. `act`/`dismiss` read
an unfiltered `listAll` so an admin can still act on what they can see. A circle with **no** admins fans a
report to the reporter only — the safe end, not a broadcast.

### 3. A share REFUSES when the circle's posture promised sealing and the pod is gone

**Context.** `buildCircleShareEnforcement` returns `null` without a podRoot — which is what a device looks
like after the person signs out mid-flow. The share then fell through to a plain `shared-ref` write and
returned `{ok:true}`, byte-identical to a sealed, granted share: no ACP grant, no key wrap, and the person
sharing was told it worked. A mid-flow sign-out was indistinguishable from never having had a pod.

**Decision.** Both cross-circle share ops refuse with `{ok:false, error:'seal-unavailable', posture}` when the
source circle's `storagePosture` is p2/p3 (the postures that promise client-side sealing) and the enforcement
is absent.

**Alternatives / why.** Refuse whenever enforcement is absent — rejected: it would break the deliberate
no-pod/in-memory mode, which is a supported configuration and the DEFAULT (p0). Return a `degraded: true`
flag and write anyway — rejected: the content would still be sitting in plaintext under a policy that
promised otherwise; a flag the shells might not render is not consent. Gate on whether a pod was *ever*
configured — rejected: that describes the device, and the promise belongs to the **circle**.

**Consequences.** The refusal is scoped to circles that made the promise, so p0/p1 are untouched (guarded by
a control test against over-reach). `storagePosture` becomes load-bearing at share time, not only at rest.
