Found first: the invite verdict's fold in pinboard (`verdictWithRoster().memberStatus`: on the roster → member, else the membership lane's `lastExit`) answers "how did they last go" but not "after which admission". This PR reuses that same fold (`projectCircleRoster` + `observeFold`) through one new read op, `pinboard.memberStatus`, rather than a second fold. Stacked on #1227 (it uses the control agent's `isMember` from there).

## Why

A key change that adds someone (a join's grant recomputed after a lost race, the roster seed at a producer start, a stale event, a device's enrolment) could put back someone **removed meanwhile**. The key file's compare-and-swap (#1227) keeps concurrent writers from losing each other's changes; it does not know who is still a member.

## Membership first, the key follows

- **The order of a join** (`packages/circles` `circleMembershipWriters`): the redemption row, then the roster entry (MemberMap), then the signed `join` on the membership lane, **then** the key grant. That applies to the joiner's own redeem and to the admin confirming a remote joiner. The grant names the join as its admission (`admittedBy`, the join statement's hash). Before, the grant came between the MemberMap and the join, so a failed join append left a key holder who was no member.
  - Read in `docs/decisions.md` before moving it: grepped for the grant/join order (`grantKey`, "grant before join", "redeem … grant", "key follows"); no decision fixes the old order.
  - What ran between the MemberMap and the join, and does it need the key already? In the self redeem, nothing (the join was emitted right after). On the admin side, only the grant itself. The welcome and the first fan to the joiner run in the host's post-join step, after the writer returns, which is still after the grant.
  - The repeat-redeem branch (an idempotent second redeem of the same code) emits no new join; its grant names no admission and so asks against the member's last folded join.
- **`pinboard.memberStatus {groupId, webid, after?}`** returns `in`, `out` or `null`:
  - `out`: their last exit (leave or eviction) comes **after** `after` in the membership lane's causal order.
  - `in`: `after` is folded and no exit follows it.
  - `null`: it cannot be placed. Either `after` is not folded on this device, the exit is not held, or the exit and the admission are **concurrent** (neither saw the other). Fable's ruling: null is loud and nothing is written.
  - **Which order:** `causalPlace` (core, `rosterFold.js`) uses the ancestry of the statements' parents (each author's `parentHash` chain plus `deps`), the same answer on every device that has folded both. It never uses a clock, and never the fold's depth tiebreak: a greater depth alone does not make an act later.
  - With no `after`: the member's last folded join. Someone on the folded roster with no join at all was admitted by the circle's creation (a founder) or its seed, and is `in`.
  - The fold now names each subject's last exit and last join **by statement** (`lastExitBy`, `lastJoinBy`) beside `lastExit`.
- **Who asks:** the per-circle router (`createCircleControlAgentRouter(…, { memberStatusOf })`, read through the waist by `memberStatusReader`). It asks on **every** compute of a join's key change, and of a device's enrolment by its **owner** (the address announce now names `memberWebid`; a device of this device's own self asks nothing). `out` drops the change (the removal stands); `null` throws `MemberUnknownError`, writes nothing, and goes to the refusal log (`member-unknown`). Web, mobile and the relay harness compose it the same way; the box builds no circle producer.
- **Re-drive:** a grant that fails after the join stood is made by the roster seed at the next producer start (`seedCircleRoster` → `router.addMember` with no admission → the member's last join → `in`). Nothing sooner exists today. The test shows it: B and C join before the circle's producer exists (no key), and the producer's seed grants them.

## Tests (red first)

- `apps/basis/test/keyGrantFollowsMembership.test.js`: three real agents, the real join and the real `removeMember`.
  - A stale grant after a removal (the seed's call, no admission) does **not** put the member back. This failed without the router's `memberStatusOf`: "the stale grant did not put C back: expected true to be false".
  - A removed owner's new device is not enrolled; a member's device is.
  - The founder is `in`.
  - A removed member invited again on a **new** code (the old one refuses them: `removed-from-circle`) rejoins and holds the key.
  - A status that cannot be read writes nothing and logs `member-unknown`.
- `packages/core/test/causalPlace.test.js`: after, before, concurrent, not held, same; the fold's `lastExitBy` and `lastJoinBy`.
- The existing relay tests through the app's join (`sharedPodJoinerOpensKey`, `spineFromThePointSealed`, `appNoPodKeyRotationRealRemove`) still pass with the new order and the question.

Docs: `docs/catalogue/circles-and-pinboard.md` started (membership and its key; the op's block); `docs/architecture.md` §4 says the order; surface coverage regenerated.

Review before merge (keys + a new op).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
