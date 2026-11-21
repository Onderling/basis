# Circles and pinboard

Circles, their membership, and what members post. This page was started 2026-11-14 with the part that changed then:
how a member's place in a sealed circle's key follows their membership. The rest of the area (making a circle, the
invite and the join, the noticeboard, requests, the roster screens) is still to be described here; its ops are in the
catalogue baseline until it is.

## What a person can do

- Join a circle with an invite; once their join stands on the circle's membership lane, a sealed circle's key is
  wrapped for them, and their devices that prove an address in the circle are added to the key's audience.
- Be removed, or leave: the key rotates past them, and no later grant puts them back, whichever device makes it.
- Post and change items in a circle (tasks, lists, appointments) where its switches allow it; a switch the circle
  turned off holds on every member's device, also against a changed app (the receiving device judges each statement:
  [governance.md](governance.md), "The switches on arrival").
- Be invited again after a removal (a NEW invite: the old code refuses someone removed) and rejoin: the key follows
  the new join.

## Where

- **The order of a join** (`packages/circles` `circleMembershipWriters`, the redeem on the joiner's device and the
  admin's confirmation of a remote joiner): the redemption row, then the roster entry (MemberMap), then the signed
  `join` on the membership lane, then the key grant, which names that join as the admission it follows. Membership
  first, the key follows: a join that could not be written leaves no key holder who is no member.
- **The question every key change asks again** (`pinboard` op `memberStatus {groupId, webid, after?}`): is the member
  still in after the admission `after` (the join's hash; absent, their last folded join)? `in`, `out`, or null when it
  cannot be placed. Read from the same fold as the invite verdict, placed in the membership lane's own causal order
  (`causalPlace` in `packages/core` rosterFold: an ancestry path in the statements' parents, the same on every device
  that has folded both, never a clock). An exit concurrent with the admission cannot be placed: null.
- **Who asks**: the per-circle control-agent router (`apps/basis/src/v2/circlePodProducer.js`), on every compute of a
  join's key change and of a device's enrolment (the device's owner); out drops the change, null writes nothing and
  goes to the refusal log (`member-unknown`). Both shells and the relay harness compose it the same way.
- **The audience round** (`apps/basis/src/v2/keyAudienceCheck.js`, `runKeyAudienceCheck`): on the KEY OWNER's device only
  (the producer that holds the circle's root), after the producer's roster seed and after each membership event the
  router handles. A holder the membership lane places out whose removal never reached the key file (a crash, a device
  offline) is revoked with a ban, one per round, and the lane is asked again inside the write. Who a key belongs to
  comes ONLY from this device's grant notes (the producer's `keyHolders`, in its vault beside the pod-agents note, never
  on the pod, the roster or the lane): written when this device's grant ADDED the key (a join, or a device enrolled with
  its owner named), never when the key was already a recipient, never re-attributed, removed by this device's revoke.
  An address on a roster row is not used: a link proof does not bind a person. The controller and the device's own key
  are kept; a key no grant here noted ('unmapped': a holder another instance granted) and one it cannot place are kept
  and counted; a read that fails revokes nothing. A recipient-sealed (p3) circle is skipped out loud, once per circle
  per start. The round's line carries counts only. Holders another instance granted wait for a link proof that binds
  the person.
- **Re-driven by**: the roster seed at the next producer start (`seedCircleRoster`), which grants every member on the
  roster by their last join, so a grant that failed after the join stood is made then.

## Proof

- `apps/basis/test/keyGrantFollowsMembership.test.js`: three real agents, the real join and removeMember: a stale grant
  after a removal is dropped; a removed member's device is not enrolled while a member's is; the founder is in; a
  removed member re-invited on a new code gets the key; a status that cannot be read writes nothing.
- `packages/core/test/causalPlace.test.js`: after / before / concurrent / not held, and the fold's last exit and join
  by statement.
- `apps/basis/test/sharedPodJoinerOpensKey.relay.test.js`: through the app's join, the joiner opens the stored key.
- `apps/basis/test/keyAudienceCheck.relay.test.js`: a lost removal and the removed member's device taken out, one per
  round; a member keeping the key; an unnoted key kept and counted; a holder another instance granted kept and counted;
  a grant that finds the key already there leaves no note. `keyAudienceCheck.test.js`: one rotation per round, the
  status asked again inside the write, counts, a failed read revokes nothing, p3 said once, a non-owner does nothing.

## Decided, not built

- (none yet on this page)

## Open rows

- Holders nobody can name (unmapped keys): the count is in the device's log only; showing it to an admin is a row for
  after the alpha. The grant record for recipient-sealed (p3) circles: its own row.

## Decisions that bind this area

- The invite door: a peer redeem reaches all of a person's devices (one address); a device that has never held a code for the circle stays silent, so the code holder's answer is the one heard. The price: an answer now tells someone who already has the circle id and the address that this device holds an invite for it (accepted 2026-11-14; the id travels only in invites).
- One sealing key family: a member's key is wrapped to the image of their proven per-circle address (2026-09-04).
- A per-circle address is proven by a signature that names the member (circle, address, member); a copied proof verifies for no one else, the earlier proof is refused, and one address belongs to one member in a circle (2026-11-14).

<!-- catalogue-ops
pinboard: memberStatus
-->
