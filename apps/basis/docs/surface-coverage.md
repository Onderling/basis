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
|  | `listTasks` | list | ✅ | ✅ | ✅ | · | · | · | tasks, tasks |
|  | `claim` | claim | ✅ | ✅ | ✅ | · | ✅ | ✅ | grab, oppakken |
|  | `reassign` | reassign | ✅ | · | · | · | · | · |  |
|  | `registerName` | register | ✅ | ✅ | ✅ | · | ✅ | · | register, registreer, naam |
|  | `revokeDevice` | revoke-device | · | · | · | · | · | · |  |
|  | `enrollDevice` | enroll-device | · | · | · | · | · | · |  |
|  | `buildEnrollOffer` | get | · | · | · | · | · | · |  |
|  | `revealOwnerPhrase` | reveal-owner-phrase | · | · | · | · | · | · |  |
|  | `restoreOwnerPhrase` | restore-owner-phrase | · | · | · | · | · | · |  |
|  | `grantSurface` | grant-surface | · | · | · | · | · | · |  |
|  | `revokeSurface` | revoke-surface | · | · | · | · | · | · |  |
|  | `listSurfaceGrants` | list-surface-grants | · | · | · | · | · | · |  |
| **tasks** | `addTask` | add | ✅ | ✅ | ✅ | · | ✅ | · | add, todo, new task, voeg, zet, maak taak, nieuwe taak |
|  | `claimTask` | claim | ✅ | ✅ | ✅ | · | ✅ | ✅ | claim, pak, neem, i'll take, i'll do, ik pak, ik doe, ik neem |
|  | `confirmClaim` | confirm | ✅ | ✅ | ✅ | · | ✅ | ✅ | confirm, bevestig, keur, keur goed, ken toe |
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
|  | `listMyPendingClaims` | list | ✅ | · | · | · | · | · |  |
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
|  | `acceptGroupRules` | add | ✅ | · | · | · | ✅ | ✅ |  |
|  | `addMyOffering` | add | ✅ | · | · | · | ✅ | ✅ |  |
|  | `removeMyOffering` | remove | ✅ | · | · | · | ✅ | ✅ |  |
|  | `listMyOfferings` | list | ✅ | · | · | · | ✅ | · |  |
|  | `listOfferingCategories` | list | ✅ | · | · | · | ✅ | · |  |
|  | `setMyLocation` | add | ✅ | · | · | · | ✅ | ✅ |  |
|  | `clearMyLocation` | remove | ✅ | · | · | · | ✅ | ✅ |  |
|  | `getMyLocation` | list | ✅ | · | · | · | ✅ | · |  |
|  | `geocode` | list | ✅ | · | · | · | ✅ | ✅ |  |
|  | `getDataLocation` | list | ✅ | · | · | · | ✅ | · |  |
|  | `setMyHandle` | set | ✅ | · | · | · | ✅ | ✅ |  |
|  | `setMyDisplayName` | set | ✅ | · | · | · | ✅ | ✅ |  |
|  | `listMyHandles` | list | ✅ | · | · | · | ✅ | · |  |
|  | `getMyProfile` | list | ✅ | · | · | · | ✅ | · |  |
|  | `getInterestProfile` | list | ✅ | · | · | · | ✅ | · |  |
|  | `recordMemberPersonaProperties` | set | ✅ | · | · | · | ✅ | · |  |
|  | `subscribeWebPush` | add | ✅ | · | · | · | ✅ | ✅ |  |
|  | `unsubscribeWebPush` | remove | ✅ | · | · | · | ✅ | ✅ |  |
|  | `subscribeExpoPush` | add | ✅ | · | · | · | ✅ | ✅ |  |
|  | `unsubscribeExpoPush` | remove | ✅ | · | · | · | ✅ | ✅ |  |
|  | `getVapidPublicKey` | list | ✅ | · | · | · | ✅ | · |  |
|  | `getCircleStoragePolicy` | list | ✅ | · | · | · | ✅ | · |  |
|  | `setCircleStoragePolicy` | set | ✅ | · | · | · | ✅ | ✅ |  |
|  | `podSignInStatus` | list | ✅ | · | · | · | ✅ | · |  |
|  | `encryptedBackup` | list | ✅ | · | · | · | ✅ | ✅ |  |
|  | `restoreFromMnemonic` | set | ✅ | · | · | · | ✅ | ✅ |  |
|  | `listMyCircles` | list | ✅ | · | · | · | ✅ | · |  |
|  | `listCirclePostsSince` | list | ✅ | · | · | · | ✅ | · |  |
|  | `listCircleChats` | list | ✅ | · | · | · | ✅ | · |  |
|  | `getLatestPostAddedAt` | list | ✅ | · | · | · | ✅ | · |  |
|  | `listConsentingPeers` | list | ✅ | · | · | · | ✅ | · |  |
|  | `getPrivacyNotice` | list | ✅ | · | · | · | ✅ | · |  |
|  | `getMetrics` | list | ✅ | · | · | · | ✅ | · |  |
|  | `createGroupV2` | add | ✅ | · | · | · | ✅ | · |  |
|  | `redeemMembershipCode` | submit | ✅ | · | · | · | ✅ | · |  |
|  | `verifyMembershipCodeForPeer` | confirm | ✅ | · | · | · | ✅ | · |  |
|  | `recordRemoteRedemption` | add | ✅ | · | · | · | ✅ | · |  |
|  | `setMemberRole` | update | ✅ | · | · | · | ✅ | · |  |
|  | `removeMember` | remove | ✅ | · | · | · | ✅ | ✅ |  |
|  | `listGroupRoster` | list | ✅ | · | · | · | ✅ | · |  |
|  | `getCurrentMembershipCode` | get | ✅ | · | · | · | ✅ | · |  |
|  | `rotateMyGroupCode` | revoke | ✅ | · | · | · | ✅ | ✅ |  |
|  | `editGroupRules` | update | ✅ | · | · | · | ✅ | · |  |
|  | `recordGroupRulesUpdate` | update | ✅ | · | · | · | ✅ | · |  |
|  | `recordRosterSeed` | update | ✅ | · | · | · | ✅ | · |  |
|  | `getGroupRulesUpdateStatement` | get | ✅ | · | · | · | ✅ | · |  |
|  | `postAnnouncement` | add | ✅ | · | · | · | ✅ | ✅ |  |
|  | `whoAmI` | get | ✅ | · | · | · | ✅ | · |  |
|  | `recordPeerIntro` | add | ✅ | · | · | · | ✅ | · |  |
|  | `addContactFromQr` | add | ✅ | · | · | · | ✅ | ✅ |  |
|  | `acceptResponder` | confirm | ✅ | · | · | · | ✅ | ✅ |  |
|  | `listMutedPeers` | list | ✅ | · | · | · | ✅ | · |  |
|  | `unmutePeer` | mute | ✅ | · | · | · | ✅ | ✅ |  |
|  | `broadcastCircleGovernance` | share | ✅ | · | · | · | ✅ | · |  |
|  | `broadcastCircleKeyStatement` | share | ✅ | · | · | · | ✅ | · |  |
|  | `broadcastCircleMembership` | share | ✅ | · | · | · | ✅ | · |  |
|  | `broadcastCircleChatStatement` | share | ✅ | · | · | · | ✅ | · |  |
|  | `broadcastCircleTask` | share | ✅ | · | · | · | ✅ | · |  |
|  | `broadcastCirclePolicy` | share | ✅ | · | · | · | ✅ | · |  |
|  | `broadcastCircleRules` | share | ✅ | · | · | · | ✅ | · |  |
|  | `broadcastCircleRecipe` | share | ✅ | · | · | · | ✅ | · |  |
|  | `broadcastCircleAddresses` | share | ✅ | · | · | · | ✅ | · |  |
|  | `recordCircleAddressAnnouncement` | add | ✅ | · | · | · | ✅ | · |  |
|  | `ingestCircleMessage` | add | ✅ | · | · | · | ✅ | · |  |
|  | `ingestRemotePost` | add | ✅ | · | · | · | ✅ | · |  |
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
|  | `setProfileCircleMembership` | update | ✅ | · | · | · | · | · |  |
|  | `setProfileDisclosure` | update | ✅ | · | · | · | · | · |  |
|  | `getProfileDisclosure` | get | ✅ | · | · | · | · | · |  |
|  | `getPersonaView` | get | ✅ | · | · | · | · | · |  |
|  | `getPersonaRelease` | get | ✅ | · | · | · | · | · |  |
|  | `revokeAgent` | revoke | ✅ | · | · | · | ✅ | ✅ |  |
|  | `grantAgent` | update | ✅ | · | · | · | · | · |  |
|  | `grantRole` | update | ✅ | · | · | · | · | · |  |
|  | `revokeGrant` | revoke | ✅ | · | · | · | · | · |  |
|  | `purgeAgent` | remove | ✅ | · | · | · | ✅ | ✅ |  |
|  | `listCatalogue` | list | ✅ | ✅ | · | · | · | · |  |
|  | `installAgent` | add | ✅ | · | · | · | ✅ | ✅ |  |
|  | `listDataVersions` | list | ✅ | · | · | · | · | · |  |
|  | `restoreDataVersion` | update | ✅ | · | · | · | ✅ | ✅ |  |
| **params** | `set-param` | set-param | · | · | · | · | · | · |  |
|  | `get-param` | get-param | · | · | · | · | · | · |  |
|  | `list-user-params` | list-user-params | · | · | · | · | · | · |  |
|  | `restore-probe` | restore-probe | · | · | · | · | · | · |  |
|  | `restore-merge` | restore-merge | · | · | · | · | · | · |  |
|  | `restore-resolve-mismatch` | restore-resolve-mismatch | · | · | · | · | · | · |  |
|---|---|---|---|---|---|---|---|---|---|
| **totals** | 257 ops | | 240 | 128 | 34 | 3 | 150 | 69 | |

