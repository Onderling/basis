# The functionality catalogue

One page per capability AREA, beside `docs/architecture.md` (the abstract core). The architecture says how the
machine is shaped; a catalogue page says what a person can do in one area, where that lives, what proves it, what
was decided not to build, and which ledger rows are open. The areas are the MODULES of a modular Basis: a page's
"where" section is the module boundary (which manifests, which packages).

Five fixed headings per page: **what a person can do · where · proof · decided, not built · open rows**, and a
closing **decisions that bind this area** (links into `docs/decisions.md`).

Guard: `scripts/lint-catalogue-ops.mjs` (in `npm run guards`): every op in every app manifest is named on exactly one
page, in that page's `<!-- catalogue-ops -->` block (one line per app: `tasks: addTask claimTask …`). The ops of the
areas whose page is still owed sit in `scripts/catalogue-ops-baseline.json`; that list may only shrink. Writing a
page: add its block, then `node scripts/lint-catalogue-ops.mjs --update`.

Rule for anyone ruling on absence: before "not built" or "needs design", read the area's page, grep
`apps/*/manifest.js` and the locale file, grep `plans/` including `archive/`, and say what was checked.

| Page | Area | State |
|---|---|---|
| [tasks-and-dispatch.md](tasks-and-dispatch.md) | tasks, chores, claims, subtasks, approval, mandates, skill dispatch | first draft 2026-10-23 |
| circles-and-pinboard | circles, membership, governance, posts, requests | owed |
| calendar | appointments, rsvp, week overview | owed |
| lists | plain lines, sendable lists | owed |
| household-bot | the bot in a circle: add/done, nudges, digests | owed |
| nearby | rooms, levels, connection points, LAN/BLE | owed |
| contacts-and-personas | contacts, trust, personas, disclosure, Mij | owed |
| feedback | the feedback app (its own repo; one row here) | owed |
| relay-and-box | relay, the always-on box, companion, delivery ladder | owed |
