# Folio

> **Layer: app.** Composes substrates from `packages/{item-store, agent-ui, ...}`. Direct kernel use is allowed only when justified in this README's `## Direct kernel use` section (per [`app-readme-scheme.md`](../../docs/conventions/app-readme-scheme.md)). See [`Project Files/conventions/architectural-layering.md`](../../docs/conventions/architectural-layering.md).
>
> **Manifest + tier policy.** Folio's surface is **declaration-only**
> today — [`manifest.js`](./manifest.js) lists the destructive ops
> (`deleteFromPod` Q27 danger, `forceRepush` Q27 warn, `deleteLocally`
> Q27 info) + sync/watch ops, but the HTTP routes + RN screens keep
> their hand-coded UX (currently all T3 per
> `DESIGN-tier-policy.md`).  Future
> slices F.2 / F.3 wire the status page + folio-mobile screens to read
> from the manifest projection via `createOpBinding`, lifting the 3
> hand-rolled confirm modals to one substrate-driven component.

Your markdown notes, mirrored into your Solid pod.

A markdown folder that quietly mirrors itself into your pod.  Any markdown
editor (Obsidian, iA Writer, VSCode, vim) sees a normal folder.  Other
agents (the household app, the archive, the import bridge) write to the
same pod over the network.  No editor lock-in, no proprietary sync layer
— your existing tools just work.

## Substrates

This app composes the following substrate packages
(see [`Project Files/conventions/architectural-layering.md`](../../docs/conventions/architectural-layering.md)):

| Package | Used for | Why a substrate, not direct kernel |
|---|---|---|
| `@onderling/sync-engine` (L1a) | Bidirectional pod ↔ local-folder sync — `SyncEngine` (Folio is the pattern source for this substrate, post-Phase 5.1), `PathMap`, `scanLocal` / `scanPod` / `diff`, version helpers, fs/hash/watcher adapters (Node + RN). | The substrate exists *because* of Folio — Folio's V0.3 BidirectionalSyncEngine was lifted into the substrate in Phase 5.1. App-side `src/SyncEngine.js` is a thin subclass adding markdown-specific glue. |
| `@onderling/pseudo-pod` (Phase D cache-mode, 2026-05-16) | Write-through offline queue + read cache for the desktop CLI daemon — `createPseudoPod`, `createSyncEnginePodClient`, plus backend factories (`createMemoryBackend`, `createNodeFsBackend`). Wired in `podCache.js` + `_podFactory.js`; cache-mode is the default since Phase D. | Platform-neutral abstraction over PodClient; backend injected by caller (Node fs on desktop, RN adapter on mobile, memory for tests). Provides offline resilience as a substrate concern, not Folio app code. |
| `@onderling/pod-search` (V2 first consumer, Phase 52.25) | The `/zoek` **semantic note search** — `src/folioSearch.js` builds a `PodSearch` over the note corpus (title + body are `embed:true`), and the browser agent's `searchNotes` op runs `query({ mode })`. Uses pod-search's `hash` adapter for the content-hash cache key; an optional `vectorStore` persists vectors under `private/state/search-index/`. | The FTS5/vector index, the chunking + content-hash embed cache, RRF hybrid fusion, and the restart-safe persistence all live in the substrate; Folio is a thin consumer that maps note rows onto items and injects a policy-resolved embedder. The embedder is **injected, duck-typed** (llmTool:'off' / no Ollama ⇒ no embedder ⇒ lexical), so folio never imports `@onderling/llm-client`. |
| `@onderling/sync-engine-rn` (L1a, RN platform) | React Native sync engine bring-up + background task scheduling (background fetch, periodic sync) — `createSyncEngine`, `registerBackgroundTask`, `defineBackgroundTask`. Consumed by folio-mobile via Folio's `src/rn/serviceFactory.js` + `backgroundTasks.js`. | RN-specific adapters (scheduler, storage, background-fetch broker) live here; Folio pre-binds the app's `SyncEngine` subclass and re-exports for folio-mobile to consume. Same substrate, RN platform. |

## Direct kernel use

