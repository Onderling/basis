# Lists

A circle's lists: plain lines (shopping, packing, chores), each list a container of entries, kept in the circle's own
store and carried to its members like every other item. A person also has lists of their OWN, in their own store,
reached from the assistant thread (the "+"). This page was started 2026-11-14 with the Lists tab; sendable lists are
still to be described.

## What a person can do

- Open a circle's **Lists tab** (after Tasks) when the circle has lists on. The circle's settings switch for lists is
  that tab: off, there is no tab. The tab is the circle's lists screen: an empty circle says how to make the first one.
- Make a list (or a board, which holds entries of more than one kind) by name, add an entry to it, tick an entry off,
  remove and restore entries and lists, and edit an entry's words.
- Make a list from the circle's "+" (`/new-list`), wherever lists are on.
- Put a THING on a list (an entry that carries a reference, say a shop's product, and how many): a second add of the
  same thing raises how many instead of adding a line. Every door shows how many ("2× Halfvolle melk 1 L"); no door shows a
  price, and the list never learns what the thing is. The reference sits in the entry's `embeds` as a plain reference;
  the words come from `entryWords` (`@onderling/kring-host/circleLists`), the one formatter every door reads.
- Put a lists block on a screen of their own (a page's recipe); a block whose circle has lists off says so in one line.
- Keep lists of their OWN from the "+" thread: "nieuwe lijst Vakantie" makes one, "zet melk op mijn boodschappen" adds
  to it, "wat staat er op mijn boodschappen" answers with its entries, the done ones marked. A done entry stays, marked,
  until it is taken off: "haal melk van mijn boodschappen". The line is read against
  the own lists first; a name that is both theirs and a circle's asks which, with 'mine' first. An own list belongs to
  the self ticked in the "+" when it was made: it is carried to that self's devices only, and shown only with that self
  ticked.

## Where

- The ops: `apps/lists/manifest.js` (below), mounted on every shell (`listsOpsForShell`).
- The tab: `apps/basis/src/v2/circleTabs.js` (the lists tab, after Tasks, on with the `lists` feature). It paints the
  circle's lists screen itself: web `renderListsInto` in `apps/basis/web/v2/circleApp.js` (the same body the circle's
  menu opens in a panel), mobile `CircleListsScreen` mounted `embedded` in the tab (`CircleLauncherScreen.js`).
- The read model both shells draw from: `makeCircleLists` (`@onderling/kring-host/circleLists`) over the circle's own
  store; writes go through the ops.
- The "+": `apps/basis/src/v2/attachEntries.js` offers making a list wherever the feature has a surface (the tab).
- The block: `apps/basis/src/v2/circleRecipeBlocks.js` (`materializeLists`), only where a recipe carries it.
- Own lists: the same ops with the own scope named as the circle, over the person's own store as one self
  (`ownListsCall`, `ownStoreAsSelf` in `apps/basis/src/core/agent/realAgent.js`); the "+" reads them first
  (`plusLineOutcome`'s `own`, `plusOwnLists`, `plusDoneLine` in `apps/basis/src/v2/vandaagPlus.js`), both shells
  through the shared functions (`plus-own-lists`, `plus-done-line` in `scripts/shell-seams.mjs`).

<!-- catalogue-ops
lists: createList addToList listLists markListItemDone makeChore entryReminders shopVisit listEntries listDone removeFromList removeList restoreList restoreEntry editEntry
-->

## Proof

- `apps/basis/test/v2/circleListsTab.test.js` — the tab is on with the feature, after Tasks, off without it; the "+"
  no longer waits for a block; web paints the same lists body in the tab as in the panel; the phone mounts its lists
  screen in the tab.
- `apps/basis/test/v2/listsBlock.test.js` — the lists block: what it reads, its one act per entry, the off line.
- `apps/basis/test/v2/offeredFeatures.test.js` — a feature with no surface is neither a toggle nor in the "+".
- `apps/basis/test/entryRefQuantity.test.js` — an entry with a reference and a quantity crosses to a second device
  whole; a second add of the same thing raises the quantity; bad input is refused; made a chore it keeps both.
- `apps/basis/test/v2/ownListsPlus.test.js` — own lists land in the own store and nowhere else; a door and a persona's
  lane are refused; a list made as a persona is read only with that persona; the "+" reads own lists first, asks when a
  circle holds the same name, makes an own list; the thread's answer to a read.

## Decided, not built

- Lists are not on Today (Frits, round 2 of the walk: only a task that carries a list shows there).
- The lists block is not a circle's default surface: the tab is. A block stays only where a person's own screen
  recipe carries it.

## Open rows

- Own lists on Me (a block), and sharing or moving an own list into a circle: open ideas for Frits, not built.

## Decisions that bind this area

- `docs/decisions.md` 2026-11-16: a person's own lists live in their own store, are the self's that made them, and are
  reached from the "+" thread. The tab follows the ledger row's ruling (the settings switch is the tab).
