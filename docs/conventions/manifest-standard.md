# Manifest standard — what a conformant app manifest must satisfy

CLAUDE.md invariant #4: **the manifest is the source of truth for surfaces.** An app declares its operations
and surfaces once in `apps/<app>/manifest.js`; the pure projectors (`renderChat` · `renderSlash` · `renderGate`
· `renderWeb` · `renderMobile`) turn that one declaration into every interface. For that to hold, every app
manifest has to meet a shared standard — otherwise a projector needs a per-app escape hatch and the "one
contract" property quietly erodes.

This page is that standard in prose. It is enforced, not aspirational: `manifestConformance(manifest)` in
`@onderling/app-manifest` returns `{ ok, issues, warnings }` for a single manifest, and the fitness test
`packages/app-manifest/test/manifestConformance.test.js` runs it against every discovered app manifest and
fails CI on drift. Issues carry a **code** (not a free string) so tooling and tests can assert on them.

> A manifest is conformant when `manifestConformance(m).ok === true`.

The standard encodes only rules that are already TRUE of every app manifest (tasks-v0, stoop, household,
calendar, folio, basis). It is green on `master` and goes red on a real regression. Rules the codebase
does not universally hold to are deliberately **not** conformance failures — see "What is not a failure" below.

## The rules

### 1. Structural validity — `invalid-structure`

`validateManifest(m).ok` must be true: `app` is a non-empty string, `itemTypes` / `operations` are well-shaped,
every enum-valued field (param kinds, setting kinds, reply shapes, runtime, …) is a known value, there are no
duplicate operation or view ids, and every `nouns` key is one of `itemTypes`. This is the backbone — the shape
every projector assumes. One conformance issue is raised per underlying validator error, carrying its path.

### 2. Atom discipline — `verb-not-atom`

