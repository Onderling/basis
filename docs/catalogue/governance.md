# Governance

Area: who decides in a circle, and how a decision is made, carried and checked. A removal, a role change, a rules
change, a settings change and a key rotation are GOVERNED actions: each follows the class the circle's policy names
for it. Reports ride the removal class. Started by Fable, 2026-11-13, from the code after the L663 work (the doors,
the receiver gate, the drawn sample). Core or module: **core** (the decision grammar lives in shared basis code and the
kernel's roster fold; every shell composes the same binding).

## What a person can do

- See the circle's open decisions, their tally and deadline, and vote where the class lets them (the Decisions
  screen, web and phone); see the settled ones as history.
- As an admin, set WHO DECIDES each governed action: one admin (`any-admin`), the admins together (`admin-quorum`, a
  majority of the admins; a single admin is the quorum), the whole circle (`member-vote`, a majority of all members),
  or, after the alpha, a few drawn members (`random-sample`, built and held back, see below). Who decides is itself a
  setting: changing it follows the settings class.
- Remove a member, make someone an admin or an admin a member again, change the rules, change a setting: each goes
  through the circle's rule. Where one admin may decide it is done at once (with a propose + resolve trail); otherwise
  a proposal opens and the screen says so. An admin may always step down from their OWN role; that never waits.
- Past a decision's deadline, an admin may decide a stuck member vote (the override).
- File a report on a post, a message or a member; the admins see it and may act on it (a member-target ban is a
  removal, under the removal class).
