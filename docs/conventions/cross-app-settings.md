# Cross-app settings: shared vs. per-device, and pod-side defaults

> **Status:** locked 2026-05-07. Project-wide convention.
> **Companions:**
> - [`./pod-layout-conventions.md`](./pod-layout-conventions.md) — coming once a 2nd app adopts the same shape (rule of two)
> - `../Pinboard/pod-layout-2026-05-06.md` — current canonical example
> - [`./architectural-layering.md`](./architectural-layering.md) — apps don't import each other; this convention rides on the pod, not on cross-app imports.
> **Applies to:** every directory under `apps/` whose users sign in
> with a Solid pod and have settings worth persisting.

## Why this exists

Three observations from work on Pinboard:

1. **Some settings belong to the user, not the device.** "Default share location with new contacts" follows the user; "poll cadence" follows the device. Hardcoding either to one blob is wrong.
2. **A user often runs more than one of these apps on the same pod.** When they install Folio next to Pinboard, "do I broadcast my displayName?" is conceptually the same answer in both. Re-asking is friction; silently ignoring the prior answer is creepy.
3. **The pod is the natural place to coordinate this.** Apps already write there; reading another app's blob to seed a default is one extra request, no new substrate.

This doc nails down the resulting rule for every app that ships in this repo.

## Rule 1 — Two scopes per app

Every app SHOULD store its persisted settings in **two** containers:

```
<pod>/<app>/settings/shared.json              user-portable
<pod>/<app>/settings/devices/<deviceId>.json  per-install
```

- `shared.json` — one blob per user. Read + write by every install of that app belonging to the user. Preferences that should follow the user across all their devices live here.
- `devices/<deviceId>.json` — one blob per install. The `deviceId` is a UUIDv4 generated on first run, stored in the agent vault under `agent-device-id` (see [`core.AgentIdentity.deviceId`](../../packages/core/src/identity/AgentIdentity.js)). The blob is read + written ONLY by that install — other installs see it but never overwrite it.

Apps with no device-specific concerns can ship with only `shared.json`. Apps with no shared concerns are uncommon — most user-tunable preferences are inherently user-scoped.

### Field-set partition (per app)

Each app's `loadSettings({dataSource, deviceId})` reads both blobs, merges (device overlay shared), returns the merged view. `saveSettings` / `updateSettings` route patches by **field name**: each app maintains its own `DEVICE_FIELDS` + `SHARED_FIELDS` sets. Examples:

| Field | Likely scope | Why |
|---|---|---|
| `pollIntervalMs`, `onlineWindow` | device | Per-machine cadence / battery decisions. |
| `allowHopThrough`, `allowRelay` | device | Hardware-level routing. |
| `broadcastable`, `acceptInbound` | shared | User policy. |
| `defaultShareLocation` | shared | New-contact default — same answer everywhere. |
| `displayName`, `handle` | shared (often via MemberMap, not settings) | Identity. |
| `theme`, `fontScale` | depends — usually device | UI preferences are typically per-screen. |

**Rule:** when adding a new field, the app's PR description must declare its scope. New fields default to **shared** if unsure (safer — pod-portable preferences won't accidentally lock someone into a per-machine state they can't change from a different device).

## Rule 2 — Per-device blobs are local-only

Per-device blobs are install-scoped and disposable:

- They MUST NOT be pushed to the pod via the bulk-sync path. Bulk-sync (Phase 34 in Pinboard) explicitly skips `<app>/settings/devices/*` and the migration-marker key.
- A fresh install gets a fresh `deviceId` and starts with defaults — there is no "restore my old device's settings from the pod" path. By design: devices aren't replaced 1-for-1; their settings shouldn't be either.
- ACPs on per-device blobs are owner-only (same as shared.json). Multi-device sync is implicit (the same user owns all installs); the deviceId namespacing prevents cross-install overwrites, not cross-user reads.

In Pinboard, this is enforced via `CachingDataSource`'s `localOnlyPrefixes` constructor option. Other apps adopting this layout SHOULD use the same pattern (or a substrate equivalent once the local-store extraction lands — tracked in `Project Files/Substrates/substrate-candidates.md`).

