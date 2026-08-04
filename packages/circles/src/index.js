/**
 * `@onderling/circles` — audience model + saved-audience (circles)
 * substrate.  See README.md for the canonical alias note
 * (`circle.id ≡ task.circleId`).
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
