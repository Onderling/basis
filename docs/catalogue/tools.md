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
  Where a door shows pictures (Telegram), the box fetches the pictures from the toolbox's own host for the things that
  are shown as cards first (the first 3 per shop; what is left of the 10 per answer goes to the rest in order), and per
  shop come ONE album of those cards' pictures side by side, each captioned with its number, and ONE message under it:
  the shop, the numbered lines, a "Kies <n>" button per card and one "Meer van <winkel> (n)" (`/meer`,
  `tools.moreThings`), which shows the next ones from the list already fetched, each with its own number. A shop with
  fewer than two pictures gets the message alone (an album of one is refused by Telegram, and one photo alone is drawn
  at the width of the chat). A door without pictures shows the whole list in words.
  The operator's words may carry SLOTS (`slots` on a word in the placed file): phrases that fill a parameter of the
  tool, so `zoek hagelslag bij Albert Heijn` asks for `hagelslag` with `stores: ["ah"]`. A phrase counts only as whole
  words at the start or end of the question, longest first; Basis knows no shop, the phrases and values are the
  toolbox's.
- **A housemate** sees which toolboxes are on, and their words, in `/help` and the welcome.
- **A toolbox's own page** (a static page in the housemate's browser, paired as one of their screens) searches by
  calling `tools.useTool` through the household bot over the relay, as that housemate. The screen holds the op but the
  management screen paints no button for it (`SCREEN_NO_BUTTON`, apart from `BOT_SCREEN_NEVER`, which is what a screen
  can never call). A screen gets the toolbox's own `output` unchanged; a tool's own error as
  `{code: 'tool-error', toolError: {code, params}}`; an answer too large for one relay envelope as `answer-too-large`
  (never cut); over the screen's call budget (3 a second, a burst of 60) `rate-limited`.
  The page does this with the **screen client**, one file built from the web app's own screen code
  (`apps/basis/src/v2/screenClient.js`, built by `apps/basis/scripts/build-screen-client.mjs`; its types in
  `screenClient.d.ts`). The page is bound to its own toolbox: it pairs only for a toolbox that is on, and calls only that
  one (`toolbox-not-yours` otherwise). Every refusal has a fixed code and a call never throws; a grant that ran out and one taken
  away are one code, `grant-expired` (pair again).
  **How the page is reached and what it may do (L1113).** The housemate types `/scherm <toolbox>`; the bot sends, in
  their own private chat only, a link to the page where the operator placed it (an https address, or a loopback
  address `http://localhost:<port>/…` or `http://127.0.0.1:<port>/…`, which works on the same device only; plain
  http on another host only as the operator's explicit choice, `"pageOverHttp": "home-network"` in the placed file, on a
  host of the home network: core's one rule `homeNetworkKind`, the same the relay uses for a plain `ws:` address, minus
  the shared range 100.64/10 (carrier NAT, Tailscale), loopback and a single-label name, declared in `toolboxes.js` with the reason; the card
  says the risk before the yes; any other http address is not kept), carrying a one-use ticket (short-lived,
  bound to that housemate and that toolbox). The page hands the ticket back in its offer; the bot reads the toolbox from
  the ticket, never from the page's own words, and then asks the housemate for the code as for any screen. A toolbox
  offer without a ticket, with a used, expired or someone else's ticket, or naming another toolbox, is refused in words
  before anything is asked. The grant is `tools.useTool` for that toolbox plus the household ops the OPERATOR placed for
  the page, each only if the housemate's own role holds it; the question lists them in words. Basis's own screen keeps
  the role's whole column. A page paired before this was ended once at the upgrade, and its housemate told how to
  reconnect.
- **A housemate** opens a toolbox's page that the BOX serves itself: when the operator placed the page's files on the
  box, the link `/scherm <toolbox>` sends also carries an entry in its query (`?e=`), made with the ticket and as
  short-lived. The box's page server (localhost only; the operator's https server in front is what the home network
  reaches) spends it once into a cookie for that toolbox's path (`HttpOnly; Secure; SameSite=Strict`, 30 days, this
  device) and serves the page's files; without a live entry or cookie it answers a refusal page in words that says to
  ask the bot for a link. A housemate who is revoked, or a toolbox switched off, ends the cookies at once. The entry
  and the cookie only open the files; what the page may DO is still its paired grant.
  **This cookie is Basis's only one, on purpose.** Basis keeps no state in cookies (Frits 2026-11-26): a device's state
  lives in the storage register, sealed where it is content. The toolbox page's cookie holds no data: it is a server
  deciding who may load a page's files. `lint-no-cookies` (in `npm run guards`) is red on any other cookie use in
  shipped code, naming the line and what to use instead, and it is red when this exception stops using a cookie.
