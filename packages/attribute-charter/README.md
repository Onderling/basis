# @onderling/attribute-charter

A privacy mini-spec for optional background attributes on pseudonymous
contributions. A project lead may request a **few, coarse** attributes
(municipality, age band, role, …) that a participant can **choose** to attach
to feedback — enabling segmentation of results without enabling
re-identification. The traceability budget is fixed *before* any data flows
(charter caps), guarded again at read time (k-anonymity suppression), and
checked on-device (a low-leak warning heuristic). Pure functions; no UI, no
transport; identical on web and mobile.

```
npm install @onderling/attribute-charter
```

## Quick start

```js
import {
  createCharter, charterHash,
  createDisclosureProfile, setValue, setEnabled, releasedValues,
  suppressRareAttributes,
} from '@onderling/attribute-charter';

// 1. The project lead fixes the request up front — at most 3 attributes.
const charter = createCharter({
  projectId: 'neighbourhood-42',
  attributes: ['place', 'ageBand'],
});
const hash = charterHash(charter);   // binds every consent to THIS request

// 2. The participant curates a reusable disclosure profile (all opt-in).
let p = createDisclosureProfile({ projectId: 'neighbourhood-42' });
p = setValue(p, 'place', 'Utrecht');
p = setEnabled(p, 'place', true);    // valued AND enabled → released
p = setValue(p, 'ageBand', '35-54'); // valued but NOT enabled → withheld

// 3. What actually rides along with a contribution:
releasedValues(p, charter);          // → { place: 'Utrecht' }

// 4. At read time, rare combinations are suppressed (k-anonymity guard).
const safe = suppressRareAttributes(records, { attributeK: 5 });
```

All profile setters are immutable — they return a new profile, as in the
example.

## The vocabulary

`VOCABULARY` defines the five requestable attributes and their coarse
buckets — `place` (municipality, free text), `ageBand`, `role`, `tenure`,
`household`. There is no fine-grained variant by design. Helpers:
`attributeKeys()`, `isVocabKey(key)`, `bucketsFor(key)`,
`isValidValue(key, value)`, `bucketCount(key)`.

## The three guards

| Stage | Export | Guarantee |
| --- | --- | --- |
| Before data flows | `createCharter` / `CHARTER_MAX_ATTRIBUTES` | a request is capped (≤ 3 attributes); `charterHash(charter)` binds each consent to the exact request |
| At read | `suppressRareAttributes(records, { attributeK })` / `attributeKDefault` | attribute combinations shared by fewer than *k* contributions are dropped from aggregation output |
| On device | `disclosureWarning({ enabledKeys, n, mode })` | estimates how identifying the current selection is within a cohort of size `n`; graduated `mode`: `normal` / `minimal` / `off` |

## Disclosure profile

The participant's choices live in a small reusable structure —
`createDisclosureProfile({ projectId })`, `setValue`, `setEnabled`,
`enabledSharedKeys(profile)`, `releasedValues(profile, charter)`. Everything
defaults to withheld; only explicitly enabled keys with valid values are
released, and only for keys the charter actually requests.

## Related packages

`@onderling/agent-registry` carries the generalized per-persona property and
disclosure model this package is the first concrete instance of.

## Status

`0.x` — pre-1.0; the API may move between minor versions. Versioned with
changesets. Source: [github.com/Onderling/basis](https://github.com/Onderling/basis)
(`packages/attribute-charter`).
