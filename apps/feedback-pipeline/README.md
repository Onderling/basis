# @canopy-app/feedback-pipeline

> **Direction (decided 2026-06-11):** this app will **dissolve into canopy-chat**. Its manifest/ops
> stay (the source of truth all projectors read), but the `feedback` name becomes a **navigation label**
> for this functionality inside the unified chat surface — not a separate app/build/shell. (The
> server-side pipeline/portal stay deployable; it's the user-facing surface that unifies.) See the root
> README's *Direction* note.

> **Layer: app (experiment / pre-DD).** A local-LLM pipeline that cleans,
> anonymizes and dedup-summarizes chat messages. Self-contained today (talks to
> Ollama over HTTP, no `@canopy/*` dependency) so the experiment runs with zero
> install. The path to composing the real substrates (Telegram, pod, llm-client)
> is in [`docs/PLAN-tomorrow-tg-pod.md`](./docs/PLAN-tomorrow-tg-pod.md).

Implements **step 3 ("Lokale filtering")** and the start of **step 5
("Aggregatie")** of the six-step feedback pipeline in
[`Project Files/Aanpak/commerciele_verkenning.md`](../../Project%20Files/Aanpak/commerciele_verkenning.md)
— the OR / zorg / whistleblower "feedback-infrastructuur" product line
(public-facing as *Onderling*).

## The pipeline

```
raw message
   │
   ▼  step 1  — src/redact.js  (deterministic regex)
strip phone · email · IBAN · postcode · URL · street+number  → [token]s
   │
   ▼  step 1b — src/names.js   (gazetteer)
strip KNOWN first names → [naam]   (best-effort; see FINDINGS)
   │
   ▼  step 1c — src/lang.js    (detect NL/EN, hybrid: user default + override)
   │
   ▼  step 2  — src/prompts.js CLEAN_SYSTEM[lang]  (local LLM, qwen2.5:7b)
drop remaining names · remove swear words/insults BUT keep severity & intensity
(monolingual prompt — no translation surface)
   │
   ▼  step 3  — src/triage.js  triageSummarize()
   ├─ crisis lexicon (src/signals.js, deterministic) + LLM label per message
   ├─ SIGNAL track → crisis / safety / serious-integrity → escalation (not aggregated)
   └─ REGULAR → grouped by domain → summarize PER DOMAIN (dedup within)
```

**Why the split?** Local models de-curse and drop names well but **leak
structured identifiers** (phone/email/IBAN) inconsistently — so those go to a
100%-reliable regex. **Names** are an open set, so a gazetteer catches the
common cases and the LLM mops up the rest (it is *not* a guarantee — see
FINDINGS). And rather than tell one prompt to "keep the language" (which a 7B
model drifts on), we **detect the language and route to a monolingual prompt**.
Evidence + per-model verdicts + the iteration log:
[`docs/FINDINGS.md`](./docs/FINDINGS.md). The regex layer is also the product's
*architectural* anonymity guarantee ("drempel ingebouwd").

## What's in here

```
apps/feedback-pipeline/
├── src/
│   ├── redact.js      ← step 1: regex pre-pass (pure, tested)
│   ├── names.js       ← step 1b: name gazetteer (best-effort, tested)
│   ├── lang.js        ← step 1c: NL/EN detect + hybrid resolver (tested)
│   ├── signals.js     ← crisis lexicon (deterministic, high-recall; tested)
│   ├── prompts.js     ← CLEAN_SYSTEM.{en,nl} + SUMMARIZE_SYSTEM + LABEL_SYSTEM
│   ├── ollama.js      ← tiny Ollama HTTP client (temp 0)
│   ├── pipeline.js    ← cleanMessage() / summarize() / runPipeline()
│   └── triage.js      ← step 3: triageSummarize() — signal track + per-domain
├── fixtures/messages.js   ← EN+NL fixtures (PII + profanity + dup batch)
├── scripts/
│   ├── clean-smoke.js     ← step 1+2 across models     → results-clean.md
│   └── pipeline-smoke.js  ← full step 1→2→3            → results-pipeline.md
├── test/
│   ├── redact.test.js     ← regex unit tests + documented false positives
│   ├── names.test.js      ← name FP/FN limits (adversarial)
│   └── lang.test.js       ← detection + hybrid resolver, incl. LIMIT cases
└── docs/
    ├── FINDINGS.md             ← model comparison + iteration log
    ├── SIMULATIONS.md          ← full-pipeline runs (Richting 5 participation)
    ├── STRESS-TEST-AGENTS.md   ← multi-agent adversarial stress-test spec
    ├── STRESS-TEST-RESULTS.md  ← stress-test verdicts (4 audits) + fixes
    ├── STRESS-TEST-TRACE-richting3.md ← sentence-level input→output trace
    ├── CATEGORIES-AND-LAYERS.md ← forward design: all category/PII floors × scenarios
    ├── TODO-category-floors.md ← next build: deterministic floor per category
    ├── BEST-PRACTICES.md       ← shielding / minimal-edit / specialized passes
    ├── pipeline-order.md       ← step order: floors + LLM (deterministic+llm gates)
    ├── parameters.md           ← every config field + env knob (onboarding checklist)
    ├── privatemode-models.md   ← Privatemode API model ids + prompt-profile assignment
    └── PLAN-tomorrow-tg-pod.md ← Telegram + pod wiring plan
fixtures/scenario-tests.js      ← per-scenario multi-agent test configs (A/B/C + 1–5)
workflows/gen-scenario.js       ← reusable generation workflow (args = a scenario config)
```

## Bring it up

```bash
cd apps/feedback-pipeline

# 1. deterministic part — no Ollama needed:
npm test

# 2. model experiments — needs Ollama running with the models pulled:
npm run clean-smoke       # → results-clean.md
npm run pipeline-smoke    # → results-pipeline.md
```

Model sets are env-overridable so you can keep testing candidates before
committing to one:

```bash
CLEAN_MODELS="qwen2.5:7b-instruct,mistral:7b-instruct,qwen2.5:3b-instruct" npm run clean-smoke
CLEAN_MODEL=qwen2.5:7b-instruct SUMMARIZE_MODELS="qwen2.5:7b-instruct,mistral:7b-instruct" npm run pipeline-smoke
OLLAMA_URL=http://otherbox:11434 npm run clean-smoke   # point at a remote Ollama
```

## Status (2026-06-02)

Scaffold + baseline findings only. Step 1 (regex) is implemented and unit-tested;
steps 2–3 are prompt + harness, validated by hand against today's sweep but **not
yet run inside this app** (the model sweeps are the user's to trigger). No
Telegram, no pod, no `@canopy/*` wiring yet — see the tomorrow-plan. All fixtures
are synthetic.
