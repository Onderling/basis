# Surface coverage — op × chat / slash / gate / web·mobile / inline

_chat = LLM tool · slash = /command · gate = deterministic NL verbs · web/mobile = screen (renderWeb ≡ renderMobile) · inline = button affordance_

| app | op | verb | chat | slash | gate | attach | web/mobile | inline | gate verbs |
|---|---|---|---|---|---|---|---|---|---|
| **basis** | `help` | help | ✅ | ✅ | · | · | · | · |  |
|  | `help-with` | add | ✅ | ✅ | · | · | ✅ | · |  |
|  | `embed` | add | ✅ | ✅ | · | · | ✅ | ✅ |  |
|  | `embed-file` | add | ✅ | ✅ | · | ✅ | ✅ | · |  |
|  | `embed-time` | add | ✅ | ✅ | · | ✅ | ✅ | · |  |
|  | `logs` | list | ✅ | ✅ | · | · | · | · |  |
|  | `feedback` | get | ✅ | ✅ | · | ✅ | · | · |  |
|  | `scanQr` | list | ✅ | ✅ | · | · | · | · |  |
|  | `find` | list | ✅ | ✅ | · | · | · | · |  |
|  | `brief` | list | ✅ | ✅ | · | · | · | · |  |
|  | `signin` | add | · | ✅ | · | · | ✅ | · |  |
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
|  | `signout` | remove | · | ✅ | · | · | · | · |  |
|  | `screen-add-page` | add | · | ✅ | · | · | ✅ | · |  |
|  | `screen-remove-page` | remove | · | ✅ | · | · | · | · |  |
|  | `screen-rename-page` | update | · | ✅ | · | · | · | · |  |
|  | `screen-set-active` | update | · | ✅ | · | · | · | · |  |
|  | `screen-set-personas` | update | · | ✅ | · | · | · | · |  |
|  | `screen-set-circles` | update | · | ✅ | · | · | · | · |  |
|  | `screen-pin` | add | · | ✅ | · | · | ✅ | · |  |
|  | `screen-unpin` | remove | · | ✅ | · | · | · | · |  |
|  | `screen-add-block` | add | · | ✅ | · | · | ✅ | · |  |
|  | `screen-remove-block` | remove | · | ✅ | · | · | · | · |  |
|  | `screen-move-block` | move | · | ✅ | · | · | · | · |  |
|  | `screen-set-block-config` | update | · | ✅ | · | · | · | · |  |
|  | `screen-undo` | undo | · | ✅ | · | · | · | · |  |
| **tasks** | `addTask` | add | ✅ | ✅ | ✅ | ✅ | ✅ | · | add, todo, new task, voeg, zet, maak taak, nieuwe taak |
|  | `claimTask` | claim | ✅ | ✅ | ✅ | · | ✅ | ✅ | claim, i'll take, i'll do, pak, neem, ik pak, ik doe, ik neem |
|  | `confirmClaim` | confirm | ✅ | ✅ | ✅ | · | ✅ | ✅ | confirm, bevestig, keur, keur goed, ken toe |
|  | `completeTask` | complete | ✅ | ✅ | ✅ | · | ✅ | ✅ | done with, done, complete, completed, finished, klaar met, klaar, voltooid, gedaan |
|  | `removeTask` | remove | ✅ | · | · | · | · | · |  |
|  | `attachTaskGrant` | update | ✅ | · | · | · | ✅ | · |  |
|  | `reassignTask` | reassign | ✅ | · | · | · | · | · |  |
|  | `submitTask` | submit | ✅ | ✅ | ✅ | · | ✅ | ✅ | submit, hand in, indienen, inleveren, ter review |
|  | `approveTask` | approve | ✅ | ✅ | ✅ | · | ✅ | ✅ | approve, goedkeuren, akkoord |
|  | `rejectTask` | reject | ✅ | ✅ | ✅ | · | ✅ | ✅ | reject, afkeuren, afwijzen, weiger |
|  | `revokeTask` | revoke | ✅ | · | · | · | ✅ | ✅ |  |
|  | `listOpen` | list | ✅ | ✅ | · | · | · | · |  |
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
| **household** | `addItem` | add | ✅ | ✅ | ✅ | · | ✅ | · | add, toevoegen, noteer, voeg toe |
|  | `listOpenItems` | list | ✅ | ✅ | ✅ | · | · | · | list, show, lijst, toon |
|  | `markComplete` | complete | ✅ | ✅ | ✅ | · | ✅ | ✅ | done, complete, bought, did, finished, klaar, gedaan, gekocht |
|  | `removeItem` | remove | ✅ | ✅ | ✅ | · | ✅ | ✅ | remove, delete, cancel, nope, verwijder, weg |
|  | `registerName` | register | ✅ | ✅ | ✅ | · | ✅ | · | register, registreer, naam |
|  | `revokeDevice` | revoke-device | · | · | · | · | · | · |  |
|  | `pairCirclePeer` | pair-peer | · | · | · | · | · | · |  |
|  | `stashEnrollOffer` | stash-enroll-offer | · | · | · | · | · | · |  |
|  | `bindCirclePersona` | bind-circle-persona | · | · | · | · | · | · |  |
|  | `claimCompanion` | claim-companion | · | · | · | · | · | · |  |
|  | `companionGrantChoices` | list-companion-grants | · | · | · | · | · | · |  |
|  | `grantCompanion` | grant-companion | · | · | · | · | · | · |  |
|  | `companionGrantList` | read-companion-grants | · | · | · | · | · | · |  |
|  | `revokeCompanionGrant` | revoke-companion-grant | · | · | · | · | · | · |  |
|  | `listRecoveryCircles` | list-recovery-circles | · | · | · | · | · | · |  |
|  | `exportRecoveryFile` | export-recovery-file | · | · | · | · | · | · |  |
|  | `listReceivablePersonas` | list | · | · | · | · | · | · |  |
|  | `removePersonaHere` | remove-persona | · | · | · | · | · | · |  |
|  | `setNearbyLevel` | set-nearby-level | · | · | · | · | · | · |  |
|  | `listPersonasHere` | list | · | ✅ | · | · | · | · |  |
|  | `pausePersona` | pause-persona | · | ✅ | · | · | · | · |  |
|  | `resumePersona` | resume-persona | · | ✅ | · | · | · | · |  |
|  | `receivePersonas` | receive-personas | · | · | · | · | · | · |  |
|  | `importRecoveryFile` | import-recovery-file | · | · | · | · | · | · |  |
|  | `restoreStatus` | restore-status | · | · | · | · | · | · |  |
|  | `restoreSource` | restore-source | · | · | · | · | · | · |  |
|  | `restoreIntent` | restore-intent | · | · | · | · | · | · |  |
|  | `replaceDevice` | replace-device | · | · | · | · | · | · |  |
|  | `enrollDevice` | enroll-device | · | · | · | · | · | · |  |
|  | `buildEnrollOffer` | get | · | · | · | · | · | · |  |
|  | `revealOwnerPhrase` | reveal-owner-phrase | · | · | · | · | · | · |  |
|  | `restoreOwnerPhrase` | restore-owner-phrase | · | · | · | · | · | · |  |
|  | `restoreFromMnemonicWizard` | submit | ✅ | ✅ | · | · | ✅ | · |  |
|  | `grantSurface` | grant-surface | · | · | · | · | · | · |  |
|  | `revokeSurface` | revoke-surface | · | · | · | · | · | · |  |
|  | `listSurfaceGrants` | list-surface-grants | · | · | · | · | · | · |  |
| **pinboard** | `postRequest` | add | ✅ | ✅ | ✅ | · | ✅ | · | post, ask, borrow, vraag, plaats, leen, bied aan |
|  | `listOpenRequests` | list | ✅ | ✅ | · | · | · | · |  |
|  | `listMyRequests` | list | ✅ | ✅ | ✅ | · | · | · | mine, mijn |
|  | `respondToItem` | claim | ✅ | ✅ | ✅ | · | ✅ | ✅ | help with, respond to, offer, ik help, help met, reageer op, bied hulp |
|  | `cancelRequest` | remove | ✅ | ✅ | ✅ | · | ✅ | ✅ | withdraw, intrekken, annuleer |
|  | `assignLend` | reassign | ✅ | ✅ | · | · | · | · |  |
|  | `markReturned` | complete | ✅ | ✅ | ✅ | · | ✅ | ✅ | returned, mark returned, teruggebracht, terug |
|  | `leaveGroup` | remove | ✅ | ✅ | · | · | · | · |  |
|  | `getItemTree` | tree | ✅ | ✅ | · | · | · | · |  |
|  | `signOutOfPod` | remove | ✅ | ✅ | · | · | ✅ | ✅ |  |
|  | `listFeed` | list | ✅ | ✅ | · | · | · | · |  |
|  | `getPinboardProfile` | list | ✅ | ✅ | · | · | · | · |  |
|  | `startDm` | add | ✅ | · | · | · | ✅ | ✅ |  |
|  | `setHolidayMode` | submit | ✅ | ✅ | · | · | · | · |  |
|  | `getHolidayMode` | list | ✅ | ✅ | · | · | · | · |  |
|  | `listContacts` | list | ✅ | ✅ | · | · | · | · |  |
|  | `addContact` | add | ✅ | ✅ | · | · | ✅ | · |  |
|  | `setContactTrust` | submit | ✅ | ✅ | · | · | · | · |  |
|  | `setContactHidden` | submit | ✅ | ✅ | · | · | ✅ | ✅ |  |
|  | `setContactPersona` | submit | ✅ | ✅ | · | · | ✅ | · |  |
|  | `setContactPersonKey` | submit | ✅ | · | · | · | ✅ | · |  |
|  | `getContactShareQr` | list | ✅ | ✅ | · | · | · | · |  |
|  | `conflictDisputeWizard` | add | ✅ | ✅ | · | · | ✅ | ✅ |  |
|  | `postAudienceWizard` | add | ✅ | ✅ | · | · | ✅ | · |  |
|  | `createGroupWizard` | add | ✅ | ✅ | · | · | ✅ | · |  |
|  | `joinGroupWizard` | add | ✅ | ✅ | · | · | ✅ | · |  |
|  | `getCurrentGroup` | list | ✅ | ✅ | · | · | · | · |  |
|  | `listGroupMembers` | list | ✅ | ✅ | · | · | · | · |  |
|  | `getGroupRules` | list | ✅ | ✅ | · | · | · | · |  |
|  | `acceptGroupRules` | add | ✅ | · | · | · | ✅ | ✅ |  |
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
|  | `subscribeWebPush` | add | ✅ | · | · | · | ✅ | ✅ |  |
|  | `unsubscribeWebPush` | remove | ✅ | · | · | · | ✅ | ✅ |  |
|  | `subscribeExpoPush` | add | ✅ | · | · | · | ✅ | ✅ |  |
|  | `unsubscribeExpoPush` | remove | ✅ | · | · | · | ✅ | ✅ |  |
|  | `getVapidPublicKey` | list | ✅ | · | · | · | ✅ | · |  |
|  | `getCircleStoragePolicy` | list | ✅ | · | · | · | ✅ | · |  |
|  | `setCircleStoragePolicy` | set | ✅ | · | · | · | ✅ | ✅ |  |
|  | `podSignInStatus` | list | ✅ | · | · | · | ✅ | · |  |
|  | `listMyCircles` | list | ✅ | · | · | · | ✅ | · |  |
|  | `listCirclePostsSince` | list | ✅ | · | · | · | ✅ | · |  |
|  | `getLatestPostAddedAt` | list | ✅ | · | · | · | ✅ | · |  |
|  | `listConsentingPeers` | list | ✅ | · | · | · | ✅ | · |  |
|  | `getPrivacyNotice` | list | ✅ | · | · | · | ✅ | · |  |
|  | `getMetrics` | list | ✅ | · | · | · | ✅ | · |  |
|  | `createGroupV2` | add | ✅ | · | · | · | ✅ | · |  |
|  | `redeemMembershipCode` | submit | ✅ | · | · | · | ✅ | · |  |
|  | `verifyMembershipCodeForPeer` | confirm | ✅ | · | · | · | ✅ | · |  |
|  | `recordRemoteRedemption` | add | ✅ | · | · | · | ✅ | · |  |
|  | `acknowledgeCaretaker` | update | ✅ | · | · | · | ✅ | ✅ |  |
|  | `setMemberRole` | update | ✅ | · | · | · | ✅ | ✅ |  |
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
|  | `broadcastCircleGovernance` | share | ✅ | · | · | · | ✅ | · |  |
|  | `broadcastCircleKeyStatement` | share | ✅ | · | · | · | ✅ | · |  |
|  | `broadcastCircleMembership` | share | ✅ | · | · | · | ✅ | · |  |
|  | `broadcastCircleChatStatement` | share | ✅ | · | · | · | ✅ | · |  |
|  | `broadcastCircleTask` | share | ✅ | · | · | · | ✅ | · |  |
|  | `broadcastCircleRules` | share | ✅ | · | · | · | ✅ | · |  |
|  | `broadcastCircleRecipe` | share | ✅ | · | · | · | ✅ | · |  |
|  | `broadcastCircleAddresses` | share | ✅ | · | · | · | ✅ | · |  |
|  | `recordCircleAddressAnnouncement` | add | ✅ | · | · | · | ✅ | · |  |
| **folio** | `deleteFromPod` | remove | · | · | · | · | ✅ | ✅ |  |
|  | `deleteLocally` | remove | · | · | · | · | ✅ | ✅ |  |
|  | `forceRepush` | sync | · | · | · | · | ✅ | ✅ |  |
|  | `syncOnce` | sync | ✅ | ✅ | ✅ | · | ✅ | ✅ | sync, synchroniseer, synchroniseren |
|  | `watchStart` | watch | ✅ | ✅ | ✅ | · | ✅ | ✅ | watch, watch folder, let op, bewaak, bewaak map |
|  | `watchStop` | watch | ✅ | · | · | · | ✅ | ✅ |  |
|  | `verifyPodState` | read | ✅ | · | · | · | ✅ | ✅ |  |
|  | `readNote` | list | ✅ | ✅ | · | · | · | · |  |
|  | `shareFolder` | add | ✅ | ✅ | ✅ | · | ✅ | · | share, deel |
|  | `downloadFile` | list | ✅ | · | ✅ | · | ✅ | ✅ | download, haal, haal op, download bestand |
|  | `saveToMyPod` | add | ✅ | · | ✅ | · | ✅ | ✅ | save, save to my pod, bewaar, opslaan, bewaar in mijn pod |
|  | `folioStatus` | list | ✅ | ✅ | · | · | · | · |  |
|  | `listFiles` | list | ✅ | ✅ | · | · | · | · |  |
|  | `searchNotes` | list | ✅ | ✅ | ✅ | · | · | · | search, find, zoek, zoeken |
| **calendar** | `addEvent` | add | ✅ | ✅ | ✅ | ✅ | ✅ | · | schedule, add event, new event, add appointment, new appointment, afspraak, plan, zet afspraak, nieuwe afspraak |
|  | `listEvents` | list | ✅ | ✅ | · | · | · | · |  |
|  | `rsvpAccept` | claim | ✅ | ✅ | ✅ | · | ✅ | ✅ | accept, accept invite, yes, accepteer, ja |
|  | `rsvpDecline` | reject | ✅ | ✅ | ✅ | · | ✅ | ✅ | decline, decline invite, no, wijs af, nee, ik kom niet |
|  | `rsvpTentative` | submit | ✅ | ✅ | ✅ | · | ✅ | ✅ | tentative, maybe, misschien, onder voorbehoud |
|  | `cancelEvent` | remove | ✅ | ✅ | ✅ | · | ✅ | ✅ | cancel event, cancel appointment, cancel, annuleer afspraak, annuleer, zeg af |
|  | `updateEvent` | edit | ✅ | · | · | · | ✅ | ✅ |  |
|  | `shareEvent` | share | · | · | · | · | ✅ | ✅ |  |
|  | `briefSummary` | list | ✅ | · | · | · | · | · |  |
|  | `searchEvents` | list | ✅ | · | · | · | · | · |  |
| **lists** | `createList` | add | ✅ | ✅ | · | ✅ | ✅ | · |  |
|  | `addToList` | add | ✅ | ✅ | · | ✅ | ✅ | · |  |
|  | `listLists` | list | ✅ | ✅ | · | · | · | · |  |
|  | `markListItemDone` | complete | ✅ | ✅ | · | · | ✅ | ✅ |  |
|  | `makeChore` | update | ✅ | ✅ | · | · | · | · |  |
|  | `entryReminders` | update | ✅ | ✅ | · | · | · | · |  |
|  | `shopVisit` | list | ✅ | ✅ | · | · | · | · |  |
|  | `listEntries` | list | ✅ | ✅ | · | · | · | · |  |
|  | `listDone` | list-done | ✅ | ✅ | · | · | · | · |  |
|  | `removeFromList` | remove | ✅ | ✅ | · | · | · | · |  |
|  | `removeList` | remove | ✅ | ✅ | · | · | ✅ | · |  |
|  | `restoreList` | unarchive | ✅ | ✅ | · | · | · | · |  |
|  | `restoreEntry` | unarchive | ✅ | ✅ | · | · | · | · |  |
|  | `editEntry` | edit | ✅ | ✅ | · | · | · | · |  |
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
|  | `removeProfileCircleMembership` | update | ✅ | · | · | · | · | · |  |
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
| **assistant** | `assistant-memory` | set-memory | ✅ | ✅ | · | · | · | · |  |
|  | `assistant-forget` | forget-conversation | · | ✅ | · | · | · | · |  |
|  | `weekOverview` | week-overview | ✅ | ✅ | · | · | · | · |  |
|  | `sendWeekOverview` | send-week-overview | · | · | · | · | · | · |  |
|  | `assistant-feedback` | hand-off-feedback | ✅ | · | · | · | · | · |  |
|  | `assistant-hello` | greet | · | · | · | · | · | · |  |
|  | `announceChange` | announce-change | · | · | · | · | · | · |  |
|  | `assistant-reminders` | set-reminders | ✅ | ✅ | · | · | · | · |  |
|  | `remindMe` | remind-me | ✅ | · | · | · | · | · |  |
|  | `sayReminder` | say-reminder | · | · | · | · | · | · |  |
|  | `cancelReminder` | cancel-reminder | ✅ | ✅ | · | · | · | · |  |
|  | `assistant-quiet` | set-quiet | · | ✅ | · | · | · | · |  |
|  | `assistant-overview` | set-overview | ✅ | ✅ | · | · | · | · |  |
|  | `assistant-language` | set-language | ✅ | ✅ | · | · | · | · |  |
|  | `assistant-apps` | set-apps | · | ✅ | · | · | · | · |  |
|  | `assistant-settings` | set-settings | · | ✅ | · | · | ✅ | · |  |
|  | `assistant-role` | set-role | · | ✅ | · | · | · | · |  |
|  | `assistant-status` | status | · | ✅ | · | · | · | · |  |
|  | `assistant-usage` | show-usage | · | ✅ | · | · | · | · |  |
|  | `assistant-users` | list-users | · | ✅ | · | · | · | · |  |
|  | `assistant-planned` | list-planned | ✅ | ✅ | · | · | · | · |  |
|  | `assistant-people` | list-people | ✅ | ✅ | · | · | · | · |  |
|  | `assistant-cohort` | open-cohort | · | ✅ | · | · | · | · |  |
|  | `assistant-invite` | invite | · | ✅ | · | · | · | · |  |
|  | `assistant-rotate` | rotate | · | ✅ | · | · | · | · |  |
|  | `assistant-circle` | join-circle | · | ✅ | · | · | · | · |  |
|  | `assistant-circles` | list-circles | · | ✅ | · | · | · | · |  |
|  | `assistant-revoke` | revoke-user | · | ✅ | · | · | · | · |  |
|  | `assistant-menu` | show-settings | · | ✅ | · | · | · | · |  |
|  | `assistant-view` | set-view | · | ✅ | · | · | · | · |  |
|  | `assistant-agenda-link` | agenda-link | · | ✅ | · | · | · | · |  |
|  | `assistant-screen` | connect-screen | · | ✅ | · | · | · | · |  |
|  | `assistant-screen-paste` | paste-screen | · | ✅ | · | · | · | · |  |
|  | `assistant-screen-confirm` | confirm-screen | · | ✅ | · | · | · | · |  |
|  | `assistant-export-key-set` | set-export-key | · | · | · | · | · | · |  |
|  | `assistant-export-key-unlock` | unlock-export-key | · | · | · | · | · | · |  |
|  | `assistant-link` | link-identity | · | ✅ | · | · | · | · |  |
|  | `assistant-link-confirm` | confirm-link | · | ✅ | · | · | · | · |  |
|  | `assistant-inapp` | invite-to-app | · | ✅ | · | · | · | · |  |
|  | `assistant-unlink` | unlink-identity | · | ✅ | · | · | · | · |  |
|  | `assistant-companion` | set-companion | · | · | · | · | · | · |  |
|  | `assistant-screen-approve` | approve-screen | · | ✅ | · | · | · | · |  |
|  | `assistant-screens` | manage-screens | · | ✅ | · | · | · | · |  |
|  | `assistant-exports` | list-exports | · | ✅ | · | · | · | · |  |
|  | `assistant-export` | export-household | · | ✅ | · | · | · | · |  |
|  | `assistant-import` | import-household | · | ✅ | · | · | ✅ | · |  |
|---|---|---|---|---|---|---|---|---|---|
| **totals** | 324 ops | | 233 | 180 | 28 | 7 | 145 | 68 | |

