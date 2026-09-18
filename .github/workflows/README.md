# GitHub Actions — what runs when

One workflow, `tests` (`test.yml`), in two tiers. Measured on the trunk 2026-09-18: everything but the
browser suite finishes inside 8 minutes; the browser suite took 45 minutes on its slowest shard — and it ran
on every feature PR, on the release PR, and again after each merge, the same bytes three times.

| Tier | Jobs | Runs on | Blocks |
| --- | --- | --- | --- |
| **the gate** | `guards + doc lint` · every package/app suite (`core`, `basis`, `basis-mobile`, `stoop`, …) · `live-pod integration` · `e2e journeys` | every pull request · every push to `development` and `live` · by hand | merging (mark these required in branch protection — still a manual GitHub step) |
| **the tail** | `browser (shard n/8)` — the only jobs that test a SHELL COMPOSITION | a push to `development` or `live` (i.e. after a merge) · by hand (`workflow_dispatch`) — **never on a PR** | the next **release**, not the next merge |

Feature branches run nothing until a PR is opened (a branch per feature ends in a PR anyway). A newer push
to a PR cancels that PR's older run; a push to `development`/`live` always runs to the end, because its
verdict is what a release reads.

## Releasing

`live` moves only from a `development` head whose post-merge run is green, tail included:

```
npm run release:check            # ✔ live may move  /  ✖ not yet, and why (in progress · a red job · no tail)
```

Then the release PR `development → live` merges on that verdict — its own gate run is confirmation, not
the decision — and the tag follows. The box updates itself from `live` within five minutes.

## Trying a change before CI

The cheapest real thing first: the relay walks and the browser specs run locally in minutes
(`npx vitest run test/<walk>.relay.test.js`, `npx playwright test test-browser/<spec>.spec.js` in `apps/basis`),
and a headless browser against the published app catches shell-level regressions before anything is merged.
A dev box on `development` (`deploy/box`, `BOX_BRANCH=development`, serving its own web app on its own
hostname) is the planned next step for trying on a phone without shipping.
