# The verification ladder — which check runs when, from a keystroke to `live`

> **Status:** locked 2026-09-18. Project-wide convention. Set the day the browser suite stopped running on
> every pull request: it took 45 minutes on its slowest shard, ran three times per change (the feature PR,
> the release PR, the merge), and the enrol of the first personal box waited an hour on bytes that had
> already been tested. The ladder below says what is checked *where*, so nobody waits on a rung that has
> already been climbed — and nothing ships without the top rung.

## The rungs

Each rung is cheaper than the next and runs earlier. A change climbs them in order; a red rung is fixed
before the next is started.

| # | Rung | What it checks | Who runs it, when | Time |
|---|---|---|---|---|
| 0 | **The one test** | the test you wrote red-first for the thing you are changing (a unit test, a relay walk, one browser spec) | you, while working — every edit | seconds to 2 min |
| 1 | **The package suite + the guards** | the suite of the package(s) you touched (`npx vitest run` in `apps/basis`, `apps/basis-mobile`, `packages/<x>`), then `npm run guards` at the root | you, before pushing | 2–8 min |
| 2 | **The cheapest real thing** | the change on a REAL composition: the relay walks in `apps/basis/test/*.relay.test.js` (real agents over a real relay), one browser spec (`npx playwright test test-browser/<spec>.spec.js`), a headless browser against the published app, a throwaway profile against the real box | you, when the change touches a shell, a transport, or the box — before opening the PR | 1–10 min |
| 3 | **The gate** (CI) | the guards, every package suite, the live-pod tier, the e2e journeys — on the PR's merge result | GitHub, on every PR and every push to `development`/`live` | ~8 min |
| 4 | **The tail** (CI) | the browser suite, eight shards — the only thing that tests a **shell composition** | GitHub, after a merge to `development` or `live`, or by hand (`workflow_dispatch`) — never on a PR | 10–20 min |
| 5 | **The release check** | that `development`'s head has a completed post-merge run with every job green, the tail included | `npm run release:check`, before the release PR | seconds |
| 6 | **The release** | `development → live` (a PR, merged on rung 5's verdict), a tag, **the merge back into `development` — also a PR** (see below), the box's own health gate (the wire smoke) and rollback, `publish:web`'s verify of `version.json` | the person releasing | minutes; the box follows within five |

**The rule in one line:** rungs 0–2 before the PR, rung 3 gates the merge, rung 4 gates the *release*,
rung 5 says whether rung 4 passed on the bytes about to ship.

### The merge back, since branch protection (2026-09-23)

`development` and `live` both carry branch protection: eighteen required checks, and **no direct pushes**. The
release chain used to end with a `git push origin development` to bring the merge commit back; that push is now
refused, and the failure lands *after* `live` has moved and the web is published — the worst moment to discover
a step no longer works. So the last step is a PR like every other:

```
release:check → PR development→live → merge → tag → PR live→development → publish:web → probe
```

The merge-back PR carries no changes of its own (it is the release merge commit travelling home), so its gate is
a formality — but it is the gate, and skipping it leaves `live` ahead of `development`, which makes the next
release's diff a lie. Protection does not enforce admins, so a person can override in a genuine emergency;
an agent session cannot and should not.

## When to take the quick route and when the full one

- **A change inside one package with a unit test** (a fold rule, a parser, a projection): rungs 0, 1, then the
  PR. Rung 2 only if the package is a transport, a store or a ceremony — anything a shell composes.
- **A change to how a shell composes things** (`circleApp.js`, the mobile screens, `device-runner.mjs`, the
  transports' connect order, a persisted store): rung 2 is not optional. Run the one browser spec or relay
  walk that crosses the seam you touched; if none exists, write it — that is the red-first test for this
  class. Two of the three defects found on 2026-09-18 (the enrol ghost, the relay waiting on NKN) were
  exactly this class and were found by rung 2 in minutes; no unit test could see them.
- **A change to the box or the deploy files** (`deploy/`, a role, the Dockerfile): rung 2 is a throwaway
  profile against the real box (the rehearsal script's shape: enrol, walk, wipe) — the box's health gate
  is the last net, not the first.
- **Never** run the whole browser suite locally (an hour) — that is what the tail is for, after the merge.
  Run the spec you need.
- **A merge does not wait for the tail.** A red tail on `development` is a red trunk: it blocks the next
  release, and fixing it is the next thing anyone does — not a note for later.

## Trying before shipping

Trying a change on a phone should not require shipping it. Today the ways are rung 2's (a browser spec
drives the real web app; a throwaway profile drives the real box). The planned next step is a **dev box**
on `BOX_BRANCH=development` serving its own web app on its own hostname — a different origin, so the
browser's profiles do not collide with the real app's — publishable from any branch with
`npm run publish:web -- basis --target dev`. The production box is never repointed between branches: under
the no-backwards-compatibility rule a `development` build may reset data, and the one box everyone uses
is the wrong place to find that out.

## Where the mechanics live

- the workflow and its two tiers: `.github/workflows/test.yml`, explained in `.github/workflows/README.md`
- the release check: `scripts/release-check.mjs` (`npm run release:check`)
- the guards aggregate: `npm run guards` (`docs/guards.md`)
- the box's own gate: `deploy/box/README.md` (the updater, the health scripts, the wire smoke)
- publishing the web app with its verify: `deploy/web/README.md`
