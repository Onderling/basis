# Part C — gate audit plan (workflow wf_03b3a76e-d57, 2026-06-11)

This confirms the first-match-wins semantics. The renderGate that compiles manifest `match` blocks into ordered rules is the consumer; cross-app ordering is determined by manifest registration order. I have everything needed. Let me produce the plan.

I've verified all load-bearing claims against the live main-tree files: the canonical `match` block shape (`verbs`/`body`/`arg`/`dropTrailing`, multiword phrases as token arrays), the `pickerSource:{listOp}` param convention, the three broken stoop blocks (`signOutOfPod` body:'reject' @1011, `markReturned` @660-676, `reportPost` @1026-1039, `getItemTree` @980-991, `listOpen` type-only @1058), and first-match-wins in tokenGate. Here is the plan.

---

# Part C — NL Gate Wiring: Implementation Plan

All proposals target the **mock catalog the gate actually consumes** (`mockManifests.js` + `mockAgent.js` + `apps/calendar/manifest.js`), not the app-local `manifest.js` skill files. Schema conventions verified against the live `claimTask`/`completeTask`/`addtask` blocks: multiword verbs are token arrays (`['new','task']`), `match` keys are `verbs`/`body`/`arg`/`dropTrailing`, and label→id ops carry `pickerSource:{ listOp }` on the target param.

**Collision decisions are folded in below** — losers already have the bare token removed from their `verbs` list.

---

## FILE 1 — `src/core/manifests/mockManifests.js`

### Tasks app

**`submitTask`** (~line 177) — `id` already has `pickerSource:{listOp:'listMine'}`. Add match block:
```js
match: {
  verbs: ['submit', ['hand', 'in'], 'indienen', 'inleveren', ['ter', 'review']],
  body:  'match',
  arg:   'id',
}
```

**`approveTask`** (~line 197) — bare `accept` **DROPPED** (collision → calendar). Add match block + add pickerSource:
```js
match: {
  verbs: ['approve', 'goedkeuren', 'akkoord'],   // NO 'accept'
  body:  'match',
  arg:   'id',
}
```

**`rejectTask`** (~line 212) — keeps `reject`/`afwijzen` (wins both collisions). Add match block + add pickerSource:
```js
match: {
  verbs: ['reject', 'afkeuren', 'afwijzen', 'weiger'],
  body:  'match',
  arg:   'id',
}
```

### Stoop app

**`postRequest`** (~line 567) — bare `share`/`deel` **DROPPED** (collision → folio). Add match block:
```js
match: {
  verbs: ['post', 'ask', 'borrow', 'vraag', 'plaats', 'leen', ['bied', 'aan']],  // NO 'share'/'deel'
  body:  'text-only',
  dropTrailing: ['to', 'aan', 'op', 'in', 'voor'],
}
```

**`respondToItem`** (~line 629) — partial gate (binds `itemId` only; `body` is required and elicited by form). Add match block + add pickerSource:
```js
match: {
  verbs: [['help', 'with'], ['respond', 'to'], 'offer', ['ik', 'help'], ['help', 'met'], ['reageer', 'op'], ['bied', 'hulp']],
  body:  'match',
  arg:   'itemId',
}
```

**`markReturned`** (~line 660) — **FIX broken block** (current: `body:'match'`, no `arg`, label dropped). Replace the existing match with:
```js
match: {
  verbs:   ['returned', 'teruggebracht', 'terug', ['mark', 'returned']],
  body:    'match',
  arg:     'itemId',
  onEmpty: { skillId: 'markReturned', args: {} },
}
```

**`reportPost`** (~line 1026) — **FIX broken block** (current: `body:'match'`, no `arg`, label dropped; `reason` stays optional/form). Replace match with:
```js
match: {
  verbs:   ['report', 'flag', 'rapporteer', 'meld'],
  body:    'match',
  arg:     'itemId',
  onEmpty: { skillId: 'reportPost', args: {} },
}
```

**`signOutOfPod`** (~line 1003) — **FIX broken block**. `body:'reject'` (line 1011) is an invalid body kind and would throw in renderSlash. **Remove the entire `match` block**; keep `slash:{ command:'/sign-out' }` and the confirm-gated UI button. No gate verb.

**`getItemTree`** (~line 980) — **Remove the `match` block entirely** (debug tree-walk, not an NL command). Keep the literal `/tree` slash command.

**`listOpen`** (~line 1046) — **Remove the `match` block entirely** (mis-wired `type-only` against a nonexistent `type` param; no typeAliases declared). Keep `/bulletin` + its `shape`. List op, no gate verb.

### Folio app

