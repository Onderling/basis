# Decision-logging convention — when (and where) to record a decision

> **Status:** locked 2026-07-02. Project-wide convention. So the *why* behind a choice survives after the
> choice is baked into code or process — and so settled questions don't get silently re-litigated.

## When to log a decision

Record a decision when a choice:
- **closes off alternatives** (you picked X over Y/Z, and someone later will wonder why not Y),
- **would otherwise be re-litigated** (it "feels settled" but nothing writes down that it is), or
- **shapes the architecture or the organization** (a structural, hard-to-reverse, or outward-facing choice).

Do **not** log routine, easily-reversible choices (variable names, one-off refactors) — that's noise. The test:
*"in three months, would someone reasonably reopen this, and would the answer save them time?"* If yes, log it.

## Where

| Kind of decision | File | Visibility |
|---|---|---|
| **Code / technical / architecture** | [`docs/decisions.md`](../decisions.md) | public |
| **Organization / strategy / legal / partners** | `plans/strategy/decisions.md` | private |

One running file per domain, **newest entry at the bottom**. (A single file, not a file-per-decision directory:
lower ceremony, and the whole history reads top-to-bottom.)

## Format (ADR-lite)

```markdown
## YYYY-MM-DD — <short title of the decision>

**Status:** settled | superseded by <date> | proposed

**Context:** the situation / forces that made a choice necessary (1–3 sentences).

**Decision:** what was chosen.

**Alternatives / why:** what else was considered and why the chosen option won.

**Consequences:** *(optional)* what this commits us to, or follow-on work it implies.
```

## Lifecycle

- **Never delete** a decision. If it's overturned, add a **new dated entry** with the new decision and mark the
  old one `**Status:** superseded by <date>` (link the two). The log is a history, not a current-state doc.
- A decision that turns into work → add the work to the relevant roadmap; the decision entry records *why*.

*(This convention is itself an entry in `docs/decisions.md`, 2026-07-02.)*

## Your OWN judgement calls — the private review file

`docs/decisions.md` records decisions the *maintainer* has answered. A choice an agent makes **without**
him is a different thing and has a different home: `plans/DECISIONS-FOR-REVIEW.md` (private/local).

**The rule — dated, and re-decided on 2026-08-13.** Any such choice goes into that file **in the same turn
as the change**, colour-coded 🟢 mechanical · 🟡 shapes something · 🔴 awkward to undo, and stating **how to
undo it**.

**Why same-turn and not a batch at the end.** The file silently drifted three days in July 2026 and had to
be reconstructed afterwards, which can only ever be partial: what you forgot is by definition absent. It is
the same habit as `agent-notes-known-gotchas.md` — write it the turn you hit it.

**What a good entry contains**, beyond the decision itself: the *risk you are taking*, stated plainly, and
the reversal. An entry that only says what was done is a changelog line; the value is in what a reviewer
would otherwise have to reconstruct — what else was possible, and what breaks if this was wrong.

**On 2026-08-13 this rule is re-decided** — keep, narrow, or drop. It exists because it was forgotten once,
not forever.