- **The household's admin** types `/toolbox`: the toolboxes the box's operator placed, each with its words and whether
  it is on. `/toolbox <naam> aan` shows the toolbox's card (its name, address, words and what it receives) and switches
  it on after their yes, in their own private chat only. `/toolbox <naam> uit` switches it off.
- **The box's operator** places a toolbox: two files on the box (its name, address and words; its key). No chat line
  ever carries an address, a tool id or a key. A toolbox with a page names it in the same file: `page` (its https
  address) and `ops` (the household ops the page may use beside the toolbox, `app.op`). A change to any of these is a
  new card for the admin's yes.

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
- A page served from the box: `apps/basis/src/v2/toolboxPages.js` (`createPageEntries`, the sealed store of entries and
  cookies; `createToolboxPages`, the localhost page server), composed in `apps/basis/bin/device-runner.mjs`
  (`toolbox-pages.json` in the data dir; port `tools.pagePort`, or `ONDERLING_TOOLBOX_PAGE_PORT`). The page's files:
  `<data-dir>/toolboxes/<name>/page/`, its placed `page` the front server's address ending in `/<name>/`. The entry in
  the link: `toolboxStart` in `apps/basis/src/v2/botScreens.js`.

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
- `apps/basis/test/screenClient.box.test.js` — the built screen client against the real box over the real relay: it
  pairs for its toolbox only from the link `/scherm <toolbox>` sends (a page from Basis's own start address, or the
  same link twice, is refused in words), holds `useTool` and the placed ops only, `useTool` answers, another toolbox
  gives `toolbox-not-yours`, an op it does not hold `op-not-allowed`. `apps/basis/test/v2/botScreens.test.js` — the
  grant's scope, the ticket (one use, the person's own, in time, its toolbox), the upgrade's one pass. `apps/basis/test/v2/screenClient.test.js` — codes, states, pairing, storage per toolbox, sign-out.
- `apps/basis/test/v2/toolboxPages.test.js` — the page server over real http: localhost only and only while a toolbox
  with a page is on; no entry or cookie refused in words; an entry spent once into a path-scoped cookie; another
  toolbox's entry, an old one, a revoked person's cookie refused; nothing outside the page folder (`..`, encoded
  slashes, dot files, a link out, other types, no listing); no other method; no secret in a log line or the store.
  `apps/basis/test/toolboxPage.box.test.js` — the same on the booted box: a housemate admitted by invite gets the link,
  enters once, and is out after `/revoke`; the listener closes when the toolbox is switched off.
- `apps/basis/test/v2/toolboxDoor.test.js` — `/toolbox` at the door: the list, the card with Ja/Nee, the yes from the
  admin's private chat only, off.
- `apps/basis/test/v2/toolboxSlots.test.js` — a word's slot phrases fill a tool parameter, only as whole words at the
  start or end, longest first; `apps/basis/test/telegram/toolboxCardsOrWords.test.js` — an album per shop and one
  message with the lines and buttons, no album for fewer than two pictures; `apps/basis/test/toolboxButtons.box.test.js`
  — the same on the booted box through a Bot API of our own (`sendMediaGroup`), and a slot reaching the toolbox.

## Decided, not built

- The https server in front of the box's page server (its certificate, its one port on the home network, one name or
  port per toolbox so each page has an origin of its own): the operator's, not built here.

- A toolbox's key handed over from the admin's own app, sealed over the relay (after the alpha; for the alpha the key
  is the operator's).
- A link from Basis's own app to a toolbox's page (the bot's `/scherm <toolbox>` link is built; a button in the app is
  not).

## Decisions that bind this area

- `docs/decisions.md` 2026-11-18: a circle uses an outside toolbox.
- `docs/decisions.md` 2026-11-20: a toolbox's page may be served from the box itself.
