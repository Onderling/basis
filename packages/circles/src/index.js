/**
 * `@onderling/circles` — audience model + saved-audience (circles)
 * substrate.  See README.md for the canonical alias note
 * (`circle.id ≡ task.circleId`).
 *
 * ⚠ This is a **pure-DI** package: it imports almost nothing (the store, fan-out, verify helpers are all
 * INJECTED by consumers — see `circleCreate.js` "imports NOTHING"). So `package.json` declares almost no deps,
 * and a `node import @onderling/item-store` from here FAILS — because item-store is not a dependency, by
 * design, NOT because the workspace is broken. If a migration adds direct-import code here, declare its deps in
 * `package.json` + run `scripts/relink-workspace.mjs`. See `docs/architecture.md` "How the monorepo resolves".
 */

export {
  PUBLIC,
  normalizeAudience,
  resolveAudience,
  inAudience,
} from './audience.js';

export { createCirclesStore } from './circlesStore.js';

// saved cross-circle views: a named SET of audiences (circle
// refs) + a resolver that returns items visible to ANY of them.
// Reuses the canonical `view` item type (audience = union of refs).
export {
  savedViewAudiences,
  makeSavedView,
  resolveSavedView,
} from './savedView.js';

// The ONE circle-broadcast fan the `broadcastKring*` family rides. Lifted out
// of stoop as a pure DI core — the caller injects its deps + helpers.
export { createCircleFanOut } from './circleFanOut.js';

// Per-circle ADDRESS announcing — receive half (`recordCircleAddress`) and send
// half (`fanCircleAddresses`). Pure DI lift out of stoop; the caller injects the
// store, the core verify helpers, the announce kind, and the fan.
export { recordCircleAddress, fanCircleAddresses } from './circleAddress.js';

// Roster read / persona-property write / roster-updated fan, plus the full member
// roster read (`listCircleMembers` — the read with the per-peer ALLOWLIST projection).
// Pure DI lift out of stoop; the caller injects the store, the membership projection,
// the shared exit + foreign-caller + allowlist-gate helpers, the release-key diff, the
// fan-out core, and its `_sync` producer.
export {
  listCircleRoster, recordMemberPersonaProperties, fanRosterUpdated, listCircleMembers,
} from './circleRoster.js';

// Circle-creation writers (§8c slice-a, ZERO-KEY) — pure DI lift out of stoop; the group key bootstraps
// lazily on the first addMember, so creation moves without the key-custody plumbing.
export { createGroupWithRules, createGroupV2, redeemInviteWithGate } from './circleCreate.js';

// Key-coupled membership writers (§8c slice-b) — the membership-STATE bodies of the four writers lifted as
// pure store functions; the single trailing group-key grant/revoke is left as an INJECTED `grantKey`/
// `revokeKey` hook, so circles never holds the key custodian (`controlAgent`). Stoop binds the hook to
// `grant/revokePodAccess`.
export {
  redeemMembershipCode, verifyMembershipCodeForPeer, leaveGroup, removeMember,
} from './circleMembershipWriters.js';