Every `op.verb` must be a known SDK atom (or a registered alias) **or** be a key of the `manifest.domainVerbs`
map; and a `domainVerbs` entry must not itself be an atom. The map classifies each domain verb — `{ register:
'write', help: 'read' }` — because the atom catalogue cannot say whether a domain verb writes (see "Declared
reach" below); a plain list is refused. This is the drift guard against a new noun-specific verb
sneaking into an op without either mapping to an atom (`add` / `list` / `complete` / `claim` / …) or being
named explicitly as domain-specific (folio `sync`, household `register`, stoop `report`). It is the packaged
form of the existing atom-discipline guard (B · Layer 1).

### 3. Noun-declaration discipline — `nouns-required` / `nouns-vacuous`

A manifest that has any **noun-bearing atom op** — an atom verb that names an item-type noun via
`appliesTo.type` or a `type`-enum param — **must** declare a `nouns` block (`nouns-required` otherwise). That
makes the app's member-facing `(verb × noun)` capability surface the author's explicit, written-down choice
rather than an implicit set the gate derives — the drift that let a broad `appliesTo` silently mint
capabilities on internal item types.

The inverse also holds: a manifest with **no** noun-bearing atom op must **not** declare a `nouns` block
(`nouns-vacuous` otherwise). This is the basis exemption made into a rule. basis is the
shell/unifier manifest — every op is an app-level command (`help` / `settings` / `newthread` / …) that names no
item noun, so there is nothing to curate. An empty `nouns:{}` would be worse than nothing: it flips the manifest
to declared-authoritative, and a future `chat-thread` / `chat-message` op's capability would be silently
dropped. So the rule is "noun-bearing ops ⇒ must declare", not "every manifest must declare".

### 4. Projector totality — `projector-error`

Each of the five surface projectors — `renderChat`, `renderSlash`, `renderGate`, `renderWeb`, `renderMobile` —
must turn the manifest into its surface without throwing. This is the literal reading of invariant #4: a
manifest that any projector chokes on is not, in fact, a single source of truth for every surface. One issue is
raised per failing projector, tagged with the surface key.

## The verb × noun algebra (uniforme-representatie)

The construct behind atom discipline is a small **algebra**: an app's member-facing capability surface is a
set of **`(verb × noun)`** pairs. The **noun** is a declared item-type; the **verb** is a *canonical SDK
atom* drawn from one fixed vocabulary. `addTask` / `addItem` / `createBoard` are all *the `add` atom on a
different noun*; `markComplete` / `done` are the one `complete` atom. Making the verb vocabulary
authoritative means a new noun gets the standard verbs "for free" by declaring which atoms apply, the gate
keys off `(atom × noun)` rather than 100+ opIds, and the LLM learns a tiny verb set instead of every op name.

**The canonical atom set is one exported constant: `CANONICAL_ATOMS`** (`@onderling/app-manifest`, an alias of
`ATOM_VERBS`, sourced from the `ATOMS` catalogue in `atoms.js`). It is the authoritative **superset** — every
atom any app manifest declares today is one of:

```
add · list · get · update · remove          (crud)
complete · claim · reassign · submit ·
approve · reject · revoke · archive · unarchive   (lifecycle)
share · move                                  (graph)
```

Each atom also carries **aliases** (`create`→`add`, `delete`→`remove`, `grab`→`claim`, `done`→`complete`,
`edit`/`patch`→`update`, `assign`→`reassign`, `read`→`get`) that an op's `verb` may use — but a **declaration**
must use the canonical spelling.

**Where the surface is declared.** `manifest.nouns` maps each item-type to the atoms it exposes:

```js
nouns: {
  task: { atoms: ['add', 'list', 'update', 'remove', 'complete', 'claim', 'reassign', 'submit', 'approve', 'reject', 'revoke'] },
  circle: { atoms: ['list', 'archive', 'unarchive'] },
}
```

This declaration IS the capability surface (declared-authoritative, `docs/decisions.md` 2026-07-02): a broad
`appliesTo` can no longer silently mint capabilities on internal item-types. Verbs that genuinely don't reduce
to an atom (the ~20% domain tail — folio `sync`, household `register`, tasks-v0 `tree`, `help`) are declared
in the `manifest.domainVerbs` map instead (each classified `'read'` or `'write'`), never in `nouns[].atoms`.

**Enforcement (the convention is now GUARDED, not just documented):**
- **Op side** — the `verb-not-atom` conformance rule (Rule 2 above): every `op.verb` must be a canonical atom
  (or alias) OR a declared `domainVerb`.
- **Declaration side** — `validateManifest` rejects a `nouns[noun].atoms` entry that isn't an SDK atom
  (`unknown-atom`) or that uses an alias where the canonical spelling is required (`alias-in-nouns`).
- **Cross-app fitness** — `packages/app-manifest/test/verbAlgebra.test.js` scans *every* `apps/*/manifest.js`
  and fails CI if any declared atom is not a `CANONICAL_ATOM` (a rogue verb). It also asserts `CANONICAL_ATOMS`
  covers every atom the manifests actually declare, so the constant stays derived-from-reality. Adding a new
  verb to the algebra = adding one `Atom` to `ATOMS` in `atoms.js`.

### `claim` — the verb vs the noun (disambiguation)

The token **`claim` names two different things**; keep them apart:

- the **`claim` ATOM** (a verb) — "self-assign an open item": a compare-and-swap on an EXISTING item's
  assignee, **in-place**. Appears as `verb: 'claim'` on `task` / `post` / `calendar-event`. No new item is
  created.
- the **`claim` NOUN** — the `@onderling/item-types` `claim` item-type (`CLAIM_SCHEMA`): a NEW standalone
  **binding item** that references another item (`itemRef` → an offer/request/job) and carries its own
  lifecycle `status`. A distinct row in the store, not a mutation of the referenced item.

So *"claim a task"* (verb) mutates the task's assignee; *"a claim on an offer"* (noun) mints a `claim` item.
A `nouns` block listing `claim` under a type's `atoms` is using the VERB; listing `'claim'` in `itemTypes` is
using the NOUN. The item-type is **deliberately not renamed** — its blast radius is large (a persisted
`type: {const:'claim'}` discriminator, the registry's public API, and the `lend-request` legacy alias) — so
the two are disambiguated by documentation (this section + JSDoc on `packages/item-types/src/types/claim.js`)
rather than a rename, per the repo's code-preservation ethos.

## Declared reach: `writes` and `hosts`

Two declarations say how far an app reaches. They are checked by the guard `scripts/lint-manifest-scopes.mjs`
(in `npm run guards`), not by `manifestConformance`; the validator tolerates both keys like any other. The guard
reads every manifest the app runs — the list in `apps/basis/src/v2/manifestSources.js`, which both shells
compose from — so the plumbing manifests declared outside `apps/<app>/manifest.js` (the parameter register, the
device-log lanes) are checked like the app manifests.

- **`writes: { scope }` on an op row** — where the op writes. Required on every op not known to only read: its
  verb is an atom other than the read atoms `list` / `get` (aliases count, so `edit` writes and `read` does
  not), a domain verb its manifest classifies `'write'`, or it has no verb; or the op declares `appends`
  (`verbKind` in `atoms.js` is the one reading). A domain verb missing from the `domainVerbs` map is red —
  "classify this verb: read or write" — never a silent read: the default is the safe one. There is no
  `writes: null`. The three scopes (`WRITE_SCOPES`):
  - `device` — only on this device: local settings, caches, this device's own registrations;
  - `person` — the person's own data, which follows them across their devices: profile and persona
    properties, the contacts book, the agent registry, their pod;
  - `circle` — the circle's shared store or log, which syncs to the circle's members. An op that delivers to
    another person outside any circle declares `circle` too: it leaves the person, so the widest reach is the
    honest one.

  **An op that writes in more than one place declares the WIDEST reach** — a share that writes the person's
  store and a circle lane is `circle`. Widest, not most common, so the declaration can only over-state reach,
  never under-state it. The key is `writes`, not `scope` — `scope` already means who a setting or param
  applies to.
- **`hosts: string[]` at the top level** — every network host the app's own code reaches (`[]` for none). An
  endpoint the person configures — their pod, their relay — is not a fixed host and is not listed. **A
  declaration, not a check:** the guard verifies that the array is there, not that it is complete — a new
  `fetch` to an undeclared host fails nothing. It binds where the realm host starts an extension with
  `--allow-net` set from it; until then, and for code in the main bundle, it is a convention kept by review.
  `hosts` has **two** consumers in the runtime, not one: `--allow-net` (the enforcement), and certification
  and the consent card, which read the declaration itself (an extension that declares both a data-read grant
  and a network host is refused certification). So a false `[]` is not harmless until the realm arrives — it
  is a future false claim on a card.

Nothing at runtime reads either declaration yet; the extension contract (`docs/extending.md`) is where they
will bind.

## What is not a conformance failure

The registry (`@onderling/item-types`) is the source of truth for nouns, but app-local (non-registry) item types
are permitted (F-SP1-a): household's `shopping` / `errand`, tasks-v0's `circle` / `schedule-slot`, and so on.
Requiring every declared noun to be registry-canonical would fail four of the six current apps, so that rule
(`validateManifest`'s opt-in `strictNouns`) is **not** part of the standard. Registry-noncanonical nouns are
instead surfaced as non-blocking `warnings` (code `noncanonical-itemtype`) on the conformance result — a
convergence signal for tooling and docs, never something that flips `ok`.

Likewise, the`strict` skillId cross-check (every `view.dataSource.skillId` resolving to a declared op or
`externalSkills` entry) is not required: some apps legitimately reference skills that live outside their
manifest.

**Coverage gaps are not conformance failures either.** An op that declares a chat surface but no slash command
is a legitimate coverage gap, tracked by the surface-coverage snapshot (`docs/surface-coverage.md` in
basis), not a conformance violation. Conformance asks "does every declared surface project?"; coverage
asks "which surfaces are declared?". They are separate checks.

## Using it

```js
import { manifestConformance } from '@onderling/app-manifest';

const { ok, issues, warnings } = manifestConformance(myManifest);
// ok      → boolean (reflects issues only)
// issues  → [{ code, message, path?, surface? }]  — codes: invalid-structure |
//           verb-not-atom | nouns-required | nouns-vacuous | projector-error
// warnings→ [{ code: 'noncanonical-itemtype', path, message }]  — non-blocking
```

The cross-app fitness test discovers app manifests by scanning `apps/`, so a **new** app with a `manifest.js`
is held to this standard automatically — you cannot add a non-conformant app silently.