| Kernel/adapter package | Primitive | Used for | Justification |
|---|---|---|---|
| `@onderling/pod-client` | `PodClient` (dynamic import in `_podFactory.js:125`) | Solid pod read/write/list with `If-Match`/conflict detection — the production target the SyncEngine writes into. Imported via `await import(...)` to avoid forcing a hard dep in RN builds. | Folio is one of the canonical PodClient consumers; no substrate wraps "construct a PodClient" because the credential plumbing is per-app (mnemonic → `Bootstrap` → token). |
| `@onderling/core` | `Bootstrap` | Mnemonic-driven identity bring-up + Solid pod credential issuance for the CLI. | Foundation primitive; substrate-of-substrates over `Bootstrap` would be over-abstraction at this stage. |
| `@onderling/core` | `VaultNodeFs` | Node-side encrypted vault for the CLI's keypair. | Platform-specific vault concrete; the CLI is Node-only, so the matching kernel concrete is the right level. |
| `@onderling/core` | `PodCapabilityToken` | Folio's `share` flow — issue capability tokens to other agents. | Capability-token semantics are kernel-foundational; substrates compose them, they don't wrap them. |
| `@onderling/core` | `AgentIdentity` | Server-side `/share` endpoint (`routes.js`) — construct identity from vault on-demand to sign capability tokens. | Identity construction from keypair; per-app vault binding; same kernel-foundational tier as `Bootstrap`. No substrate wrapper exists or would be appropriate. |
| `@onderling/core` | `validateMnemonic` | CLI `init` — sanity-check user-typed mnemonics. | One-line helper; pulling a substrate around it would be silly. |
| `@onderling/oidc-session` (Phase 52.15.2, 2026-05-14) | `createSolidAuthNode` | Desktop OIDC session bring-up + multi-issuer sign-in for `folio serve` (`serveCmd.js`, `diagnostics.js`). Replaces the lifted-out `src/auth/OidcSession.js` app-side wrapper. | Platform-specific Node auth factory; per-app credential plumbing (client-registration state, vault-backed session). Kernel-direct because the issuer / vault binding is per-app, not substrate-uniform. |

## Bring it up

```bash
# Install + test
cd apps/folio
npm install
npm test            # 451/452 pass (1 pre-existing flaky FS-cleanup race)

# Initialise a pod identity (interactive — prompts for mnemonic + pod URL)
node bin/folio init

# Sync a local notes folder ↔ pod
node bin/folio sync   --folder ~/notes
node bin/folio watch  --folder ~/notes      # continuous mirror
node bin/folio status --folder ~/notes      # diff + conflict count

# Run the localhost web server (Folio.B1.server) for the upcoming web UI
node bin/folio serve --folder ~/notes
```

Detailed sign-in / service / troubleshooting runbooks live in their own sections below ("How to sign in to your Solid pod", "Run Folio as a service", "Troubleshooting").

## What's in here

```
apps/folio/
├── README.md                  ← this file
├── package.json               ← @onderling-app/folio
├── bin/folio                  ← CLI entry
├── src/
│   ├── SyncEngine.js          ← thin subclass of @onderling/sync-engine's engine
│   ├── PathMap.js             ← re-exports substrate's PathMap with ACL helpers
│   ├── scanLocal.js / scanPod.js / diff.js / versions.js
│   ├── adapters/              ← fs/hash/watcher (Node + RN re-exports from substrate)
│   ├── autoShare.js           ← issues PodCapabilityToken on .shared/ folders
│   ├── cli/                   ← initCmd / syncCmd / watchCmd / serveCmd / shareCmd / …
│   ├── server/                ← Express + WebSocket (B1.server)
│   ├── rn/                    ← serviceFactory + backgroundTasks (consumed by folio-mobile)
│   └── diagnostics.js
└── test/                      ← unit + integration; vitest
```

## v1 scope

Phase A (CLI) and Phase B.1.server (Express + WebSocket) are shipped:

- `SyncEngine` library (Folio.A1) — pure JS, used by all phases.
- `folio` CLI (Folio.A2) — `init / sync / watch / status / share / conflicts / rm`.
- Local web server (Folio.B1.server) — Express + WebSocket on
  `http://127.0.0.1:8888`; consumed by the upcoming web UI (B1.ui).
