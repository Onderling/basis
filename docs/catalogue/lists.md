# Lists

A circle's lists: plain lines (shopping, packing, chores), each list a container of entries, kept in the circle's own
store and carried to its members like every other item. This page was started 2026-11-14 with the Lists tab; parts of
the area (sendable lists, a person's own lists in the assistant thread) are still to be described.

## What a person can do

- Open a circle's **Lists tab** (after Tasks) when the circle has lists on. The circle's settings switch for lists is
  that tab: off, there is no tab. The tab is the circle's lists screen: an empty circle says how to make the first one.
- Make a list (or a board, which holds entries of more than one kind) by name, add an entry to it, tick an entry off,
  remove and restore entries and lists, and edit an entry's words.
- Make a list from the circle's "+" (`/new-list`), wherever lists are on.
- Put a lists block on a screen of their own (a page's recipe); a block whose circle has lists off says so in one line.

## Where

- The ops: `apps/lists/manifest.js` (below), mounted on every shell (`listsOpsForShell`).
- The tab: `apps/basis/src/v2/circleTabs.js` (the lists tab, after Tasks, on with the `lists` feature). It paints the
  circle's lists screen itself: web `renderListsInto` in `apps/basis/web/v2/circleApp.js` (the same body the circle's
  menu opens in a panel), mobile `CircleListsScreen` mounted `embedded` in the tab (`CircleLauncherScreen.js`).
- The read model both shells draw from: `makeCircleLists` (`@onderling/kring-host/circleLists`) over the circle's own
  store; writes go through the ops.
- The "+": `apps/basis/src/v2/attachEntries.js` offers making a list wherever the feature has a surface (the tab).
- The block: `apps/basis/src/v2/circleRecipeBlocks.js` (`materializeLists`), only where a recipe carries it.

<!-- catalogue-ops
lists: createList addToList listLists markListItemDone makeChore entryReminders shopVisit listEntries listDone removeFromList removeList restoreList restoreEntry editEntry
-->

## Proof

- `apps/basis/test/v2/circleListsTab.test.js` — the tab is on with the feature, after Tasks, off without it; the "+"
  no longer waits for a block; web paints the same lists body in the tab as in the panel; the phone mounts its lists
  screen in the tab.
- `apps/basis/test/v2/listsBlock.test.js` — the lists block: what it reads, its one act per entry, the off line.
- `apps/basis/test/v2/offeredFeatures.test.js` — a feature with no surface is neither a toggle nor in the "+".

## Decided, not built

- Lists are not on Today (Frits, round 2 of the walk: only a task that carries a list shows there).
- The lists block is not a circle's default surface: the tab is. A block stays only where a person's own screen
  recipe carries it.

## Open rows

- The person's own lists in the assistant thread ("+"): a second step after the tab.

## Decisions that bind this area

- None recorded in `docs/decisions.md` yet; the tab follows the ledger row's ruling (the settings switch is the tab).
