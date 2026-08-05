# Principles — the *why* behind the design

*Created 2026-08-05. This is the short, canonical statement of the load-bearing principles the whole system
serves — the **why**. It complements, and does not restate, the **how**: the model + mechanisms live in
[`architecture.md`](architecture.md), the enforcement rules in [`../CLAUDE.md`](../CLAUDE.md) and
[`conventions/`](conventions/), the settled choices in [`decisions.md`](decisions.md). When a design fork
comes up, derive the answer from the principles below — this is the doc to consult (and to hand a subagent)
first. Reference-and-derive, kept to one page on purpose so it cannot drift into a second copy of the details.*

## How to read the sources (the derivation rule)

- **Product/values docs are a HORIZON** — `onderling-site/content/kaartjes.json` (the public promises) and the
  Dutch strategy docs (`plans/strategie/*`) say the *why* and the direction. Cite them for values; **never read
  them as a technical spec** (an over-literal read of *"de ledenlijst blijft van de vereniging"* once produced
  a false membership "tension" — it was an organizational reassurance, not a roster-model claim).
- **The technical authority is `PLAN-homes.md` + `architecture.md`** — they say the *what/how* and name the
  guards. A fork is resolved by: derive the value from the product horizon, the mechanism from the technical
  authority, and check it against the invariants in `CLAUDE.md`.

## The load-bearing principles

Each: the principle · the source phrase (value) · the technical property it forces.

1. **Your words stay yours — data ownership.** *"je woorden blijven van jou"; "Jij bent de baas over je
   gegevens."* → the user, not a company, owns the record; it is theirs to read, move, and rebuild.
2. **No central arbiter.** *"0 servers verplicht"; "geen centrale server die alles bewaart."* → circle state is
   a **signed, peer-replicated append-only log**; nothing central decides who is in or what happened. Publicly:
   *"verwijderen kun je vragen, niet afdwingen"* — literally append-only-peer-log semantics, promised.
3. **Local-first.** *"de gegevens staan in de eerste plaats op de apparaten van de gebruikers zelf."* → devices
   hold the truth and the resilience; the network syncs. The device caches are why *"pod kwijt = ongemak, geen
   verlies."* (See the tension with pods below — it is deliberate, not an oversight.)
4. **Portable, and rebuildable from the log.** *"je hele opslagruimte verhuizen … dat kan"; "portable tussen
   apparaten en providers."* → the record is provider-independent; every read-model/cache is **rebuildable from
   the log**, so it can never become an independent source of truth that drifts (`architecture.md` §2-3).
5. **Minimum disclosure, by default; you are the final editor.** *"Per kring bepaal je wat anderen van je zien;
   standaard zo min mogelijk"; "de gebruiker is eindredacteur."* → **per-circle keys + selective, revocable
   release**; nothing leaves without an explicit act.
6. **Trust between real people is the point.** *"AI verlaagt de kosten van coördineren … maar niet de kosten
   van vertrouwen."* → membership is **proof-derived and tamper-evident** (signed per-circle keys + a
   per-author hash-chain over membership/key events), not a mutable admin table. The crypto *realizes* the
   trust promise; it doesn't replace it.
7. **One record, many projections.** One signed per-circle log; **one store per circle** (two is a defect); a
   projection is the **materialised head**, always rebuildable, never a second store (`architecture.md` §3-4,
   guard `G-C1`).
8. **One central surface — everything through the waist.** Every interface (AI · GUI · slash · gate) compiles
   to the same `{opId, args} → callSkill`; there are no parallel routes. Cross-cutting concerns (sync, the
   agent trail) hook **once at the waist** and project out — never as scattered `emit()` calls (`CLAUDE.md`
   invariant "nothing runs parallel to the main components").
9. **Enforceability — put the gate where it binds.** A check a different client could bypass is a *convention*;
   the real gate lives at the seal, the key, the roster, the relay — where it holds no matter what the other
   side runs (`conventions/enforceability.md`).
10. **Safety over liveness.** For a security boundary, **deny/revoke/pend wins**; anything that must be *agreed*
    (a tally, a caretaker, a revoke) is computed identically everywhere, never decided locally
    (`architecture.md` §4).
11. **Placement by trust + latency — never default-to-server.** Sensitive compute stays client-side or in an
    **attested enclave** (Privatemode/TEE), the same crossing as any model call (`conventions/pod-independence.md`).

## Local-first ↔ Solid pods — the deliberate tension

Local-first says the truth lives on your devices. Solid pods are *"where bytes rest"* — and a pod can sit on
**your own server OR at a provider**, which reads as a contradiction with "purely local." It is a real tension,
kept on purpose, and reconciled by four things:

- **The pod is a SHAPE, not a place** — a contract (registry + containers + sealed items) any dumb medium can
  hold. The file form (pseudo-pod) already exists locally; a provider is just another medium
  (`architecture.md` §3, Pod).
- **Ciphertext-only.** Storage is sealed and dumb; a provider *"kan niet meelezen."* Hosting your bytes is not
  reading them.
- **Rebuildable from device caches.** *"pod kwijt = ongemak, geen verlies"* — the pod is resilience/interop, not
  the sole copy; the local-first devices remain the truth.
- **Solid adds SOVEREIGNTY, not dependence** — claimable, standards-based, interoperable; a managed pod can be
  **claimed** by its owner and moved. You choose *where the pod rests*; that choice is the sovereignty, not the
  location.

The honest residual: a provider-hosted pod does mean your (encrypted) bytes sit somewhere with an availability
and metadata relationship you don't fully control — which is why local-first stays the **default and the
resilience floor**, and the pod (wherever it rests) is the sealed, sovereign, interoperable **at-rest + interop
layer** on top. The commercial model leans into exactly this seam — EU pod-hosting-with-SLA is a *service around*
ownership (*"Wij kunnen zeggen: jouw data blijft bij jou"*), open-core, *"geen advertentie en geen datahandel"* —
so revenue depends on the ownership stance rather than fighting it.

## Named exceptions (deliberate carve-outs, not drift)

Some product-mandated shapes sit *beside* the one-log/one-store/local-first default and are designed *around*,
not tolerated as drift: the **aggregation-pod** (k-anonymized, consent-approved cross-pod output),
**published-above-threshold output** (deliberately immutable — a stated exception to erasure), **cross-circle
sharing** (its own key model + share policy; the log must leave it a clean seam), **saved-audiences /
"snijdingen"** (legitimately mutable config, not log-derived — this is what `createCirclesStore` is), and
**external chat channels** (WhatsApp/Telegram — a low-threshold tradeoff with server-side metadata). Detail:
`plans/PLAN-one-log-convergence.md`.

## Where to go next
- The *how* it runs: [`architecture.md`](architecture.md). The enforcement rules: [`../CLAUDE.md`](../CLAUDE.md)
  + [`conventions/`](conventions/). The design of record: `plans/PLAN-homes.md`. Settled choices:
  [`decisions.md`](decisions.md).