- **`/zoek` semantic note search (Phase 52.25)** — `src/folioSearch.js`
  wires the note corpus onto `@onderling/pod-search` V2; the browser agent's
  `searchNotes` op (`manifest.js`, slash `/zoek`, Part-C verbs
  `zoek/search/find`) offers lexical **and** semantic/hybrid ranking. The
  embedder is injected by the host (basis resolves it from the active
  circle's `embedTool ?? llmTool` policy); with the policy `off` or no
  provider available, `/zoek` degrades to **lexical-only** and makes no
  embed call. **Follow-up:** RN wiring of pod-search's `hash` adapter via
  `expo-crypto` (`packages/react-native/platform`) + a real pod-backed note
  body read (the in-process index is title/name-only until then).

```js
import { SyncEngine } from '@onderling-app/folio';
import { PodClient }  from '@onderling/pod-client';

const podClient = new PodClient({ podRoot, auth });
const engine    = new SyncEngine({
  podClient,
  localRoot: '/Users/alice/notes',
  podRoot:   'https://alice.example/notes/',
});

await engine.runOnce();          // one-shot
engine.start();                  // continuous (chokidar + interval)
engine.on('conflict', ({ relPath }) => console.warn('conflict:', relPath));
engine.on('synced',   (s)            => console.log('synced:', s));
await engine.stop();
```

## TODO — Inrupt-cleanup convergence (2026-05-08)

Folio's authentication surface is touched by two ongoing tracks:

1. **Mobile (`apps/folio-mobile`)** uses
   [`@onderling/oidc-session-rn`](../../packages/oidc-session-rn/) —
   newly extracted 2026-05-08 from folio-mobile's own `src/auth/`
   directory as the rule-of-two consumer with Stoop V3 Phase 40.3.
   Folio-mobile is unchanged behaviourally; its `src/auth/{OidcSessionRN,
   folioAuth, dcr}.js` are now thin re-export shims around the
   substrate.
2. **Desktop (`apps/folio`, this app)** uses
   [`@onderling/oidc-session`](../../packages/oidc-session/)'s
   `createSolidAuthNode({vault, clientName})` factory (Phase 52.15.2
   substrate promotion, 2026-05-14 — replaced the lifted-out
   `src/auth/OidcSession.js` wrapper). Multi-issuer support
   (Inrupt + solidcommunity.net + solidweb.org + custom URL) lands
   via the `KNOWN_ISSUERS` / `getIssuerPickerHtml()` exports + the
   updated sign-in modal. **Sharing v2 (Phase 52.16, ACP/WAC) is
   implemented** via `createClientSharing` from
   `@onderling/pod-client/sharing` in `src/autoShare.js`; ACP grant
   is attempted first with cap-token fallback on non-ACP pods
   (regression tests at `test/autoShare.acp.test.js`).

**Adoption status (2026-05-15):** Phases 52.15 + 52.16 complete.
Phase 52.10 agent-registry and Phase 52.14 stale-peer subscription
remain deferred to Folio V2 (need sync-engine → pseudoPod V1
absorption first). 463/463 desktop tests + 79/79 mobile tests
green.

## Settings layout

When Folio introduces user-tunable settings, the layout MUST follow
the project-wide convention in
[`Project Files/conventions/cross-app-settings.md`](../../docs/conventions/cross-app-settings.md):

```
<pod>/folio/settings/shared.json              user-portable
<pod>/folio/settings/devices/<deviceId>.json  per-install (local-only)
```

`shared.json` follows the user across every install of Folio (and is
the blob a sibling app — Stoop, Archive — may read on its first run
to seed defaults per Rule 3 of the convention).
`devices/<deviceId>.json` stays local to each install (poll cadence,
mobile online-window, hop-relay decisions). The `deviceId` is
[`core.AgentIdentity.deviceId`](../../packages/core/src/identity/AgentIdentity.js).

**Cross-app shared-defaults (Rule 3):** when Folio runs on a pod
that already has a `<pod>/stoop/settings/shared.json`, Folio MAY
seed its own first-run defaults from those values for fields that
mean the same thing (e.g. `defaultShareLocation`,
`preferredLocale`). Document the field-mapping table in this section
once Folio implements it. **Don't slave to siblings continuously**
— the rule is "defaults at first start, divergence allowed thereafter."

Per-device blobs MUST NOT be pushed to the pod via bulk-sync (see
the Stoop pod-layout doc
for the canonical implementation).

**Status (2026-05-07):** Folio doesn't ship persisted settings yet;
this section is forward-looking. Update it when settings land.

### Personal-pod URLs do not travel peer-to-peer

Folio is currently single-user / single-pod and doesn't fan content
out to peers, so this rule mostly bites Folio's mobile companion
when notes are shared. The project-wide rule in
`Project Files/projects/README.md`
applies the moment Folio adds any peer-broadcast surface (e.g.
sharing a note with a circle-member): no pod URL ever crosses the
wire — bytes only.

## Reference

- Plan: `../../coding-plans/track-H-app-folio.md` — phased implementation plan (A: CLI, B: web, C: mobile).
- Design sketch: `../../coding-plans/track-H-design-sketches.md` §H1 — the user-facing experience.
- Settings convention: [`Project Files/conventions/cross-app-settings.md`](../../docs/conventions/cross-app-settings.md).

## Folder-name conventions

Folder names drive the pod's ACL.  These are honored by `PathMap.aclFor`:

| Local path             | Pod ACL       |
|------------------------|---------------|
| `shared/...`           | public-read   |
| anything else          | private (default) |

Phase B will add:
- `with-<webid>/`  — auto-shared with that contact (Twist 1).
- `private/...`    — encryption-by-ACL helper (Twist 1.5).
- per-folder time-machine versioning (Twist 2).

## Conflict UX

When both local and pod sides change a file since the last sync, Folio
writes git-style markers in place to the local file:

```
<<<<<<< YOURS (local 2026-04-29 14:32 UTC)
my version
=======
their version
>>>>>>> THEIRS (pod 2026-04-29 14:35 UTC)
```

Edit the file in your normal markdown editor to resolve, then `runOnce`
again to push the merge back to the pod.

## State

Per-folder sync state lives at `<localRoot>/.onderling/notes-sync-state.json`
and is the source of truth for "what was the last common version of each
file."  Delete the state file to force a full re-scan on next sync.

## Web server (Folio.B1.server)

```bash
folio serve              # binds to 127.0.0.1:8888 by default
folio serve --port 9000  # override port
folio serve --watch      # also start the SyncEngine watcher on boot
```

REST endpoints (all JSON; localhost only — no auth on the loopback layer):

| Verb   | Path                       | Body / notes                                          |
|--------|----------------------------|--------------------------------------------------------|
| GET    | `/status`                  | sync stats + pending counts                            |
| GET    | `/conflicts`               | list of conflicted files                               |
| POST   | `/conflicts/:id/resolve`   | `{ resolution: 'mine'\|'theirs'\|<text> }`             |
| POST   | `/share`                   | `{ webid, scopes, expiresIn?, path? }` → token JSON    |
| POST   | `/sync/now`                | `{ direction?: 'both'\|'push'\|'pull' }` (202 + WS)    |
| POST   | `/watch/start`             | start the SyncEngine watcher                            |
| POST   | `/watch/stop`              | stop the SyncEngine watcher                             |
| POST   | `/auth/login`              | `{ issuer }` → `{ redirectUrl }` (Solid OIDC)          |
| GET    | `/auth/callback`           | provider redirects here; 302 → `/`                     |
| GET    | `/auth/status`             | `{ authenticated, webid?, expiresAt?, issuer? }`        |
| POST   | `/auth/logout`             | clear the in-memory session + vault refresh token      |

## How to sign in to your Solid pod

Folio talks to your pod over standard Solid OIDC, via Inrupt's
[`@inrupt/solid-client-authn-node`](https://www.npmjs.com/package/@inrupt/solid-client-authn-node).

```bash
folio init      # one-time: creates the vault + sync config
folio serve     # starts the local agent on http://127.0.0.1:8888
```

Open `http://127.0.0.1:8888/` in any browser.  Top-right shows a "Sign in"
button:

1. Click **Sign in**.  Pick `solidcommunity.net`, `login.inrupt.com`, or
   paste a custom issuer URL.
2. The browser is sent to your identity provider's login page.
3. After a successful login the provider redirects you back to
   `http://127.0.0.1:8888/auth/callback?…`; Folio exchanges the code for
   tokens and lands you on `/` with the status pill showing your WebID.
4. The refresh token is encrypted-at-rest in the vault — you do **not**
   need to sign in again across `folio serve` restarts.

The access token lives in process memory only; the refresh token is the
one persistent piece of credential material.  `folio serve` will silently
re-establish the session on boot if a valid refresh token is in the vault.

To sign out, click **Sign out** in the pill — that clears the in-memory
session and removes the refresh token from the vault.

The `/auth/callback` endpoint is hard-bound to localhost only; even if
something resolves the Folio host externally, the server returns `403
FORBIDDEN` for non-loopback callers.

WebSocket `/events` broadcasts `status`, `sync.progress`, `sync.done`,
`conflict.new`, and `error` frames.  Errors are shaped
`{ error: { code, message } }` with appropriate HTTP status.

The full contract lives in a comment block at the top of
[`src/server/routes.js`](src/server/routes.js).

## Run Folio as a service

To make Folio auto-start on login (so notes keep syncing without you having
to remember to run `folio serve`), install the per-user service unit:

```bash
folio install-service       # install + start
folio service-status        # running / stopped / not-installed
folio uninstall-service     # stop + disable + remove (idempotent)
```

What gets written, by platform:

| OS      | Unit file                                          | Backend           |
|---------|----------------------------------------------------|-------------------|
| macOS   | `~/Library/LaunchAgents/org.onderling.folio.plist`   | launchd (LaunchAgent) |
| Linux   | `~/.config/systemd/user/folio.service`             | systemd `--user`  |
| Windows | Scheduled Task `Folio` (sentinel in `%LOCALAPPDATA%/folio/`) | Task Scheduler `/SC ONLOGON /RL LIMITED` |

The unit references absolute paths to the `node` binary and `cli.js`
resolved at install time, so it survives `PATH` changes in your shell.
Working directory is set to your `localRoot` (the folder you passed to
`folio init`).

**Per-user only.**  No `sudo` is ever required: macOS uses LaunchAgents
(not LaunchDaemons), Linux uses `systemctl --user`, Windows uses
unprivileged Task Scheduler.

**Logs:**
- macOS:   `~/Library/Logs/folio/folio.log`
- Linux:   `~/.cache/folio/folio.log`
- Windows: `%LOCALAPPDATA%\folio\folio.log`

`install-service` is idempotent — running it twice re-writes the unit and
re-loads it, so changes you make to your `localRoot` propagate cleanly.

`uninstall-service` is also idempotent — safe to call when nothing is
installed.

> **Windows is best-effort.**  No Windows CI verification; the task uses
> Task Scheduler `ONLOGON` triggers but does not have systemd's
> `Restart=on-failure` semantics — the process is restarted only on the
> next logon (or when you re-run `folio install-service`).

## Troubleshooting

Run `folio doctor` to diagnose setup issues.  It walks the bring-up chain
step-by-step (config → vault → OIDC → pod write/read/delete) and prints one
`[PASS]` / `[FAIL]` / `[WARN]` / `[SKIP]` line per check, so the failure
mode is obvious in 5 seconds without having to read source.  Use `--json`
for machine-parseable output, `--verbose` for raw error text per step.

## Tests

```bash
cd apps/folio && npm test
```

## Cross-app substrate compatibility (added 2026-05-07, revised)

Tasks V1 (`Project Files/Tasks App/advice-2026-05-07.md`)
flags two cross-app patterns relevant to Folio:

- **Read `*.ics` calendar files from the pod.** When Folio's UI
  needs to display calendar data (a future "calendar" view, or
  to attach a calendar event reference to a note), it reads
  `<user-pod>/calendar/*.ics` directly. Read-only; Folio is not
  responsible for getting the events into the pod in the first
  place. **The OAuth + change-listener work for Google /
  Outlook / iCloud sources lives in `apps/import-bridge-v0`**
  per the revised plan (2026-05-07) — it's "yet another import
  source", which is exactly what import-bridge is for. *(The
  earlier draft of this section recommended Folio host the
  sync; that recommendation has been moved.)*
- **Canonical user-skills profile at `<user-pod>/profile/skills.json`.**
  Tasks / Stoop / Household all import the user's skills from
  this canonical profile via a prefilled-form-edit-before-submit
  pattern. **Folio is the natural app for editing the canonical
  profile** (it already owns "your stuff on your pod" UX) — when
  Folio's UI gets a "skills" tab, it edits this file directly,
  and other apps prefill from it. Substrate-candidate for
  `@onderling/identity-resolver` once a 2nd consumer lands.

Both items are forward-compat heads-up; no immediate code
changes required.
