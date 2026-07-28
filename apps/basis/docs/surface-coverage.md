# Surface coverage — op × chat / slash / gate / web·mobile / inline

_chat = LLM tool · slash = /command · gate = deterministic NL verbs · web/mobile = screen (renderWeb ≡ renderMobile) · inline = button affordance_

| app | op | verb | chat | slash | gate | attach | web/mobile | inline | gate verbs |
|---|---|---|---|---|---|---|---|---|---|
| **basis** | `help` | help | ✅ | ✅ | · | · | · | · |  |
|  | `newthread` | add | ✅ | ✅ | · | · | ✅ | · |  |
|  | `help-with` | add | ✅ | ✅ | · | · | ✅ | · |  |
|  | `threads` | list | ✅ | ✅ | · | · | · | · |  |
|  | `startDm` | add | ✅ | ✅ | · | · | ✅ | · |  |
|  | `embed` | add | ✅ | ✅ | · | ✅ | ✅ | · |  |
|  | `embed-file` | add | ✅ | ✅ | · | ✅ | ✅ | · |  |
|  | `embed-time` | add | ✅ | ✅ | · | ✅ | ✅ | · |  |
|  | `logs` | list | ✅ | ✅ | · | · | · | · |  |
|  | `scanQr` | list | ✅ | ✅ | · | · | · | · |  |
|  | `find` | list | ✅ | ✅ | · | · | · | · |  |
|  | `brief` | list | ✅ | ✅ | · | · | · | · |  |
|  | `compare` | list | ✅ | · | · | · | · | · |  |
|  | `signin` | add | ✅ | ✅ | · | · | ✅ | · |  |
|  | `reset-thread` | remove | ✅ | ✅ | · | · | · | · |  |
|  | `whoami` | list | ✅ | ✅ | · | · | · | · |  |
|  | `me` | list | ✅ | ✅ | · | · | ✅ | · |  |
|  | `send-file` | add | ✅ | ✅ | · | · | ✅ | · |  |
|  | `lookup-peer` | list | ✅ | ✅ | · | · | · | · |  |
|  | `publish-peer` | add | ✅ | ✅ | · | · | ✅ | · |  |
|  | `rotate-identity` | add | ✅ | ✅ | · | · | ✅ | · |  |
|  | `security-status` | list | ✅ | ✅ | · | · | · | · |  |
|  | `set-relay` | submit | ✅ | ✅ | · | · | ✅ | · |  |
|  | `transport-mode` | submit | ✅ | ✅ | · | · | · | · |  |
|  | `transports` | list | ✅ | ✅ | · | · | · | · |  |
|  | `settings` | list | ✅ | ✅ | · | · | ✅ | · |  |
|  | `mute` | add | ✅ | ✅ | · | · | ✅ | · |  |
|  | `unmute` | add | ✅ | ✅ | · | · | ✅ | · |  |
|  | `muted` | list | ✅ | ✅ | · | · | · | · |  |
|  | `debug-dump` | list | ✅ | ✅ | · | · | · | · |  |
|  | `audit-tail` | list | ✅ | ✅ | · | · | · | · |  |
|  | `peer-connect` | add | ✅ | ✅ | · | · | ✅ | · |  |
|  | `test-peer` | add | ✅ | ✅ | · | · | ✅ | · |  |
|  | `signout` | remove | ✅ | ✅ | · | · | · | · |  |
|  | `apps` | list | ✅ | ✅ | · | · | · | · |  |
|  | `sendto` | add | ✅ | ✅ | · | · | ✅ | · |  |
| **household** | `addItem` | add | ✅ | ✅ | ✅ | · | ✅ | · | add, toevoegen, noteer, voeg toe |
|  | `listOpen` | list | ✅ | ✅ | ✅ | · | · | · | list, show, lijst, toon |
|  | `markComplete` | complete | ✅ | ✅ | ✅ | · | ✅ | ✅ | done, complete, bought, did, finished, klaar, gedaan, gekocht |
|  | `removeItem` | remove | ✅ | ✅ | ✅ | · | ✅ | ✅ | remove, delete, cancel, nope, verwijder, weg |
|  | `help` | help | ✅ | ✅ | ✅ | · | · | · | help, hulp |
|  | `addTask` | add | ✅ | ✅ | ✅ | · | ✅ | · | task, taak |
|  | `listTasks` | list | ✅ | ✅ | ✅ | · | · | · | tasks, taken |
|  | `claim` | claim | ✅ | ✅ | ✅ | · | ✅ | ✅ | grab, oppakken |
|  | `reassign` | reassign | ✅ | · | · | · | · | · |  |
|  | `registerName` | register | ✅ | ✅ | ✅ | · | ✅ | · | register, registreer, naam |
| **tasks** | `addTask` | add | ✅ | ✅ | ✅ | · | ✅ | · | add, todo, new task, voeg, zet, maak taak, nieuwe taak |
|  | `claimTask` | claim | ✅ | ✅ | ✅ | · | ✅ | ✅ | claim, pak, neem, i'll take, i'll do, ik pak, ik doe, ik neem |
|  | `completeTask` | complete | ✅ | ✅ | ✅ | · | ✅ | ✅ | klaar met, done with, done, complete, completed, finished, klaar, voltooid, gedaan |
|  | `getTaskSnapshot` | list | ✅ | · | · | · | · | · |  |
|  | `removeTask` | remove | ✅ | · | · | · | · | · |  |
|  | `attachTaskGrant` | update | ✅ | · | · | · | ✅ | · |  |
|  | `reassignTask` | reassign | ✅ | · | · | · | · | · |  |
|  | `submitTask` | submit | ✅ | ✅ | ✅ | · | ✅ | ✅ | submit, hand in, indienen, inleveren, ter review |
|  | `approveTask` | approve | ✅ | ✅ | ✅ | · | ✅ | ✅ | approve, goedkeuren, akkoord |
|  | `rejectTask` | reject | ✅ | ✅ | ✅ | · | ✅ | ✅ | reject, afkeuren, afwijzen, weiger |
|  | `revokeTask` | revoke | ✅ | · | · | · | ✅ | ✅ |  |
|  | `listOpen` | list | ✅ | · | · | · | · | · |  |
|  | `listMine` | list | ✅ | ✅ | · | · | ✅ | · |  |
|  | `listClaimable` | list | ✅ | · | · | · | · | · |  |
|  | `listClaimConflicts` | list | ✅ | · | · | · | · | · |  |
|  | `resolveClaim` | reassign | ✅ | · | · | · | · | · |  |
|  | `listAwaitingApproval` | list | ✅ | · | · | · | · | · |  |
|  | `listMyMasteredTasks` | list | ✅ | · | · | · | · | · |  |
|  | `listMyInbox` | list | ✅ | · | · | · | · | · |  |
|  | `clearInboxItem` | remove | ✅ | · | · | · | ✅ | ✅ |  |
|  | `approveSubtaskRequest` | approve | ✅ | ✅ | · | · | ✅ | ✅ |  |
|  | `declineSubtaskRequest` | reject | ✅ | ✅ | · | · | ✅ | ✅ |  |
|  | `approveSubtaskProposal` | approve | ✅ | ✅ | · | · | ✅ | ✅ |  |
|  | `declineSubtaskProposal` | reject | ✅ | ✅ | · | · | ✅ | ✅ |  |
|  | `clearInbox` | remove | ✅ | · | · | · | ✅ | ✅ |  |
|  | `getDagTree` | tree | ✅ | · | · | · | · | · |  |
|  | `archiveCircle` | archive | ✅ | ✅ | · | · | ✅ | ✅ |  |
|  | `unarchiveCircle` | unarchive | ✅ | ✅ | · | · | ✅ | ✅ |  |
|  | `editTask` | edit | ✅ | ✅ | · | · | ✅ | ✅ |  |
|  | `provisionMyCircle` | add | ✅ | ✅ | · | · | ✅ | · |  |
|  | `myInbox` | list | ✅ | ✅ | · | · | · | · |  |
|  | `getMyAvailability` | list | ✅ | ✅ | · | · | · | · |  |
|  | `setMyAvailability` | submit | ✅ | ✅ | · | · | · | · |  |
|  | `setAvailabilityOptIn` | submit | ✅ | ✅ | · | · | · | · |  |
|  | `suggestSchedule` | list | ✅ | ✅ | · | · | · | · |  |
|  | `acceptSchedule` | add | ✅ | ✅ | · | · | ✅ | ✅ |  |
|  | `getMyCircles` | list | ✅ | ✅ | · | · | · | · |  |
|  | `listMyTasksAcrossCircles` | list | ✅ | ✅ | · | · | · | · |  |
|  | `getCircleConfig` | list | ✅ | ✅ | · | · | · | · |  |
|  | `listCircleMembers` | list | ✅ | ✅ | · | · | · | · |  |
|  | `pauseCircle` | submit | ✅ | ✅ | · | · | · | · |  |
|  | `unpauseCircle` | submit | ✅ | ✅ | · | · | · | · |  |
|  | `issueInvite` | add | ✅ | ✅ | · | · | ✅ | · |  |
|  | `redeemInvite` | add | ✅ | ✅ | · | · | ✅ | · |  |
|  | `addSubtask` | add | ✅ | ✅ | · | · | ✅ | ✅ |  |
|  | `proposeSubtask` | add | ✅ | ✅ | · | · | ✅ | ✅ |  |
|  | `forceSpawnSubtask` | add | ✅ | ✅ | · | · | ✅ | · |  |
| **stoop** | `postRequest` | add | ✅ | ✅ | ✅ | · | ✅ | · | post, ask, borrow, vraag, plaats, leen, bied aan |
|  | `listOpen` | list | ✅ | ✅ | · | · | · | · |  |
|  | `listMyRequests` | list | ✅ | ✅ | ✅ | · | · | · | mine, mijn |
|  | `respondToItem` | claim | ✅ | ✅ | ✅ | · | ✅ | ✅ | help with, respond to, offer, ik help, help met, reageer op, bied hulp |
|  | `cancelRequest` | remove | ✅ | ✅ | ✅ | · | ✅ | ✅ | withdraw, intrekken, annuleer |
|  | `assignLend` | reassign | ✅ | ✅ | · | · | · | · |  |
|  | `markReturned` | complete | ✅ | ✅ | ✅ | · | ✅ | ✅ | returned, teruggebracht, terug, mark returned |
|  | `reportPost` | report | ✅ | ✅ | ✅ | · | ✅ | ✅ | report, rapporteer, flag |
|  | `mutePeer` | mute | ✅ | ✅ | ✅ | · | · | · | mute, demp |
|  | `setMyOfferings` | set | ✅ | ✅ | · | · | · | · |  |
|  | `setMySkills` | set | ✅ | ✅ | · | · | · | · |  |
|  | `setPeerReveal` | set | ✅ | ✅ | · | · | · | · |  |
|  | `leaveGroup` | remove | ✅ | ✅ | · | · | · | · |  |
|  | `getItemTree` | tree | ✅ | ✅ | · | · | · | · |  |
|  | `signOutOfPod` | remove | ✅ | ✅ | · | · | ✅ | ✅ |  |
|  | `listFeed` | list | ✅ | ✅ | · | · | · | · |  |
|  | `getStoopProfile` | list | ✅ | ✅ | · | · | · | · |  |
|  | `startDm` | add | ✅ | · | · | · | ✅ | ✅ |  |
|  | `setHolidayMode` | submit | ✅ | ✅ | · | · | · | · |  |
|  | `getHolidayMode` | list | ✅ | ✅ | · | · | · | · |  |
|  | `listContacts` | list | ✅ | ✅ | · | · | · | · |  |
|  | `addContact` | add | ✅ | ✅ | · | · | ✅ | · |  |
|  | `removeContact` | remove | ✅ | ✅ | · | · | ✅ | ✅ |  |
|  | `setContactTrust` | submit | ✅ | ✅ | · | · | · | · |  |
|  | `getContactShareQr` | list | ✅ | ✅ | · | · | · | · |  |
|  | `restoreFromMnemonicWizard` | submit | ✅ | ✅ | · | · | ✅ | · |  |
|  | `conflictDisputeWizard` | add | ✅ | ✅ | · | · | ✅ | ✅ |  |
|  | `postAudienceWizard` | add | ✅ | ✅ | · | · | ✅ | · |  |
|  | `encryptedBackupWizard` | list | ✅ | ✅ | · | · | ✅ | · |  |
|  | `createGroupWizard` | add | ✅ | ✅ | · | · | ✅ | · |  |
|  | `joinGroupWizard` | add | ✅ | ✅ | · | · | ✅ | · |  |
|  | `getCurrentGroup` | list | ✅ | ✅ | · | · | · | · |  |
|  | `listGroupMembers` | list | ✅ | ✅ | · | · | · | · |  |
|  | `getGroupRules` | list | ✅ | ✅ | · | · | · | · |  |
| **folio** | `deleteFromPod` | remove | · | · | · | · | ✅ | ✅ |  |
|  | `deleteLocally` | remove | · | · | · | · | ✅ | ✅ |  |
|  | `forceRepush` | sync | · | · | · | · | ✅ | ✅ |  |
|  | `syncOnce` | sync | ✅ | ✅ | ✅ | · | ✅ | ✅ | sync, synchroniseer, synchroniseren |
|  | `watchStart` | watch | ✅ | ✅ | ✅ | · | ✅ | ✅ | watch, watch folder, let op, bewaak, bewaak map |
|  | `watchStop` | watch | ✅ | · | · | · | ✅ | ✅ |  |
|  | `verifyPodState` | read | ✅ | · | · | · | ✅ | ✅ |  |
|  | `readNote` | list | ✅ | ✅ | · | · | · | · |  |
|  | `shareFolder` | add | ✅ | ✅ | ✅ | · | ✅ | · | share, deel |
|  | `getFileSnapshot` | list | ✅ | · | · | · | · | · |  |
|  | `downloadFile` | list | ✅ | · | ✅ | · | ✅ | ✅ | download, haal, haal op, download bestand |
|  | `saveToMyPod` | add | ✅ | · | ✅ | · | ✅ | ✅ | save, bewaar, save to my pod, opslaan, bewaar in mijn pod |
|  | `folioStatus` | list | ✅ | ✅ | · | · | · | · |  |
|  | `listFiles` | list | ✅ | ✅ | · | · | · | · |  |
|  | `searchNotes` | list | ✅ | ✅ | ✅ | · | · | · | zoek, zoeken, search, find |
| **calendar** | `addEvent` | add | ✅ | ✅ | ✅ | · | ✅ | · | schedule, add event, new event, add appointment, new appointment, afspraak, plan, zet afspraak, nieuwe afspraak |
|  | `listEvents` | list | ✅ | ✅ | · | · | · | · |  |
|  | `rsvpAccept` | claim | ✅ | ✅ | ✅ | · | ✅ | ✅ | accept, accept invite, yes, accepteer, ja |
|  | `rsvpDecline` | reject | ✅ | ✅ | ✅ | · | ✅ | ✅ | decline, decline invite, no, wijs af, nee, ik kom niet |
|  | `rsvpTentative` | submit | ✅ | ✅ | ✅ | · | ✅ | ✅ | tentative, maybe, misschien, onder voorbehoud |
|  | `cancelEvent` | remove | ✅ | ✅ | ✅ | · | ✅ | ✅ | cancel event, cancel appointment, cancel, annuleer afspraak, annuleer, zeg af |
|  | `getEventSnapshot` | list | ✅ | · | · | · | · | · |  |
|  | `briefSummary` | list | ✅ | · | · | · | · | · |  |
|  | `searchEvents` | list | ✅ | · | · | · | · | · |  |
|  | `podStatus` | list | ✅ | ✅ | · | · | · | · |  |
|  | `getIcsFeed` | list | ✅ | ✅ | · | · | · | · |  |
| **agents** | `listAgents` | list | ✅ | ✅ | · | · | · | · |  |
|  | `viewAgent` | list | ✅ | · | · | · | · | · |  |
|  | `setAgentSkillExposure` | update | ✅ | ✅ | · | · | · | · |  |
|  | `getAgentSkillExposure` | list | ✅ | · | · | · | · | · |  |
|  | `createProfile` | add | ✅ | · | · | · | ✅ | ✅ |  |
|  | `setProfileProperty` | update | ✅ | · | · | · | · | · |  |
|  | `getProfileProperties` | get | ✅ | · | · | · | · | · |  |
|  | `setProfileDriver` | update | ✅ | · | · | · | · | · |  |
|  | `getProfileDrivers` | get | ✅ | · | · | · | · | · |  |
|  | `setProfileDisclosure` | update | ✅ | · | · | · | · | · |  |
|  | `getProfileDisclosure` | get | ✅ | · | · | · | · | · |  |
|  | `getPersonaView` | get | ✅ | · | · | · | · | · |  |
|  | `getPersonaRelease` | get | ✅ | · | · | · | · | · |  |
|  | `revokeAgent` | revoke | ✅ | · | · | · | ✅ | ✅ |  |
|  | `grantAgent` | update | ✅ | · | · | · | · | · |  |
|  | `grantRole` | update | ✅ | · | · | · | · | · |  |
|  | `revokeGrant` | revoke | ✅ | · | · | · | · | · |  |
|  | `purgeAgent` | remove | ✅ | · | · | · | ✅ | ✅ |  |
|  | `listCatalog` | list | ✅ | ✅ | · | · | · | · |  |
|  | `installAgent` | add | ✅ | · | · | · | ✅ | ✅ |  |
|  | `listDataVersions` | list | ✅ | · | · | · | · | · |  |
|  | `restoreDataVersion` | update | ✅ | · | · | · | ✅ | ✅ |  |
|---|---|---|---|---|---|---|---|---|---|
| **totals** | 175 ops | | 172 | 127 | 33 | 3 | 84 | 47 | |

