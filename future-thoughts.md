# future-thoughts.md — where extra functionality lives

**Status: exploratory.** Not a build commitment. This is the bigger-picture *why* behind the actionable spine in
`REMAINING-WORK.md` ("★ Architectural spine" → plugin spectrum · placement spectrum · workstreams W0–W6). When
any of this turns concrete, it lands there as a workstream; this file is where the shape is thought through first.

---

## The question

*Where does the extra functionality live?* Once apps dissolve into building-blocks (`{opId,args}` + a manifest),
"installing an app" can mean very different things — code on your phone, code on a server, code at a circle admin,
or no new code at all (just a recomposition of primitives). This doc unifies those into **one** model.

## The one-sentence answer

> **Functionality is a *composition of capabilities*, executed *wherever the capability is granted*; the *kring*
> is the scope and safety boundary for the grants; and your "personal server" is just the degenerate kring of
> one where you are your own admin.**

Nothing new is added to the waist. `{opId,args} → callSkill` already routes to wherever the handler is; an agent
is already just a user ([[feedback-agent-is-just-a-user]]); the manifest is already the contract. This idea only
adds a **capability layer** that says *who may invoke which atom, in which kring*, and a placement choice for
*where* each atom runs.

---

## Three building blocks

1. **Atomic capabilities — the platform's "instruction set."** The primitives every node exposes and a user
   actually trusts at the bottom: *create-task · send-message · start-stream · negotiate (a2a) · connect (mDNS /
   BT) · authenticate · pod read/write · schedule-job · call-LLM.* These are the lowest waist ops, device-
   independent, defined once. **They already exist in the core SDK** (`packages/core/src/protocol/` —
   `messaging`, `streaming`, `taskExchange`/`Task`, `pubSub`, `fileSharing`, `session`; `a2a/` — agent-to-agent
   negotiation; `skills/` — `defineSkill`/`SkillRegistry`/`capabilities`, the op-registration mechanism). The atom
   set is **discovered, not invented** — see "the atom set already exists" below.
2. **App ops = compositions.** A manifest op (`feedback.submit`, `household.addItem`) is a composition that
   ultimately bottoms out in atomic capabilities (write a pod doc, send a message, start a stream…). The manifest
   declares the composite; the substrate provides the atoms.
3. **Grants — the hierarchical capabilities landscape.** A grant is a scoped, revocable, attenuable token
   (object-capability style) that says *"this installed app may invoke these atoms, on my behalf, in this kring."*
   It's **hierarchical** because ops decompose into a tree of atoms: a grant attached high in the tree implies its
   subtree; a member can instead grant only individual leaves. The kring is the scope every grant is pinned to.

