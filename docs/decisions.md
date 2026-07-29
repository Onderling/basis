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

## 2026-07-14 — Agent property vocabulary: open JSON-LD (schema.org / FOAF / vCard / OIDC claims + W3C WoT), thin onderling policy namespace

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
- **Onderling's own thin namespace** (`cdi:` — onderling disclosure) carries only the *policy* layer no standard
  specifies: the disclosure **ladder** (coarsening rungs), **persona**, **disclosure level**.

Anything **not pre-declared** is reachable only through a consent-gated query path (deferred; the highest-risk
surface).

**Alternatives / why:** over a **bespoke onderling vocabulary** — kills interop (another app/bot/agent can't
understand our terms). Over **W3C Verifiable Credentials + DIDs as the base** — heavy, and verification /
attestation is deliberately out of scope (properties are self-asserted; VC selective-disclosure is a clean
*later* add-on at the predicate rung if a real verification need appears). Standard self-describing terms for the
*what*; a thin onderling namespace for the *policy*.

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

---

## 2026-07-27 — What per-circle addressing actually promises

**Status:** settled (design of record); not built. Relates to `PLAN-peer-connectivity.md` G12/G13.

**Context.** A member presents a different address in every circle, derived from a secret profile seed
(`deriveCircleSeed` → HKDF). The intent is that two circles cannot correlate the same person. Today those
addresses are derived, proven at join and stored on the roster — but **never used for routing**; every send
resolves to the member's global signing key, so a relay sees one identity across all their circles.

Fixing that requires the relay to accept several addresses for one device, and **every shape of that leaks
to the relay**. One socket carrying N addresses correlates them outright. N separate sockets do not — but a
device has exactly **one push token**, and the wake path must map *address → token*, so registering N
addresses writes N rows carrying the same token. A push token cannot be fragmented: the OS issues one per
device.

**Decision.** The promise is:

> **Your circles are unlinkable to everyone except the one relay you chose — and you can choose yourself.**

Concretely: unlinkable to other members, to anyone observing the wire, and to every relay you did not use.
The relay you do use can correlate your circle addresses and **can read nothing**.

Because the relay correlates anyway, the cheap implementation is also the right one: **one socket carrying
several registered addresses**, not N connections.

**Alternatives considered.**
- *Per-circle opt-out of push* (no token ⇒ nothing to correlate) and *polling instead of push* — both trade
  wake for unlinkability, per circle, and both fit the existing per-circle policy pattern. **Parked**, not
  rejected: they add real complexity for a property the next option delivers outright.
- *Running your own relay / companion node* — **this is the real answer.** If the relay is yours, "the relay
  correlates" stops mattering, and the promise above becomes unconditional. It is already a planned
  direction (`NOTE-companion-node.md`), so the honest framing is that per-circle addressing is
  meaningfully private today and *fully* private once you host your own connection point.
- *Doing nothing* — rejected: the current state is worse than either, because the design implies a property
  the system does not have.

**Consequences.** Product copy must not claim unlinkability against the relay; it may claim it against
members, the wire and other relays, and it may point at self-hosting for the rest. The per-circle address
becomes load-bearing at the transport, so hold-forward, the push-token registry and the ForwardQueue all
multiply per (member × circle). Migration is dual-addressing with a webid fallback, dropped last — the
fallback is not only a safety net: members who joined before the address-proof work have no per-circle
address at all.

## NKN is the contact-to-contact transport; circles ride relays or pods (2026-07-28)

An NKN client *is* an address — per-circle addressing over NKN would mean one client per circle, with each
client's websocket set and fan-out, running on a phone. Rather than measure that cost, the decision is that
it is the wrong shape: **NKN reaches a person; a circle is reached through a relay or through its pod.**
The pod case is the built exception for relay-less circles: NKN carries the join handshake to the admin,
and the pod is the circle's connection point thereafter.

