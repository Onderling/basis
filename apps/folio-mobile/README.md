# @onderling-app/folio-mobile

> **Layer: app.** Composes substrates from `packages/{item-store, agent-ui, ...}`. Direct kernel use is allowed only when justified in this README's `## Direct kernel use` section (per [`app-readme-scheme.md`](../../docs/conventions/app-readme-scheme.md)). See [`Project Files/conventions/architectural-layering.md`](../../docs/conventions/architectural-layering.md). **Known direct kernel use:** `pod-client.PodClient` + `core.Bootstrap` — the canonical "no substrate fits yet" example called out in the layering doc.
>
> **Manifest + tier policy.** Folio-mobile reads from the folio
> manifest (declared in [`../folio/manifest.js`](../folio/manifest.js))
> via the workspace dependency.  All RN screens are currently T3 per
> `DESIGN-tier-policy.md`; future slice
> F.3 wires `ShareScreen` + `NotesListScreen` to consume the
> manifest's Q27 confirms (deleteFromPod / forceRepush /
> deleteLocally) via an RN-side equivalent of `createOpBinding`.

Folio.C2 — React Native mobile client for [Folio](../folio/), the
Solid-pod-backed markdown notes app built on the @onderling platform.

This is a separate workspace from `apps/mesh-demo` (per Q-C1.3); the two
apps share `packages/*` but maintain independent Expo configurations.

## Substrates

This app composes the following substrate packages
(see [`Project Files/conventions/architectural-layering.md`](../../docs/conventions/architectural-layering.md)):

| Package | Used for | Why a substrate, not direct kernel |
|---|---|---|
| `@onderling/sync-engine` (L1a) | Bidirectional pod ↔ local-folder sync (RN side: `expo-file-system` + RN watcher adapter). Pulled in via the `@onderling-app/folio` app library. | Folio shipped this substrate; mobile reuses the engine + RN adapters via Folio's app-side service factory. |

The `@onderling-app/folio` workspace is **not** a substrate — it's a sibling app that exports its `SyncEngine` subclass + RN service factory for Folio Mobile to consume. This is the Folio C1 pluggable-engine pattern.

## Direct kernel use

| Kernel/adapter package | Primitive | Used for | Justification |
|---|---|---|---|
| `@onderling/pod-client` | `PodClient`, `SolidOidcAuth` | Solid pod read/write/list + OIDC auth flow (mobile-side, `expo-auth-session`). | Folio is one of the canonical PodClient consumers; no substrate currently wraps "construct an authenticated PodClient from an OIDC flow on RN." Layering doc lists this as the canonical "no substrate fits yet" example. |
| `@onderling/core` | `PodCapabilityToken` | Share screen — accept incoming capability tokens from another agent. | Capability-token primitive is kernel-foundational; substrates compose it, they don't wrap it. |
| `@onderling/react-native` | `platform/polyfills` (entry-point side-effect import) | RN bring-up: `react-native-get-random-values` + `nacl-util` polyfills before any crypto runs. | Platform layer — RN-specific bring-up lives in `@onderling/react-native` by design; no substrate wraps it. |
| `@onderling/react-native` | `pseudo-pod-adapter` (optional, feature-flagged) | Dynamic import in `ServiceContext.js:284`, gated on `FOLIO_PSEUDO_POD` / `EXPO_PUBLIC_FOLIO_PSEUDO_POD` env. Phase 3 OQ-6 optional caching layer: write-through queue + read cache backed by RN persistent store. | RN-specific concrete for the pseudo-pod abstraction; feature-flagged because Phase 3 is still validating the cache-mode default. Side-loaded so the bundle doesn't pull the cache layer when the flag is off. |

## Architecture: ONE `core.Agent` (when mesh transports are wired)

Folio-mobile is currently pod-only — no mesh transports today, so
the single-agent rule is satisfied trivially. **If/when** Folio
adds mDNS / BLE / relay (e.g. for direct cross-device note sync
without a pod hop), build them onto ONE `core.Agent` per
service-context, not per-account. Project-wide convention:
[`Project Files/conventions/single-agent.md`](../../docs/conventions/single-agent.md).

## Status

**v0** — Phase C deliverable.  Screens + auth + plain-TextInput editor.
Built on top of Folio.C1's pluggable RN engine adapters.

## Phase 52.x substrate adoption (2026-05-15)

Folio-mobile's substrate adoption tracks alongside Folio desktop:

| Phase | Surface | Adopted via |
|---|---|---|
| 52.15 | Multi-issuer auth substrate (RN flavour) | `src/auth/folioAuthHook.js` → `useOidcSignIn` from `@onderling/oidc-session-rn/hook` |
| 52.15.5 | `<IssuerPicker>` on SignInScreen | `src/screens/SignInScreen.js` |
| 52.16 | ACP/WAC sharing v2 (`client.sharing.*`) | `src/screens/ShareScreen.js` uses `podClient.sharing.grant({...})` with cap-token fallback |

