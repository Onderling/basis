# Circles and pinboard

Circles, their membership, and what members post. This page was started 2026-11-14 with the part that changed then:
how a member's place in a sealed circle's key follows their membership. The rest of the area (making a circle, the
invite and the join, the noticeboard, requests, the roster screens) is still to be described here; its ops are in the
catalogue baseline until it is.

## What a person can do

- Join a circle with an invite; once their join stands on the circle's membership lane, a sealed circle's key is
  wrapped for them, and their devices that prove an address in the circle are added to the key's audience.
- Be removed, or leave: the key rotates past them, and no later grant puts them back, whichever device makes it.
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
- **Re-driven by**: the roster seed at the next producer start (`seedCircleRoster`), which grants every member on the
  roster by their last join, so a grant that failed after the join stood is made then.

## Proof

- `apps/basis/test/keyGrantFollowsMembership.test.js`: three real agents, the real join and removeMember: a stale grant
  after a removal is dropped; a removed member's device is not enrolled while a member's is; the founder is in; a
  removed member re-invited on a new code gets the key; a status that cannot be read writes nothing.
- `packages/core/test/causalPlace.test.js`: after / before / concurrent / not held, and the fold's last exit and join
  by statement.
- `apps/basis/test/sharedPodJoinerOpensKey.relay.test.js`: through the app's join, the joiner opens the stored key.

## Decided, not built

- (none yet on this page)

## Open rows

- The audience check on the key owner's device (drops a holder the membership no longer has): its own row.

## Decisions that bind this area

- One sealing key family: a member's key is wrapped to the image of their proven per-circle address (2026-09-04).

<!-- catalogue-ops
pinboard: memberStatus
-->