## Rule 3 — Apps may seed defaults from another app's settings

When app B starts on a pod that already has app A's settings, B MAY read A's `shared.json` to **seed defaults for fields A and B both understand**. This is a one-shot at install/first-run; once the user touches B's settings, B never reads A again.

**Allowed:**

- Seed `B.defaultShareLocation` from `A.defaultShareLocation` if A wrote one.
- Seed `B.acceptInbound` from `A.broadcastable` (semantically equivalent).
- Seed `B.preferredLocale` from `A.preferredLocale`.

**Not allowed:**

- Reading A's `devices/*.json` (it isn't yours, and it's install-scoped).
- Continuous mirroring — apps don't slave to each other's settings post-install. The pod is a coordination point, not a runtime dependency.
- Writing into another app's settings container. Apps stay in their own namespace (`<pod>/<app>/...`).

The rule is **defaults at first start, divergence allowed thereafter.** A user who explicitly sets B's broadcastable = true, then changes A's broadcastable = false, will keep B as true. That's deliberate: people often want different behaviour per app.

### How to implement

In an app's first-run path:

```js
async function maybeSeedFromSiblingApp({ podClient, mySettings }) {
  if (mySettings.shared?.bootstrappedFromSibling) return mySettings;
  for (const sibling of ['pinboard', 'folio', 'archive', 'household']) {
    if (sibling === MY_APP_NAME) continue;
    const path = `${podRoot}/${sibling}/settings/shared.json`;
    try {
      const raw = await podClient.read(path);
      if (!raw) continue;
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      mySettings.shared = {
        ...mapSiblingFields(sibling, parsed),
        ...mySettings.shared,                    // explicit user values win
        bootstrappedFromSibling: sibling,
      };
      break;                                     // first one wins
    } catch { /* sibling not installed */ }
  }
  return mySettings;
}
```

`mapSiblingFields` is per-app — it knows which of the sibling's fields map onto its own. Document this map in the app's README so users (and reviewers) can see what's borrowed.

### When NOT to seed

- Identity-shaped fields (handle, displayName, mute lists). Those go through the user's `MemberMap`, not via app-A → app-B copy.
- Privacy-sensitive defaults that change risk profile. If app B is more public than app A by nature, seeding silently can surprise the user. Prefer asking.

## Rule 4 — Document the layout in your README

Every app's README MUST include a **Settings layout** section noting:

- The `shared.json` + `devices/<deviceId>.json` split (or that the app is shared-only).
- Which fields are device-scoped vs. shared-scoped.
- Which sibling-app fields are seeded as defaults at first run, if any.

The Pinboard README is the canonical example — see its `## Settings layout` section.

## Migration

Apps with a pre-existing flat `<pod>/<app>/settings.json` SHOULD migrate lazily on first load: read the legacy blob, partition by field, write the new layout, delete the legacy blob, set a marker key (e.g. `<app>/settings/.migrated-from-v2`) so subsequent loads skip the work. Pinboard ships this as `_migrateLegacyIfPresent` in `apps/pinboard/src/lib/Settings.js` — fork that pattern.

## Tracking

Pinboard Phase 33 introduced the layout: see`Project Files/Pinboard/coding-plan-v2-2026-05-07.md` § Phase 33 + `Project Files/Pinboard/pod-layout-2026-05-06.md`.
- Cross-app shared-defaults rule (Rule 3 above) was added 2026-05-07; first consumer is whichever sibling-app ships next; rule-of-two extraction into a substrate (`@onderling/cross-app-bootstrap` or similar) is tracked in `Project Files/Substrates/substrate-candidates.md`.
- Open questions:
  - Should the field-mapping table between siblings live in a shared registry, or stay per-app? Likely per-app for now (loose coupling); revisit if 4+ apps each maintain similar mappings.
  - Should sibling-app-name lookups be authenticated by app manifest (Phase 38)? Probably yes once Phase 38 lands.
