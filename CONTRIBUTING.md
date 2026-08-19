# Contributing

Thanks for your interest in the Onderling platform. This repo (`basis`) is a pnpm monorepo:
the published `@onderling/*` packages live under `packages/`, the applications under `apps/`.
This page covers the practical workflow; the deeper conventions live in
[`docs/conventions/`](docs/conventions/).

## Getting started

```sh
git clone https://github.com/Onderling/basis.git
cd basis
npm install
```

Layout: `apps/*` (thin app shells) and `packages/*` (the platform). Workspace resolution is
pnpm with a hoisted (flat) `node_modules` and per-package lockfiles — see
[`pnpm-workspace.yaml`](pnpm-workspace.yaml) for the reasoning.

### Running tests

Tests are per package / per app, not one root runner:

```sh
cd packages/core && npx vitest run          # any package
cd apps/folio && npx vitest run             # any app with tests
```

Root shortcuts exist for the main suites (`npm test`, `npm run test:core`,
`npm run test:pod-client`, …) and CI runs one job per package — see
[`docs/conventions/CONTRIBUTING.md`](docs/conventions/CONTRIBUTING.md) for what gates a PR.

### Verifying the documentation

Docs are held to the code by two runnable checks plus an executable layer:

```sh
npm run readme-fitness              # every documented @onderling/* symbol must exist in the code
npm run lint:docs                   # no broken links, no links into private/local-only paths
cd apps/sdk-journeys && npm test    # five executable consumer journeys (J1–J5) must pass
```

If you touch a package README, a tutorial, or a how-to guide, run all three.

## The engineering culture

The model is settled; the work is keeping the code matching the model. Read
[`CLAUDE.md`](CLAUDE.md) for the full statement; the short version is the
**manifest-is-the-contract** model: every interface (AI, GUI, slash command, gate) compiles to
the same `{opId, args}`, and an app's `manifest.js` is the single declaration all surfaces are
projected from.

The invariants — a violation is a bug, not a style nit:

- **Logic lives once, in shared code.** Web and mobile shells are thin adapters, nothing else.
- **web ≡ mobile.** Neither platform is the primitive one; shared behaviour exists in both by
  construction.
- **No duplication.** A string, op, or function is defined once. Editing the same thing in two
  files is the signal to consolidate.
- **The manifest is the source of truth for surfaces.** New ops go in `manifest.js`, never a
  per-shell switch statement.
- **Three-layer dependency rule:** `apps/` → substrate packages → `packages/core` (the kernel).
  Adapters live outside the kernel; nothing in the kernel depends up on an adapter.
- **Functionality is placed by trust + latency** — sensitive compute stays client-side or in an
  attested enclave, never default-to-server.
- **Every user-facing string goes through `t()`** with a locale entry.

And the working rule that keeps all of the above true: **prefer a fitness function to a manual
check**. When you fix drift, add the test or lint that makes the same drift fail CI next time.
`npm run readme-fitness` and `npm run lint:docs` are themselves examples of this pattern.

## Making changes

- Branch from `master`, open a PR. Keep commits scoped — one concern per commit.
- Run the test suites for the packages and apps you touched, plus the doc checks above if you
  touched documentation.
- **Published packages** (the `@onderling/*` set in [`docs/packages.md`](docs/packages.md)) are
  versioned with changesets. If your change affects one, add a changeset:

  ```sh
  npx @changesets/cli
  ```

- Package READMEs must satisfy [`docs/conventions/package-readme.md`](docs/conventions/package-readme.md)
  (accurate API surface, runnable examples, honest limits) and pass `npm run readme-fitness`.
- App READMEs follow [`docs/conventions/app-readme-scheme.md`](docs/conventions/app-readme-scheme.md).
- New dependencies at the top level need an explicit conversation first.

## Where to start

- Issues labeled **good first issue** are scoped to be doable without deep repo context.
- The [package index](docs/packages.md) is the map of the published surface — every package,
  what it is, and which executable journey verifies it.
- The [tutorials](docs/tutorials/) build a working mental model in three steps; the
  [how-to guides](docs/how-to/) cover common tasks after that.
- [`docs/architecture.md`](docs/architecture.md) explains how the pieces fit.
