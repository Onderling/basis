# News and read state

What is new for the person, and what they already read, on every one of their devices. Started 2026-11-09 with the
read state; the notification projection and "Nieuw voor jou" on Today follow.

## What a person can do

- See which circles have news: the circle tiles (a count and a subtitle) and Today's "Kringen met nieuws" (a count and
  the kinds of what is new, as icons). With nothing new, Today says where it looked ("Niets nieuws in Werk Test").
- See which contacts wrote: the count on a contact's row and the sum on the Contacten tab.
- Read something on one device and have it read on all: opening a circle or a conversation marks what is in it read,
  and the person's other devices stop counting it once the mark arrives.
- See "Nieuw voor jou" at the top of Today (only when something is there): a new post, task or appointment, a line in
  a circle, a direct message, someone they admitted joining, their own removal; each row opens the thing, ✕ sets it
  aside, "Alles gelezen" clears the block; a row that arrived long after it was sent says "kwam later binnen".

The notification projection: `apps/basis/src/v2/notifications.js` (`notificationRows`), prepended to Today by the
shared screen materializer when the shell asks (`forYou: true`), painted by `renderForYou` on both shells; setting a row
aside marks its ids read (`createReadMarks().markRows`).

## Where it lives

- **One news projection**: `apps/basis/src/v2/circleTilePreviews.js` (`buildTilePreviews`): human-lane lines plus
  item landings, from others, newer than this device's seen-mark by when they ARRIVED here (`landedAt`), and in no
  read set. The tiles, Today's news (`userScreenBlocks.js`) and Mij read it. The contact badges:
  `apps/basis/src/v2/contactUnread.js` (inbound turns by `receivedAt`).
- **Arrival times**: the device log stamps `landedAt` at the first append of an id (`apps/basis/src/eventLog.js`,
  `landedTimeOf`); an inbound direct message is stored with `receivedAt` (`packages/item-store/src/addressedDeliver.js`).
  The sender's time stays on everything and is what a bubble shows.
- **Item landings**: `apps/basis/src/v2/itemLanding.js` (`item-landed`, one per circle and item, written at the items
  rail's applied hook in the shared agent).
- **Read marks**: one `read-marks` row per self and group in the own-devices store
  (`packages/item-types/src/types/readMarks.js`), merged as a union by the store's `set-union` resolution
  (`packages/item-store/src/resolutionPolicy.js`, `causalMerge.js` `mergeSetUnion`), pruned by a floor that merges by
  its maximum so pruning is the same everywhere. The shells hold the set through `createReadMarks`
  (`apps/basis/src/v2/readMarks.js`, a shell seam) over the two device ops below.

<!-- catalogue-ops
household: markRead listReadMarks
-->

## Proof

- `packages/item-store/test/setUnionMerge.test.js` — two devices marking at once, in both orders; a stale device cannot
  bring back a pruned mark; refused outside the own-devices types.
- `apps/basis/test/v2/readMarks.test.js` — read on another device is not news here (tiles, Today, contact badges).
- `apps/basis/test/eventLogLandedAt.test.js`, `apps/basis/test/v2/itemLanding.test.js`, `apps/basis/test/v2/contactUnread.test.js`.
- `apps/basis/test-browser/walk-today-news.spec.js` — two apps over the relay: a chat line, a post, a post that came while
  offline, an appointment and a late line are each news on Today.

## Decided not to build (yet)

- An edit of an item someone else wrote is not news (only its first arrival).
- No OS notification, no wake, no sound from this area: the notification record's later routes read the same sources.
