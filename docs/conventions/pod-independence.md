# Convention: preserve pod-independence

> **Status:** deliverable (per transition doc §V.5 + §V.6).
> Pins the design principle that the substrates-v2 plan MUST not
> regress capabilities today's code already delivers without
> requiring a Solid pod.
>
> **Locked 2026-05-14.** Treat this as a constraint on every
> future substrate decision.

## The principle

Anything that **works today without a pod** must continue to work
without a pod after standardisation. New capabilities that require
a pod are fine; substrate redesigns that silently make existing
no-pod features pod-dependent are NOT.

This isn't an aspiration. It's an audit constraint. Any plan
revision that proposes retiring a substrate (or rerouting a
capability) MUST explicitly state whether the substrate's
capability was pod-independent today, and if so, how the new
design preserves it.

## What's preserved (today's audit, 2026-05-14)

| Today's capability | Tomorrow's mechanism |
|---|---|
| Pinboard's `groupMirror` — group state across member devices, no pod needed | Pseudo-pod replication ring + `notify-envelope` full-payload fan-out (Phase 52.2 + 52.4); Phase 52.9.2 retired `groupMirror` cleanly with parity-tested substitute |
| Tasks's relay-fan-out — task ledger across circle, no pod needed | Same substrate (`notify-envelope` + `pseudo-pod`); no-pod circle policy is one of four §II.2 policies |
| Try-the-app-for-a-week-before-pod | Pseudo-pod **standalone mode** (Phase 52.2 V0); apps work fully against the local pseudo-pod without ever provisioning a Solid pod |
| BLE-only campsite circles (no internet) | Pseudo-pod replication ring travels over BLE skill calls — no relay needed; substrate is transport-agnostic |
| Mnemonic restore reconstructing identity locally | No-pod users: restore is local-only; vault lives in pseudo-pod, replicated across user's own devices. Pod-having users: vault lives at `<pod>/private/identity-vault` — a documented limitation in the interim (web console in Hub track handles edge cases) |
| Conflict resolution without a central authority | Phase 52.14 Q-D — Lamport-style `_v` per resource + 3-way `writeFromPeer` compare. No central coordinator needed |
| Sharing without OIDC | Cap-token issuance via `PodCapabilityToken` stays as the no-pod sharing primitive (Phase 52.16). ACP/WAC is the **upgrade** for pod-having users, never the **replacement** |

## What's NOT constrained by this principle

- **Folio is already fully pod-attached.** No no-pod mode to
  preserve. Folio's transition simply extends; substrate doesn't
  promise no-pod Folio.
- **New capabilities** being **added** (cross-pod refs, OIDC for
  cross-user pods, web console recovery, sharing via ACP) may
  require pods — they're net new, not regressions.
- **Pod-having mode improvements** (cache-mode write-through
  queue, conflict detection via etag) only operate when a pod is
  present. No-pod users don't lose anything by not having them.

## The substrate-side mechanism

The substrate **never branches at the call site**. App code calls
`substrate.writeItem(...)` without knowing the policy. The
substrate picks the wire format + persistence target per-write
based on three inputs (§II.6 in the functional design):

- **Content nature.** Persistent (handled by `notify-envelope`)
  vs ephemeral (handled by `notifier`).
- **Circle preference.** The §II.2 policy on the circle
  (centralised / decentralised / hybrid / no-pod).
- **Current pod reachability.** Consulted before every persistent
  write via `pod-routing.isPodReachable(uri)`.

Receivers' substrates deposit items into the local pseudo-pod
**uniformly across modes**. Apps read uniformly. This is what
makes graceful degradation work — the substrate handles the
"sometimes pod, sometimes not" plumbing.

## Graceful degradation as the migration story

Because §II.2 policies are **preferences with graceful
degradation** (locked 2026-05-11):

- Pod-having circles **don't lose offline capability** when they
  migrate from pre-standardisation (groupMirror / relay-fan-out).
- The substrate's replication-ring mode is the **universal
  baseline**; the pod is a **promotable ring member** whose
  participation is gated by reachability.
- Apps that attached a pod to a circle during the transition keep
  working offline; data syncs when connectivity returns.

This is the architecture-level guarantee that makes the
pod-independence principle robust even as new features land.

## Audit trigger

**Any future plan revision that proposes retiring a substrate
MUST explicitly state:**

1. Was the substrate's capability pod-independent today?
2. If yes, how does the new design preserve that?
3. If the new design only works with a pod, that's a regression
   of the principle — surface explicitly + get an explicit
   acceptance trade-off from the user before shipping.

The Q-B groupMirror retirement (Phase 52.9.2, 2026-05-14) is the
worked example. Before retirement, groupMirror provided no-pod
group state replication. After retirement, the substrate path
(pseudo-pod ring + notify-envelope) covers the same capability,
verified by parity tests. The retirement passed the audit.

## Pointers

- `Project Files/standardisation-transition-2026-05-11.md` §V.6 —
  source of the principle
- `Project Files/standardisation-plan-restructured-2026-05-10.md`
  §II.2 — four circle policies (centralised / decentralised /
  hybrid / no-pod)
- `Project Files/standardisation-plan-restructured-2026-05-10.md`
  §II.6 — persistent-write patterns + graceful degradation
- `Project Files/standardisation-plan-restructured-2026-05-10.md`
  §II.7 — pseudo-pod's three modes (standalone / replication-ring
  / cache)
- `Project Files/Pinboard/conflict-resolution-design-2026-05-14.md` —
  Q-D's version-vector design (pod-independent convergence)
- `Project Files/Substrates/substrates-v2-coding-plan-2026-05-11.md`
  §Phase 52.9.2 + §Phase 52.14 — worked examples of the principle
  applied during retirement / extension
