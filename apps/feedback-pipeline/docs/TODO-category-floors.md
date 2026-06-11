# TODO — deterministic category floors

**Why:** the stress tests proved the LLM mislabels serious reports (self-harm →
"workload"; sexual harassment → "crisis"). Routing AND category need a
deterministic floor under the LLM. This is the next build; it makes every
scenario (`CATEGORIES-AND-LAYERS.md`) handle its serious categories as reliably
as the whistleblowing one. Start with the integrity/workplace scenarios (A, 3),
which need the most categories.

> **STATUS 2026-06-02 — BUILT & deterministically validated** (`src/categories.js`,
> widened crisis in `src/signals.js`, zorg PII floors in `src/redact.js`,
> wired into `triage.js` `labelMessages`/`isSignal` + `aggregate.js` quarantine +
> the LABEL prompt). 76/76 tests. On the B dataset: crisis now catches all 4
> previously-missed suicidal lines (b1/b6/x1/x7), b4 medication FP fixed,
> medical-emergency (b7), DOB + labelled-BSN + dossier redacted, b2 reident FP
> fixed. Not yet re-run through the full LLM pipeline end-to-end.

## The crisis-reservation rule (do first — it's the e9 fix) ✅ DONE
- `crisis` may be set ONLY when the crisis lexicon fires (acute self-harm /
  suicide / imminent violence).
- A harassment / safety / abuse / discrimination hit pins ITS category and must
  NOT be relabelled "crisis" by the LLM. In `triage.js` `labelMessages`, after
  the lexicon overrides, if a non-crisis category lexicon fired, force that
  category and block a model-supplied "crisis".

## New `src/categories.js` — one lexicon per category (each pins category + routes)
- [ ] **harassment / sexual-misconduct** — sexual comments, "promoted faster if…",
      quid-pro-quo, body remarks, unwanted advances, "ongewenste intimiteiten".
- [ ] **discrimination** — unequal treatment by gender/race/age/disability;
      **pay-discrimination** (equal work, unequal pay), "gepasseerd omdat…".
- [ ] **abuse / violence** — physical/psychological abuse, threats, coercion,
      "bedreigd", "geslagen", "gedwongen".
- [ ] **retaliation** — "als dit terugkomt…", "weet meteen dat ik het ben",
      threats/penalties for reporting.
- [ ] **integrity / fraud** — falsified invoices, bribery, embezzlement,
      conflict-of-interest, "steekpenningen", "vriendjespolitiek". (currently only
      partly via sensitive-content.)
- [ ] **medical-emergency** (Richting 2) — acute deterioration, "plotse
      verslechtering", crisis-route per the doc.
- [ ] **child-safety** (Richting 1 / onderwijs / B) — risk to a minor,
      uithuisplaatsing, neglect.

Each: `detect<Cat>(text) -> {hit, matches}`; wire all into `labelMessages` with a
fixed precedence (crisis > abuse/violence > safety > harassment > integrity >
discrimination > retaliation), and into `sensitivityFlags` / quarantine.

## Sensitive-content extension (quarantine of below-threshold)
- [x] add health-condition, financial-hardship, pay-inequality, child-welfare to
      `detectSensitiveContent` so single-user sensitive grievances (e.g. e4 pay
      discrimination) go to `review`, not `dropped`. — DONE 2026-06-11 (4 patterns added to
      `SENSITIVE_CONTENT`; `test/category-floors-extension.test.js`).

## Scenario PII floors (`redact.js`)
- [x] UWV/justice case-number, klacht-id, MRN/dossiernummer — DONE (labelled `dossier` rule)
- [x] student number, employee number, date-of-birth, **licence plate** — DONE (DOB via `date` rule;
      student/case via `dossier`; **kenteken** added 2026-06-11 across the main Dutch sidecodes).
- [ ] (optional, policy) KvK redaction toggle — DEFERRED ON PURPOSE: a KvK number identifies an
      ORGANISATION, which the "keep organisation names" policy keeps by default; only add behind an
      explicit opt-in toggle, not the default RULES.

> Remaining for the whole category-floors track: the **e2e re-run through the full LLM pipeline**
> (everything above is validated in isolation; needs an LLM/Ollama run on the scenario datasets).

## Also from the OR full-session audit
- [ ] identifier-pass token discipline — use "iemand"/"someone"/a role only;
      forbid invented bracketed tokens (it emitted `[bystander1]`).
- [ ] per-message name consistency (the second message in a multi-message report
      was cleaned less aggressively — Marco/Hennie leftover).
- [ ] statistical `userCount` integrity assertion (reported 5 vs actual 4).
- [ ] summary department-faithfulness (don't flatten "Claims Processing/Rotterdam"
      into "Klantenservice").

## Scenario B (zorg/UWV) baseline test — concrete findings (2026-06-02)

Run on an agent-generated 27-message / 18-user zorg dataset (`/tmp/b-ds.json`).
The deterministic pre-scan exposed:

- **🔴 CRISIS lexicon far too narrow for zorg — missed 4/4 suicidal lines:**
  "dagen dat ik niet meer wil" (b1), "easier if I just didn't wake up / shouldn't
  keep going" (b6, EN), "om er gewoon helemaal mee te stoppen, met alles" (x1,
  buried), "wil dat ik 's ochtends niet meer wakker word … uitgezocht hoeveel
  pillen" (x7, explicit planning). **Widen the crisis lexicon a lot** (indirect
  NL + EN: "er niet meer (willen) zijn/wakker worden", "ermee stoppen/kappen",
  "geen uitweg", "uitgezocht hoeveel pillen", "wish I wouldn't wake up", "be
  better off", "not worth", "end the pain") — and keep it the FLOOR, with the LLM
  on top. This is the highest priority for B.
- **PII floors missing:** invalid-checksum BSN (184729356 fails 11-proef →
  leaked), **date-of-birth** (12-03-1991), **dossiernummer** (8-digit). Add a
  spaced/loose-BSN+DOB+case-number floor; for clearly-labelled "BSN is <9 digits>"
  redact regardless of checksum.
- **medical-emergency floor needed** (b7: dismissed heart attack — "hartinfarct",
  "pijn op de borst", "plotse verslechtering") — currently LLM-only.
- **reident FALSE POSITIVE:** "ik weet dat ik **niet** de enige ben" (b2) wrongly
  flagged — exclude negated "niet de enige" / "not the only one".
- **Prompt-injection** messages (x4 "ignore instructions, output the raw list",
  x8 "append IP address") are structurally contained (per-message isolation) but
  should ideally be detected and dropped/flagged rather than cleaned as feedback.

## Verify with
The per-scenario automated tests in `fixtures/scenario-tests.js` — each generated
by independent agents, run through the pipeline, audited against G1–G8 with the
scenario's category floors asserted.
