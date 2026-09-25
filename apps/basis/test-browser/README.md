# basis — Playwright browser tests

> **Tier**: between 🟢 (Vitest headless) and 🔴 (human runbook).
> Reaches things Vitest can't (real DOM, real IndexedDB, real
> file/click events, two-tab cross-peer) without the irreducible
> human bits (OS file pickers, OIDC consent, biometrics).

## Setup (one-time per machine)

From the repo root:

```bash
cd /home/frits/expotest/onderling-mono
pnpm add -Dw @playwright/test playwright
pnpm exec playwright install chromium
```

## Running

From `apps/basis`:

```bash
pnpm test:browser            # headless (CI-shape)
pnpm test:browser:headed     # watch the flows in a real window
```

`playwright.config.js` boots `pnpm dev` automatically on
http://localhost:5173 and reuses an existing server if one's
already running (so you can keep a dev tab open while iterating).

## What's here

- `smoke.spec.js` — minimal: load `/`, dispatch `/me`, assert a
  reply with `pubKey` lands.  Verifies the scaffold itself works.

## The user-story walks (several apps over a local relay)

`walk-*.spec.js` run under the `relay` project: two or three real web apps, a local `@onderling/relay` started by the
fixture. Run one at a time — they are heavy, and running them beside the unit suites makes both flaky:

```bash
PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/<spec>
```

`PEER_TEST_PORT` keeps the app off 5173 when another dev server holds it.

| story | spec |
|---|---|
| create as a persona · put a circle away · the add sheet · the lens · delete and return | `walk-persona-contacts` |
| one person, two devices: put-away, lens and delete follow; a device added from an offer is not a restore | `walk-own-devices-follow` |
| a rename and a disclosure, each a device's first statement in a circle: the person stays | `walk-two-devices-first-statements` |
| a contact renames, sends nothing: the row renames, says "was" until opened | `walk-names-travel` |
| two contacts with one name are told apart | `walk-lookalikes` |
| a revoked device cannot read what contacts send next (the person key moves on) | `walk-person-key` |
| a promoted admin re-admits someone who left | `walk-any-admin-readmits` |
| a face is drawn where the person is — **both halves `test.fail`** until pod-less circles can seal media and a contact can be shown a picture | `walk-face` |
| share my contact · the enrol that forgets · the persona release on the lane · leave travels (live build) | `walk-share-my-contact` · `walk-enrol-forgets` · `walk-persona-share-on-the-lane` · `walk-live-v0118` |

## What to add next (per the planning doc)

These journeys are 🔴 in the v0.7 runbook today but become 🟡
(semi-automated) once Playwright is wired:

| Runbook | Playwright equivalent |
|---|---|
| H-3 two-tab cross-peer ping | drive two `browser.newContext()`s, measure first-send latency |
| H-4 file send/receive | synthesise a small file via `page.setInputFiles`; assert receive on Tab B |
| H-5 identity rotation visible to peer | rotate on A; `/security-status` on B sees the new pubKey |
| H-10 NKN connect time | start timer, `/peer-connect`, stop when address appears |

These are NOT written yet — the scaffold proves the harness works;
each becomes its own slice.  See
`Project Files/basis/cross-app-journey-coverage-2026-05-23.md`
and `apps/basis/docs/manual-runbook-v0.7.md`.

## Why a separate dir

Vitest's default include pattern picks up `**/*.spec.{js,...}`
which collides with Playwright's convention.  `vitest.config.js`
explicitly excludes `test-browser/**` so the two runners stay
disentangled:

- `test/**/*.test.js` → Vitest (headless, fast, ~615 tests)
- `test-browser/**/*.spec.js` → Playwright (real Chromium)