**`shareFolder`** (~line 1096) — **owns `share`/`deel`** (collision winner). Partial gate: `with` (webid, required) can never be filled by a one-line body, so every dispatch will `needsForm` for the recipient — same two-required-arg limitation that got `reassign`/`assignLend` skipped. **Decision: keep as an explicitly partial gate** (fills `folder` only; recipient elicited). Add match block:
```js
match: {
  verbs: ['share', 'deel'],
  body:  'text-only',
  arg:   'folder',
  dropTrailing: ['with', 'to', 'met', 'aan'],
}
```
> If the human prefers symmetry with the skipped two-arg ops, skipping `shareFolder` from the gate is also acceptable — but then `share`/`deel` become unclaimed, which is fine.

**`downloadFile`** (~line 1141) — add match block + add pickerSource:
```js
match: {
  verbs: ['download', 'haal', ['haal', 'op'], ['download', 'bestand']],
  body:  'match',
  arg:   'path',
}
```

**`saveToMyPod`** (~line 1160) — add match block + add pickerSource (no required param; `path` is the natural target):
```js
match: {
  verbs: ['save', 'bewaar', ['save', 'to', 'my', 'pod'], 'opslaan', ['bewaar', 'in', 'mijn', 'pod']],
  body:  'match',
  arg:   'path',
}
```

**`syncOnce`** / **`watchStart`** — `runtime:'node'`, filtered out of the browser bundle (fire only in sidecar mode, like the existing `/sync` `/watch`). Add no-arg match blocks:
```js
// syncOnce
match: { verbs: ['sync', 'synchroniseer', 'synchroniseren'], body: 'none' }
// watchStart
match: { verbs: ['watch', ['watch', 'folder'], ['let', 'op'], 'bewaak', ['bewaak', 'map']], body: 'none' }
```

### pickerSource additions — FILE 1
Add `pickerSource: { listOp: '<x>' }` to the **target param** of these ops (the rest already have it):

| op | param | listOp |
|---|---|---|
| `approveTask` | `id` | `listMine` |
| `rejectTask` | `id` | `listMine` |
| `respondToItem` | `itemId` | `listFeed` |
| `markReturned` | `itemId` | `listFeed` |
| `reportPost` | `itemId` | `listFeed` |
| `downloadFile` | `path` | `listFiles` |
| `saveToMyPod` | `path` | `listFiles` |

(`submitTask.id`, `postRequest` (none needed), `shareFolder.folder` (text-only add → no picker), `syncOnce`/`watchStart` (no params) need none.)

---

## FILE 2 — `src/core/agent/mockAgent.js` (household-mock)

`markComplete.choreId` and `removeChore.choreId` already have `pickerSource:{listOp:'listOpen'}` (lines 59-61, 142-143). No pickerSource additions needed in this file.

**`addChore`** (param `label`) — add match block:
```js
match: {
  verbs: ['add', ['new', 'chore'], 'toevoegen', 'noteer', ['voeg', 'toe']],
  body:  'text-only',
  arg:   'label',
  dropTrailing: ['to', ['to', 'the', 'list'], 'op', 'aan', ['aan', 'de', 'lijst'], 'toe'],
  split: true,
}
```

**`addMember`** (param `name`) — add match block:
```js
match: {
  verbs: ['register', ['add', 'member'], 'registreer', 'naam', ['lid', 'toevoegen']],
  body:  'text-only',
  arg:   'name',
}
```

**`markComplete`** (param `choreId`) — add match block:
```js
match: {
  verbs: [['klaar', 'met'], 'done', 'complete', 'did', 'finished', 'bought', 'klaar', 'gedaan', 'gekocht'],
  body:  'match',
  arg:   'choreId',
  split: true,
}
```

**`removeChore`** (param `choreId`) — bare `cancel` **DROPPED** (collision → calendar). Add match block:
```js
match: {
  verbs: ['remove', 'delete', 'nope', 'verwijder', 'weg'],   // NO 'cancel'
  body:  'match',
  arg:   'choreId',
  split: true,
}
```

**`listOpen`** (params: `[]`) — body must be `'none'` (no `type` param, so NOT `type-only`):
```js
match: {
  verbs: ['list', 'show', 'mine', 'lijst', 'toon'],
  body:  'none',
}
```

> **Byte-equivalence caution:** household-mock is the golden parity reference. These are purely **additive** match blocks under `surfaces.slash`; do not touch any existing op shape, param order, or skill IDs. Verify the household byte-equivalence test still passes after the edit.

---

## FILE 3 — `apps/calendar/manifest.js` (calendar)

All five ops' `id` param already has `pickerSource:{listOp:'listEvents'}` (lines 94/110/126/142 for the rsvp/cancel ops). **No pickerSource additions needed.**

