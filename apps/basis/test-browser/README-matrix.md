# The connectivity setup / mode MATRIX

Test infrastructure that runs the Phase-0 journey suite with **multiple clients in different client
modes** and **different circle setups**, across phases. It builds on the existing Phase-0 harness
(`peerHarness.js` + `journeys.spec.js`) — it does not replace them. It grows as each phase lands:
adding a setup is one entry in `setups.js`; adding a journey is one spec that uses the harness.

## The files

| File | What it is |
|---|---|
| `peerHarness.js` | The reusable N-peer harness (existing). Extended with a **per-peer `mode`** so one test can hold clients in different modes: `bootPeer(browser, label, { lang, transportMode, relayUrl, pod, storageState })`. All new fields optional — the old signature still works. |
| `setups.js` | The matrix **axes as data** (transport × pod) + `describeMatrix(test, title, axes, body)` — expands the cartesian product into readably-named, phase-aware cells. |
| `matrix.spec.js` | The **core journeys** (pairing, fan-out, task-handoff, entrust, offline-catch-up) run across the matrix, plus a **mixed-mode** cell (A relay-only, B nkn-only). |
| `relayFixture.js` / `relayTeardown.js` | Playwright `globalSetup`/`globalTeardown` that start/stop a local `@onderling/relay` for the `relay` project. |

## The axes

**Transport** (`TRANSPORT_MODES`, mirrors the app's `TRANSPORT_MODES`):

| id | client mode | supported now |
|---|---|---|
| `nkn` | the app's default rendezvous (no relay env) | yes (flaky in a sandbox) |
| `relay` | a local `@onderling/relay` WebSocket broker (hermetic) | yes (with the fixture armed) |
| `both` | both up; router picks best route per peer | yes |

**Pod data-policy** (`POD_POLICIES`, the per-circle `circlePolicy.pod`):

| id | circlePolicy.pod | supported now |
|---|---|---|
| `no-pod` | `none` (fan-out only) | **yes — the only real data-policy today** |
| `shared-pod` | `shared` | fixme (Phase 2) |
| `pod-only` | `personal` | fixme (Phase 3) |
| `hybrid` | `hybrid` | fixme (Phase 3) |

**Client roles** (`CLIENT_ROLES`) are a *note*, not a boot flag — a role comes from the **journey**:
who runs `createCircle` is the admin, who redeems the invite is a member, a contact-add makes a
contact, `@`-tagging engages the bot. Recorded in `setups.js` so the matrix documents them.

Each cell carries the earliest phase it works; `CURRENT_PHASE` (default `1`, override with
`PEER_TEST_PHASE`) decides real-vs-fixme, so unsupported cells auto-`fixme` with the target phase in
the title.

## The per-client mode knobs (the localStorage keys seeded)

`bootPeer` seeds these via `context.addInitScript` **before** the app boots (see `LS_KEYS`):

| key | purpose | discovered in |
|---|---|---|
| `basis.app.lang` | force locale (headless Chromium is en-US) | existing |
| `basis.relayUrl` | the relay pref, read at boot | `src/v2/relayPref.js` (`STORAGE_KEY`) → `web/v2/circleApp.js` (`localStorageRelayIo().load()`) |
| `basis.chat-id:cc-transport-mode` | the `/transport-mode` vault value under the chat-identity `VaultLocalStorage` prefix | `src/core/localBuiltins.js` (`cc-transport-mode`) + `realAgent.js` (`basis.chat-id:` prefix) |

A `relay`/`both` peer also gets the relay URL as the **`?relay=<wss>` boot param** (belt to the
localStorage braces — `web/v2/circleApp.js` applies it at boot).

> **Honest note on transport mode:** the app also **derives** the effective mode from which transports
> actually connect (`realAgent.connectPeerTransport`: relay present → `relay`/`both`, else `nkn`). So the
> load-bearing knob is whether a `relayUrl` is seeded (+ whether NKN's CDN lib loads); seeding
> `basis.chat-id:cc-transport-mode` is a best-effort hint, not the sole lever.

## Running a named setup / project

```bash
cd apps/basis

# default (unchanged) — NKN, no relay:
npx playwright test test-browser/matrix.spec.js

# the NKN transport setup explicitly:
npx playwright test test-browser/matrix.spec.js --project=nkn

# the relay setup — ARM the fixture with a ws:// URL; globalSetup starts the relay,
# the harness seeds it per-client, globalTeardown stops it:
PEER_TEST_RELAY=ws://127.0.0.1:8787 npx playwright test test-browser/matrix.spec.js --project=relay

# enumerate the cells without running (the structural proof):
npx playwright test test-browser/matrix.spec.js --list
```

`PEER_TEST_RELAY` unset ⇒ the fixture does nothing and default/`nkn` runs are untouched (no process
leaks). When it's set, `VITE_CIRCLE_RELAY_URL` is *also* forwarded to the dev server as a build-time
default — but only if Playwright starts the server (a reused `:5173` keeps its env; the per-client
`basis.relayUrl` seed wins regardless).

## Current honest coverage

- Cells per project: **61** (12 transport×pod cells × 5 core journeys + 1 mixed-mode). Across the 3
  projects (`chromium`, `nkn`, `relay`): 183.
- **Real** bodies now (`CURRENT_PHASE=1`): **7 per project** — `pairing` and `entrust` on each of the 3
  no-pod transport cells (`NKN`, `relay`, `NKN+relay`), plus the mixed-mode `pairing`. These may still be
  RED in a sandbox (empty roster is bug B1, fixed in Phase 1; NKN is flaky) — that's the point: "Phase 1
  done" == these go green.
- **fixme** now: **54 per project** — every pod-backed cell (Phase 2/3, not wired) and the Phase-2 journeys
  (`fan-out`, `task-handoff`, `offline-catch-up`) on the no-pod cells. Each fixme title states the reason
  and the target phase.

## The mixed-mode cell

`matrix · mixed-mode (A relay-only, B nkn-only) · no-pod` boots two peers from an **array** of per-peer
modes (`bootPeers(browser, 2, [{transportMode:'relay'}, {transportMode:'nkn'}])`) and pairs them —
proving clients in *different* transport modes can still pair. It only crosses the wire for real when the
relay fixture is up (the `relay` project) and/or NKN reaches the network; structural regardless.

## Adding to the matrix (extensibility)

- **A new setup** → one entry in the relevant axis array in `setups.js` (`TRANSPORT_MODES` /
  `POD_POLICIES`), with its `phase`/`real`. When a pod policy gets wired, flip `real: true` +
  drop its `phase` — its cells become real automatically.
- **A new journey** → one entry in `CORE` in `matrix.spec.js` (id, name, earliest `phase`, and a
  `run({peers, browser, cell})` body using the harness). It's multiplied over every cell for free.
- **A new spec entirely** → import the harness + `describeMatrix` and go; nothing else changes.

## Two harness gotchas preserved

- In-kring navigation leaves via the `.circle-kring__back` ("← kringen") button (`gotoKringen`), not a
  `[data-tab="kringen"]` tab.
- Tasks are **OFF by policy default** — call `enableFeature(page, 'tasks')` before `/addtask` + the Taken
  tab (the `task-handoff`/`entrust` bodies do).