**Invariant — an atom lives in a substrate/core, never in an app (Frits, 2026-06-13).** If an app needs an
irreducible op that doesn't exist yet, that op **graduates into a substrate** and the app merely composes it.
Apps are compositions; they are not homes for primitives. (This is just CLAUDE.md invariants #1 "logic lives once"
and #5 "three-layer dependency" applied to atoms — and it's what keeps the atom set shared and the apps thin.)

This is the formalisation of the long-standing intuition that **the kring is the capability/safety boundary that
"almost encompasses" the other apps** — not just a chat scope, but the container that decides what an installed
capability may touch.

---

## Designing the atom set + compositions (the part that needs more thought)

Two design choices carry this whole idea, and both have well-trodden prior art.

**Correction (Frits, 2026-06-13): you already have the atoms — don't invent a new ISA.** The core SDK already
ships tasks, streams, messages, negotiation (a2a), pub/sub, file-sharing and sessions as atomic primitives
(`packages/core/src/{protocol,a2a,skills}`). They **stay part of canopy-chat**; *forms* is the main gap to add.
So the atom set is **discovered, not designed** — and the real work is **strict mapping**: a slash-command refers
to *(a set of)* opIDs, and every opID must **always** bottom out in these basal SDK primitives. That's *mostly*
true today but not *enforced* — making it strict is precisely what unlocks safe **external / downloadable
slash-commands**, because a composition can then only reference opIDs that bottom out in granted atoms.
**Consequence (kijken hoe dit kan):** the current app ops (feedback, household, …) must be realigned to *compose
over the atoms* rather than carry bespoke logic — an audit + refactor, tied to W3 (carve app-bundles).

**Treat that SDK atom set as an instruction set (ISA).** The properties to hold it to (and that the strict
mapping must preserve):
- **Small + stable.** Like a VM's opcode set or eBPF's fixed helper functions — you rarely *add* atoms, you
  *compose* them. Churn at this layer breaks every downloaded composition, so the bar to add an atom is high.
- **Independently grantable.** Each atom is a capability you can grant / deny / attenuate on its own
  (`send-message` ≠ `read-pod`). Atom granularity *is* the safety dial.
- **Composable + device-independent.** Atoms chain / branch / map, and run on *any* node (phone, admin, server)
  because they're substrate ops, not platform code.
- **Closed.** A composition may reference **only** declared atoms. Nothing else is reachable.

**Compositions are data — and that's what makes them both safe and store-proof.** An app op is a declared
composition (sequence / branch / bind-args over atom calls) shipped as *data* — the manifest. The key property:
**a pure-data composition is sandboxed by construction.** It can't do anything except invoke atoms, and every
atom is capability-gated — so you never trust the *composition's author*, only the *atoms* you granted.
Downloading a composition is downloading a *recipe*, not a program with ambient authority. (This is exactly the
**eBPF** move: untrusted bytecode is safe not because you trust who wrote it, but because it's verified against a
fixed, gated helper set. Same with smart-contract opcodes and a CPU ISA.)

### Functioning examples — this pattern is well-trodden
- **Tasker + TaskerNet** *(Android, on Play)* — atomic *Actions* (send SMS, HTTP, toggles…) + downloadable
  *Tasks/Profiles* shared as data. The closest living match to "atom ISA + downloadable compositions" *on Play*.
- **Apple Shortcuts** — atomic *Actions* + shareable *Shortcuts* (iCloud links = data). Blessed by Apple itself —
  the strongest "this shape is allowed" precedent.
- **Discord / Slack / Telegram bots** — a bot joins a server/channel (= a *kring*) as a participant and shares
  slash-commands; logic runs on a third-party server, the app just dispatches + renders. This is our
  **kring-admin-app + remote-handler tier, already shipping on Play.**
- **Home Assistant** — *Blueprints* = shareable automation compositions (YAML = data, installed in-app); *HACS* =
  custom components (code) installed **outside** the store app. The exact data-in-store / code-off-store split we want.
- **Node-RED** — *flows* = compositions over nodes, shared as JSON (data); nodes (code) via npm.
- **MCP (Model Context Protocol)** — servers expose *tools* (atoms); a client/agent composes them over a
  transport. The current *industry-standard* form of "atomic capabilities + remote dispatch" — already in our vocabulary.
- **Scriptable / Pythonista** *(iOS, on the App Store)* — run user logic in a sandboxed interpreter — proof the
  interpreter exception ships even on stricter Apple (the tier-3 precedent).
- **Browser-extension permission model** — manifest + per-permission grants = the precedent for our grant UX
  (declare needed capabilities; the user grants a subset; revocable).

The lesson from all of them: **the safe, shippable mass is "compositions as data over a built-in atom set";
code-carrying is the exception, handled by a remote node or an off-store channel.**

---

## kring-admin-apps (Frits, 2026-06-13)

> *Voor elke functionaliteitenbundel kun je als admin een app installeren, daarmee inloggen op de kring en van
> daaruit functionaliteit met de gebruikers delen (slash-commands + manifests). Operaties worden uitgevoerd ofwel
> bij de admin zelf, óf op basis van atomaire functionaliteiten van de gebruiker. Voor je privé-apps ben je zelf
> kringadmin.*

Restated in the model:

- **Install = a bundle joins the kring as an agent.** The admin installs a functionality bundle; it logs into the
  kring like any participant ([[feedback-agent-is-just-a-user]]) and *shares* its ops with members through the
  normal surfaces — slash-commands + the manifest projectors. No privileged path; it's a peer that happens to
  carry capabilities.
- **Two execution loci** (the heart of the idea):
  - **At the admin's node** — the kring's own "personal server." Right for central/heavy compute or
    cross-member aggregation. The admin (or an enclave, for blindness) is the trust anchor.
  - **On the members' atomic capabilities** — the op decomposes into atoms each member's node runs locally
    (create *my* task, send *my* message, start *my* stream). Distributed, local-first, no central compute.
  The op is the same; *placement is per-atom*, decided by trust + latency.
- **Private apps ⇒ you are your own admin.** A solo capability is just a **kring of one**. This is exactly the
  **personal-server topology (W6)**: your agent runs your bundles, you grant yourself the atoms. So the
  personal-server idea isn't a separate feature — it's **N = 1** of kring-admin-apps.

### The unification (why the two ideas are one)

| Case | Kring | Admin | Where ops run | Local-first stance |
|---|---|---|---|---|
| Fully local solo | 1 (you) | you | your device | maximal |
| Personal server (W6) | 1 (you) | you | your server (n=1 admin node) | user-controlled |
| Shared kring, distributed | N | someone | each member's atoms | maximal, peer-to-peer |
| Shared kring, central | N | someone | admin's node | trust the admin (or enclave) |
| Either, provider-blind | any | any | attested enclave | provider can't see plaintext |

One mechanism — **capabilities granted within a kring, atoms placed by trust + latency** — covers the whole table.
"Personal server" and "kring-admin app" are the same construct read at N = 1 and N > 1. That's the reconciliation.

---

## What about the Google Play Store? (and Apple)

The honest read — what to *design for*, not legal advice; tier-3 and any paid path deserve a real policy review.

**The policy that matters most:** Google Play's *Device & Network Abuse* rule — an app **may not download and
execute code** (dex / JAR / .so) from outside Play, **with an explicit exception for code run in an interpreter or
VM that doesn't grant indirect access to Android APIs** (the "JavaScript-in-a-webview" carve-out). Termux is the
cautionary tale of brushing against this. Mapping our plugin spectrum onto it:

- **Tier 1 — pure-manifest apps: clearly fine.** Manifests and `{opId,args}` are *data*, not executable code. A
  recomposition of existing substrate ops downloads no code at all. This is the safe, shippable default.
- **Tier 2 — remote-handler apps: fine.** The handler runs on *someone else's* node (admin / personal server /
  the bundle's own agent); the phone only sends `{opId,args}` over the transport and renders the result. No code
  is downloaded to the device. This is just networking.
- **Tier 3 — sandboxed-local-code (WASM): borderline-but-defensible, and the reason it's a FUTURE IDEA.** WASM in
  a capability-sandboxed interpreter that reaches **only** granted ops + pod paths and **never** Android APIs is
  the direct analogue of the permitted webview-JS exception. Defensible — but it's exactly the case to get policy
  sign-off on, keep strictly sandboxed, and not ship lightly.

**Other store realities to plan for:**
- **Payments.** If bundles are *sold*, Google generally requires Play Billing for digital goods (with the
  landscape shifting post-Epic/DMA toward allowing external payment links). Free / self-hosted / third-party
  bundles sidestep this. Decide the monetisation model before the install UI.
- **Permissions + Data Safety.** mDNS/BT/local-network and a foreground "personal server" need the right runtime
  permissions (Bluetooth, Android's Local Network permission) and an honest Data Safety disclosure. Here our
  model is a *strength*: user-controlled servers + E2E + "not shared with third parties" is a clean story.
- **"Store within an app."** Framing matters: these are *capabilities/integrations inside our app* (like bot
  add-ons or browser extensions), **not** a distributor of standalone Android apps. Keep that line bright.
- **Apple is stricter** on both code-download and stores-within-apps — assume the iOS build ships only tiers 1–2.

### The four app-market-proof patterns (with shipping precedents)
Ranked safest-first; each is something an app *already on Play/App Store* does today:
1. **Composition-as-data** — download a *configuration that recombines built-in atoms*. The atoms ship in the
   APK; the composition is data, never code. **Provably safe — it's not executable code at all.** *Precedents:*
   Tasker profiles, Apple Shortcuts, HA Blueprints, Node-RED flows, Zapier zaps. ← **the default tier.**
2. **Remote execution (the bot pattern)** — the logic runs on a server (admin / personal / third-party); the app
   is an API client that sends `{opId,args}` and renders the result. **Provably safe — it's just networking.**
   *Precedents:* Discord, Slack, Telegram bots; any MCP client.
3. **Sandboxed interpreter, no Android-API bridge** — run downloaded logic in a VM/interpreter that reaches only
   granted atoms (the explicit webview-JS carve-out). **Defensible; the engineering + policy lift.** *Precedents:*
   web browsers, Scriptable, Pythonista, a-Shell.
4. **Code-carrying, off-store** — distribute anything that *does* ship native/dex code via **F-Droid / web-PWA /
   self-host**, not the store app. *Precedents:* HACS, Termux (which moved to F-Droid precisely over this rule).

**The architectural hedge (and it's a real advantage):** because functionality is *data + remote dispatch*, the
**store app can stay minimal and fully compliant (patterns 1–2)**, while anything code-carrying lives on the
**web / PWA / self-host / F-Droid** channel that no app store gates. Same waist, two distribution channels — the
thin client makes store compliance easy *by construction*. Patterns 1–2 cover the overwhelming majority of real
bundles; 3 is opt-in-later; 4 is the escape valve.

---

## Worked example — feedback as an *extension*, not an app

**Framing (Frits, 2026-06-13).** We treat `apps/feedback-pipeline` as an **external project** and a **design
exemplar / acceptance test**: the goal is *not* "build feedback into canopy-chat," it's *"make canopy-chat able
to absorb a third party's functionality the way feedback needs — with no new app installed."* If feedback can be
delivered as *{a contact-bot + a loaded manifest/mapping}*, so can anyone's functionality. Feedback is how we
**dogfood** the whole model.

**Placement, not blanket graduation (refined — Frits, 2026-06-13).** "Irreducible" does NOT imply "graduate to the
client substrate." Three placements, and **only the first graduates**:
- **(a) client atom → substrate** — *if* it runs on the user's node AND is reusable (rule of three).
- **(b) client composite → the mapping** — feedback's journey (`handleMessage → review → consent`).
- **(c) server/remote → behind the bot** — cross-participant or project-specific; placed remotely by trust + latency.

The 2026-06-13 verification showed feedback's pipeline is *mostly composition*: `seal` (X25519) + `sign` (Ed25519)
are already core crypto, `call-LLM` is already an atom (`llm-client`), and `clean` / `triage` are **composites**
over `call-LLM`. The **k-anonymity filter is (c), not an atom** — it runs server-side in the curator/aggregation
(`apps/feedback-pipeline/src/aggregation/*`, `src/curator/*`) over the *whole* contribution set, with a
project-specific threshold (`aggregation.k`); a client cannot run it on its own data. It **stays feedback's
server-side functionality, behind the bot** — exactly the "project/remote stuff unique to feedback." The client-side floor (**PII-redaction**) graduates as a **generic, config-driven `redact(text, config)` atom** (a).
Today it's `redact.js` (ordered regex `RULES` + replacements + small validators: BSN 11-proef, NL-phone) +
`names.js` (first-name gazetteer + honorific/surname heuristics) — **engine generic, content NL-specific**. So the
atom carries the generic engine (ordered regex rules + replacements + optional gazetteer + a **registry of named
validators** — `bsn-11proef`, `nl-phone`, `iban`, `luhn` — the config selects), and **feedback ships its NL ruleset
+ name list as DATA** in its mapping. That's the config-driven-atom pattern (generic atom + project data): it
graduates because it's *generic* (so reusable), and it keeps "no separate app" (engine in the substrate, config
over the wire). Scope: the atom is the deterministic **floor** — structured PII reliable, **names best-effort**;
the name/tone guarantee stays an **LLM composite** (`call-LLM`) + human review, and k-anon stays server-side.
(A *custom* validator beyond the named registry falls to the LLM composite or a remote handler — not the case for
feedback.) So "feedback has bespoke atoms" was never a blocker: classify by placement, and most of it is composition.

**Two delivery modes canopy-chat must support** (a real project may use both):

- **Mode 1 — bot-exposed skills** *(new capability for canopy-chat).* The project bot is a contact; the
  slash-commands it exposes **are skills** (`skillDiscovery` / `a2aDiscover`). Adding the contact makes its skills
  appear as slash-commands + menus **scoped to the conversation with that bot — not the global app catalog**: its
  handler *is* the bot, so it can't be surfaced app-wide without shipping the bot's internal functionality locally
  (which is impossible). The sensitive/project compute (k-anon aggregation, central pod, the enclave LLM route)
  runs **behind the bot** (remote-handler / tier-2). *Needs:* a **discovered-skill → manifest bridge** that injects
  a contact's SkillCards as a virtual manifest **at contact-thread scope**; dispatch in that thread routes
  `{opId,args}` → `sendA2ATask(thatContact, skillId, args)`.
- **Mode 2 — composite + manifest** *(data).* The project ships a **mapping**: a manifest declaring its commands
  as **composites of existing ops** + a curation renderer, all pure data. Adding it writes a ref into the pod
  `mappings/` folder and merges the manifest. *Needs:* a **composite-op runner** (run a new opId as a declared
  sequence of existing opIds) + the **mappings-folder startup scan**.

**User journey A — bot.** Maaike uses canopy-chat for her household + buurt circles. She gets a link *"Geef
feedback op het buurtplan,"* opens it (mobile or web). Canopy-chat shows a consent card: *add 'Buurtplan-feedback'
as a contact (a bot)? It can offer: /feedback · /review · /consent* — the bot's advertised skills, listed plainly
(which atoms, why, what-if-deny). On consent the bot is added (a WebID agent over the transport), its SkillCards
become a virtual manifest merged into her catalog, and the new slash-commands + a menu appear **in the chat with
the bot**. `/feedback` runs the journey; the project pipeline (clean / k-anon / seal) runs bot-side; she sees the
before/after curation rendered locally. **Nothing was installed.** Project ends → she removes the contact → the
commands vanish.

**User journey B — composite + manifest.** Same invite, but the project ships a *mapping* (data, no remote logic
on the client path). She opens the link → a consent card lists the **atoms the mapping needs** (`call-LLM`,
`redaction-floor`, `write-pod`, the `compare` op) — in plain language. On consent a ref is written to her pod
`mappings/` folder, the manifest merges, and new slash-commands + clickable menus appear. The **composite-op
runner** executes `/feedback` as the declared sequence (collect → floor → clean → review → consent-write), reusing
folio's `diff()` behind a **curation renderer** for the before/after. Because it's all data + core atoms, it
behaves identically on web + mobile (the startup scan reloads it from the pod). Done → she deletes the mapping ref
→ surfaces revert.

*(Real feedback is the **hybrid**: Mode-2 manifest for the local UI/curation, Mode-1 bot for the sensitive/remote
bits — the client carries data + bindings, sensitive compute stays behind the bot/enclave. This matches the code:
client-side floor + server-side aggregation.)*

**Grounded status (2026-06-13 verification).** *Already there:* dynamic manifest merge
(`packages/manifest-host` · `apps/canopy-chat/src/manifestMerge.js`), pod config-read at startup
(`packages/pod-routing/src/configResource.js`), per-circle surface scoping (`scopeCatalogToApps`), re-keyed menus
(`inlineKeyboardFor`), remote skill discovery + invocation (`skillDiscovery` · `a2aDiscover` · `a2aTaskSend` ·
`taskExchange.callSkill`), bot-as-contact (`apps/canopy-chat/src/feedback/feedbackSurface.js`,
`apps/feedback-pipeline/docs/MENUKAART.md §4B`), and folio's reusable pure `diff()`
(`packages/sync-engine/src/diff.js`). *Missing (small, bounded — this is the feedback slice of the plan):*
1. **composite-op runner** (data-defined `{id, steps:[{appOrigin,opId,args}]}` → sequenced dispatch);
2. **discovered-skill → manifest bridge** (PeerGraph upsert → virtual manifest → merge → route to `sendA2ATask`);
3. **pod `mappings/` folder scan** at startup (small extension of `configResource.js`);
4. **expose folio `diff()` as a manifest op + a curation renderer** (compute reused; new "look");
5. **classify feedback's ops by placement** — `redaction-floor` (client-side) graduates to a substrate *only if
   reusable*; the **k-anon filter / curator / central-pod aggregation stay server-side behind the bot** (not client atoms);
6. **finish the bot `PeerBridge`** (the server-run / unsigned tier; `InternalBusBridge` is already real).

---

## Steps to realise (sequenced, tied to the spine)

These extend `REMAINING-WORK.md` W0–W6; none start until the user says go.

1. **Catalogue the SDK atom set + make the opID→atom mapping strict.** The atoms already exist
   (`packages/core/src/{protocol,a2a,skills}`: tasks, streams, messages, a2a-negotiation, pub/sub, file-sharing,
   sessions) — *catalogue* them, **add forms** (the one gap, kept in canopy-chat), define the composition
   data-format (sequence / branch / bind-args over atom calls) **+ a verifier that every opID decomposes only to
   declared atoms** (the sandbox-by-construction guarantee, enforced as a **W0 fitness function**). (Builds on W2.)
2. **Realign current ops to the atoms.** Audit feedback / household / tasks / stoop ops and refactor any that
   carry bespoke logic so each is a *composition over the SDK atoms* — the precondition for placing their
   slash-commands externally. *Kijken hoe dit kan.* (Part of W3.)
3. **Capability-grant model (ocap).** Scoped, revocable, attenuable grant tokens pinned to a kring; the
   op→atom decomposition tree; "grant high implies subtree." Likely an extension of the existing ACP/agent-browser
   grant path, not a new protocol.
4. **kring-admin install flow.** Admin installs a bundle → it joins the kring as an agent → members are prompted to
   grant the atoms it needs → its ops appear via the manifest projectors (slash + chat + gate). (Tier 1 first.)
5. **Per-atom placement.** Let each atom resolve to *local* (member's node) or *central* (admin / personal server)
   by trust + latency — the W6 placement spectrum, now per-atom inside a shared kring.
6. **Managed personal-server option.** For the N = 1 case + non-self-hosters: single-tenant, user-keyed hosting
   (managed-Solid-pod model extended to compute); enclave variant = provider-blind. (W6.)
7. **Plugin-manager UI (mobile-first).** Install / grant / revoke / inspect-capabilities, in the app, via a plain
   consent card that lists the atoms + scope + "what if I deny?". The user-facing face of tiers 1–2.
8. **Store-compliance pass.** Tier-1/2 in the Play/Apple builds; tier-3 (WASM) gated behind a policy review and a
   hard capability sandbox; web/self-host channel for anything code-carrying; Data Safety + permissions audit.

---

## Consent (plain card)

A capability model is only as safe as its *consent step*. The consent card is a **plain card**: it lists the
atoms an extension needs, with **scope** ("can post to *this* kring and read *your* shopping list — nothing
else"), and answers *"what happens if I deny this?"* before you decide. Because a composition is
sandboxed-by-construction (it can only call atoms), the card can **enumerate the exact atom set** a bundle will
ever touch — concrete, not hand-waving. Underneath, grants stay object-capability-strict: default-deny, scoped to
the kring, attenuable, revocable.

*(An **optional, later** enhancement could let the AI-as-interface theme [[project-ai-as-interface-direction]]
explain a grant conversationally — but that is NOT in scope and not a dependency; the plain card is the design.)*

---

## Open questions / risks

- **Grant UX vs. fatigue.** A hierarchical capability model is only safe if members actually understand grants;
  too many prompts and they rubber-stamp. *Direction:* default-deny + a plain consent card that enumerates the
  exact atom set + scope, rather than a raw permission wall.
- **Admin trust in shared kringen.** "Runs at the admin" means the admin sees plaintext for central ops — the
  enclave tier exists for when that's unacceptable, but most kringen will just trust their admin. Make that
  trust *explicit and visible*, never implicit.
- **Revocation + offline.** Revoking a capability must propagate even though members are local-first/offline;
  define the semantics (lease/expiry vs. push-revoke).
- **Op realignment is unscoped.** We don't yet know how many current feedback/household/tasks/stoop ops are
  *already* clean compositions over the SDK atoms vs. carry bespoke logic. The strict-mapping audit (step 2) has
  to come back before "external slash-commands" is a real promise — *kijken hoe dit kan*.
- **Tier-3 is a genuine security + policy lift** — keep it parked until tiers 1–2 prove the model.
- **Naming.** If `canopy → rhizome` happens, the capability/kring vocabulary should be settled in the same pass.
