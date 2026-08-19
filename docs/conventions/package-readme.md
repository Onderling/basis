# Package README requirements (@onderling/* — npm-facing)

Derived from the house style (packages/sdk/README.md), Frits's instructions (2026-07-16:
standard style; philosophy only where it helps; clean English), and npm conventions.
Every wave-1 package README must satisfy all of these. Verify each doc against this list.

**R1 — Title + one-liner.** `# @onderling/<name>` followed by a one-sentence statement of what
it is. A reader knows in 5 seconds whether this package is for them.

**R2 — Orientation ≤ 1 paragraph.** What it does, when to use it, at most ONE sentence of
layering/placement. No philosophy unless it explains observable behaviour (e.g. "PII-safe by
construction" describes the API's shape — allowed; mission statements — not).

**R3 — Install line.** `npm install @onderling/<name>` near the top, plus peer/lazy-dep notes
where a consumer will hit them (e.g. a transport's native lib).

**R4 — Quick example on the first screen.** Runnable, copy-pasteable, imports written exactly
as a consumer writes them, using only public exports.

**R5 — Accurate API surface.** Every documented symbol exists in the code with the documented
signature ("nothing aspirational"). Primary flows fully documented; a large long-tail surface
may point into the source, but the main entry points never just say "see source".

**R6 — 2–3 real examples total** covering the primary flows (the quick example counts).

**R7 — Stability note.** 0.x status: the API may move between minor versions; versioned via
changesets; link to the repo.

**R8 — Cross-links.** Related @onderling packages and the repo
(https://github.com/Onderling/basis). Never link into private paths (plans/, _archive/).

**R9 — Language.** Clean English throughout. No Dutch words or Dutch-isms; product terms
translated (kring → circle, buurt → neighbourhood).

**R10 — Format.** ~60–150 lines; GitHub-flavored markdown; fenced code blocks with language
tags; sentence-case headings; no emoji headings.

**R11 — Honest limits.** Document the gotchas a consumer WILL hit (dropped log fields,
lazy-imported native libs, coarse-only vocabularies), not just the happy path.

**R12 — No repo-internal jargon** without a one-line gloss (manifest, skill, circle are fine
when introduced; internal codenames/objective letters are not).

**R13 — Tone: professional and friendly; explain, don't decree.** Describe what the package
does and, briefly, where it's heading — not the decision process (no phase numbers, plan
references, or "locked/decided <date>" framing in public docs). Reserve warnings for real
footguns a consumer could actually hit, and always give the reason.

## How this is enforced

Two verification layers, both runnable locally:

1. `npm run readme-fitness` — extracts every fenced `js` block from the wave-1 package READMEs,
   `docs/packages.md`, and `docs/tutorials/*`, and asserts every `import { X } from '@onderling/…'`
   symbol actually exists on the real exported surface (resolved through each package's own
   `exports` map — the same resolution a consumer gets). Drift fails the script.
2. `apps/sdk-journeys/` (`npm test` there) — executable consumer journeys; the documented flows
   must actually run. Tutorial and README examples are drawn from journey code, so the examples
   are tested by construction.
