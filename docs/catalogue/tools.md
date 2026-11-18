# Tools

A circle uses an outside TOOLBOX: a program that offers TOOLS (one callable function each), answers when asked, keeps
nothing of the circle and acts for nobody. The household bot is the circle's companion: the always-on node a toolbox is
called from, with doors (Telegram, the bot's thread in Basis, a screen) that a person's act comes in through. This page
was started 2026-11-18 with the first toolbox, a grocery search.

## What a person can do

- **A housemate** types a toolbox's word at the household bot: `zoek halfvolle melk` (with or without a slash). The
  bot asks the toolbox's tool and answers with what it found, each with its detail line (size, price). Choosing one to
  put on a list is the next step (choices with buttons).
- **A housemate** sees which toolboxes are on, and their words, in `/help` and the welcome.
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
tools: useTool listTools addToolbox removeToolbox
assistant: assistant-toolbox
-->

## Proof

- `apps/basis/test/v2/toolboxClient.test.js` — the recorded wire: the card without the key, the call's method,
  headers and one data part, every failure as one code, a list of things read as given, prices as cents by string.
- `apps/basis/test/v2/toolboxes.test.js` — a placed toolbox is off until the yes; the card before the yes; the key in
  the request's header only and in no reply, refusal, log line or list; no call leaves for a toolbox that is off, not
  offered or without its key; the gate's words read live.
- `apps/basis/test/v2/toolboxDoor.test.js` — `/toolbox` at the door: the list, the card with Ja/Nee, the yes from the
  admin's private chat only, off.

## Decided, not built

- A toolbox's key handed over from the admin's own app, sealed over the relay (after the alpha; for the alpha the key
  is the operator's).
- A tool call from a screen through the door, the screen client as one file, and the link to a toolbox's own page.

## Decisions that bind this area

- `docs/decisions.md` 2026-11-18: a circle uses an outside toolbox.
