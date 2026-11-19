# Tools

A circle uses an outside TOOLBOX: a program that offers TOOLS (one callable function each), answers when asked, keeps
nothing of the circle and acts for nobody. The household bot is the circle's companion: the always-on node a toolbox is
called from, with doors (Telegram, the bot's thread in Basis, a screen) that a person's act comes in through. This page
was started 2026-11-18 with the first toolbox, a grocery search.

## What a person can do

- **A housemate** types a toolbox's word at the household bot: `zoek halfvolle melk` (with or without a slash). The
  bot asks the toolbox's tool and answers with what it found, each with its detail line (size, price) and a button.
  The button (`/kies <n>`) puts that thing on the list of the shop that sells it, else on the shopping list, else the
  bot asks which list; it carries the thing's reference and a quantity of 1, as the person who tapped.
  The same answer in words, at every door (also Basis's own bot thread, which has no buttons yet): the list is
  numbered, and `2` or `kies 2` picks the second thing of the LAST list shown in that thread. A number with no list
  open there is an ordinary line. The same thing again raises its quantity.
  Where a door shows pictures (Telegram), the box fetches each thing's picture from the toolbox's own host and each
  thing comes as a photo card with its number and button, at most 3 per shop; the rest of that shop sits behind one
  button, "Meer van <winkel> (n)" (`/meer`, `tools.moreThings`), which shows the next ones from the list already
  fetched, each with its own number. A door without pictures shows the whole list in words.
- **A housemate** sees which toolboxes are on, and their words, in `/help` and the welcome.
- **A toolbox's own page** (a static page in the housemate's browser, paired as one of their screens) searches by
  calling `tools.useTool` through the household bot over the relay, as that housemate. The screen holds the op but the
  management screen paints no button for it (`SCREEN_NO_BUTTON`, apart from `BOT_SCREEN_NEVER`, which is what a screen
  can never call). A screen gets the toolbox's own `output` unchanged; a tool's own error as
  `{code: 'tool-error', toolError: {code, params}}`; an answer too large for one relay envelope as `answer-too-large`
  (never cut); over the screen's call budget (3 a second, a burst of 60) `rate-limited`.
- **The household's admin** types `/toolbox`: the toolboxes the box's operator placed, each with its words and whether
  it is on. `/toolbox <naam> aan` shows the toolbox's card (its name, address, words and what it receives) and switches
  it on after their yes, in their own private chat only. `/toolbox <naam> uit` switches it off.
- **The box's operator** places a toolbox: two files on the box (its name, address and words; its key). No chat line
  ever carries an address, a tool id or a key.

## Where

- The ops: `apps/basis/src/v2/toolsManifest.js` (`tools`: `useTool`, `listTools`, `addToolbox`, `removeToolbox`), a
  door manifest of the box (beside `assistant`), mounted on the box's waist in `apps/basis/bin/device-runner.mjs`.
- The toolboxes and the four ops over them: `apps/basis/src/v2/toolboxes.js` (`makeToolboxOps`; `toolboxGateRule`, the
  deterministic gate's rule for a toolbox's words; the door's words for a refusal, a help line and the welcome line).
- The wire: `apps/basis/src/v2/toolboxClient.js`, A2A 1.0 over HTTP (the card at `/.well-known/agent-card.json`,
  JSON-RPC `SendMessage`, `A2A-Version: 1.0`, a bearer key). Not core's native A2A path, which speaks an earlier draft.
- The door command: `/toolbox` (`assistant-toolbox` in `apps/basis/src/v2/assistantManifest.js`, `toolboxOp` in
  `apps/basis/src/v2/assistantOps.js`).
- The operator's step: `deploy/roles/assistant.yml` (the files in the service's data volume).

<!-- catalogue-ops
tools: useTool pickThing moreThings listTools addToolbox removeToolbox
assistant: assistant-toolbox
-->

## Proof

- `apps/basis/test/v2/toolboxClient.test.js` — the recorded wire: the card without the key, the call's method,
  headers and one data part, every failure as one code, a list of things read as given, prices as cents by string.
- `apps/basis/test/v2/toolboxes.test.js` — a placed toolbox is off until the yes; the card before the yes; the key in
  the request's header only and in no reply, refusal, log line or list; no call leaves for a toolbox that is off, not
  offered or without its key; the gate's words read live.
- `apps/basis/test/v2/toolboxChoices.test.js` — a button per thing; the tap adds that thing (its reference, quantity 1)
  to the seller's list, else the shopping list, else asks; only from the thread it was shown in.
- `apps/basis/test/v2/toolboxDoor.test.js` — `/toolbox` at the door: the list, the card with Ja/Nee, the yes from the
  admin's private chat only, off.

## Decided, not built

- A toolbox's key handed over from the admin's own app, sealed over the relay (after the alpha; for the alpha the key
  is the operator's).
- A tool call from a screen through the door, the screen client as one file, and the link to a toolbox's own page.

## Decisions that bind this area

- `docs/decisions.md` 2026-11-18: a circle uses an outside toolbox.
