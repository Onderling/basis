# The screen client: notes for a toolbox's page

The screen client is ONE file a toolbox's own page imports to be a connected screen of a household bot. It is built from
`apps/basis/src/v2/screenClient.js` by `apps/basis/scripts/build-screen-client.mjs` into
`apps/basis/dist/screen-client/onderling-screen-client.js`, with `onderling-screen-client.d.ts` and `VERSION` beside it. It is
the web app's screen shell without the paint: the same `createScreenView` and the same browser agent.

## Using it

```js
import { createScreenClient } from './onderling-screen-client.js';
const client = createScreenClient({ toolbox: 'boodschappen', bot: '<the bot\'s start link>', label: 'boodschappen op de laptop' });
const back = await client.resume();               // {ok: true}, or {ok: false, code: 'not-paired'}: pair again
if (!back.ok) {
  const { paste, code, expiresAt } = await client.startPairing();
  // show `code`; ask the person to paste `paste` into their own chat with the bot and pick that code
  const outcome = await client.waitForGrant();    // 'granted' | 'refused' | 'expired'
}
const found = await client.call('tools.useTool', { toolbox: 'boodschappen', tool: 'products.search', input: { query: 'melk' } });
```

- **The bot's start link** is what the household's admin gets from `/scherm` (the address a screen opens to make its own
  connect code: `…#scherm-nieuw=…`). A page opened from disk has no link of its own, so it is given this once (by the
  person, or in the toolbox's install).
- **One toolbox per page.** The pairing names the toolbox; the bot pairs only a toolbox that is ON there (else the person
  is told so in their chat, and nothing is asked), and `tools.useTool` from this page runs only for that toolbox
  (`toolbox-not-yours` otherwise). The toolbox name and the label are the page's own claim: the person's pick of the code
  in their own chat is the gate.
- **Nothing runs at import.** The file touches no global and opens nothing until a method is called.
- **The form:** an ES module. A page opened from disk cannot load a module script in Chromium (`file://` is refused), so
  the toolbox folds the file into its own classic script (`esbuild page.js --bundle --format=iife`); the file has no
  `import()`, no worker and no wasm, so this works.

## Every code

| code | when |
|---|---|
| `not-paired` | nothing kept in this browser, or a call before pairing |
| `grant-expired` | the grant ran out, or was taken away (`/schermen los`, a pairing elsewhere): one code for both, pair again |
| `rate-limited` | past the bot's budget: 3 calls a second, a burst of 60, per screen |
| `no-connection` | no relay connection; the state is `broken` until a call gets through again |
| `timeout` | no answer within the call's `timeoutMs` (30 seconds without one) |
| `aborted` | the call's `signal` fired |
| `op-not-allowed` | an op this screen's grant does not hold (`ops()` lists what it holds) |
| `toolbox-unreachable` | the toolbox did not answer, or is off (its own codes folded into one) |
| `toolbox-not-yours` | `tools.useTool` for another toolbox than this page's |
| `answer-too-large` | an answer larger than one relay envelope: ask for less, never cut |
| `tool-error` | the toolbox's own error, with `toolError: {code, params}` as it gave them |
| `not-found` | e.g. `removeList` of a list that does not exist |
| `failed` | anything else |

Calls may run at once. A changed list is told by `onNudge` (the bot nudges a screen when what it reads changed): no need
to poll; without a nudge, one `lists.listEntries` a minute is well within the budget.

## Storage, and what each browser does from disk

The grant and the key are kept under this toolbox's name (`onderling.screen.<toolbox>.…` and
`onderling-screen:<toolbox>:…`); `signOut()` removes exactly those. Never assume storage survives: `resume()` says
`not-paired` when nothing is kept, and the page pairs again.

- **Chromium (tried 2026-11-19, `test-browser/screen-client-file.spec.js`):** `file://` storage is ONE store shared by every
  local page: a page in another folder reads what this one wrote. So another local html file can read this page's screen
  key. That is a known limit of running from disk (a hosted page on an origin of its own does not have it).
- **Firefox:** not tried; it is not installed on the build machine. To be tried before a toolbox ships to people who use
  it.

## Proof

- `test/v2/screenClient.test.js`: codes, states, pairing in steps, storage per toolbox and sign-out, abort and time-out.
- `test/screenClientBundle.test.js`: the one file, its `.d.ts` and VERSION, no `import()`/worker/wasm, nothing at import.
- `test/screenClient.box.test.js`: the BUILT file pairs over the real relay with the real box for its toolbox, gets the
  toolbox's own output, is refused another toolbox that is on too and an op it does not hold; a page for a toolbox that
  is not on is refused in words.
- `test/relayAcceptsAnyOrigin.relay.test.js`: the relay accepts `Origin: null` (a page from disk).
- `test-browser/screen-client-file.spec.js`: the file folded into a classic script, from `file://`, in Chromium.