**`addEvent`** (param `title`) — add match block:
```js
match: {
  verbs: ['schedule', ['add', 'event'], ['new', 'event'], ['add', 'appointment'], ['new', 'appointment'], 'afspraak', 'plan', ['zet', 'afspraak'], ['nieuwe', 'afspraak']],
  body:  'text-only',
  arg:   'title',
  dropTrailing: ['to', 'with', 'op', 'met', 'toe'],
}
```

**`rsvpAccept`** (param `id`) — **owns `accept`** (collision winner vs tasks):
```js
match: { verbs: ['accept', ['accept', 'invite'], 'yes', 'accepteer', 'ja', ['ik', 'kom']], body: 'match', arg: 'id' }
```

**`rsvpDecline`** (param `id`) — bare `reject`/`afwijzen` **DROPPED** (collision → tasks):
```js
match: { verbs: ['decline', ['decline', 'invite'], 'no', ['wijs', 'af'], 'nee', ['ik', 'kom', 'niet']], body: 'match', arg: 'id' }
```

**`rsvpTentative`** (param `id`):
```js
match: { verbs: ['tentative', 'maybe', 'misschien', ['onder', 'voorbehoud']], body: 'match', arg: 'id' }
```

**`cancelEvent`** (param `id`) — **owns `cancel`** (collision winner vs household). Multiword forms before bare token:
```js
match: { verbs: [['cancel', 'event'], ['cancel', 'appointment'], 'cancel', ['annuleer', 'afspraak'], 'annuleer', ['zeg', 'af']], body: 'match', arg: 'id' }
```

---

## (a) Cross-app verb-ordering note for renderGate

`tokenGate` is strictly **first-match-wins** across the flattened ordered rule list (`src/v2/tokenGate.js:27` — `for (const rule of ruleList)`), and cross-app ordering follows manifest registration order. The six collisions are resolved **by removing the bare token from the loser**, so ordering between apps is no longer load-bearing for them — but two intra-op orderings still matter:

- **`cancelEvent`**: list `['cancel','event']` and `['cancel','appointment']` BEFORE bare `'cancel'`, so "cancel event Foo" doesn't get eaten by bare-cancel with "event Foo" as the label.
- **`markComplete`** (household): `['klaar','met']` BEFORE bare `'klaar'`.
- General rule for the compiler: **multiword (token-array) verbs must be tried before their bare-token prefixes**, both within an op and globally. If renderGate doesn't already sort longest-phrase-first, the emitted rule list must preserve the array order written above.

Final single owners: `share`/`deel` → **folio.shareFolder**; `accept` → **calendar.rsvpAccept**; `reject`/`afwijzen` → **tasks.rejectTask**; `cancel` → **calendar.cancelEvent**.

## (b) Risk / verify checklist

1. **renderSlash no longer throws** — `signOutOfPod`'s `body:'reject'` is gone; grep `body:.*'reject'` returns nothing in `mockManifests.js`. Confirm renderSlash's body-kind switch only ever sees `none|text-only|match|type-only|type+text`.
2. **Household byte-equivalence untouched** — edits to `mockAgent.js` are additive `surfaces.slash.match` blocks only; run the household golden/byte-equivalence test and confirm zero diff in op shape.
3. **Surface-coverage snapshot** — regenerate the surface-coverage snapshot (no existing `*coverage*` snapshot was found — if one is added in this work it should be the new baseline; otherwise none to update).
4. **No orphaned labels** — every `body:'match'` block now has a matching `arg` whose param carries `pickerSource` (verify the 7 pickerSource additions land on the right param names: `id`/`itemId`/`path`/`choreId`).
5. **Partial gates documented** — `respondToItem` (binds `itemId`, form elicits `body`) and `shareFolder` (binds `folder`, form elicits `with`) will `needsForm`; assert in tests that a bare "help with X" / "share X" dispatch resolves the label then requests the second arg rather than dispatching incomplete.
6. **Tests to add** (`test/v2/tokenGate.test.js` + a new gate-routing test):
   - Each collision verb routes to its single owner ("share the deck" → folio, "cancel the standup" → calendar, "reject the report" → tasks, "accept the invite" → calendar) and the loser does NOT match the bare token.
   - Multiword precedence: "cancel event Demo" → `cancelEvent`, not bare-cancel; "klaar met afwas" → `markComplete`.
   - Label→id resolution fires via the added `pickerSource` for `approveTask`/`rejectTask`/`markReturned`/`reportPost`/`downloadFile`/`saveToMyPod`.
   - `signOutOfPod`/`getItemTree`/`listOpen` have NO gate verb and their literal slash commands still route.
   - Node-runtime `syncOnce`/`watchStart` gate verbs are absent from the browser bundle, present in sidecar mode.