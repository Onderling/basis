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
