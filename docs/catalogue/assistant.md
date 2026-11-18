# The person's own assistant (the "+")

The "+" on every tab is a conversation with the person's OWN assistant: one kept thread per self, read by fixed
phrases first and by the person's own model when one is set. It works on the person's own things only (own notes,
own appointments, own lists); a circle's act reaches it through the which-circle card. Started 2026-11-17 with the
assistant-thread build.

## What a person can do

- Ask in their own words ("wat kan je voor me doen?", "waar ligt de sleutel?") and get an answer in words from their
  own model, which is told it is their own place and reads their own notes, appointments and lists, as the self that
  is ticked.
- Say a thing to keep with a phrase, no model needed: "onthoud dat …" opens the note form filled with their words;
  "afspraak vrijdag om half drie tandarts" or "ik moet morgen om 10 naar de kapper" opens the appointment form with
  the day and time read; "zet melk op Vakantie" adds to an own list at once; "wat heb ik (morgen) gepland?" and
  "mijn agenda" say the appointments. Nothing the model proposes happens without a yes: a form's Save, or Bevestigen
  on the card that names the act.
- Say something that belongs in a circle: a line two places can take gets a card naming the act and the places, and
  nothing runs before the pick; an own act the model proposes gets a card naming it, run only on Bevestigen.
- Be answered in the language of the line they wrote, whatever language the turns before were in.
- Type "/" for the same acts the buttons and the model have; picking one opens the same form.
- Hear why the model did not answer: their own model refused (their key or credit, with where the setting is), was too
  slow, or could not be reached; the fixed phrases and buttons still work.
- Follow up on the previous turn ("zet dat morgen om 10 in mijn agenda"); refuse a proposal by closing its form, and
  the thread says it was not saved.
- See at the top which model answers and whether it is confidential; with no model set, learn what works without
  one and where to set one.
- Find the conversation again after closing the app; "Forget this conversation" empties it (stored things stay).
- Tick another self: its own conversation, and nothing of the other self reaches the model.

## Where

- The door, shared by both sheets: `apps/basis/src/assistant/plusDoor.js` (`createPlusDoor`: the plain reading, the
  own gate, the one handler `answer` for a model's pick and a "/" line, the thread, `settled`, `suggest`), the own
  place's catalogue (`ownPlaceCatalogue`, `OWN_PLACE_LINES`), and what the model may read
  (`apps/basis/src/assistant/ownItems.js`).
- The engine the household bot also runs: `apps/basis/src/v2/assistantEngine.js` and `circleDispatch.js` (the peek,
  the claimed-result check); the tool narrowing per line: `toolFamilies.js`.
- The plain reading and the card's words: `apps/basis/src/v2/vandaagPlus.js` (`plusRead`, `plusLineOutcome`,
  `plusDoneLine`, `plusCardWords`); the day and time reader: `apps/basis/src/forms/parseDate.js`.
- The phrases: each app's `gate.<lang>.json` (a verb may be placed `in` the own place:
  `packages/app-manifest/src/gateVerbs.js`) and the basis gate files' word lists (`_refers`, `_lead`, `_ownFamily`,
  `_rare`).
- The model route: `apps/basis/src/v2/userLlmRuntime.js`, `circleLlmProviders.js` (the reasoning switch per model
  family, the per-person prompt-cache salt from `hmacBase64Url` in `packages/core`).
- The sheets: `apps/basis/web/v2/vandaagPlus.js` with `circleApp.js` (web), `apps/basis-mobile/src/screens/v2/`
  `VandaagPlusModal.js` with `CircleLauncherScreen.js` (phone). Their seams: the `plus-*` entries in
  `scripts/shell-seams.mjs`.

<!-- catalogue-ops
assistant: assistant-memory assistant-forget assistant-language
-->

## Proof

- `apps/basis/test/v2/plusDoor.test.js` (the door: the journeys with a stand-in model, the own gate, the budget of a
  request, whose words a turn is), `vandaagPlus.test.js`, `readDayAndTime.test.js`, `circleDispatchNoClaim.test.js`,
  `ownRouteCacheSalt.test.js`, `ownRouteReasoning.test.js`, `listEventsDay.test.js`.
- Browser, with a stand-in model behind the real model interface: `apps/basis/test-browser/plus-story.spec.js`
  (journeys 1 to 4 and 8) and `plus-story-rest.spec.js` (5, 6, 7, 9, 10, 11); `plus-kept-thread`, `vandaag-plus`,
  `plus-circle-act`, `plus-suggestions`.
- Phone: `apps/basis-mobile/e2e/plusStory.test.js`, with a scripted model on the laptop (`e2e/support/standInModel.js`).

## Decided, not built

- The box (the always-on household device) does not compose the own "+": a declared exception until after the alpha
  (the `plus-*` seams name web and the phone only). Its Telegram door runs the same engine over the household's
  things.
- A circle's rows are not read by the own model; a circle act reaches the "+" through the which-circle card only.
- No model route from the deployment for testers in the alpha; a route set by a scanned code comes after it.

## Open rows

- A one-shot reminder due just before midnight must never be lost (runs late and says when it was due): agreed,
  after this build.
- A phone walk of the whole story on a real device, with the scripted model: written, waits for the device.

## Decisions that bind this area

- `docs/decisions.md` 2026-11-17: in the own "+", setting your own route is the agreement (once, not per question);
  it amends 2026-07-18's per-question consent, which stays for the help bot.
- `docs/decisions.md` 2026-11-16: a person's own lists are the self's that made them; read and written as that self.
- `docs/decisions.md` 2026-07-18: the assistant never claims a confidentiality it does not have (the route line).
