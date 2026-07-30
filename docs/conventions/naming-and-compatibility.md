# Naming, and how much compatibility we owe

Two rules that travel together: what things are called, and what we owe the old spelling.

## Naming: onderling, everywhere

Product and platform naming in code, comments, labels, URI schemes, storage keys, namespaces and
key-derivation inputs is **onderling** (or neutral). There are no "canopy" identifiers left, and new ones
are a defect.

The earlier split (onderling = product, canopy = platform/SDK) is dropped — see `docs/decisions.md`,
2026-07-28. Two places legitimately still say canopy: the local checkout folder `canopy-mono` (the
feedback repo's `file:` deps cross to it) and `apps/tasks-mobile` (a deferred delete candidate).

## Compatibility: a dated licence, not a standing one

> **⏳ Backwards compatibility is NOT required — until 2026-08-31**
> (Frits, 2026-07-28; **extended from 07-31 to 08-31 on 2026-07-30**).

*Why it was extended:* the round-trip work on 2026-07-30 turned up a wire change worth making — the
reciprocal HI now carries a `reply: true` marker — and the original month ran out the next day, mid-flight.
Renewing deliberately is the point of a dated licence; letting it lapse by accident while work is in the air
is not.

Nothing is live: no external users, no data worth migrating. So a rename or reshape lands as a **clean
break** — no dual-write windows, no legacy read-fallbacks, no deprecated aliases. Those cost real
clarity: they read as caution while hiding which path is the real one, and every reader afterwards has to
work out whether the fallback is load-bearing.

**Accepted consequence:** local dev state re-derives. Sealed pod data, per-circle addresses, passkey
vault keys and old export archives written under previous names do not open; dev circles may need
re-creating. Pre-launch is exactly when that is cheap, which is the whole reason to do it now.

### The expiry is the point

**After 2026-08-31 this licence lapses — ASK before breaking a persisted or wire format.** A standing
"compatibility doesn't matter" would quietly outlive the condition that made it true, which is how a
reasonable decision becomes an unreasonable habit. If the date has passed and nobody has renewed it,
treat compatibility as required again and raise the question.

### What a break still owes the reader

Even under the licence: say what re-derives, in the commit message and in the summary to Frits. "Nothing
will break" is a claim about *other people's* data — it is rarely a claim about the developer's own
machine, and the difference is worth spelling out rather than discovering.