Cost, accepted: a peer whose only transport is NKN is reachable as a contact, not per-circle.
Consequences: `NknTransport.supportsAliases` stays `false` as a design fact, not a pending item; per-circle
addressing (G13) is a relay concern only.

## Relay diversity is an unlinkability strategy; registration must not defeat it (2026-07-28, Frits)

The G12/G13 promise conceded that *the relay you chose* can correlate your circles. Frits' sharpening:
that concession is **per relay** — someone whose circles ride different relays is unlinkable to every one
of them, because no single relay sees two of their addresses.

The design rule that follows: **a per-circle address is registered ONLY on relays that circle rides.**
Registering all addresses on every socket would hand each relay a linkage it could never observe on its
own — quietly converting a per-relay concession into a global one. The connection-points store
(`circlesFor(url)`) is the scoping source; a circle with no recorded point rides the deployment default
and registers there alone.


## An agent is owned by a KEY, and a circle's authority over it is scoped (2026-07-28, Frits)

Frits' proposal: *ownership is a secret key on the agent, given to it in order to control it — maybe
rotate it at handover. Or is joining a circle enough for the agent to follow instructions?*

Both, as two tiers — with one refinement that removes the leak surface: make it **asymmetric**. If the
agent held a shared secret, the agent would be the weakest link (anyone who reads its storage owns it),
and the secret cannot be shown to it without also being leakable by it. So:

1. **Owner = whoever signs with the agent's OWNER key.** The agent stores only the owner's PUBLIC key,
   stamped at provisioning; agent-wide control ops must arrive signed by it. "Giving the key to the
   agent" becomes "stamping a pubkey" — nothing on the agent to leak. This is what answers *who owns an
   agent that sits in no circle*: the key does, with no circle involved.
2. **Handover = rotation**: the old key signs a replace-owner instruction carrying the new pubkey, so
   the previous owner provably loses control.
3. **A circle gets SCOPED authority only** — its admins govern what the agent exposes *in that circle*,
   never agent-wide. Membership-as-full-control would let circle B's admins reach into circle A: the
   cross-circle authority leak the identity design exists to prevent.

Details: a per-agent owner keypair (not the reused identity key), so owning an agent does not advertise
the owner's global identity to every circle it joins; lost-key recovery is re-stamping with physical
access to where the agent runs (possession is root, as with any device). The registry's existing
`ownerFingerprint` is tier 1 — no new identity concept was needed. The agent trail's `via: 'owner'` now
has a definition: signed by the owner key.

## If another app version can get it anyway, it is not enforcement (2026-07-28, Frits)

*"Could someone with a different app version get what they want anyway? If so, we shouldn't act as if we
have power to enforce it."*

A UI that promises what a modified client can ignore produces false confidence, which is worse than an
honest "this is a convention". The rule is therefore: name client-side controls as conventions or
filters, and put the real gate where it holds regardless of the other side's client — the seal, the key,
the roster, the relay.

First consequences, both built:
- **Per-skill exposure is a discovery FILTER, not access control.** Hiding a skill removes it from the
  cards and catalogs others read and stops nothing; someone who knows the skill id can still dispatch.
  What refuses an unauthorised call is the grant/token check. Hiding therefore also does **not** revoke:
  a hidden skill keeps its grant on the card, because telling someone they had revoked something they
  had not would be the same lie in the other direction.
- **C13's fast rung stays unilateral.** Adding a contact is a note in my own address book; *reachability*
  is the other side's to govern, because that is enforceable on their device.

## A conversation is a projection the reader narrows — chat included (2026-07-28, Frits)

The long-open product call ("does a conversation mean only `chat-message`, or chat + tasks + questions?")
is answered by neither option: *"everything should be filterable, even chat itself — in case you have an
automated agents chat and you are not interested in their interactions."*

So the conversation is not a fixed set of kinds decided once; it is a **projection the reader narrows**,
and `chat-message` is itself one of the filterable kinds.

