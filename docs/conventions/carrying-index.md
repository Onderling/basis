# The carrying index — every way bytes move or wait, by what you want to do

*Added 2026-10-07, after two carrying mechanisms were nearly (or actually) built beside ones that existed: a sealed
file store for the agenda link beside the companion's blob bucket, and a pub/sub question beside `protocol/pubSub.js`.
The mechanisms are all explained in [`architecture.md`](../architecture.md) — by their names. Nobody looking for "an
agenda link" searches for "blob". This index is keyed by the VERB, the twin of
[`shared-vocabularies.md`](shared-vocabularies.md) for closed word sets.*

## How to use it

Before you build anything that sends, holds, fans, syncs, serves or wakes: find your verb below. If a row fits, use
that mechanism (or extend it, and update its row). If two rows almost fit, that is the design question — ask before
building a third.

**"Used today by"** names a PRODUCTION file that reaches the mechanism (not a test, not a demo). A row with no such file
says **inert** — built, tested, reached by nothing. An inert row is a finding: adopt it, or retire it with a decision
line. It is never deleted quietly. (Measured 2026-10-07 by a sweep of the code. A guard that holds this table to the
code is the next step.)

**The base the rows ride on.** Almost every row between agents goes out through one send:
`sa.peer.sendTo(to, payload, { guarantee: 'hold-forward' })` (`packages/secure-agent/src/createSecureAgent.js`). It holds
a message on the device for a peer that cannot be reached (24 h, 50 per peer, 64 peers, persisted as the shell's
outbox) and sends it when the peer shows up. A circle's "fan" is stoop's `broadcastToCircle`
(`packages/circles/src/circleFanOut.js`): one hold-forward copy per member, over the relay. The relay itself sees
addresses, sizes, timing and ciphertext — never content.

## Between the members of a circle

| I want to… | Mechanism | Lives in | Who learns what | Used today by | Not for |
|---|---|---|---|---|---|
| put an item in a circle so every member has it (tasks, lists, appointments, the noticeboard) | the circle's store, carried as signed snapshots on the task lane | `apps/basis/src/v2/taskRail.js` (`routeTaskMirror`, `onItemApplied`), `noticeboardCarry.js`, `noticeboardFan.js` | each member's device: the signed item; the relay: size and timing | `core/agent/realAgent.js`, `circleLanes.js` (every shell) | one person only (→ contact thread) |
| say who joined, left or was evicted | membership statements on the membership lane | `membershipRail.js`; fan: stoop `broadcastCircleMembership` | every member; an evicted person also gets their own evict | `realAgent.js`, `circleLanes.js` | anything but membership |
| carry chat, governance, keys, a circle's rules or policy | the statement lanes | `chatRail.js`, `keyRail.js`, `governanceAppWiring.js`, `policyUpdateLane.js`, `rulesUpdateLane.js` | every member | `realAgent.js`, `circleLanes.js`, mobile `CircleLauncherScreen.js` | content for one person |
| catch up on what I missed while offline | pull-all (governance) and windowed frontier replay (tasks, chat) | `governanceCatchUp.js`, `frontierReplay.js`, `catchUpTargets.js` | the peer asked learns who asked and their frontier | `realAgent.js`, `circleLanes.js`, `enrollOffer.js`, mobile `ChatScreen.js` | a live push (→ the lanes) |
| hold a sealed photo or file for the members who hold its key | the blob bucket behind a gate (token → ACL → presigned URL; the client opens) | `@onderling/blob-gateway` (`uploadBlob`, `openBlob`, `gatekeeper`), `circleMediaGateway.js` | the bucket: ciphertext and size; the gate: who holds a token | `core/handlers/mediaEmbed.js`, `profileMediaReseal.js`, mobile `CircleLauncherScreen.js` | serving plaintext (→ link-sealed blob) |

## Between me and one other person

