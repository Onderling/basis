# Manifest → catalogue → screen pipeline

How the per-app manifests feed into both the dispatch pipeline and
the on-screen nav UI in basis-mobile.  Written 2026-05-26
after a household-bug surfaced the dual-truth gotcha between
`composeManifests` and `buildNavModels`.

## Big picture

Each app declares a single **manifest** (ops, item types, surfaces).
The chat shell fans that manifest out into **two independent
projections**, which then drive different runtime concerns:

```
                     ┌──────────────────────────────────────┐
                     │  Per-app manifests                   │
                     │  (declarations: ops, item types,     │
                     │   surfaces.slash, surfaces.chat,     │
                     │   surfaces.tab, …)                   │
                     └────────────┬─────────────────────────┘
                                  │
                ┌─────────────────┴───────────────────┐
                ▼                                     ▼
   ┌─────────────────────────┐         ┌────────────────────────┐
   │ composeManifests()      │         │ buildNavModels()       │
   │   merges all manifests  │         │   projects EACH one    │
   │   via mergeManifests()  │         │   via renderMobile()   │
   │                         │         │                        │
   │ → catalogue               │         │ → [{appOrigin, nav}…]  │
   │   { opsById,            │         │   one entry per app    │
   │     appOrigins,         │         │                        │
   │     commandMenu, … }    │         │                        │
   └─────────┬───────────────┘         └────────────┬───────────┘
             │                                      │
             ▼                                      ▼
   ┌──────────────────────┐           ┌───────────────────────────┐
   │ Dispatch pipeline    │           │ Boot debug UI (V1) /      │
   │ (parseInput →        │           │ screens per app (later)   │
   │  resolveDispatch →   │           │                           │
   │  runDispatch →       │           │                           │
   │  renderReply)        │           │                           │
   └──────────────────────┘           └───────────────────────────┘
```

The crucial property: **both branches must list the same set of
apps in the same order.** They're two views on one identity; if
they drift, the chat works but the screens disagree (or vice
versa) — which is exactly the bug behind the missing household
box on 2026-05-26.

## Cast of characters

### Per-app manifests

Static declarations.  Each lives next to (or inside) the app it
describes:

- `basisManifest` — re-exported from `apps/basis/src/index.js`.
  Owns chat-shell-host ops (`/help`, `/threads`, `/settings`,
  `/holiday-mode`, `/commands`, `/logs`, `/debug-dump`, …).
- `mockHouseholdManifest` — `apps/basis/src/core/agent/mockAgent.js`.
  Declares `/mine`, `markComplete`, etc.  Reads "mock" but is the
  real declaration that the *production* household agent (booted by
  realAgent.js) responds to.
- `mockTasksManifest`, `mockStoopManifest`, `mockFolioManifest` —
  `apps/basis/src/core/manifests/mockManifests.js`.  Same
  pattern: declarations live in basis's core, the actual
  skill implementations sit in `apps/<app>/src/browser.js`.
- `calendarManifest` — `apps/calendar/manifest.js`.  In-tree.

Each manifest has at minimum:
```
{ app: 'household', itemTypes: [...], operations: [{id, verb, params, surfaces}, …] }
```

The `app:` field is the **appOrigin** that both `appOrigins` and
NavModel keys end up using.

### `composeManifests({ householdManifest? })`

`apps/basis-mobile/src/core/composeManifests.js`.  Merges
every manifest into one **catalogue** via the shared
`mergeManifests()` from `@onderling/app-manifest`.

What you get back:
```
{
  opsById:     Map<opId, {appOrigin, opEntry, …}>,
  appOrigins:  Set<appOrigin>,
  commandMenu: [{command, opId, hint}, …],   // for slash autocomplete
  …  // see packages/app-manifest for the full schema
}
```

The catalogue is what the **dispatch pipeline** consumes
(`parseInput` looks up commands here, `resolveDispatch` finds the
op + its appOrigin).  The default-included set is:
1. `basisManifest`
2. `mockHouseholdManifest`  (or override via `opts.householdManifest`)
3. `mockTasksManifest`
4. `mockStoopManifest`
5. `mockFolioManifest`
6. `calendarManifest`

### `buildNavModels({ householdManifest? })`

`apps/basis-mobile/src/core/navModel.js`.  Walks the SAME six
manifests and projects each through **`renderMobile()`** to get a
per-app NavModel.

Why a parallel list instead of deriving from the catalogue?  The
catalogue is a flat dispatch index optimised for "given an op, who
handles it?"; NavModels are a per-app *surface* projection
optimised for "what screens does this app want to show?".  The two
shapes don't fold into each other cleanly today.

The contract: **its result has one entry per manifest, in the same
order as composeManifests's input.** When they drift, the
boot-debug list desyncs from the merged catalogue — the symptom is
exactly the "5 apps but I see /post and /feed work fine" mismatch
we hit 2026-05-26.

### `renderMobile(manifest) → NavModel`

`packages/app-manifest/src/renderMobile.js`.  A **strict-equivalence
re-export of `renderWeb`** — same projection function, just badged
for mobile so future divergence (e.g. tab nav vs sidebar nav) has
a name to hang on.

The equivalence is enforced by
`packages/app-manifest/test/crossSurfaceEquivalence.test.js` — if
you ever need to special-case mobile, that test will fail and tell
you to think twice.

