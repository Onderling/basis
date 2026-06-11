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
| **tasks** | `addTask` | add | ✅ | ✅ | ✅ | ✅ | · | add, todo, new task, voeg, zet, maak taak, nieuwe taak |
|  | `listMine` | list | ✅ | ✅ | · | · | · |  |
|  | `claimTask` | claim | ✅ | ✅ | ✅ | ✅ | ✅ | claim, pak, neem, i'll take, i'll do, ik pak, ik doe, ik neem |
|  | `completeTask` | complete | ✅ | ✅ | ✅ | ✅ | ✅ | klaar met, done with, done, complete, completed, finished, klaar, voltooid, gedaan |
|  | `editTask` | edit | ✅ | ✅ | · | ✅ | ✅ |  |
|  | `getTaskSnapshot` | list | ✅ | · | · | · | · |  |
|  | `provisionMyCrew` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `submitTask` | submit | ✅ | ✅ | · | ✅ | ✅ |  |
|  | `approveTask` | approve | ✅ | ✅ | · | ✅ | ✅ |  |
|  | `rejectTask` | reject | ✅ | ✅ | · | ✅ | ✅ |  |
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
|  | `postRequest` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `getStoopProfile` | list | ✅ | ✅ | · | · | · |  |
|  | `revealPeer` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `respondToItem` | claim | ✅ | · | · | ✅ | ✅ |  |
|  | `markReturned` | complete | ✅ | ✅ | ✅ | ✅ | ✅ | returned, teruggebracht, terug |
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
|  | `getItemTree` | tree | ✅ | ✅ | ✅ | · | · | tree, boom |
|  | `signOutOfPod` | remove | ✅ | ✅ | ✅ | ✅ | ✅ | sign-out, signout, uitloggen |
|  | `reportPost` | report | ✅ | ✅ | ✅ | ✅ | ✅ | report, rapporteer, flag |
|  | `listOpen` | list | ✅ | ✅ | ✅ | · | · | bulletin, board, posts, open, prikbord, buurt |
| **folio** | `readNote` | list | ✅ | ✅ | · | · | · |  |
|  | `shareFolder` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `syncOnce` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `watchStart` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `getFileSnapshot` | list | ✅ | · | · | · | · |  |
|  | `downloadFile` | list | ✅ | · | · | ✅ | ✅ |  |
|  | `saveToMyPod` | add | ✅ | · | · | ✅ | ✅ |  |
|  | `folioStatus` | list | ✅ | ✅ | · | · | · |  |
|  | `listFiles` | list | ✅ | ✅ | · | · | · |  |
| **household** | `addItem` | add | ✅ | ✅ | ✅ | ✅ | · | add, toevoegen, noteer, voeg toe |
|  | `listOpen` | list | ✅ | ✅ | ✅ | · | · | list, show, lijst, toon |
|  | `markComplete` | complete | ✅ | ✅ | ✅ | ✅ | ✅ | done, complete, bought, did, finished, klaar, gedaan, gekocht |
|  | `removeItem` | remove | ✅ | ✅ | ✅ | ✅ | ✅ | remove, delete, cancel, nope, verwijder, weg |
|  | `help` | help | ✅ | ✅ | ✅ | · | · | help, hulp |
|  | `addTask` | add | ✅ | ✅ | ✅ | ✅ | · | task, taak |
|  | `listTasks` | list | ✅ | ✅ | ✅ | · | · | tasks, taken |
|  | `claim` | claim | ✅ | ✅ | ✅ | ✅ | ✅ | claim, pak, neem |
|  | `reassign` | reassign | ✅ | · | · | · | · |  |
|  | `registerName` | register | ✅ | ✅ | ✅ | ✅ | · | register, registreer, naam |
|---|---|---|---|---|---|---|---|---|
| **totals** | 118 ops | | 118 | 111 | 17 | 59 | 25 | |

## Gaps for the gate/LLM + inline-menu work

- **missing gate** (101/118): canopy-chat:help, canopy-chat:feedback, canopy-chat:feedback-stop, canopy-chat:newthread, canopy-chat:help-with, canopy-chat:threads, canopy-chat:startDm, canopy-chat:embed, canopy-chat:embed-file, canopy-chat:embed-time, canopy-chat:logs, canopy-chat:scanQr, canopy-chat:find, canopy-chat:brief, canopy-chat:signin, canopy-chat:reset-thread, canopy-chat:whoami, canopy-chat:me, canopy-chat:send-file, canopy-chat:lookup-peer, canopy-chat:publish-nkn, canopy-chat:rotate-identity, canopy-chat:security-status, canopy-chat:set-relay, canopy-chat:transport-mode, canopy-chat:transports, canopy-chat:settings, canopy-chat:mute, canopy-chat:unmute, canopy-chat:muted, canopy-chat:debug-dump, canopy-chat:audit-tail, canopy-chat:peer-connect, canopy-chat:test-peer, canopy-chat:signout, canopy-chat:apps, canopy-chat:sendto, tasks:listMine, tasks:editTask, tasks:getTaskSnapshot …
- **missing inline** (93/118): canopy-chat:help, canopy-chat:feedback, canopy-chat:feedback-stop, canopy-chat:newthread, canopy-chat:help-with, canopy-chat:threads, canopy-chat:startDm, canopy-chat:embed, canopy-chat:embed-file, canopy-chat:embed-time, canopy-chat:logs, canopy-chat:scanQr, canopy-chat:find, canopy-chat:brief, canopy-chat:signin, canopy-chat:reset-thread, canopy-chat:whoami, canopy-chat:me, canopy-chat:send-file, canopy-chat:lookup-peer, canopy-chat:publish-nkn, canopy-chat:rotate-identity, canopy-chat:security-status, canopy-chat:set-relay, canopy-chat:transport-mode, canopy-chat:transports, canopy-chat:settings, canopy-chat:mute, canopy-chat:unmute, canopy-chat:muted, canopy-chat:debug-dump, canopy-chat:audit-tail, canopy-chat:peer-connect, canopy-chat:test-peer, canopy-chat:signout, canopy-chat:apps, canopy-chat:sendto, tasks:addTask, tasks:listMine, tasks:getTaskSnapshot …
- **missing chat** (0/118): 
