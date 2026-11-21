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
- **Hiding a contact is a preference ordered by device clocks.** The mark rides the person's own devices
  (newest `hiddenAt` wins) and each device stamps its own clock, so a laptop ten minutes behind can lose its
  newer unhide. Accepted, and said on the field (`apps/pinboard/manifest.js`, `setContactHidden.hiddenAt`): it is a
  filter on what you see, and it gets the log's order when the contact book becomes an item type.
- **A sealed local value opens only under its own key, and a planted plain value is refused** on a device whose content
  key was minted with its form mark. What is left: a value copied into ANOTHER storage under the same key name still
  opens (the binding is the key, not the store, so a renamed store keeps reading); on a device with an older key a
  plain value still reads as the upgrade's until the alpha build drops that path; and anyone who can write the storage
  can still delete or roll back a value to an older sealed one of the same key. The person's device is the boundary
  (`apps/basis/src/v2/localStoreSeal.js`).
- **A proof that a device holds an address names the relay it dialled**, and a relay counts only names its operator
  set (`RELAY_NAMES`): the Host header is the caller's to write, so a relay that took its name from it would accept an
  answer a hostile relay obtained for itself. What is left: with no names set, a relay takes a PRIVATE name (localhost,
  a LAN or loopback literal) from Host, so two relays reached under the same private address in two networks answer
  to the same name, and a device that moves between them could be proxied from one to the other. The same holds for a
  relay with no names set that is also reachable publicly: a hostile relay the device dialled under a private name
  (its LAN address) can pass that relay's challenge on under the same private Host. Set `RELAY_NAMES` on any relay
  reachable from the internet. Both cases need the device to dial a private name it was handed; accepted (`packages/core/src/identity/addressPossession.js`, `relayOwnNames`).

- **A circle's switches bind on arrival, with named limits** (2026-11-21). An app, feature or act the circle switched
  off is refused on every member's device, judged by the settings in force where the statement stands on the content
  line (docs/architecture.md, "Consistency & governance"). What a changed client can still do:
  - **Whoever answers this device's catch-up can hand it a row**, or an older state of a row it does not hold newer, of
    any type whose app is on, also where adding is off: a head served for a row whose statements aged out is signed by
    the server, not the writer, and is judged only by its app being on. It is taken only in answer to this device's own
    ask, never from the live fan, and it cannot replace a newer row this device holds. Closing it means keeping the
    writer's original statement beside every row and serving that (roughly double the storage per row).
  - **Which change it was** is not told apart: with "add" on and "complete" off, a changed app can complete a task and
    the receiver sees "a change". Each type declaring its fields per act closes it.
  - **Whose item it is**: any member can change or remove another member's item where the switches allow the act.
  - **A removed row can come back as new**: the store keeps no tombstone, so a re-sent snapshot is judged as an add.
  - **An admin can draw the line early** (name fewer tips than they held) and so take back up to the items window of
    what the switch covers: signed, shown, and itself a governed settings change.
  - **The wake is decided on the sender**, by the entry kind: a changed sender can wake members' devices for a chat
    kind the circle has off (a ping, nothing shows). A circle whose settings a device does not know yet filters
    nothing until they arrive. The record of each circle's conversation kinds is held per process (a box running
    several agents shares it).
- **Whose item it is binds on the receiving device** (`madeBy`, `changedBy`): a member's device that skips its own
  check cannot change or remove another member's note, post or ask on anyone else's device. What is left: a row whose
  maker is not known there (made before makers were kept, or served by catch-up without one) takes any member's change
  (lenient on purpose for the alpha: strict would refuse honest edits of old rows on a late joiner); an admin is judged
  by the roster as it stands, not at the statement's own place; a served head carries the maker as the serving member
  holds it (`apps/basis/src/v2/itemsRail.js`).

## The inverse failure

Do not over-correct into refusing to build client-side controls. A filter that is *called* a filter is
useful and honest. The defect is only ever the mismatch between what the control does and what the
surface implies it does.
