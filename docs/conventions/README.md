# Conventions

Project-wide rules every contributor follows. Read the ones relevant to what you're touching **before** you
author code — several are load-bearing invariants, not style preferences.

- **[architectural-layering.md](./architectural-layering.md)** — the `apps → substrates → kernel` layering: what
  each layer owns and what is not acceptable. The core invariant.
- **[app-readme-scheme.md](./app-readme-scheme.md)** — the README scheme every app under `apps/` follows from
  its first commit (including the honest phase table).
- **[manifest-standard.md](./manifest-standard.md)** — what a *conformant* app manifest must satisfy
  (structural validity, atom discipline, noun-declaration discipline, projector totality) so the manifest stays
  the single source of truth for surfaces (invariant #4); enforced by a cross-app fitness function.
- **[property-vocabulary.md](./property-vocabulary.md)** — how an agent expresses queryable **properties**
  (JSON-LD terms: schema.org/FOAF/vCard/OIDC for people, W3C WoT for devices; a thin `cdi:` policy namespace).
  Standard the properties facet will follow (not yet built).
- **[localisation.md](./localisation.md)** — every user-facing surface ships translatable from commit one;
  substrates emit error codes, not strings.
- **[cross-app-settings.md](./cross-app-settings.md)** — pod-side settings split into portable `shared.json` +
  per-install `devices/<id>.json`.
- **[cross-pod-refs.md](./cross-pod-refs.md)** — how items reference content across pods.
- **[pod-independence.md](./pod-independence.md)** — local-only mode is the floor; the pod is the portability
  layer, not a runtime dependency.
- **[single-agent.md](./single-agent.md)** — one `core.Agent` per service-context; transports are routes into
  it, not parallel agents.
- **[ports.md](./ports.md)** — the `Transport` / `DataSource` / `ActorResolver` ports the kernel defines:
  the compatibility contract a third-party adapter implements, plus the conformance harness that checks it.
- **[signed-bodies.md](./signed-bodies.md)** — how a signed, peer-verified body carries its version (a
  self-describing namespaced string, inside the signature) so the format is legible to an independent
  implementation and can evolve without a flag day.
- **[storage-layout.md](./storage-layout.md)** — how app data is laid out in a pod.
- **[doc-structure.md](./doc-structure.md)** — what belongs in `CLAUDE.md` vs the docs tree, and when to
  compress/enlarge `CLAUDE.md` (the rule governing this split).
- **[decision-log.md](./decision-log.md)** — when (and where) to record a decision; the decisions log lives at
  `docs/decisions.md` (code) / `plans/strategy/decisions.md` (org).
- **[CONTRIBUTING.md](./CONTRIBUTING.md)** — contribution basics.
