/**
 * shell-seams — the seams every shell composes, declared once; `lint-shell-seams.mjs` checks the three shells.
 *
 * The rule (CLAUDE.md invariant #2): web ≡ mobile ≡ box. The shells are thin adapters over one shared substrate,
 * and the substrate exposes SEAMS — the lane table, the contact channel, the pair roster, the own-devices
 * catch-ups — that a shell composes with its adapters. A seam a shell forgets is invisible: nothing fails,
 * the device just does not do the thing. Measured twice in one week on the box (2026-09-18/19): the device
 * runner never composed the pair roster, and keyed a contact thread by the wire address while both shells
 * key by identity. Both were found by walking, days after the seams landed on web and mobile.
 *
 * This is a text guard, on purpose: the three composition files have no runtime coverage in common (the
 * browser walks reach web, the mobile tests reach the bundle, the relay walks reach the runner — never
 * the same seam in all three). A distinctive name per seam, present in each shell's file SET, is the fact
 * this guard can check cheaply. Mobile is a set of files, not one — the pair roster's `onAdmitted` and the
 * primary-device kick live in `ChatScreen.js`, not in `agentBundle.js` — so a shell is `{ name, files }`.
 *
 * A gap a shell is KNOWN to have goes in `BASELINE` with the brief that closes it; the guard reports it and
 * stays green, and goes red when a NEW gap appears — or when a baselined gap is gone and its entry is stale.
 */

/** A seam: what it is, why every shell needs it, and the text that proves a shell composes it. `shells` narrows a
 *  seam to the shells it applies to (a view seam has no meaning on the box) — with the reason beside it. */