- See a change someone made WITHOUT the vote the circle requires: it is listed on the Decisions screen ("X changed the
  rules without the vote this circle requires. The change is not applied.") and no device applies it.
- When the last admin leaves, the circle passes to a caretaker computed from the log (every device names the same
  person; nobody is asked).
- Found a circle by answering the conflict question: "an admin decides" (the default) or "the circle votes"; the
  answer decides who removes members. ("Two random members mediate" returns with the drawn sample, after the alpha.)

## Where

- **The classes and the one rule:** `apps/basis/src/v2/circlePolicy.js` (`GOVERNANCE_ACTIONS`, `GOVERNANCE_CLASSES`,
  `DEFAULT_GOVERNANCE`, `decisionClassFor`; `changeRole` is decided by `changePolicy`'s class; `changeNeedsVote` is
  THE rule the doors and the receiving devices both ask, admins counted from the roster, an unread roster fails
  closed; `decisionSample` for the drawn sample).
- **Deciding:** `governanceDecision.js` (`resolveGovernance`, the tally per class; `drawSample` for `random-sample`,
  drawn with the caretaker succession order seeded by the proposal's hash, never the proposer or the member it is
  about), `governanceLog.js` (`foldGovernance` over the verified events), `governanceOrchestrator.js` (propose ·
  vote · override · tally · enact; an op that refuses closes the proposal as rejected; the deciding proposal's id
  rides into what is enacted), `governanceHost.js` (each action → its real op), `governanceView.js`.
- **The doors** (one per governed act, the same for web and phone): `governanceDoors.js` — `removeMemberDoor`,
  `changeRulesDoor` (with `readCircleRules` / `rulesForSave` over the circle's `group-rules` head), `changeRoleDoor`,
  `changeSettingsDoor`.
- **The binding:** `governanceAppWiring.js` `bindCircleGovernance` — ONE per shell (web `shellGovernance`, the phone
  launcher's binding passed to its screens); `policyEnactor` writes an enacted setting and states it on the lane;
  `view()` carries the refused changes.
- **The receiver gate:** `governanceReceiverGate.js` (`writeSkippedTheVote`, `gateCarriedWrites`,
  `refusedCarriedChanges`), applied in `rulesUpdateLane.js` `applyRulesUpdates` and `policyUpdateLane.js`
  `applyPolicyUpdates`; every shell (web, phone, box) hands them `readPolicy` and `membersOf`. A device trusts its own
  tally of the votes, never a recorded "approved" alone.
- **The membership gate:** a removal or a role change made without the vote the circle's rule asks takes effect on no
  member's device. `governanceReceiverGate.js` `membershipGateFor`, handed to the kernel's `foldRoster` as
  `governedGate` by pinboard's roster read (`membershipRead.governedGateFor`): no settings statement ever asked a vote →
  one fold as before; otherwise a two-pass read (the first pass gives the members the tally counts). Every removal,
  role change and rules change is stamped with the settings version its device had seen (`policyVersion`, at
  `membershipEmit` and the rules emitter, whichever path wrote it); an author's own later settings change draws its
  line through their own hash chain (`membershipUpTo`, `authorChainCut.js`), so what they signed before it keeps its
  stamp. Never asked for a person's own acts (leaving, stepping down, the caretaker's acknowledgement). Admissions
  (`join`) are not gated: the policy has no admission class yet.
  An author's stamps bind only that author: an admin who never stamps above an older settings version keeps being
  judged by it after ANOTHER admin tightened (no device can tell them from an honest admin who was offline); it is
  signed, attributable and shown. Two admins' settings at one version merge "who decides" strictest-first per act
  (member vote, then the admins together, then any one admin): `denyWinsMerge`'s governance order.
- **The roster and the caretaker:** `packages/core/src/security/rosterFold.js` (`foldRoster`, `caretakerOrder`),
  folded by pinboard's `deriveRoster`.
- **Screens:** web `apps/basis/web/v2/circleGovernancePanel.js`; phone `CircleGovernanceScreen.js`; the doors' callers
  in the settings, members and rules screens of both shells.
- **The create wizard:** `apps/basis/src/core/wizards/createGroupState.js` `policyPatchFromState` compiles the
  "decide together?" answer to the settings class and the conflict answer to the removal class (`CONFLICT_TO_CLASS`).

<!-- catalogue-ops
governance: governance.propose governance.vote governance.resolve governance.policyUpdate governance.rulesUpdate governance.reportFile governance.reportResolve
pinboard: removeMember setMemberRole editGroupRules recordGroupRulesUpdate getGroupRulesUpdateStatement broadcastCircleGovernance broadcastCircleRules
-->

## Proof

- The doors: `test/v2/governanceDoors.test.js` (removal), `governanceDoorRules.test.js` (rules), `governanceDoorRole.test.js`
  (roles), `settingsGateInForce.test.js` (the settings Save asks the rule in force, admins from the roster).
- One binding per shell, enacted settings stated on the lane: `test/fitness/governanceOneBindingPerShell.test.js`;
  an enacted removal is the whole removal: `test/fitness/governanceEnactsWholeRemoval.test.js`.
- The receiver gate: `governanceReceiverGate.test.js`, `receiverGateApplies.test.js` (a lone admin's change under
  admin-quorum is not applied; the voted one is), `test/fitness/receiverGateWiredInEveryShell.test.js`; refused
  changes shown: `refusedChangesShown.test.js`.
- The drawn sample and the wizard's answer: `randomSampleClass.test.js`.
- The membership gate: `membershipGate.test.js`, and walked with three real agents in
  `membershipGate.walk.test.js` (a lone removal under "admins decide together" holds on every device; under any-admin
  it removes; a removal made under any-admin stays after the circle tightens).
- The caretaker over a real relay: `test/v2/caretakerHandover.relay.test.js`; a removed member refused on every
  member's device: `removedMemberRefusedEverywhere.relay.test.js`; the classes and tallies:
  `governanceDecision.test.js`, `governanceHost.test.js`, `governanceOrchestrator.test.js`.

## Decided, not built

- **The drawn sample is held back for the alpha** (`DRAWN_SAMPLE_ENABLED = false`): its draw was seeded by the
  proposal's own hash (the proposer could re-word until it suits them) and drawn from the roster at fold time (an
  admitting admin could steer it). No circle can hold the class until the fixed draw is in: each eligible member's
  device signs a fixed message over the proposal (a value nobody can vary), the seed covers ALL eligible members of the
  roster frozen at the proposal. The decision code is built and tested.
- **A decision is judged by the policy in force on the receiving device**, not the policy at the time it was made.
- **Polls with a real circle effect** (a typed poll item whose outcome is told or enacts a governed action): L737.

## Open rows

- L663 (the build: the membership gate, the last admin's step-down prompt) · L845 (the wizard's default conflict
  answer, Frits) · L843 (retire the old rules-broadcast path) · L737 (polls).

## Decisions that bind this area

- `docs/decisions.md` 2026-07-25 "L4 governance" (decision classes; a removal by an admin and by a vote are one action
  under two classes) and "Last-admin" (the caretaker, computed from the log).
- Frits 2026-11-10 (L663): the mediation made real as a reusable drawn sample; role changes follow the settings class;
  a write that skipped the vote is kept and shown, never applied; an admin may step down at any time.
