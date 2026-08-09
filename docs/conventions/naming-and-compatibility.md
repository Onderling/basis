# Naming, and how much compatibility we owe

Two rules that travel together: what things are called, and what we owe the old spelling.

## Naming: onderling, everywhere

Product and platform naming in code, comments, labels, URI schemes, storage keys, namespaces and
key-derivation inputs is **onderling** (or neutral). There are no "canopy" identifiers left, and new ones
are a defect.

The earlier split (onderling = product, canopy = platform/SDK) is dropped — see `docs/decisions.md`,
2026-07-28. Two places legitimately still say canopy: the local checkout folder `canopy-mono` (the
feedback repo's `file:` deps cross to it) and `apps/tasks-mobile` (a deferred delete candidate).

## Compatibility: not required (a standing rule)

> **Backwards compatibility is NOT required — standing rule (Frits, 2026-08-08).**
> Break persisted/wire formats freely; this is no longer a dated licence.

*History:* this was a dated licence (2026-07-28, extended to 2026-08-31); on 2026-08-08 Frits made it
standing — "no backwards compatibility needed." The condition that makes it safe is unchanged: nothing is
live.

Nothing is live: no external users, no data worth migrating. So a rename or reshape lands as a **clean
break** — no dual-write windows, no legacy read-fallbacks, no deprecated aliases. Those cost real
clarity: they read as caution while hiding which path is the real one, and every reader afterwards has to
work out whether the fallback is load-bearing.

**Accepted consequence:** local dev state re-derives. Sealed pod data, per-circle addresses, passkey
vault keys and old export archives written under previous names do not open; dev circles may need
re-creating. Pre-launch is exactly when that is cheap, which is the whole reason to do it now.

### When to revisit (the one trigger)

The dated expiry was retired 2026-08-08; the rule is now standing. The thing that makes it safe is *no
external users*. **Revisit only when that changes** — a published `@onderling/*` package gains real
third-party consumers, or a real user's sealed data must survive an upgrade. Until then, a rename or
reshape lands as a clean break.

### What a break still owes the reader

Even under the licence: say what re-derives, in the commit message and in the summary to Frits. "Nothing
will break" is a claim about *other people's* data — it is rarely a claim about the developer's own
machine, and the difference is worth spelling out rather than discovering.
