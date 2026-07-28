# Web ↔ Mobile substrate-parity matrix (2026-05-24)

Output of task **#220** — first slice of the revised mobile roadmap
(`Project Files/basis/mobile-roadmap-2026-05-24.md`).

For every basis web feature, this matrix records:

- The substrate skill basis dispatches to (web side).
- Where the equivalent mobile screen lives — or that none exists.
- Whether the mobile screen calls the **same** substrate skill (the
  test of true parity) or a different/older one (semantic drift).
- The resulting gap, if any, and which slice it belongs in.

Methodology: grep + read of `apps/basis/src/web/realAgent.js`
for the web dispatcher; grep of `apps/<app>-mobile/src/screens/` for
the mobile calls. File:line citations are approximate (audit was
real-time; commits may have shifted line numbers by ±20).

## Headline

**~21/33 features are at full skill-level parity.** The remaining 12
split into:

- **Mobile UI gap, substrate exists** (#220.1, #220.2) — easy slices
  on existing apps.
- **Folio-mobile is a UI stub** (#220.3) — biggest concentrated gap;
  needs a slice-level decision (build it now vs. defer until
  basis-mobile under #222 carries the load).
- **Semantic mismatch** (#220.5 revealPeer, #220.6 stoop profile
  shape) — small cleanup slices.
- **Architecture-level deferrals** (#220.6 mesh fan-out, #220.7
  catch-up, #220.4 calendar) — out of scope for per-app screens;
  belong to basis-mobile (#222) or post-#222.

## Matrix

| # | Feature | Web skill | Web `file:line` (≈) | Mobile screen | Same skill? | Gap |
|---|---------|-----------|--------------------|---------------|-------------|-----|
| **Tasks** |
| 1 | addTask | `addTask` | realAgent.js:853 | `tasks-mobile/src/screens/ComposeScreen.jsx:53` | ✅ | — |
| 2 | claimTask | `claimTask` | realAgent.js:854 | `tasks-mobile/src/screens/TaskDetailScreen.jsx:127` | ✅ | — |
| 3 | completeTask | `completeTask` | realAgent.js:854 | `tasks-mobile/src/screens/TaskDetailScreen.jsx:128` | ✅ | — |
| 4 | submitTask | `submitTask` | realAgent.js:854 | `tasks-mobile/src/screens/SubmitScreen.jsx:50` | ✅ | — |
| 5 | approveTask / rejectTask | `approveTask`, `rejectTask` | realAgent.js:854 | `tasks-mobile/src/screens/ReviewScreen.jsx:111-112` | ✅ | — |
| 6 | editTask (#219) | `editTask` | realAgent.js:1138-1171 | **not found** | ✗ | **#220.1** |
| 7 | addSubtask | `addSubtask` | realAgent.js:854 | `tasks-mobile/src/screens/TaskDetailScreen.jsx:133` | ✅ | — |
| 8 | proposeSubtask + approve/decline proposal | `proposeSubtask`, `approveSubtaskProposal`, `declineSubtaskProposal` | realAgent.js:854 | `ComposeScreen.jsx:55` (propose), `InboxScreen.jsx:115-116` (approve/decline) | ✅ | — |
| 9 | approveSubtaskRequest + decline | `approveSubtaskRequest`, `declineSubtaskRequest` | realAgent.js:854 | `tasks-mobile/src/screens/InboxScreen.jsx:117-118` | ✅ | — |
| 10 | forceSpawnSubtask | `forceSpawnSubtask` | realAgent.js:854 | `tasks-mobile/src/screens/ComposeScreen.jsx:56` | ✅ | — |
| 11 | listMine / myInbox | `listMine`→`listOpen`, `myInbox`→`listMyInbox` | realAgent.js:621-627 | `InboxScreen.jsx`, `MyWorkScreen.jsx` (via adapter) | ✅ (via alias) | — |
| 12 | Circle controls (pause/unpause/archive/unarchive) | `pauseCircle`, `unpauseCircle`, `archiveCircle`, `unarchiveCircle` | realAgent.js:781-787 | `CreateCircleScreen.jsx:55` (provision only) | ⚠️ partial | **#220.2** |
| 13 | Invites (issue/redeem) | `issueInvite`, `redeemInvite` | realAgent.js:854 | `OnboardIssueScreen.jsx:51`, `OnboardScanScreen.jsx:45` | ✅ | — |
| 14 | Availability | `getMyAvailability`, `setMyAvailability` | realAgent.js:854 | `tasks-mobile/src/screens/AvailabilityScreen.jsx:33-34` | ✅ | — |
| 15 | Planner: suggest/acceptSchedule | `suggestSchedule`, `acceptSchedule` | realAgent.js:854 | `PlannerCards.jsx` (uses `useNativeCalendarLiveSync`) | ⚠️ different | **#220.4** |
| **Stoop** |
| 16 | postRequest / postOffer / postReport | `postRequest` (web stub for offer/report) | realAgent.js:975-1085 | `stoop-mobile/src/screens/PostComposeScreen.jsx:85` | ⚠️ partial | mobile only `postRequest`; web also stubs offer/report |
| 17 | listFeed / listOpen / listMyRequests | `listOpen` (aliased) | realAgent.js:884, 1550-1570 | `FeedScreen.jsx:46`, `MineScreen.jsx:31` | ✅ | — |
| 18 | respondToItem (Help with) | `respondToItem` | realAgent.js:854 | `stoop-mobile/src/screens/ItemDetailScreen.js:44` | ✅ | — |
| 19 | markReturned | `markReturned` | realAgent.js:900-901 | `stoop-mobile/src/screens/ItemDetailScreen.js:47` | ✅ | — |
| 20 | ContactBook (list/add/remove/setTrust) | `listContacts`, `addContact`, `removeContact`, `setContactTrust` | realAgent.js:914-1657 | `ContactsScreen.js:34-35`, `ContactScreen.js:60-64` | ✅ | — |
| 21 | Holiday mode | `setHolidayMode`, `getHolidayMode` | realAgent.js:903-1612 | `ProfileMineScreen.js` (set only) | ⚠️ partial | `getHolidayMode` not exposed in mobile UI |
| 22 | Groups (create/join/list/leave/members) | `createGroupV2`, `listGroupMembers`, `leaveGroup` | realAgent.js:941-974, 1672-1742 | `CreateGroupScreen.js:41`, `GroupScreen.js:33-36` | ✅ | — |
| 23 | revealPeer (bilateral) | `revealPeer`→`setPeerReveal` (toggle) | realAgent.js:658, 887-895 | `ChatThreadScreen.js:49` (uses `requestReveal`) | ⚠️ different | **#220.5** |
| 24 | getStoopProfile / setStoopProfile | `getStoopProfile`→`getMyProfile` alias | realAgent.js:658, 1574-1581 | `ProfileMineScreen.js:36` (`getMyProfile`) | ⚠️ shape drift | **#220.5** (related: setStoopProfile shape) |
| **Folio** |
| 25 | shareFolder | `shareFolder` | realAgent.js:1089-1098 | **not found** | ✗ | **#220.3** |
| 26 | saveToMyPod | `saveToMyPod` | realAgent.js:1089-1098 | **not found** | ✗ | **#220.3** |
| 27 | downloadFile | `downloadFile` | realAgent.js:1089-1098 | **not found** | ✗ | **#220.3** |
| 28 | listFiles / browseFolder | `listFiles` | realAgent.js:1089-1098 | **not found** | ✗ | **#220.3** |
| **Calendar** |
| 29 | Calendar invite (cross-peer) | `calendar_addEvent` via registerCalendarSkills | realAgent.js:179-188 | (native calendar only) | ✗ | **#220.4** |
| 30 | RSVP (accept/decline) | inferred from `calendar_*` skills | realAgent.js:179-188 | **not found** | ✗ | **#220.4** |
| **Cross-cutting** |
| 31 | DM threads (P2P chat) | `sendChatMessage`, `getChatThread` | realAgent.js:854 | tasks-mobile `ChatThreadScreen.jsx:46-48`; stoop-mobile `ChatThreadScreen.js:48-50` | ✅ (per-app context) | — |
| 32 | Mesh post fan-out (cross-instance) | `postRequest` → `sa.peer.sendTo()` + `listGroupRoster` | realAgent.js:995-1085 | **not implemented** | ✗ | **#220.6** (blocked on #223 NKN-on-RN) |
| 33 | Catch-up on reconnect (backfill) | `agent.on('item-arrive')` listener path | (substrate-side) | stoop-mobile `FeedScreen.js` has stub comment | ⚠️ unverified | **#220.7** |

## Gaps (candidate follow-ups)

The following sub-tasks under #220 should be filed as separate tasks
(or rolled into #222 / #223 as noted).

### #220.1 — `editTask` UI on tasks-mobile

`tasks-mobile/src/screens/TaskDetailScreen.jsx` has claim/complete/
submit branches but no `edit` mode. The substrate skill exists since
#219; mobile just needs an Edit affordance that opens the same
fields the web `/edit-task` slash exposes.

**Slice fit:** per-app screen addition. Could ship before #222.
**Est:** ~3–4h.

### #220.2 — Circle pause/unpause/archive/unarchive on tasks-mobile

`tasks-mobile/src/screens/CreateCircleScreen.jsx` handles provision
but `CircleSettingsScreen` (referenced in tasks-mobile routes) lacks
admin lifecycle toggles. Substrate skills exist; mobile needs the
UI toggles + permission gating.

**Slice fit:** per-app screen addition. Could ship before #222.
**Est:** ~3–4h.

### #220.3 — Folio-mobile substrate wiring (entire app stub)

`folio-mobile/src/screens/ShareScreen.js` is UI-only — no
`shareFolder` / `saveToMyPod` / `downloadFile` / `listFiles` calls
anywhere in folio-mobile. The substrate skills exist in the
browser-factory; folio-mobile just doesn't wire them.

**Slice fit:** decision needed.
- Option A: wire substrate now (~1 day) for parity.
- Option B: defer until basis-mobile (#222) composes folio
  via the shared factory, which makes folio-mobile's wiring less
  urgent (basis-mobile becomes the unified folio entry-point).
**Recommendation:** Option B — concentrates folio work into the
shared composition, avoids two separate folio UIs.

### #220.4 — Calendar substrate path on mobile

Web uses `registerCalendarSkills` from `@onderling-app/calendar`
(`calendar_addEvent` + RSVP). Mobile (tasks-mobile, stoop-mobile)
uses native calendar sync only (`useNativeCalendarLiveSync` etc.) —
no cross-peer invite/RSVP path.

**Slice fit:** design decision. Probably tasks-mobile should expose
BOTH native calendar (for personal scheduling) AND substrate
calendar (for cross-peer invites). Defer to a dedicated slice.
**Est:** ~1.5 days (per-app design + screens).

### #220.5 — revealPeer + Stoop profile shape drift

Two related semantic mismatches on stoop-mobile:
- `revealPeer` on web is a bilateral toggle (`setPeerReveal`);
  mobile uses unilateral `requestReveal`. UX implication: web
  semantics ("if I reveal AND you reveal, we both see") differ
  from mobile semantics ("I ask you to reveal").
- `getStoopProfile`/`setStoopProfile` shapes differ between web's
  `getMyProfile` alias and stoop-mobile's direct calls; web has no
  matching `setStoopProfile` (uses `setMyHandle`/`setMyDisplayName`
  pair instead).

**Slice fit:** alignment slice on stoop-mobile. Touches
`ChatThreadScreen.js` (reveal) + `ProfileMineScreen.js` (profile).
**Est:** ~4h.

### #220.6 — Mesh post fan-out on mobile

Web realAgent.js:995–1085 wires the fan-out via `sa.peer.sendTo()`
loop over `listGroupRoster`. Mobile has no peer-send because no
NKN transport. **Blocked on #223** (NKN-on-RN).

**Slice fit:** rolls into #222 (basis-mobile) once #223 ships.
Don't file as separate task.

### #220.7 — Catch-up backfill on mobile (verify or implement)

`stoop-mobile/src/screens/FeedScreen.js:5` comments an
`agent.on('item-arrive', ...)` listener but I didn't verify the
full backfill loop on reconnect. May be implemented further down
in the agent bundle (`agentBundle.js`).

**Slice fit:** verification first; if missing, ~half day to add.
**Est:** ~2h verify + ~4h implement-if-missing.

## What this tells us about #222 (basis-mobile)

The composition shell story holds up: most substrate skills are
already wired in the existing RN apps, so basis-mobile becomes
a unifying chat-shell over them rather than a re-implementation.

The hard work is:

1. **NKN-on-RN (#223)** — single biggest blocker; without it the
   mesh stories don't work on mobile.
2. **Folio-mobile gap (#220.3)** — folio is the weakest mobile app;
   basis-mobile can become its de-facto UI (composition
   reuses folio's substrate skills, which are intact even though
   folio-mobile doesn't surface them).
3. **renderMobile projector (#221)** — once shipped, the gaps in
   #220.1, #220.2, #220.5 might evaporate (the projector generates
   UI from the manifest, so any web ops with `surfaces.ui:button`
   automatically appear on mobile too).

## Things NOT in this audit

- Per-skill auth gates (admin/coord/member checks). Web realAgent
  delegates these to the substrate skills; mobile is assumed to
  match because it calls the same skills.
- Reply-shape adapters in realAgent.js:1113–1280 — these are
  web-basis conventions, not mobile concerns directly. They
  belong in the `src/core/` lift under #221.5.
- Pod sign-in flows — folio-mobile and stoop-mobile both have OIDC
  flows that differ from basis-web's. Onderling-mobile
  reuses one of those (open question).

---

**Memory references:**

- [[mobile-roadmap]] — full roadmap doc
- [[platform-parity]] — web ≡ mobile principle
- [[manifest-driven-surfaces-endgame]] — the long-game cure for most
  of these gaps