Deferred to Folio-mobile V2 (waits on the sync-engine → pseudoPod V1
absorption — see `Project Files/Folio/v1-mobile-functional-design-2026-05-11.md`):

- 52.10 agent-registry per-bundle — requires the engine to run through
  pseudoPod.
- 52.14 Q-D Lamport `_v` stale-peer auto-heal — same.
- 52.2.x peer-fetch gates / `fetch-resource` skill — same.

Surfaced by Slice G audit (`Project Files/Folio/slice-g-audit.md`, 2026-05-20) — both
intentional v0 gaps in user-facing parity with folio desktop:

- **Inbound cap-token receive UI.** Desktop's `/share` endpoint
  accepts incoming capability tokens from another agent; mobile's
  `ShareScreen` only issues outbound tokens.  When V2 lands the
  receive flow, mirror the desktop endpoint's logic (decode + verify
  + persist).  Documented in `src/screens/ShareScreen.js` header.
- **File deletion UI.** Desktop has `/delete/:id` (Phase 2.11) plus a
  CLI `rm` (local tombstone only).  Mobile notes-list shows files
  but has no delete affordance.  Add either inline (swipe-to-delete)
  or via the per-file edit screen when V2 starts.

Out of scope for this slice:

- Push notifications
- App Store / Play Store packaging
- Tablet / iPad layouts
- Offline-only mode
- Markdown preview / syntax highlighting
- Background sync wiring (the C1 `backgroundTasks.js` foundation is
  present but not yet auto-registered — manual sync only)
- Multi-account support

## Bring it up

### Install

```bash
# From the repo root.
npm install --prefix apps/folio-mobile
```

The workspace pulls Folio + the platform packages via `file:` deps so
local edits to `apps/folio/` and `packages/*` are picked up by Metro
without re-publishing.

### Run on emulator

```bash
cd apps/folio-mobile
npx expo start

# Then press 'a' for Android emulator (Android Studio AVD running).
```

The first build will take a couple of minutes — Metro re-bundles all
of `packages/core` + `packages/pod-client` + `packages/react-native` +
`apps/folio` into the dev bundle.  Subsequent fast-refreshes are
sub-second.

### Run on real device (dev build)

The mesh-demo's existing dev build is installed on the user's phone.
Folio-mobile uses a **different** application ID
(`org.onderling.foliomobile`), so it needs its own dev build.  Per
CLAUDE.md, you should NOT run `npx expo run:android` for this app
without explicit user approval — that prebuilds and installs a fresh
APK.

When the user IS ready for a real-device build:

```bash
# user-attended only
cd apps/folio-mobile
npx expo run:android
```

After install, `npx expo start` in the same terminal serves the JS
bundle to the dev build over LAN.

## Authentication

