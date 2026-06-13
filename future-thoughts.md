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
   actually trusts at the bottom: *create-task · send-message · start-stream · connect (mDNS / BT) · authenticate
   · pod read/write · schedule-job · call-LLM.* These are the lowest waist ops. They are device-independent and
   exist once, in the substrates.
2. **App ops = compositions.** A manifest op (`feedback.submit`, `household.addItem`) is a composition that
   ultimately bottoms out in atomic capabilities (write a pod doc, send a message, start a stream…). The manifest
   declares the composite; the substrate provides the atoms.
3. **Grants — the hierarchical capabilities landscape.** A grant is a scoped, revocable, attenuable token
   (object-capability style) that says *"this installed app may invoke these atoms, on my behalf, in this kring."*
   It's **hierarchical** because ops decompose into a tree of atoms: a grant attached high in the tree implies its
   subtree; a member can instead grant only individual leaves. The kring is the scope every grant is pinned to.

This is the formalisation of the long-standing intuition that **the kring is the capability/safety boundary that
"almost encompasses" the other apps** — not just a chat scope, but the container that decides what an installed
capability may touch.

---

## Designing the atom set + compositions (the part that needs more thought)

Two design choices carry this whole idea, and both have well-trodden prior art.

**The atom set is an instruction set (ISA) — treat it like one.** What makes it right:
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

## Steps to realise (sequenced, tied to the spine)

These extend `REMAINING-WORK.md` W0–W6; none start until the user says go.

1. **Name the atomic-capability instruction set + the composition format.** Enumerate the substrate primitives
   (create-task, send-message, start-stream, connect-mDNS/BT, authenticate, pod r/w, schedule, call-LLM) as the
   canonical atom list; define the composition data-format (sequence / branch / bind-args over atom calls) **and a
   verifier that a composition references only declared atoms** — the sandbox-by-construction guarantee. (Builds
   on W2 — the kring-host substrate.)
2. **Capability-grant model (ocap).** Scoped, revocable, attenuable grant tokens pinned to a kring; the
   op→atom decomposition tree; "grant high implies subtree." Likely an extension of the existing ACP/agent-browser
   grant path, not a new protocol.
3. **kring-admin install flow.** Admin installs a bundle → it joins the kring as an agent → members are prompted to
   grant the atoms it needs → its ops appear via the manifest projectors (slash + chat + gate). (Tier 1 first.)
4. **Per-atom placement.** Let each atom resolve to *local* (member's node) or *central* (admin / personal server)
   by trust + latency — the W6 placement spectrum, now per-atom inside a shared kring.
5. **Managed personal-server option.** For the N = 1 case + non-self-hosters: single-tenant, user-keyed hosting
   (managed-Solid-pod model extended to compute); enclave variant = provider-blind. (W6.)
6. **Plugin-manager UI (mobile-first) with AI-explained grants.** Install / grant / revoke / inspect-capabilities,
   in the app — with the consent step driven by the assistant (see "AI-mediated consent" below), not a raw
   permission wall. The user-facing face of tiers 1–2.
7. **Store-compliance pass.** Tier-1/2 in the Play/Apple builds; tier-3 (WASM) gated behind a policy review and a
   hard capability sandbox; web/self-host channel for anything code-carrying; Data Safety + permissions audit.

---

## AI-mediated consent (grants, explained)

A capability model is only as safe as its *consent step*. A wall of "Grant `create-task`? Grant `read-pod`?" gets
rubber-stamped, which defeats the entire point of fine-grained capabilities. The fix is the **AI-as-interface**
theme ([[project-ai-as-interface-direction]]) pointed straight at consent: instead of a permission list, the
assistant **explains, in plain language, what an installed bundle will actually be able to do, why it asks for
each atom, and what the worst case is** — and answers *"what happens if I deny this one?"* before you decide.

Crucially this changes the *interface*, not the *model*: underneath, grants stay object-capability-strict —
default-deny, scoped to the kring, attenuable, revocable. The AI is the doorgeefluik *to* the grant model, the
same way it's becoming the interface to settings and to ops — it never widens what a grant means, it just makes
the decision legible. Because a composition is sandboxed-by-construction (it can only call atoms), the assistant
can even **enumerate the exact atom set a bundle will ever touch** and explain it concretely ("this can post to
*this* kring and read *your* shopping list — nothing else"), rather than hand-waving.

This is the design element most likely to make capabilities *usable* rather than merely *correct* — it turns the
security model from a friction wall into a conversation, and it's the natural first home for AI-as-interface
because the stakes (a clear, honest consent) are exactly where plain language earns its keep.

---

## Open questions / risks

- **Grant UX vs. fatigue.** A hierarchical capability model is only safe if members actually understand grants;
  too many prompts and they rubber-stamp. *Direction:* AI-mediated consent (above) — default-deny + an assistant
  that explains each grant — rather than a raw permission wall.
- **Admin trust in shared kringen.** "Runs at the admin" means the admin sees plaintext for central ops — the
  enclave tier exists for when that's unacceptable, but most kringen will just trust their admin. Make that
  trust *explicit and visible*, never implicit.
- **Revocation + offline.** Revoking a capability must propagate even though members are local-first/offline;
  define the semantics (lease/expiry vs. push-revoke).
- **Tier-3 is a genuine security + policy lift** — keep it parked until tiers 1–2 prove the model.
- **Naming.** If `canopy → rhizome` happens, the capability/kring vocabulary should be settled in the same pass.
