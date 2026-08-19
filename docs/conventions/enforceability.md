# The enforceability test

> **Could someone running a different app version get what they want anyway?**
> If yes, do not present it as enforcement. (Frits, 2026-07-28)

## Why this is a rule and not a nicety

A UI that promises what a modified client can ignore produces **false confidence**, which is worse than
an honest "this is a convention": the user makes decisions — what to share, whom to add, what to hide —
on a guarantee that is not there. Being wrong about your own protections is a specific, avoidable harm,
and it is the kind our whole design posture exists to prevent.

It is also a useful design tool. Asking the question tells you *where the gate actually belongs*.

## How to apply it

1. For any control, ask what a hostile or simply modified client can do regardless.
2. If the answer is "everything", name it what it is — a **convention**, a **filter**, a **preference** —
   in the code comment, in the JSDoc, and in the user-facing string.
3. Put the enforceable check where it holds no matter what the other side runs: **the seal, the key, the
   roster, the relay**. Those bind because they are not asking the other client to cooperate.
4. Say the honest thing in the UI even when it is less impressive. "This decides what people see, not
   what they may do" is a better sentence than an implied guarantee.

## Worked examples in this repo

- **Per-skill exposure is a discovery FILTER.** Hiding a skill removes it from cards and catalogues; it
  stops no dispatch. The grant/token check at dispatch is the enforcement. It follows that hiding also
  does **not** revoke — a hidden skill keeps its grant on the card, because telling someone they had
  revoked something they had not is the same lie pointing the other way.
  (`packages/agent-registry/src/skillExposure.js` — the tests pin this property explicitly.)
- **C13's fast rung stays unilateral.** Adding a contact is a note in my own address book; nothing stops
  me writing one. *Reachability* is the other side's to govern, because that IS enforceable on their
  device.
- **The chat filter is a reading preference.** Device-local, never fanned, and the string says "this only
  changes what you see here" so it cannot be mistaken for a circle setting.

## The inverse failure

Do not over-correct into refusing to build client-side controls. A filter that is *called* a filter is
useful and honest. The defect is only ever the mismatch between what the control does and what the
surface implies it does.