| I want to… | Mechanism | Lives in | Who learns what | Used today by | Not for |
|---|---|---|---|---|---|
| talk one-to-one with a contact or a bot | contact threads over the points on the contact card | `contactThreadChannel.js` | the relay: address and size; the other end: the text | `bin/device-runner.mjs`, mobile `agentBundle.js`, `src/index.js` | a circle (→ the lanes) |
| have a bot write first (a reminder, a link sent privately) | the door's reach to a person's own chat | `doorReach.js` (`createPersonReach`) | Telegram learns the text on a Telegram door; the inbox path learns the turn | `bin/device-runner.mjs` | anything a person did not ask the bot for |
| call a skill on another agent (an op, with a token) | task exchange (A2A-style) | `packages/core/src/protocol/taskExchange.js`, `secure-agent/peerSkillCalls.js` | the callee learns the op, its args and the token | `core/Agent.js`, the box (`device-runner.mjs`), `screenView.js`, `botFeeds.js` (the agenda link's `feed.put`) | a broadcast |
| let another person's agent act for me on one task | a task grant | `packages/core/src/permissions/TaskGrant.js` | the holder learns the scope | `apps/tasks-v0/src/Agent.js` (loaded by `realAgent.js`), `mandate.js`, mobile `CircleLauncherScreen.js` | standing access (→ surface grants) |
| ask the people in the room (Nearby) | the nearby ask channel over the local network | `nearbyAskChannel.js` | any peer on the LAN: the ask's text and tags | `nearbyRoomBinding.js` (mobile `agentBundle.js`, `CircleLauncherScreen.js`), `src/index.js` | anything private |

## Between my own devices

| I want to… | Mechanism | Lives in | Who learns what | Used today by | Not for |
|---|---|---|---|---|---|
| give my other devices what this one wrote (grants, a circle's traffic, keys) | the sibling carry | `siblingCarry.js`, `grantsRail.js`, `contactTurnFan.js`, `knownPeersSync.js`, `personKeySync.js`, `primaryDevice.js` | the relay: address and size; my other devices: everything | `realAgent.js`, `src/index.js` | other people |
| make a circle I joined appear on my other devices | circle follow | `circleFollowSync.js` | my devices: the circle's id, handle, address and relays | `realAgent.js` | other people |
| keep my own rows (my appointments, my planned work) on all my devices | the own-devices store, on the task lane under its own scope, fanned by the sibling carry | `ownDevicesStore.js` (+ `grantsRail.js`'s sibling-gated catch-up) | my devices only; a household bot has no siblings, so there it stays local | `bin/device-runner.mjs`, `realAgent.js`, mobile `agentBundle.js`, `assistantOps.js` | anything a circle should see |
| back up my device's log to my pod, and let a connected screen read its slice | the history mirror and view lanes | `historyMirror.js` (`provisionHistoryMirror`), `surfaceGrants.js` (`viewLaneId`), `surfaceNudge.js` | the pod: ciphertext and batch sizes | `realAgent.js`; only web hands it a provider (`circleApp.js`); off by default | live traffic |
| write through to my pod (registry, settings, a shared-pod circle) | pod write-through | `registryCarrier.js`; stoop's pod writes | the pod: sealed blobs under opaque names | `realAgent.js`, mobile `core/circlePods.js`, web `circleApp.js` | anything that must reach another person live |

## To a reader that is no agent

| I want to… | Mechanism | Lives in | Who learns what | Used today by | Not for |
|---|---|---|---|---|---|
| serve something at a link to a program that holds no key (a calendar app) | a link-sealed blob in the companion's bucket, opened at serve time with the key the request brings (`/feed/<id>.<k>.ics`) | `@onderling/blob-gateway` `linkSeal.js`; companion `feedShelf.js` | the companion: what it serves, while it serves it; at rest only ciphertext; whoever holds the link reads it | companion `index.js` (when `COMPANION_FEEDS` is on); the bot's agenda link (`botFeeds.js`, `personFeed.js`) | anything an agent could fetch itself (→ the blob bucket) |

## Inside one host

| I want to… | Mechanism | Lives in | Who learns what | Used today by | Not for |
|---|---|---|---|---|---|
| be told when an item this host holds changed (its own write, or one that landed) | the change feed | `changeFeed.js` (joins the store's publish and `onItemApplied`) | nothing leaves the host | `bin/device-runner.mjs` (the screens' nudge, the planned work's event rows, the agenda link) | another agent (→ the lanes) |
| tell a connected screen to read again, without content | the screen nudge | `screenNudge.js` (sends), `screenView.js` (receives) | the relay: that a nudge went to that screen | `bin/device-runner.mjs`, web `screenShell.js` | carrying content |
| wake a sleeping phone | push (contentless wake) | relay `PushSender` / `ExpoPushSender`, `PushTokenRegistry`; `react-native/push/wakeNudges.js` | the relay and Expo / APNs / FCM: token ↔ address and wake timing, no content | the relay when `PUSH_PROVIDER=expo`; mobile `nativePush.js`; web `webPushClient.js` (a no-op in the browser) | content |

## Held by a server

| I want to… | Mechanism | Lives in | Who learns what | Used today by | Not for |
|---|---|---|---|---|---|
| keep a message for an address that is offline, at the relay | the relay's forward queue | `packages/relay/src/ForwardQueue.js` (+ `SqliteForwardStore`) | the relay: addresses, size, timing, ciphertext; 24 h | `relay/server.js` (every `RelayTransport`) | anything longer than a day (→ the device's own hold) |

## Inert — built, reached by nothing in production (measured 2026-10-07)

| What it would do | Mechanism | Lives in | Only reached by |
|---|---|---|---|
| subscribe across agents to a topic | protocol pub/sub | `packages/core/src/protocol/pubSub.js` | wired in `core/Agent.js` and published to by `ReachabilityOracle`, but nothing in production subscribes |
| pub/sub for skills | `SkillsPubSub` | `packages/core/src/SkillsPubSub.js` | the core index re-export |
| stream a task's output | streaming | `packages/core/src/protocol/streaming.js` | the core index re-export |
| go through a third agent | the hop tunnel | `packages/core/src/routing/hopTunnel.js`, `security/tunnelSeal.js` | `mesh-demo`, `sdk-smoke` |
| fetch from several recipients at once | the relay's multi-recipient queue | `packages/relay/src/MultiRecipientQueue.js` | no client sends `multi-request` |
| drop sealed mail for an away owner at a companion | the sealed inbox | `apps/companion-node/src/sealedInbox.js` | tests (`boot.js` never turns it on) |
| serve the photo edge over HTTP | the blob gate's HTTP mount | `blob-gateway/httpGate.js`, `relay/blobGateMount.js`, companion `mediaEdge.js` | tests (no shipped boot passes a `blobGate`) |
| carry items the old way | the secure-mesh envelope adapter | `packages/core/src/sync/secureMeshEnvelopeAdapter.js` | wired in `realAgent.js`, but task and noticeboard writes go through the task lane |
| BLE, MQTT transports | the transports | `@onderling/transports` | `mesh-demo` (basis builds them with `ble: false`) |

**Transports actually built by the shells:** the relay WebSocket everywhere; NKN on web (when its script loads) and
mobile, never on the box; WebRTC rendezvous on web and mobile; mDNS on mobile (browse by default) and on a companion
started with `--nearby`.

## Where servers keep things

- **The relay:** the forward queue (SQLite at `QUEUE_DB`, else memory), push tokens (SQLite at `PUSH_TOKENS_DB`, else
  memory), the blob gate's ACL (memory by default) and whatever bucket it is handed.
- **The companion** (its config dir): `host-identity.json`; `sealed-inbox.json` when the inbox is on; `feeds/` (a
  file bucket, ciphertext only) when feeds are on. Its media bucket and registry pseudo-pod are in memory.
- **A device:** its outbox (the hold-forward queue), the device log, the stores — all sealed at rest on the box.