His example forces a second axis. "Agent chatter I don't want to read" cannot be expressed as a kind
filter — those rows are the same kind and differ only by **who wrote them**. Hence:
- **kinds** — what the row is (chat / tasks / questions / offers …);
- **authors** — people vs agents (and the inverse, for auditing what the agents said).

The circle's own `conversationKinds` remains the **ceiling**: a reader narrows within it, never past it,
so "what this circle is" stays an admin question while "what I want to read" stays the reader's. The
filter is device-local and never fanned — a filter that told the circle what you skip would be a new
disclosure. Two guarantees keep it from eating the conversation: the last remaining kind cannot be
switched off, and an actor that cannot be resolved counts as a person (a roster hiccup must never make
people disappear).

## Retention exposes ONE control, because the other two would be dishonest (2026-07-28)

Retention is per-kind underneath (`short` plumbing · `chat` · `audit`). The **setting** offers only the
chat window (7/14/30/90 days, default 14).

Why not three controls: plumbing retention is an implementation detail nobody should have to reason
about, and an "audit window" control would **promise a deletion it does not perform** — audit entries
(governance, reports, the agent trail) compact into a counted summary rather than disappearing, because
a trail that quietly forgets looks complete. One number therefore governs all three honestly: chat takes
the choice, plumbing follows it (never longer than the conversation it describes), and audit uses it as
the *detail* window. The user-facing note says exactly that, since "older messages are removed" alone
would be untrue about decisions and reports.

## Naming: no "canopy" identifiers anywhere; backwards compatibility is not required pre-launch (2026-07-28, Frits)

Product and platform naming in code, comments, labels, schemes, storage keys, namespaces and
key-derivation inputs is **onderling**. Nothing is live — no external users, no data worth migrating —
so the rename landed as a **clean break**: no dual-write windows, no legacy read-fallbacks, no
deprecated aliases, since those are dead weight that reads as caution while hiding which path is real.

This included inputs that would otherwise be frozen forever (HKDF/PRF salts, export info strings): they
are hashed and never displayed, but renaming them re-derives every per-circle address and orphans
sealed data. Accepted, because pre-launch is exactly when that is cheap.

**The no-backwards-compatibility licence is dated: it expires 2026-07-31**, after which breaking a
persisted or wire format needs an explicit decision again. A standing "compat doesn't matter" would
quietly outlive the condition that made it true.

## The push-token concession: its escape is the companion, and the UI owes the user the trade (2026-07-29)

Per-circle addressing registers several addresses on one socket, so a relay has no addressing reason to
think they are one person. Push notifications reintroduce exactly that: a device gets **one** push token
from the OS, and waking it for any of those addresses means registering the same token under each
(`PushTokenRegistry` is keyed by address; the relay writes one row per address the socket owns). Group by
token and the circles fall out as one device — one person.

You cannot fragment a push token, so this is not an implementation gap to close later:

> **G13 cannot deliver unlinkability against a relay you are connected to, while push notifications are
> enabled on that device.**

**The escape is the companion node, not a cleverer protocol.** The concession is *"the relay you chose can
correlate your circles"* — so the answer is that the relay is **yours**: a user-hostable node
(`plans/NOTE-companion-node.md`) makes the one party who can correlate the same party who already knows
everything. That is a hosting decision, not a cryptographic one, and it is why self-hosting sits in the
promise as the real answer rather than as a footnote. Relay diversity (2026-07-28) is the weaker version
available to someone who does not self-host: split circles across relays and no single one sees two.

**What the UI owes the user.** Because the trade is *made by turning notifications on*, it has to be
visible where that choice is made — on mobile, where push actually exists:

- enabling notifications is the moment the relay gains the ability to link that device's circles, and the
  surface must say so, in the same breath as the benefit, the way the address-fallback offer states its
  cost;
