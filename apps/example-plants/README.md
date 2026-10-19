# example-plants

An example **extension**: one third-party data type (`plants.plant` — a name, a room, when it wants water), declared
only. It is the proof that a developer's noun plugs into a node without a handler, a store or any surface code: the
node composes the type into its registry, the free atoms run over the circle's one store, the chat gate answers to
`plant …`, and its rows sync to the circle's other members like any other type.

It is not composed into the app. A node runs it only when handed it (`createRealHouseholdAgent({ extensions: [{ origin:
'plants', manifest }] })`); which extensions reach a node is the install step's job, not this app's.

## Substrates

| Package | Used for | Why a substrate, not direct kernel |
|---|---|---|
| `@onderling/app-manifest` (declaration only) | The manifest shape: `nouns[noun].atoms`, `schema`, `presents`. | The manifest is the contract every surface projects from. |

## Direct kernel use

None. There is no code here beyond the declaration.

## Shared UI helpers

None — every surface paints from the manifest.

## Bring it up

```sh
cd apps/basis && npx vitest run test/extensionNoun.test.js test/extensionNounSync.test.js test/extensionNounSynth.test.js
```

## What's in here

| File | What it is |
|---|---|
| `manifest.js` | The extension's whole declaration. |

| Phase | State |
|---|---|
| The type validates in a circle store; refused on a node without it | built, tested |
| Free atoms through the waist; chat words `plant add …` | built, tested |
| Rows sync to a member with the extension; a member without it holds none (said once) | built, tested |
| Shows on Vandaag / Gepland (presenter) | not yet — the shells' catalogue does not take extensions |
| Reminders at `waterAt` | not yet — reminders are written for appointments and chores only |
| A person's own scope (no circle) | refused for now — an extension type lives in a circle's store only |
