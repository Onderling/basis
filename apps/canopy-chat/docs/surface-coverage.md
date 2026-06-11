# Surface coverage — op × chat / slash / gate / web·mobile / inline

_chat = LLM tool · slash = /command · gate = deterministic NL verbs · web/mobile = screen (renderWeb ≡ renderMobile) · inline = button affordance_

| app | op | verb | chat | slash | gate | web/mobile | inline | gate verbs |
|---|---|---|---|---|---|---|---|---|
| **canopy-chat** | `help` | help | ✅ | ✅ | · | · | · |  |
|  | `feedback` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `feedback-stop` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `newthread` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `help-with` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `threads` | list | ✅ | ✅ | · | · | · |  |
|  | `startDm` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `embed` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `embed-file` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `embed-time` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `logs` | list | ✅ | ✅ | · | · | · |  |
|  | `scanQr` | list | ✅ | ✅ | · | · | · |  |
|  | `find` | list | ✅ | ✅ | · | · | · |  |
|  | `brief` | list | ✅ | ✅ | · | · | · |  |
|  | `signin` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `reset-thread` | remove | ✅ | ✅ | · | · | · |  |
|  | `whoami` | list | ✅ | ✅ | · | · | · |  |
|  | `me` | list | ✅ | ✅ | · | · | · |  |
|  | `send-file` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `lookup-peer` | list | ✅ | ✅ | · | · | · |  |
|  | `publish-nkn` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `rotate-identity` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `security-status` | list | ✅ | ✅ | · | · | · |  |
|  | `set-relay` | submit | ✅ | ✅ | · | · | · |  |
|  | `transport-mode` | submit | ✅ | ✅ | · | · | · |  |
|  | `transports` | list | ✅ | ✅ | · | · | · |  |
|  | `settings` | list | ✅ | ✅ | · | · | · |  |
|  | `mute` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `unmute` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `muted` | list | ✅ | ✅ | · | · | · |  |
|  | `debug-dump` | list | ✅ | ✅ | · | · | · |  |
|  | `audit-tail` | list | ✅ | ✅ | · | · | · |  |
|  | `peer-connect` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `test-peer` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `signout` | remove | ✅ | ✅ | · | · | · |  |
|  | `apps` | list | ✅ | ✅ | · | · | · |  |
|  | `sendto` | add | ✅ | ✅ | · | ✅ | · |  |
| **household** | `listOpen` | list | ✅ | ✅ | ✅ | · | · | list, show, mine, lijst, toon |
|  | `markComplete` | complete | ✅ | ✅ | ✅ | ✅ | ✅ | klaar met, done, complete, did, finished, bought, klaar, gedaan, gekocht |
|  | `getProfile` | list | ✅ | ✅ | · | · | · |  |
|  | `addMember` | add | ✅ | ✅ | ✅ | ✅ | · | register, add member, registreer, naam, lid toevoegen |
|  | `addChore` | add | ✅ | ✅ | ✅ | ✅ | · | add, new chore, toevoegen, noteer, voeg toe |
|  | `nudgePeer` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `removeChore` | remove | ✅ | ✅ | ✅ | · | · | remove, delete, nope, verwijder, weg |
|  | `getChoreSnapshot` | list | ✅ | · | · | · | · |  |
| **tasks** | `addTask` | add | ✅ | ✅ | ✅ | ✅ | · | add, todo, new task, voeg, zet, maak taak, nieuwe taak |
|  | `listMine` | list | ✅ | ✅ | · | · | · |  |
|  | `claimTask` | claim | ✅ | ✅ | ✅ | ✅ | ✅ | claim, pak, neem, i'll take, i'll do, ik pak, ik doe, ik neem |
|  | `completeTask` | complete | ✅ | ✅ | ✅ | ✅ | ✅ | klaar met, done with, done, complete, completed, finished, klaar, voltooid, gedaan |
|  | `editTask` | edit | ✅ | ✅ | · | ✅ | ✅ |  |
|  | `getTaskSnapshot` | list | ✅ | · | · | · | · |  |
|  | `provisionMyCrew` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `submitTask` | submit | ✅ | ✅ | ✅ | ✅ | ✅ | submit, hand in, indienen, inleveren, ter review |
|  | `approveTask` | approve | ✅ | ✅ | ✅ | ✅ | ✅ | approve, goedkeuren, akkoord |
|  | `rejectTask` | reject | ✅ | ✅ | ✅ | ✅ | ✅ | reject, afkeuren, afwijzen, weiger |
|  | `myInbox` | list | ✅ | ✅ | · | · | · |  |
|  | `getMyAvailability` | list | ✅ | ✅ | · | · | · |  |
|  | `setMyAvailability` | submit | ✅ | ✅ | · | · | · |  |
|  | `setAvailabilityOptIn` | submit | ✅ | ✅ | · | · | · |  |
|  | `suggestSchedule` | list | ✅ | ✅ | · | · | · |  |
|  | `acceptSchedule` | add | ✅ | ✅ | · | ✅ | ✅ |  |
|  | `getMyCrews` | list | ✅ | ✅ | · | · | · |  |
|  | `getCrewConfig` | list | ✅ | ✅ | · | · | · |  |
|  | `listCrewMembers` | list | ✅ | ✅ | · | · | · |  |
|  | `pauseCrew` | submit | ✅ | ✅ | · | · | · |  |
|  | `unpauseCrew` | submit | ✅ | ✅ | · | · | · |  |
|  | `archiveCrew` | remove | ✅ | ✅ | · | · | · |  |
|  | `unarchiveCrew` | submit | ✅ | ✅ | · | · | · |  |
|  | `issueInvite` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `redeemInvite` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `addSubtask` | add | ✅ | ✅ | · | ✅ | ✅ |  |
|  | `proposeSubtask` | add | ✅ | ✅ | · | ✅ | ✅ |  |
|  | `approveSubtaskRequest` | approve | ✅ | ✅ | · | ✅ | ✅ |  |
|  | `declineSubtaskRequest` | reject | ✅ | ✅ | · | ✅ | ✅ |  |
|  | `approveSubtaskProposal` | approve | ✅ | ✅ | · | ✅ | ✅ |  |
|  | `declineSubtaskProposal` | reject | ✅ | ✅ | · | ✅ | ✅ |  |
|  | `forceSpawnSubtask` | add | ✅ | ✅ | · | ✅ | · |  |
| **stoop** | `listFeed` | list | ✅ | ✅ | · | · | · |  |
|  | `postRequest` | add | ✅ | ✅ | ✅ | ✅ | · | post, ask, borrow, vraag, plaats, leen, bied aan |
|  | `getStoopProfile` | list | ✅ | ✅ | · | · | · |  |
|  | `revealPeer` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `respondToItem` | claim | ✅ | · | ✅ | ✅ | ✅ | help with, respond to, offer, ik help, help met, reageer op, bied hulp |
|  | `markReturned` | complete | ✅ | ✅ | ✅ | ✅ | ✅ | returned, teruggebracht, terug, mark returned |
|  | `startDm` | add | ✅ | · | · | ✅ | ✅ |  |
|  | `setHolidayMode` | submit | ✅ | ✅ | · | · | · |  |
|  | `getHolidayMode` | list | ✅ | ✅ | · | · | · |  |
|  | `listContacts` | list | ✅ | ✅ | · | · | · |  |
|  | `addContact` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `removeContact` | remove | ✅ | ✅ | · | ✅ | ✅ |  |
|  | `setContactTrust` | submit | ✅ | ✅ | · | · | · |  |
|  | `restoreFromMnemonicWizard` | submit | ✅ | ✅ | · | · | · |  |
|  | `conflictDisputeWizard` | add | ✅ | ✅ | · | ✅ | ✅ |  |
|  | `postAudienceWizard` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `encryptedBackupWizard` | list | ✅ | ✅ | · | · | · |  |
|  | `createGroupWizard` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `joinGroupWizard` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `getCurrentGroup` | list | ✅ | ✅ | · | · | · |  |
|  | `listGroupMembers` | list | ✅ | ✅ | · | · | · |  |
|  | `getGroupRules` | list | ✅ | ✅ | · | · | · |  |
|  | `leaveGroup` | remove | ✅ | ✅ | · | · | · |  |
|  | `getContactShareQr` | list | ✅ | ✅ | · | · | · |  |
|  | `assignLend` | reassign | ✅ | ✅ | · | · | · |  |
|  | `setMySkills` | set | ✅ | ✅ | · | · | · |  |
|  | `getItemTree` | tree | ✅ | ✅ | · | · | · |  |
|  | `signOutOfPod` | remove | ✅ | ✅ | · | ✅ | ✅ |  |
|  | `reportPost` | report | ✅ | ✅ | ✅ | ✅ | ✅ | report, rapporteer, flag |
|  | `listOpen` | list | ✅ | ✅ | · | · | · |  |
| **folio** | `readNote` | list | ✅ | ✅ | · | · | · |  |
|  | `shareFolder` | add | ✅ | ✅ | ✅ | ✅ | · | share, deel |
|  | `syncOnce` | add | ✅ | ✅ | ✅ | ✅ | · | sync, synchroniseer, synchroniseren |
|  | `watchStart` | add | ✅ | ✅ | ✅ | ✅ | · | watch, watch folder, let op, bewaak, bewaak map |
|  | `getFileSnapshot` | list | ✅ | · | · | · | · |  |
|  | `downloadFile` | list | ✅ | · | ✅ | ✅ | ✅ | download, haal, haal op, download bestand |
|  | `saveToMyPod` | add | ✅ | · | ✅ | ✅ | ✅ | save, bewaar, save to my pod, opslaan, bewaar in mijn pod |
|  | `folioStatus` | list | ✅ | ✅ | · | · | · |  |
|  | `listFiles` | list | ✅ | ✅ | · | · | · |  |
| **calendar** | `addEvent` | add | ✅ | ✅ | ✅ | ✅ | · | schedule, add event, new event, add appointment, new appointment, afspraak, plan, zet afspraak, nieuwe afspraak |
|  | `listEvents` | list | ✅ | ✅ | · | · | · |  |
|  | `rsvpAccept` | claim | ✅ | ✅ | ✅ | ✅ | ✅ | accept, accept invite, yes, accepteer, ja |
|  | `rsvpDecline` | reject | ✅ | ✅ | ✅ | ✅ | ✅ | decline, decline invite, no, wijs af, nee, ik kom niet |
|  | `rsvpTentative` | submit | ✅ | ✅ | ✅ | ✅ | ✅ | tentative, maybe, misschien, onder voorbehoud |
|  | `cancelEvent` | remove | ✅ | ✅ | ✅ | ✅ | ✅ | cancel event, cancel appointment, cancel, annuleer afspraak, annuleer, zeg af |
|  | `getEventSnapshot` | list | ✅ | · | · | · | · |  |
|  | `briefSummary` | list | ✅ | · | · | · | · |  |
|  | `searchEvents` | list | ✅ | · | · | · | · |  |
|  | `podStatus` | list | ✅ | ✅ | · | · | · |  |
|  | `getIcsFeed` | list | ✅ | ✅ | · | · | · |  |
|---|---|---|---|---|---|---|---|---|
| **totals** | 127 ops | | 127 | 117 | 25 | 62 | 27 | |

