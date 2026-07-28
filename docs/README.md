# onderling — documentation

Public documentation for the onderling monorepo (working name **Onderling**). If you're new here, read in
this order.

## Start here
1. **[Project overview](../README.md)** — what onderling is, the apps, the architecture model, and how to run
   things. This is the front page; everything below is detail.
2. **[QUICKSTART](../QUICKSTART.md)** — a minimal hands-on agent in a few lines of code.
3. **[Repository layout](./repository-layout.md)** — the apps, the packages (SDK → substrates), and how the
   docs themselves are organized.
4. **[Glossary](./glossary.md)** — the vocabulary you'll hit everywhere: manifest, op, the thin waist,
   projectors, substrate, pod, circle, doorgeefluik, and the transport names.

## Reference
- **[Architecture (deep dive)](./architecture.md)** — the full model: the thin waist, the end-to-end dispatch
  flow, the three layers, placement-by-trust, and where the project is heading. Read to understand the whole
  system; `CLAUDE.md` + the overview are the summary.
- **[Conventions](./conventions/)** — project-wide rules every contributor follows (layering, localisation,
  settings, pod independence, the single-agent rule, …). Read these before authoring code.
- **[Known gotchas](./agent-notes-known-gotchas.md)** — build/native traps (EAS/Metro monorepo resolution,
  Android-12 permissions) that pass locally but fail on device/CI. Check here **before** you start bisecting.

## What "the architecture" is, in one line
Every interface — chat/LLM, GUI, slash command, deterministic gate — compiles to the same `{opId, args}` and
hands it to `callSkill`; an app's `manifest.js` is the single contract, and pure projectors turn that one
declaration into every surface (web, mobile, chat, slash). The full story is in the
[project overview](../README.md#one-manifest-every-surface); the terms are in the [glossary](./glossary.md).

## How documentation is organized
- **Public (committed to this repo):** `docs/`, `README.md`, `QUICKSTART.md`, `CLAUDE.md` / `AGENTS.md`, and
  per-app `apps/*/docs/` + CHANGELOGs.
- **Private (local-only, never published):** working plans, designs, and notes. A file's function is encoded
  in its name/location and decides whether git tracks it; a CI lint (`npm run lint:docs`) fails if a public
  doc ever links into private content, so the split can't silently rot.

Full model: [repository-layout → Documentation](./repository-layout.md#documentation).
