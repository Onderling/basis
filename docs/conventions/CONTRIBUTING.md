# Contributing to @onderling

## CI / PR gating

PRs are gated on `.github/workflows/test.yml`. Jobs run in parallel — one per
package — on every PR and on every push to `master` / `track-H-folio`.

**Required** (must pass before merge):

- `core`
- `pod-client`
- `relay`
- `integration-tests`
- `folio`

**Informational** (does not block merge):

- `react-native` — yellow / `continue-on-error: true` until the
  `BleTransport.test.js` + `MdnsTransport.test.js` parser failures are sorted.

See `.github/workflows/README.md` for a quick "what runs when" reference.

## Local dev

```bash
# Run every package's tests (matches what CI runs, minus the parallelism)
npm test

# Or per-package
npm run test:core
npm run test:pod-client
npm run test:relay
npm run test:rn
npm run test:scenarios          # integration-tests
npm test --prefix apps/folio    # folio
```

Tests use [Vitest](https://vitest.dev). Unit tests live under
`packages/*/test/`; cross-component scenarios under
`packages/integration-tests/`.

## Branches

- Three long-lived branches: `development` (default; every PR lands here), `live` (the release gate; only
  `development` merges into it), `master` (legacy, frozen). Everything else is a short-lived feature branch.
- **A feature branch is deleted when its PR merges** — on origin by the repository setting, locally by the author.
  A branch that outlives its merge is a mistake, not an archive: the commits are on `development`.
- History that must survive without a branch is a **tag** (`archive/pre-purge-app-trunk`) and a ref bundle outside
  the repo — see `docs/repository-layout.md` §"History that is not on a branch". Never a `master-backup-*` branch.
- Sweep: `git branch --merged development` lists what is safe to delete locally; a branch that is unmerged by
  ancestry but whose patches are on `development` (a rebase) is found with `git cherry development <branch>`
  (every line `-` = safe). Ancestry alone lies here since the 2026-04-09 history rewrite.

## Other expectations

- Read `CLAUDE.md` for the project's working agreements before touching the kernel
  or its adapters (transport primitives, security wrapping, decisions already made).
- Don't add top-level dependencies without an explicit conversation.
- Design-first: spec lives under `Design/` — code follows docs.