### Flows

| app | flow | kind | scope | steps | declared effects |
|---|---|---|---|---|---|
| **household** | `enroll-device` | ceremony | device | 1 | overwrite:owner-root, write:device-delegation, write:registry |
|  | `revoke-device` | ceremony | device | 1 | write:registry, send:circle-address-revoke |
| **stoop** | `joinGroup` | wizard | device | 3 |  |
| **params** | `restore-settings` | ceremony | device | 3 | write:settings, overwrite:pod-settings |

## Gaps for the gate/LLM + inline-menu work

- **missing gate** (223/257): basis:help, basis:newthread, basis:help-with, basis:threads, basis:startDm, basis:embed, basis:embed-file, basis:embed-time, basis:logs, basis:scanQr, basis:find, basis:brief, basis:compare, basis:signin, basis:reset-thread, basis:whoami, basis:me, basis:send-file, basis:lookup-peer, basis:publish-peer, basis:rotate-identity, basis:security-status, basis:set-relay, basis:transport-mode, basis:transports, basis:settings, basis:mute, basis:unmute, basis:muted, basis:debug-dump, basis:audit-tail, basis:peer-connect, basis:test-peer, basis:signout, basis:apps, basis:sendto, household:reassign, household:revokeDevice, household:enrollDevice, household:buildEnrollOffer …
- **missing inline** (188/257): basis:help, basis:newthread, basis:help-with, basis:threads, basis:startDm, basis:embed, basis:embed-file, basis:embed-time, basis:logs, basis:scanQr, basis:find, basis:brief, basis:compare, basis:signin, basis:reset-thread, basis:whoami, basis:me, basis:send-file, basis:lookup-peer, basis:publish-peer, basis:rotate-identity, basis:security-status, basis:set-relay, basis:transport-mode, basis:transports, basis:settings, basis:mute, basis:unmute, basis:muted, basis:debug-dump, basis:audit-tail, basis:peer-connect, basis:test-peer, basis:signout, basis:apps, basis:sendto, household:addItem, household:listOpen, household:help, household:addTask …
- **missing chat** (17/257): household:revokeDevice, household:enrollDevice, household:buildEnrollOffer, household:revealOwnerPhrase, household:restoreOwnerPhrase, household:grantSurface, household:revokeSurface, household:listSurfaceGrants, folio:deleteFromPod, folio:deleteLocally, folio:forceRepush, params:set-param, params:get-param, params:list-user-params, params:restore-probe, params:restore-merge, params:restore-resolve-mismatch