NavModel shape:
```
{
  sections: [{label, items: [{label, opId, …}, …]}, …],
  globals:  [{label, opId, …}, …],   // floating actions / FAB candidates
  // potentially more in later renderMobile revisions
}
```

### The agent bundle

`bootAgentBundle()` returns:
```
{
  catalogue,     // from composeManifests — feeds the dispatch pipeline
  callSkill,   // (appOrigin, opId, args) → Promise<payload>
               //   routes through the in-process realAgent
  agent,       // the realAgent controller (or null in test stubs)
  transport,   // { kind: 'none' | 'nkn' | 'stub', connected? }
  dispose,
}
```

`callSkill` is the dispatch's terminal.  It knows about:
- household (built into realAgent itself)
- tasks-v0 (via `createBrowserTasksAgent`)
- stoop (via `createBrowserStoopAgent`)
- folio (via `createBrowserFolioAgent`)
- calendar — depends on whether the calendar browser-factory has
  been composed in; currently the calendar manifest is in the
  catalogue but the dispatch may not have a backing agent on mobile
  yet (see #238).

It **does NOT know about `basis`** as an app — those ops are
chat-shell-host concerns (open a thread, toggle holiday mode,
print logs, …) that web routes through `localBuiltins` instead.
The mobile shell currently short-circuits `appOrigin ===
'basis'` with a friendly "not wired on mobile yet" reply;
porting `localBuiltins` is a later #253 sub-step.

## The dispatch pipeline

User input enters via either the bottom `TextInput` or the
`SlashFAB` modal.  Both call the same `submitInput(rawInput)`,
which runs:

```
parseInput(rawInput, catalogue)
   → ParseResult {kind: 'slash'|'unknown'|'error', opId?, args?, threadId?}

resolveDispatch(parseResult, catalogue)
   → Dispatch {kind: 'ready'|'unknown'|'error', opId, args, appOrigin,
               threadId, replyShape}

if (dispatch.appOrigin === 'basis')      // short-circuit V1
   → synthetic 'text' RenderedReply
else if (dispatch.kind === 'ready')
   → runDispatch(dispatch, bundle.callSkill)
        → Reply {payload, shape, threadId, error?}
   → renderReply(reply, {catalogue})
        → RenderedReply {kind: 'text'|'list'|'error', …}
```

The chat then appends a user-bubble + a bot-bubble for each
round-trip.

## Common gotchas

### "I see 5 apps but the slash commands work for the missing one"

Means composeManifests has it but buildNavModels doesn't (or
vice versa).  Inspect both lists side by side.

### "Red bubble: realAgent unknown appOrigin 'basis'"

The dispatch pipeline routed a basis-host op to the agent's
`callSkill` instead of `localBuiltins`.  Fix: intercept
`dispatch.appOrigin === 'basis'` BEFORE calling
`runDispatch` (or port the actual `localBuiltins` from
`apps/basis/src/core/localBuiltins.js` — that's #253's
later sub-step).

### "I added a manifest but the catalogue is missing ops"

Check that the manifest was passed to `mergeManifests` (i.e. is in
the `composeManifests` entries list) AND has a sensible
`operations[].surfaces.slash.command` if you want it in the
slash-autocomplete `commandMenu`.

### "I added a manifest but the screen list doesn't include it"

You forgot to add it to `buildNavModels` too.  Both lists.  Every
time.  Yes, the duplication is unfortunate — see the next section
for the cleanup path.

## Future cleanup — collapse the dual-truth

The two lists in `composeManifests` and `buildNavModels` are an
obvious place for drift.  A future refactor should make one
derive from the other:

- **Option A:** `buildNavModels` takes a list of manifests as an
  argument (a single shared `MANIFESTS` constant exported from a
  third file).  Both functions consume that constant.  Minimal
  churn; one source of truth.
- **Option B:** `buildNavModels` takes the *catalogue* and derives
  NavModels by re-reading per-app subsets.  Higher coupling but
  removes the duplication entirely.

Either way, the test pyramid for this is:
- `test/bootSmoke.test.js` already checks that all 5 (now 6) apps
  appear in `composeManifests().appOrigins`.  Add a parallel
  assertion that `buildNavModels()` returns the same set.

Until that lands, the README of this app should remind contributors
to update **both** functions when adding a manifest.

## See also

- `apps/basis-mobile/src/core/composeManifests.js`
- `apps/basis-mobile/src/core/navModel.js`
- `apps/basis-mobile/src/screens/ChatScreen.js` — the
  submitInput pipeline implementation
- `apps/basis/src/index.js` — exports
  `mergeManifests` / `parseInput` / `resolveDispatch` /
  `runDispatch` / `renderReply` / `basisManifest`
- `apps/basis/web/main.js` — the canonical web pipeline
  this mobile shell mirrors
- `apps/basis/src/core/localBuiltins.js` — the
  basis-host op handlers that #253's later sub-steps will
  port to RN
- `packages/app-manifest/src/renderMobile.js` — the projector
  that's strict-equivalent to `renderWeb`
- `packages/app-manifest/test/crossSurfaceEquivalence.test.js` —
  the test that keeps the two projections in lockstep