export const SEAMS = Object.freeze([
  // A freshly enrolled device forgets what its THROWAWAY self wrote. Every shell boots unenrolled first, writes
  // content under an identity of its own, and the ceremony then replaces that identity and its content key. The
  // box swept its own named paths from 2026-09-14; web and mobile did not, and nothing failed — which is exactly
  // why this is a seam and not a convention. All three read ONE list now (`src/v2/enrolForgets.js`); a shell
  // supplies only how its storage is reached.
  { id: 'enrol-forgets-the-throwaway-self', pattern: /runPendingForget\(/, why: 'a device that keeps a former self\'s content greets it in every circle and warns about rows it cannot open, for ever — read the ceremony\'s note as the FIRST awaited act of boot, before any store is touched' },
  // A FUNCTION profile's inbox is a door (the household bot on its own node): the shell that can run one reads the
  // profile's kind and composes the door; a shell that ran one without it would leave the bot deaf on its inbox.
  // Only the box runs a function profile today (web and mobile are a person's devices).
  // The agent speaks in the person's language only when the shell hands it its translator: without one, its own lines
  // (list and calendar defaults, task confirmations, a paused circle) come out as keys or English. The box passed it;
  // web and mobile did not (found 2026-09-29).
  // A card handed to the install at build goes into its contacts the way a scanned card does: the alpha's feedback
  // contact on web and mobile. The box had it for a household bot's companion until the bot's admin could hand the
  // companion over from their app (the identity link's `identity-link.companion`); a box is handed nothing at boot.
  // ONE MEMBER PER PERSONA: two personas of one person cannot be told apart on the wire, so only the person's own
  // device can warn before a second persona of theirs joins a circle it is already in. The join wizard's shared state
  // decides (`secondPersonaWarning`); the shell hands it which persona the device holds each circle as. Only the
  // person's shells run the join wizard.
  { id: 'second-persona-join-warning', pattern: /profileIdOf(?:: |=\{)\(cid\)/, shells: ['web', 'mobile'], why: 'without the host\'s persona-of-circle reader the join cannot see that the person is already in the circle as another persona, and makes a second member silently' },
  // A SCREEN'S DATA IS A HEAD: Vandaag's blocks kept current by the circles' changes and the event log (`screenHead.js`),
  // so a tab landing on a fresh head reads nothing. A shell that materialized per landing paid the whole read every time
  // (a phone: calendar.listEvents ×6 + tasks.listOpen ×3 per Vandaag landing). The box paints no screen.
  { id: 'vandaag-head', pattern: /createScreenHead\(/, shells: ['web', 'mobile'], why: 'Vandaag read again on every tab landing, though nothing had changed' },
  { id: 'seeded-contact', pattern: /seedContactCard\(/, shells: ['web', 'mobile'], why: 'a card the install is handed is a contact on every person\'s shell, through the one scanned-card path' },
  // A turn to a household bot the person's identity is linked to (`/koppel`) carries a statement from THIS device over
  // exactly that turn: the bot takes it as the person only by that, so a device they revoke stops speaking as them. A
  // shell whose contact channel lacks it sends turns the bot takes for a stranger's.
  { id: 'linked-turn-auth', pattern: /authFor:\s*agent\.linkedTurnAuth/, why: 'a person\'s turns to the bot their identity is linked to count as them — from every device of theirs but one they revoked' },
  { id: 'agent-translator', pattern: /createRealHouseholdAgent\(\{(?:(?!\n\s*\}\);)[\s\S])*?\n\s+t(?::\s*[\w.]+)?,/, why: 'the agent\'s own lines follow the person\'s language' },
  // A person's node folds a circle's appointments onto that circle's ONE store (`PERSON_NODE_STORE_OPTS`, beside the box's
  // `HOUSEHOLD_BOT_STORE_OPTS`): without it a person's app reads only its own calendar and never the appointments its
  // circles hold — the household bot's included (B3, 2026-10-05).
  // The address-fallback offer remembers a decline across restarts. Both person shells composed the offer without
  // its memory, so every boot forgot the decline and offered again — one more bubble in the circle's conversation
  // per app start (found 2026-10-08 on a phone). The box makes no offer: a hosted bot has no person to ask.
  { id: 'fallback-offer-memory', pattern: /fallbackOfferStateIo\(/, shells: ['web', 'mobile'], why: 'a declined fallback offer stays declined for its cooldown, not until the next app start' },
  // There is no default relay: a person's device that knows none ASKS at the first action that needs one (an invite).
  // The box is left out on purpose — it has no person to ask; its relay is its operator's argument.
  { id: 'relay-question', pattern: /await askRelayIfNone\(\)/, shells: ['web', 'mobile'], why: 'a device with no relay asks for one before it makes an invite that would carry none' },
  // WHAT THE NEARBY ROOM IS TOLD ABOUT YOU — the face (name · handle · nobody) and "share how to reach me" (the relay; the
  // NKN address behind the publication lock): decided once (`src/v2/nearbyIdentity.js`). Both person shells carried the
  // same two functions by copy until 2026-10-16. The box has no room.
  { id: 'nearby-identity', pattern: /createNearbyIdentity\(/, shells: ['web', 'mobile'], why: 'the room learns the same face and addresses from every shell, under the same lock' },
  // JOINING AS A PERSONA: the redeem names WHO joins — the circle's persona (`agent.circleSelf`), so it leaves as that
  // persona on its own socket and announces its person key. A shell that built the redeem without it would join every
  // circle as the default, whatever the person picked (2026-10-10).
  { id: 'redeem-as-circle-self', pattern: /circleSelfFor:\s*\(gid\)\s*=>\s*agent\.circleSelf/, why: 'a circle joined as a persona is joined AS it, from every shell' },
  // Each self on its own sockets: a persona's circle registers its per-circle address (and the persona's person address)
  // on the persona's OWN relay sockets, never the default's — or replies to it land on the default's socket and the
  // relay sees two selves on one connection (2026-10-10).
  // A contact filed under a persona talks to THAT persona: the contact channel sends as it (`selfFor`) and the pair roster
  // founds the persona's pair circle with them (`selfWebidOf`). A shell without them would answer every persona's contact
  // as the default — the very link a persona exists to prevent (2026-10-12).
  { id: 'contact-self-per-persona', pattern: /selfFor:\s*\(peerAddr\)\s*=>\s*agent\.contactSelf/, why: 'a contact filed under a persona hears from that persona, never the default, from every shell' },
  { id: 'pair-roster-per-persona', pattern: /selfWebidOf:\s*\(personaId\)\s*=>\s*agent\.personaWebid/, why: 'a persona\'s contact gets the persona\'s own pair circle, from every shell' },
  { id: 'circle-address-per-self', pattern: /relaysOf:\s*\(cid\)\s*=>\s*agent\.relaysFor/, why: 'a persona\'s circle traffic crosses the wire on the persona\'s own socket, from every shell' },
  // The help bot is a contact: its conversation's door is a Contacten row, and the launcher paints no help tile.
  { id: 'help-bot-door', pattern: /tileCircles\(/, shells: ['web', 'mobile'], why: 'the help conversation opens from Contacten on every person\'s shell, never from a second tile' },
  // Feedback about the app: the op opens the feedback contact's thread through the shell, prefilled; a shell without the
  // seam answers "not possible here" to /feedback, the "+" and the Instellingen door alike.
  { id: 'feedback-door', pattern: /openFeedback:/, shells: ['web', 'mobile'], why: 'feedback about the app opens the thread to Onderling, prefilled, on every person\'s shell' },
  // Mij's device and agent rows (and the device offer) open the settings group where devices live; the old My data
  // page is no longer that place, so a shell that kept opening it would show a page without them.
  { id: 'settings-group-for-action', pattern: /settingsGroupForAction\(/, shells: ['web', 'mobile'], why: 'a tap on a device or agent row on Mij opens Apparaten & sleutels, on every person\'s shell' },
  { id: 'person-node-store', pattern: /\.\.\.PERSON_NODE_STORE_OPTS/, shells: ['web', 'mobile'], why: 'a person\'s app sees the appointments of the circles they are in' },
  // Read-then-act in a circle's chat: the engine looks at a read the model picked and acts on it. The box's runner
  // composes its own look; web and mobile compose the shared one over their gated call (found missing 2026-09-29).
  { id: 'circle-peek', pattern: /createPeek\(/, shells: ['web', 'mobile'], why: 'a circle bot acts on "haal de melk eraf" instead of showing the list' },
  // A hosted bot keeps its household's export file (the one format kept readable across versions) on its own disk,
  // one a night, so a snapshot carries it off and /import can read it back. A person's device keeps no such shelf.
  { id: 'household-export-shelf', pattern: /createExportShelf\(/, shells: ['box'], why: 'a hosted bot\'s household survives a wipe, a lost disk and a new version' },
  { id: 'bot-inbox-door', pattern: /createInboxDoor\(/, shells: ['box'], why: 'a function profile\'s contact inbox is answered by its assistant; a person\'s never is' },
  // A household bot WRITES FIRST (reminders of what people dated): only a shell that hosts a bot runs the tick. Web and
  // mobile are a person's devices and write first to nobody.
  // A hosted bot's first message is derived from what it does for that person (their role's tools, the settings).
  { id: 'bot-welcome', pattern: /welcomeLines\(/, shells: ['box'], why: 'a hosted bot tells a new person what it does for them; a person\'s device has no door to greet on' },
  // Without its model a hosted bot says what does work (the word rules, the commands) instead of "only commands".
  { id: 'bot-basic-help', pattern: /basicModeLines\(/, shells: ['box'], why: 'a person learns what to type when the model is off or down' },
  // A host has ONE clock: every timed thing it does is a job on it (lint-host-tick refuses an interval beside it). The box
  // has jobs today; web and mobile join when they have one (they tick on foreground, painting what is planned).
  { id: 'host-tick', pattern: /createHostTick\(/, shells: ['box'], why: 'the box\'s timed work (reminders, the nightly export, the model watch, the key sweep) runs on one clock in a fixed order' },
  // Planned work: a host's own typed items (the own-devices store) and the job that runs the due ones as their person.
  // The box first (the Sunday overview of the people it serves); web and mobile join when the calendar's no-circle
  // appointments move into the store and they tick on foreground.
  // The stores write behind a short debounce; a shell that goes away inside it loses the last change. Each shell flushes
  // the waiting saves when it leaves: a page on pagehide/hidden, the app on going to the background, the box on stop.
  { id: 'flush-on-exit', pattern: /flushPendingSaves\(/, why: 'a change made a moment before a reload, a closed tab, a backgrounded app or a restart is still there afterwards' },
  // One place a host hears that an item it holds changed — its own write or a member's that landed — for its event rows
  // and its screens' nudge. Only a host that runs planned work composes it today (the box); web and mobile join with
  // their clock.
  { id: 'change-feed', pattern: /createChangeFeed\(/, shells: ['box'], why: 'a change a member makes in their app reaches the bot\'s event rows and its screens, not only the bot\'s own writes' },
  // The person's own store rides between their own devices (signed by the device, sealed to the person); what a
  // sibling wrote while this device was off is asked for on connect — every shell that holds the person's store.
  { id: 'own-store-catch-up', pattern: /ownStoreSync\??\.requestFromSiblings\(|kick\(agent\.ownStoreSync/, why: 'an appointment added on the phone while the laptop was off is on the laptop when it comes back' },
  // A person's device runs its OWN planned rows (their week on Saturday) while the app is in front: one host tick, its
  // timer the foreground cadence. The box keeps its own clock (`host-tick`).
  { id: 'person-clock', pattern: /createPersonClock\(/, shells: ['web', 'mobile'], why: 'a person\'s own planned rows (their week overview) run on their phone and in their browser while the app is open' },
  { id: 'own-devices-store', pattern: /createOwnDevicesStore\(|lazyOwnStore\(/, shells: ['web', 'mobile', 'box'], why: 'a host\'s own planned work (and that of the people it is the device for) is durable, sealed, and no circle\'s' },
  { id: 'device-push-store', pattern: /pinboardPushPersistDb:/, shells: ['web', 'mobile', 'box'], why: 'push subscriptions survive a restart on the device\'s own sealed store, never in the pinboard store a pod can reach' },
  { id: 'intention-runner', pattern: /createIntentionRunner\(/, shells: ['box'], why: 'what is planned runs once, as its person, through the door' },
  // A change that concerns others (a new, moved or cancelled appointment; a chore given) is told to them by the door
  // that hosts the bot, at once; a person's device writes first to nobody.
  { id: 'announcer', pattern: /createAnnouncer\(/, shells: ['box'], why: 'the household hears of a shared appointment, a move or a cancel, and a chore given to them, when it happens' },
  // What is coming for me, wherever it lives (my circles' appointments, my own, my chores) — Vandaag's seeded page,
  // read on the person's device, no bot (the household bot is optional). The box hosts no person, so it has no Vandaag.
  { id: 'planned-for-me', pattern: /ensureVandaagBook\(/, shells: ['web', 'mobile'], why: 'a person sees what is coming for them on Vandaag, from every circle and their own calendar' },
  { id: 'bot-reminder-tick', pattern: /createReminderTick\(/, shells: ['box'], why: 'a hosted bot reminds its people of what they dated, on their own door; a person\'s device never writes first' },
  // The device log's retention windows come from the register (`retention.chatDays`), applied after boot on every
  // shell. The box composed none until 2026-10-08 and ran on the built-in defaults: the same numbers today, but a
  // window the register changed would have reached web and mobile and never the box — where the bot's turns age out.
  { id: 'retention-window', pattern: /setRetention(?:\?\.)?\(retentionFromDays\(/, why: 'the windowed log classes (plumbing, the bot\'s turns, the trail\'s detail) age out on the window the register holds, on every device' },
  { id: 'lane-table',            pattern: /buildCircleLanes\(/,                 why: 'the one lane table (governance, membership, keys, tasks, chat, the own-devices handlers) — a shell wires its reactions, never a lane of its own' },
  // THE CIRCLE'S POLICY is circle state on the governance lane (2026-09-26): every shell builds the one lane, folds
  // it on the governance change (live fan + catch-up), and serves its head at catch-up — the box above all, the
  // always-on member a joiner catches up from after the lane's audit window has aged the statement out.
  { id: 'circle-policy-lane',        pattern: /makeCirclePolicyLane\(/,         why: 'the circle policy as a signed admin statement on the governance lane — one composition, a shell injects its stores' },
  { id: 'circle-policy-lane-folds',  pattern: /circlePolicyLane\??\.apply\(/,     why: 'the policy is applied where governance changes land — a shell that never folds it keeps the default posture' },
  { id: 'circle-policy-lane-serves', pattern: /circlePolicyLane\??\.preserved\(/, why: 'the winning statement is served at catch-up after the audit window — a later joiner converges from any peer' },
  { id: 'assistant-reply-line',  pattern: /assistantReplyText\(/,               why: 'the line a door speaks when the assistant did not act or was cut short ("en verder?") — one answer for every door' },
  // The assistant takes a thread's lines one turn at a time. A line the door answers itself (its pending ask, a
  // confirmation, a command) is claimed in that lane, so a line typed while the turn that asks is running answers it.
  { id: 'assistant-lane-claims-the-ask', pattern: /\bclaim:\s/,              why: 'an answer typed during the turn that asks is the answer — not a new request, not a chat line for the circle' },
  // The collect window is for a chat app (the box's Telegram door, where quick lines arrive as separate messages).
  // A circle composer passes 0: a person types one line on purpose there, and a wait on every reply reads as slow.
  { id: 'circle-composer-does-not-collect', pattern: /collectMs:\s*0\b/,   shells: ['web', 'mobile'], why: 'a circle composer does not wait for more lines before the bot answers' },
  { id: 'contact-channel',       pattern: /createContactThreadChannel\(/,        why: 'direct messages: durable threads, the person seal, the own-devices carry' },
  // A ROW is a view: only the shells that paint Contacten compose it. The box stores the thread and carries it; the
  // row appears on each painting device when the carried turn lands there. Scoped on purpose, and said here so
  // the scoping is reviewed, not assumed.
  { id: 'contact-channel-notes-the-sender', pattern: /notePeer:/,               shells: ['web', 'mobile'], why: 'whoever writes to me becomes a row in Contacten — direct or carried (2026-09-18: a carried turn with no row)' },
  { id: 'contact-channel-keys-by-identity', pattern: /identityOf:\s*\(addr\)/,  why: 'a thread is keyed by the person, whatever address the message came from (2026-09-19: the box keyed by the wire address)' },
  // Hiding a contact (L106) is on every device: the box must know who is hidden (it never carries a hidden row
  // back as shown) and must unhide when they write, or the laptop and the phone would disagree with it.
  { id: 'contact-channel-hidden',   pattern: /isHidden:/,                        why: 'a hidden contact who writes again comes back — the shell tells the channel who is hidden…' },
  { id: 'contact-channel-returned', pattern: /onReturned:/,                      why: '…and what to do when one of them lands a turn: unhide the row (and, where there is a screen, mark the thread)' },
  // The first message carries the sender's card (2026-09-21): a device that does not hand its card in leaves the
  // other side a nameless row; one that does not take a card in never names the people who write to it.
  { id: 'contact-channel-my-card',   pattern: /myCard:/,                          why: 'the first message to a contact carries my card — name, handle, where to write back, the person key' },
  { id: 'contact-channel-on-card',   pattern: /onCard:/,                          why: 'a card that arrives with a message (naming its sender) goes into the book; the book carry names them on every device' },
  { id: 'pair-roster',           pattern: /createPairRoster\(/,                 why: 'the hidden two-member circle every written-to contact gets; DMs ride it (L105)' },
  { id: 'pair-roster-lens',      pattern: /shareRelease:/,                      why: 'the founder says on a new pair circle what THIS contact\'s persona discloses — which persona a contact sees you as (the lens, persona step 3)' },
  // The create wizard founds a circle AS a persona (Frits 2026-09-24): the shell hands it the one composition that
  // says a release. A shell that forgets it creates circles where the picker is shown and nothing rides. The box
  // has no create wizard — it joins and holds circles, it does not found them from a form.
  { id: 'create-founds-as-persona', pattern: /shareFounderRelease[:=]/,         shells: ['web', 'mobile'], why: 'the persona picked in the create wizard says what it discloses in the new circle' },
  // What a contact sees of you (L125): the add sheet before a scanned card or link is added, the control on the
  // thread header after. A person picks both; the box has nobody to ask.
  { id: 'contact-lens-asks', pattern: /ContactLens|contactLens\./, shells: ['web', 'mobile'], why: 'a contact added by a person is asked first what they see of you, and it can be changed on their thread' },
  // Deleting a contact (L114) is one relationship act on every painting shell: hide + leave the pair circle, asked first.
  { id: 'contact-delete', pattern: /deleteContact\(/, shells: ['web', 'mobile'], why: 'deleting a contact hides the row AND leaves the pair circle — a shell that only hid would leave the route and its keys running' },
  // Opbergen (Frits 2026-09-24): a circle out of sight is one fact on every painting shell — the launcher folds it and its
  // menu sets it through the agent's one act. The box paints no launcher; the carry itself is in the shared agent.
  { id: 'circle-sight', pattern: /setCircleSight/, shells: ['web', 'mobile'], why: 'a circle put away on one device is out of sight on every device — a shell without the fold would show it anyway' },
  // The restore-finish flow opens after a RESTORE, never after an add-a-device from an offer (2026-09-24): both
  // painting shells ask the one rule, and paint the one outcome. The box has no screen to paint it on.
  { id: 'restore-finish-applies', pattern: /restoreFinishApplies\(/, shells: ['web', 'mobile'], why: 'an enrol from an offer is not a restore — "your circles are not here" would tell a person adding a device that their circles are gone' },
  { id: 'pair-roster-admits',    pattern: /onAdmitted/,                          why: 'the founder promotes the joiner and announces — the redeem handler\'s hook' },
  { id: 'primary-device-request', pattern: /primaryDevice\??\.requestFromSiblings/, why: 'which device is the primary contact address — asked of the siblings at boot, so a claim made elsewhere reaches here' },
  { id: 'known-peers-catchup',   pattern: /knownPeersSync/,                      why: 'who the person knows, on every device: bindings and the contact book' },
  { id: 'person-key-catchup',    pattern: /personKeySync/,                       why: 'the person key and its chain, on every device' },
  { id: 'profile-facts-catchup', pattern: /profileFactsSync/,                    why: "a profile's properties and disclosure, the same on every device holding that self" },
  { id: 'grants-catchup',        pattern: /grantsCatchUp/,                       why: 'the grants lane: what my devices may do' },
  { id: 'circle-presence',       pattern: /registerCirclePresence/,              why: 'per-circle addresses on the relay and the announce — the three acts every device performs on connect' },
  // Siblings follow a circle (L109, 2026-09-21): a circle founded or joined on one device reaches the others. A shell
  // that hands no consume in hears the carry and joins nothing; one that never asks misses what happened while it was off.
  { id: 'circle-follow-consume', pattern: /circleFollowSync\??\.setConsume\(/,   why: 'a circle a sibling founded or joined: this device joins it by the enrol consume\'s per-circle step, composed with the shell\'s seams' },
  { id: 'circle-follow-request', pattern: /circleFollowSync\??\.requestFromSiblings/, why: 'the circles the siblings are in that this device is not — asked at connect' },
  // WHAT A CIRCLE SHARED OUT, under its admin's hand: the outbound list and "Stop sharing", decided once
  // (`adminOutboundShares`: revocable only under a canonical posture). Web had it in its admin panel; the phone did not
  // (found by the buttons assessment, 2026-10-19). A host duty — the shell binds its resolvers — so it is a seam.
  { id: 'admin-outbound-shares', pattern: /adminOutboundShares\(|outboundSharesForAdmin\(/, shells: ['web', 'mobile'], why: 'an admin sees and can stop what the circle shared out, on every person\'s shell' },
  // A MEMBER REMOVED loses their access to what the circle shared out (`revokeAllForMember`, after the removal stands).
  // Web ran it; a member removed from the phone kept every share (a live privacy defect, fixed 2026-10-20).
  { id: 'removed-member-revoke', pattern: /revokeAllForMember\(|revokeOutboundForMember\(/, shells: ['web', 'mobile'], why: 'a member removed on any shell loses access to everything the circle shared out' },
  // A CONTACT TURN IS SEALED to the contact's CURRENT person key and opened by ours (`agent.contactSeal`): the person key
  // rotates when a device is revoked, so a revoked device (which keeps only the old key, and the profile key every device
  // shares) cannot read what is sent after. The box composed its contact channel without it: its replies went out
  // sealed to nothing but the transport, which a revoked device still opens (L236 (b)/(c), found 2026-10-20).
  // THE "+" LINE talks to the person's own agent only: an own act, or a referral to the circle where it lives — opened,
  // never acted on (`plusLineOutcome`, with each circle's availability from `circleAvailabilityFor`). A shell reading the
  // line any other way is how the sheet would come to act in a circle.
  { id: 'plus-line-outcome', pattern: /plusLineOutcome\(/, shells: ['web', 'mobile'], why: 'the "+" line makes an own act or refers to a circle, and never acts in one' },
  // Who offers what I asked: the matches under the asker's own open ask, from the members' released offerings only,
  // computed on the asker's device (`askMatchChoices`). A shell matching any other way could read what was not released.
  { id: 'ask-matches', pattern: /askMatchChoices\(/, shells: ['web', 'mobile'], why: 'matches under my own ask come from released offerings only, and only the asker sees them' },
  { id: 'contact-person-seal', pattern: /sealFor:\s*agent\.contactSeal\?\.sealFor/, why: 'a contact turn — the bot\'s replies included — is readable only with the contact\'s current person key, never by a device they revoked' },
]);

/** A shell is a file SET: the files that together compose the substrate for that surface. */
export const SHELLS = Object.freeze([
  { name: 'web',    files: ['apps/basis/web/v2/circleApp.js'] },
  { name: 'mobile', files: ['apps/basis-mobile/src/core/agentBundle.js', 'apps/basis-mobile/src/screens/ChatScreen.js', 'apps/basis-mobile/src/screens/v2/CircleLauncherScreen.js', 'apps/basis-mobile/src/screens/v2/CircleMyDataScreen.js', 'apps/basis-mobile/src/screens/v2/CircleProfileScreen.js', 'apps/basis-mobile/src/screens/v2/EnrollDeviceModal.js', 'apps/basis-mobile/src/screens/v2/ContactThreadScreen.js', 'apps/basis-mobile/src/screens/v2/CircleNoticeboard.js', 'apps/basis-mobile/App.js'] },
  { name: 'box',    files: ['apps/basis/bin/device-runner.mjs', 'apps/basis/src/telegram/runner.js'] },   // the runner is the box's Telegram door
]);

/** Gaps a shell is known to have, each with what closes it. Remove the entry when the seam lands. */
export const BASELINE = Object.freeze([]);

/** Source with comments removed — a comment that EXPLAINS a seam is not the seam. */
export const code = (src) => String(src).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * Which seams each shell lacks, and which baselined gaps are stale (the seam is there after all).
 * @param {(rel: string) => string} readFile  returns a file's text, or throws
 * @returns {{ gaps: Array<{shell: string, seam: string, why: string, files: string[]}>, known: typeof BASELINE, stale: typeof BASELINE }}
 */
export function findGaps(readFile, { seams = SEAMS, shells = SHELLS, baseline = BASELINE } = {}) {
  const gaps = []; const known = []; const stale = [];
  for (const shell of shells) {
    const text = shell.files.map((f) => { try { return code(readFile(f)); } catch { return ''; } }).join('\n');
    for (const seam of seams) {
      if (Array.isArray(seam.shells) && !seam.shells.includes(shell.name)) continue;
      const present = seam.pattern.test(text);
      const listed = baseline.find((b) => b.shell === shell.name && b.seam === seam.id) ?? null;
      if (present && listed) stale.push(listed);
      if (!present && listed) known.push(listed);
      if (!present && !listed) gaps.push({ shell: shell.name, seam: seam.id, why: seam.why, files: shell.files });
    }
  }
  return { gaps, known, stale };
}
