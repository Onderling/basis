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

**The architectural hedge (and it's a real advantage):** because functionality is *data + remote dispatch*, the
**store app can stay minimal and fully compliant (tiers 1–2)**, while the spicy, code-carrying tier lives on the
**web / PWA / self-host** path that no app store gates. Same waist, two distribution channels — the thin client
makes store compliance easy *by construction*.

---

## Steps to realise (sequenced, tied to the spine)

These extend `REMAINING-WORK.md` W0–W6; none start until the user says go.

1. **Name the atomic-capability instruction set.** Enumerate the substrate primitives (create-task, send-message,
   start-stream, connect-mDNS/BT, authenticate, pod r/w, schedule, call-LLM) as the canonical atom list. (Builds
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
6. **Plugin-manager UI (mobile-first).** Install / grant / revoke / inspect-capabilities, in the app. The
   user-facing face of tiers 1–2.
7. **Store-compliance pass.** Tier-1/2 in the Play/Apple builds; tier-3 (WASM) gated behind a policy review and a
   hard capability sandbox; web/self-host channel for anything code-carrying; Data Safety + permissions audit.

---

## Open questions / risks

- **Grant UX vs. fatigue.** A hierarchical capability model is only safe if members actually understand grants;
  too many prompts and they rubber-stamp. Needs careful default-deny + plain-language summaries (ties to the
  AI-as-interface theme: an assistant that *explains* a grant beats a permission wall).
- **Admin trust in shared kringen.** "Runs at the admin" means the admin sees plaintext for central ops — the
  enclave tier exists for when that's unacceptable, but most kringen will just trust their admin. Make that
  trust *explicit and visible*, never implicit.
- **Revocation + offline.** Revoking a capability must propagate even though members are local-first/offline;
  define the semantics (lease/expiry vs. push-revoke).
- **Tier-3 is a genuine security + policy lift** — keep it parked until tiers 1–2 prove the model.
- **Naming.** If `canopy → rhizome` happens, the capability/kring vocabulary should be settled in the same pass.