### Flows

| app | flow | kind | scope | steps | declared effects |
|---|---|---|---|---|---|
| **household** | `enroll-device` | ceremony | device | 2 | overwrite:owner-root, write:device-delegation, write:registry |
|  | `restore-finish` | ceremony | device | 4 | write:registry, write:history-keys, send:circle-address-revoke, send:circle-key-rotate |
|  | `replace-device` | ceremony | device | 1 | write:registry, write:history-keys, send:circle-address-revoke, send:circle-key-rotate |
|  | `claim-companion` | ceremony | device | 1 | send:companion-claim, write:registry |
|  | `revoke-device` | ceremony | device | 1 | write:registry, send:circle-address-revoke |
| **pinboard** | `add-contact` | ceremony | device | 1 | write:contacts |
|  | `joinGroup` | wizard | device | 3 |  |
| **params** | `restore-settings` | ceremony | device | 3 | write:settings, overwrite:pod-settings |

## Gaps for the gate/LLM + inline-menu work

- **missing gate** (296/324): basis:help, basis:help-with, basis:embed, basis:embed-file, basis:embed-time, basis:logs, basis:feedback, basis:scanQr, basis:find, basis:brief, basis:signin, basis:whoami, basis:me, basis:send-file, basis:lookup-peer, basis:publish-peer, basis:rotate-identity, basis:security-status, basis:set-relay, basis:transport-mode, basis:transports, basis:settings, basis:mute, basis:unmute, basis:muted, basis:debug-dump, basis:audit-tail, basis:peer-connect, basis:test-peer, basis:signout, basis:screen-add-page, basis:screen-remove-page, basis:screen-rename-page, basis:screen-set-active, basis:screen-set-personas, basis:screen-set-circles, basis:screen-pin, basis:screen-unpin, basis:screen-add-block, basis:screen-remove-block …
- **missing inline** (256/324): basis:help, basis:help-with, basis:embed-file, basis:embed-time, basis:logs, basis:feedback, basis:scanQr, basis:find, basis:brief, basis:signin, basis:whoami, basis:me, basis:send-file, basis:lookup-peer, basis:publish-peer, basis:rotate-identity, basis:security-status, basis:set-relay, basis:transport-mode, basis:transports, basis:settings, basis:mute, basis:unmute, basis:muted, basis:debug-dump, basis:audit-tail, basis:peer-connect, basis:test-peer, basis:signout, basis:screen-add-page, basis:screen-remove-page, basis:screen-rename-page, basis:screen-set-active, basis:screen-set-personas, basis:screen-set-circles, basis:screen-pin, basis:screen-unpin, basis:screen-add-block, basis:screen-remove-block, basis:screen-move-block …
- **missing chat** (91/324): basis:signin, basis:signout, basis:screen-add-page, basis:screen-remove-page, basis:screen-rename-page, basis:screen-set-active, basis:screen-set-personas, basis:screen-set-circles, basis:screen-pin, basis:screen-unpin, basis:screen-add-block, basis:screen-remove-block, basis:screen-move-block, basis:screen-set-block-config, basis:screen-undo, household:revokeDevice, household:pairCirclePeer, household:stashEnrollOffer, household:bindCirclePersona, household:claimCompanion, household:companionGrantChoices, household:grantCompanion, household:companionGrantList, household:revokeCompanionGrant, household:listRecoveryCircles, household:exportRecoveryFile, household:listReceivablePersonas, household:removePersonaHere, household:setNearbyLevel, household:listPersonasHere, household:pausePersona, household:resumePersona, household:receivePersonas, household:importRecoveryFile, household:restoreStatus, household:restoreSource, household:restoreIntent, household:replaceDevice, household:enrollDevice, household:buildEnrollOffer …