## Gaps for the gate/LLM + inline-menu work

- **missing gate** (142/175): basis:help, basis:newthread, basis:help-with, basis:threads, basis:startDm, basis:embed, basis:embed-file, basis:embed-time, basis:logs, basis:scanQr, basis:find, basis:brief, basis:compare, basis:signin, basis:reset-thread, basis:whoami, basis:me, basis:send-file, basis:lookup-peer, basis:publish-peer, basis:rotate-identity, basis:security-status, basis:set-relay, basis:transport-mode, basis:transports, basis:settings, basis:mute, basis:unmute, basis:muted, basis:debug-dump, basis:audit-tail, basis:peer-connect, basis:test-peer, basis:signout, basis:apps, basis:sendto, household:reassign, tasks:getTaskSnapshot, tasks:removeTask, tasks:attachTaskGrant …
- **missing inline** (128/175): basis:help, basis:newthread, basis:help-with, basis:threads, basis:startDm, basis:embed, basis:embed-file, basis:embed-time, basis:logs, basis:scanQr, basis:find, basis:brief, basis:compare, basis:signin, basis:reset-thread, basis:whoami, basis:me, basis:send-file, basis:lookup-peer, basis:publish-peer, basis:rotate-identity, basis:security-status, basis:set-relay, basis:transport-mode, basis:transports, basis:settings, basis:mute, basis:unmute, basis:muted, basis:debug-dump, basis:audit-tail, basis:peer-connect, basis:test-peer, basis:signout, basis:apps, basis:sendto, household:addItem, household:listOpen, household:help, household:addTask …
- **missing chat** (3/175): folio:deleteFromPod, folio:deleteLocally, folio:forceRepush