Auth uses [`expo-auth-session`](https://docs.expo.dev/versions/latest/sdk/auth-session/)
with PKCE against the Solid OIDC issuer.  Default issuer is
`https://login.inrupt.com`; override via `<SignInScreen issuer="..." />`
or by editing `src/lib/config.js`'s `DEFAULT_INRUPT_ISSUER`.

Custom URL scheme: `folio://auth/callback` (declared in `app.json`).

Refresh tokens go to `expo-secure-store` (iOS Keychain / Android
Keystore).  See `src/auth/OidcSessionRN.js` for the storage keys.

> **2026-05-15 — lift shipped.** The OIDC + Solid auth plumbing now
> lives in `@onderling/oidc-session-rn`. Folio-mobile consumes it via
> `src/auth/folioAuthHook.js` (which pre-binds `scheme: 'folio'` and
> `clientName: 'Folio (mobile)'`) and `<IssuerPicker>` from
> `@onderling/oidc-session-rn/picker`. The desktop counterpart is the
> Phase 52.15 `createSolidAuthNode({vault, clientName})` factory in
> `@onderling/oidc-session`; both shells route through the same
> substrate-side DCR cache + multi-issuer state machine. The local
> `src/auth/{OidcSessionRN, folioAuth, dcr}.js` files remain as thin
> Folio-flavour wrappers / test seams; the substance has moved.

## Pair-test scenarios

When running real-device tests against Folio-desktop, the F1–F4
pair scenarios (ACP grant + fetch, cap-token fallback, revocation,
conflict resolution) live in the cross-app pair-test runbook:
`Project Files/conventions/pair-test-runbook-2026-05-15.md`.

## Known iOS limitations

- **Custom URL scheme on Android Expo Go is flaky** — use a dev build
  for sign-in testing.  Expo Go does not understand
  `folio://auth/callback`.
- **Background fetch is best-effort.**  iOS schedules background-fetch
  opportunistically; the configured cadence is a *floor*, not a
  guarantee.  Android applies Doze.  See the C1 plan §Q-C1.4.
- **DPoP / token-binding is not implemented** at v0.  Bearer-token
  auth is sufficient against `storage.inrupt.com`; pods that REQUIRE
  DPoP will reject our writes with 401.  Track via the follow-up plan.
- **iOS filesystem model (sandbox, document picker, security-scoped
  bookmarks, no folder watcher).**  Folio mobile is Android-only at
  this stage; iOS is not on the roadmap.  Design notes for the iOS
  filesystem story (so the work isn't lost) live in
  [`docs/IOS-FILESYSTEM-NOTES.md`](docs/IOS-FILESYSTEM-NOTES.md).

## Tests

```bash
npm test --prefix apps/folio-mobile
```

Tests use vitest with mocked Expo + RN modules (see `test/setup.js`).
The tests do NOT touch a real device, real Inrupt issuer, or real
filesystem — they exercise the auth state machine, ServiceContext
wiring, screen logic, and conflict-merge helpers in isolation.

## Settings layout

Folio-mobile shares its settings namespace with the desktop Folio
app — both write to `<pod>/folio/...`, NOT separate per-platform
containers. The layout follows the project-wide convention in
[`Project Files/conventions/cross-app-settings.md`](../../docs/conventions/cross-app-settings.md):

```
<pod>/folio/settings/shared.json              user-portable; shared with desktop Folio
<pod>/folio/settings/devices/<deviceId>.json  per-install (this phone, local-only)
```

The `deviceId`
([`core.AgentIdentity.deviceId`](../../packages/core/src/identity/AgentIdentity.js))
is fresh on every install — re-installing the mobile app gets a new
`devices/...` blob and starts from defaults. `shared.json` carries
over (it's pod-side and follows the user).

**Mobile-specific concerns** that belong in the per-device blob:

- Battery / online-window cadence (mobile-only; desktop Folio
  ignores these fields).
- Push-notification preferences (per device).
- "Allow background sync on cellular" — per device.

User preferences (display name, default sharing, locale) live in
`shared.json` and SHOULD be set the same way on both desktop and
mobile.

**Cross-app shared-defaults (Rule 3):** see the desktop Folio
README's Settings layout section. Mobile inherits the same
sibling-app seeding behaviour automatically since it reads the
same `shared.json`.

**Status (2026-05-07):** folio-mobile doesn't ship persisted
settings yet. Update this section when they land.

### Personal-pod URLs do not travel peer-to-peer

When mobile-Folio gains a "share this note" surface (likely V2),
the project-wide rule in
`Project Files/projects/README.md`
applies: outgoing share envelopes carry the note bytes (and resized
attachments) inline, never a `<pod>/folio/notes/...` URL.

## What's in here

```
src/
  ServiceContext.js          — React context owning engine + oidc
  auth/
    folioAuth.js             — expo-auth-session + PKCE wrapper
    OidcSessionRN.js         — secure-store-backed session adapter
  screens/
    SignInScreen.js          — Solid sign-in + pod-root setup
    StatusScreen.js          — last sync, pending counts, sync now
    NotesListScreen.js       — FlatList of local notes
    NoteEditScreen.js        — plain multiline TextInput editor
    ConflictsScreen.js       — list + per-conflict resolution
    ShareScreen.js           — mint capability tokens
    SettingsScreen.js        — WebID, pod root, diagnostics, sign-out
  components/
    SyncStatusPill.js
    FileRow.js
  lib/
    config.js                — non-secret app config (pod root, issuer)
    serviceBuilder.js        — bridges to C1 RN serviceFactory
    notesList.js             — pure walker over engine.fs
    useEngineEvents.js       — re-render hook
test/
  setup.js                   — vitest mocks for Expo + RN
  auth.test.js
  ServiceContext.test.js
  screens/
    StatusScreen.test.js
    NotesListScreen.test.js
    NoteEditScreen.test.js
```

## Pinned versions

Per CLAUDE.md "Decisions already made":

- Expo 52 / React Native 0.76.9 / React 18.3.1 — match
  `apps/mesh-demo/package.json` exactly
- `react-native-webrtc 124.0.7` — needed transitively by
  `@onderling/react-native`'s WebRTC transport even when the mobile UI
  doesn't use it directly

## Hand-off pointers

- Folio.C1 (`apps/folio/src/rn/serviceFactory.js`) — the engine
  factory this app drives
- `coding-plans/track-H-folio-C1.md` §"Mobile auth flow" — auth UX
  reference
- `coding-plans/track-H-app-folio.md` §Phase C — the full Folio mobile
  vision (this slice covers v0)