- it must not be buried in a privacy page the user reaches later, and it must not be framed as a warning
  that discourages a normal choice — most people should probably turn notifications on;
- it must say what is NOT learned (no content, no circle names, no roster), because a bare "this affects
  your privacy" invites people to imagine something worse than the truth;
- and it should name the escape rather than leaving a dead end: a relay you host yourself, or circles
  spread across relays.

A privacy property the user cannot see themselves trading away is not a property they can act on.

---

## 2026-07-29 — four calls the evaluation walks forced

The S2/S3/S4 walks each ended at a question that code could not answer, because either answer was
defensible. All four were put to Frits together and settled in one sitting; each closed off alternatives,
which is why they are here rather than in a commit message.

### 1 · The delivery ladder admits doubt, and never claims arrival

**Only `maybe-received` gets wired. A positive transport ack is never reported to the UI.**

The ladder declares seven states; the send path produced five, and the two missing ones were exactly the
two that carry uncertainty. So the app said *"sent"* both for "their phone took it" and for "we never
heard anything back" — the over-claim the vocabulary exists to prevent (S2/J-D2).

Wiring the acks naively would have broken a second promise. A device acknowledges a message whatever its
owner's receipt setting says, so a peer with receipts **off** would settle at `reached-device` while an
offline peer stayed at `sent`. No string would announce the setting; the *shape of the ladder* would
(S2/J-D5). The two journeys pull against each other and cannot both be satisfied by adding rungs.

The call keeps the privacy property and fixes the honesty one: report the **downgrade** (we asked, heard
nothing, sent anyway) and never the confirmation. `reached-device` stays in the vocabulary as a state
nothing produces — listed as a dated gap in the producer guard, so it cannot be mistaken for an oversight.

What it costs: a sender never learns from the ladder that a message actually arrived. `stored` still
exists, and still arrives — but only from a peer who chose to send receipts. That is the honest position:
the only positive evidence we have is evidence somebody chose to give us.

### 2 · Reachability-on-this-circle is answered ABOVE the send path

An NKN-only member of a relay circle dropped out silently: a relay reports it can reach anyone, so the
send was attempted there, failed, and landed in a generic offline hold (S4/J-CS7).

**The fan-out answers it, not routing.** The fan-out already holds the roster, so it marks a recipient
unreachable-on-this-circle and never calls `sendTo` for them. Routing stays circle-blind and keeps its one
job — pick the best transport for a person — which is what the circle-scope design was written to protect.

The cost is accepted knowingly: two places now decide reachability, and they must not drift. The
alternative (passing a member→transport map down with the scope) would have put roster knowledge inside
routing, which is the coupling the scope exists to avoid.

### 3 · The conversation-kinds list is the truth; `features.chat` derives from it

`features.chat` and `conversationKinds` were two vocabularies for one fact — the wizard wrote the first,
the conversation read the second, and neither reached storage (S3/J-CW2, J-CW3).

**`conversationKinds` is authoritative.** Whether a circle has chat is whether `chat-message` is in its
list; `features.chat` becomes a derived view, not a second source. One list, one place, and the
duplicate-vocabulary trap that `shared-vocabularies.md` exists to prevent is closed rather than
documented.

This changes what "turn chat off" means in the wizard: it removes a kind from the conversation rather than
flipping a feature. That is the more accurate description of what actually happens to the conversation.

### 4 · A template switch re-fills what the user never touched

Picking `buurt` and then switching to `vriendenkring` moved nothing but the label — ten axes kept the
first template's values, because the merge rule could not tell "the user chose this" from "the first
template chose this" (S3/J-CW1).

**Track provenance.** Remember which axes the user actually touched; a kind switch re-fills the rest from
the new template. This makes the wizard's own promise true — a template is a starting point, not a track —
and it makes picking the wrong kind first recoverable.

A switch now visibly moves things, which is the point, and should be said out loud in the UI rather than
happening quietly.
