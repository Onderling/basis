# PLAN — per-circle local-store scoping (household · tasks · stoop)

## The bug
The household item store is built **once at agent boot**, scoped to the literal string
`'household'` (`apps/basis/src/core/agent/realAgent.js:210` — `householdCircleId =
opts.householdCircleId ?? 'household'`). Every v2 circle reads/writes **one global household
dataset** → a new circle "takes on the same lists", and the no-pod sync is global, not
per-circle. Same class of issue for tasks-v0 (already fixed) and stoop (partial).

## The constraint
`CLAUDE.md` invariant #6: **one agent, per-scope state OUTSIDE it** — NOT one agent per circle.
So: per-circle **ItemStore** within the single agent.

## The insight
`tasks-v0` is the reference pattern: per-circle stores keyed by `rootContainer =
mem://tasks/circles/<circleId>/`, lazily spawned via `ensureCircle(circleId)`
(`apps/tasks-v0/src/browser.js:204-224`). `ItemStore.#listAllItems` lists by the root prefix,
so **one shared DataSource + N ItemStores with distinct roots** partitions reads/writes with no
per-call filter and no leak surface. Give household the same treatment.

The active `circleId` already arrives in `args` for create/mutate verbs (`scopeReadyDispatch`,
`apps/basis/src/router.js:300-315`) and via `loadCircleItems` for the detail view
(`circleContent.js:61`). It's **dropped at the last hop** — the household `callSkill` branch
(`realAgent.js:820-826`) forwards args to skills that ignore them, and the store doesn't filter.
**Only the last hop into the store is missing.**

## Phases (land web first, commit per phase)

- **Phase 1 — thread circleId.** In the `household` branch of `callSkill` (`realAgent.js:820-826`)
  resolve `circleId = args.circleId ?? args.circleId ?? args.groupId ?? 'household'` (legacy bucket
  default). Gap: **read verbs** (`listOpen`/`list`) aren't in the scope-injection sets
  (`router.js:244-262`) → a chat `/list` carries no circleId. Fix: inject scope for read verbs too
  (preferred), or fall back to an injected `getActiveCircleId()`. Detail view already scoped.

- **Phase 2 — per-circle store (the fix).** Make `rootContainer` injectable in `InMemoryStore`
  (`apps/household/src/storage/InMemoryStore.js:68-73`; default `mem://household/` = legacy).
  Add a `Map<circleId,{store}>` + `getHouseholdScope(circleId)` lazily creating a store rooted at
  `mem://household/circles/${circleId}/`, backed by the shared `householdDataSource`
  (`realAgent.js:121-124`). Rebuild skill `ctx.store` from `getHouseholdScope(circleId)` per call
  (`registerHouseholdSkill`, `realAgent.js:343-357`). Seed only into the legacy bucket.
  *Keep the mirror temporarily global here — prove the local partition first.*

- **Phase 5 (do early) — fitness test.** Boot one agent, drive real `callSkill`: add Milk to A →
  `listOpen` in B is empty, in A present; assert `getHouseholdScope('A') !== getHouseholdScope('B')`.
  Repeat for tasks (`circleId`) + stoop (`groupId`). The drift guard (CLAUDE.md "prefer a fitness
  function").

- **Phase 3 — tasks + stoop.** tasks-v0: verify (already per-circle); fix the chat `/mytasks` read-scope
  gap. stoop: close the read-leak — ensure every per-circle read goes through the `groupId`-tag +
  `keepForCircle` filter (full per-store parity via `createNeighbourhoodCluster` is a follow-up).

- **Phase 4 — migration.** Zero-cost default: `getHouseholdScope('household')` (and no-active-circle)
  returns the **legacy root** `mem://household/` — the existing pile stays reachable as the
  legacy/default bucket; new circles get empty stores. Optional opt-in adopt-into-circle migration,
  idempotency-guarded.

- **Phase 6 — per-circle mirror (separate commit; OBJ-2).** Move the mirror + `setSyncHook` + peer
  roster + catch-up republish + persisted pairings (`realAgent.js:219-268`) into `getHouseholdScope`
  so each circle's store has its own mirror (`scopeId = circleId`) + its own peer roster
  (`HOUSEHOLD_PEERS_KEY` → `cc-household-peers:<circleId>`). Re-key `feedHouseholdRoster` /
  `addHouseholdPeer` (`src/v2/householdRosterPairing.js`) by circle. **Riskiest step** — isolate it.

## Sequencing
Phases 1+2+5 first (local partition + no-leak proof, mirror still global), THEN Phase 6
(per-circle mirror) so any OBJ-2 regression is isolated. tasks-v0 is the copy-from reference.

## Critical files
- `apps/basis/src/core/agent/realAgent.js` (the chokepoint + the registry)
- `apps/household/src/storage/InMemoryStore.js` (injectable rootContainer)
- `apps/household/src/substrateMirror.js` (per-circle mirror, Phase 6)
- `apps/basis/src/router.js` (read-verb scope injection)
- `apps/tasks-v0/src/browser.js` (reference pattern)