## Gaps for the gate/LLM + inline-menu work

- **missing gate** (102/127): canopy-chat:help, canopy-chat:feedback, canopy-chat:feedback-stop, canopy-chat:newthread, canopy-chat:help-with, canopy-chat:threads, canopy-chat:startDm, canopy-chat:embed, canopy-chat:embed-file, canopy-chat:embed-time, canopy-chat:logs, canopy-chat:scanQr, canopy-chat:find, canopy-chat:brief, canopy-chat:signin, canopy-chat:reset-thread, canopy-chat:whoami, canopy-chat:me, canopy-chat:send-file, canopy-chat:lookup-peer, canopy-chat:publish-nkn, canopy-chat:rotate-identity, canopy-chat:security-status, canopy-chat:set-relay, canopy-chat:transport-mode, canopy-chat:transports, canopy-chat:settings, canopy-chat:mute, canopy-chat:unmute, canopy-chat:muted, canopy-chat:debug-dump, canopy-chat:audit-tail, canopy-chat:peer-connect, canopy-chat:test-peer, canopy-chat:signout, canopy-chat:apps, canopy-chat:sendto, household:getProfile, household:nudgePeer, household:getChoreSnapshot …
- **missing inline** (100/127): canopy-chat:help, canopy-chat:feedback, canopy-chat:feedback-stop, canopy-chat:newthread, canopy-chat:help-with, canopy-chat:threads, canopy-chat:startDm, canopy-chat:embed, canopy-chat:embed-file, canopy-chat:embed-time, canopy-chat:logs, canopy-chat:scanQr, canopy-chat:find, canopy-chat:brief, canopy-chat:signin, canopy-chat:reset-thread, canopy-chat:whoami, canopy-chat:me, canopy-chat:send-file, canopy-chat:lookup-peer, canopy-chat:publish-nkn, canopy-chat:rotate-identity, canopy-chat:security-status, canopy-chat:set-relay, canopy-chat:transport-mode, canopy-chat:transports, canopy-chat:settings, canopy-chat:mute, canopy-chat:unmute, canopy-chat:muted, canopy-chat:debug-dump, canopy-chat:audit-tail, canopy-chat:peer-connect, canopy-chat:test-peer, canopy-chat:signout, canopy-chat:apps, canopy-chat:sendto, household:listOpen, household:getProfile, household:addMember …
- **missing chat** (0/127): 
