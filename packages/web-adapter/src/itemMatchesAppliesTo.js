/**
 * itemMatchesAppliesTo — does an item match an action's `appliesTo`
 *                       gate from the manifest?
 *
 * Mirrors `packages/app-manifest/src/renderChat.js`'s internal
 * `matchesAppliesTo` (same shape, same semantics) — the chat surface
 * and the web surface MUST gate items identically (the manifest is
 * platform-neutral; the appliesTo predicate is the gate, full stop).
 *
 * Discipline:
 *   - F-SP3-a (locked 2026-05-20): `appliesTo.state` may be a string
 *     OR an array of strings. Multi-state gates encode DoD-lifecycle
 *     ops cleanly (e.g. `revokeTask.appliesTo.state` =
 *     `['claimed','submitted','rejected']`).
 *   - `appliesTo.type` accepts string OR array (same shape as in
 *     renderWeb's matchOp).
 *   - When `appliesTo` is undefined → matches everything (the
 *     manifest's "no gate" path).
 *   - When `appliesTo` is set but the item is falsy → returns false
 *     (matches renderChat's invariant — can't apply a gate to an
 *     absent item).
 *   - Derives `item.state` via `deriveItemState` when not present —
 *     V0 household items use lifecycle fields (completedAt etc.)
 *     rather than carrying an explicit `state` string. This is the
 *     load-bearing difference vs renderChat: chat receives state-
 *     stamped items already (the LLM tool surface), web has to derive
 *     state from raw store items.
 *
 * @param {object} appliesTo            { type?, state? } or undefined
 * @param {object} item
 * @returns {boolean}
 */
import { deriveItemState } from './deriveItemState.js';

export function itemMatchesAppliesTo(appliesTo, item) {
  if (!appliesTo) return true;
  if (!item || typeof item !== 'object') return false;

  if (appliesTo.type !== undefined) {
    const types = Array.isArray(appliesTo.type) ? appliesTo.type : [appliesTo.type];
    // NavModel (2026-05-21) — wildcard: `appliesTo.type === '*'`
    // means "any of manifest.itemTypes".  Surfaced by stoop's
    // `cancelRequest` (spans ask/offer/lend) — the stoop -adopt
    // agent had to work around this inline in mine.html.  Fixed once
    // in the substrate so every consumer shares one gate.  See
    // `DESIGN-navmodel-sketch.md` + `packages/app-manifest/src/
    // renderWeb.js`'s matchOp wildcard branch.
    if (!types.includes('*') && !types.includes(item.type)) return false;
  }

  if (appliesTo.kind !== undefined) {
    const kinds = Array.isArray(appliesTo.kind) ? appliesTo.kind : [appliesTo.kind];
    if (!kinds.includes('*') && !kinds.includes(item.kind)) return false;
  }
  if (appliesTo.state !== undefined) {
    const states = Array.isArray(appliesTo.state) ? appliesTo.state : [appliesTo.state];
    // Honour an explicit `state` field if present (chat-style item);
    // else derive from substrate fields (web-style raw item).
    const itemState = typeof item.state === 'string' ? item.state : deriveItemState(item);
    if (!states.includes(itemState)) return false;
  }

  // Per-event-kind dispatch (a.k.a. generic field
  // gating).  Surfaced by B.2.3 deferral: inbox events vary by `kind`
  // (subtask-proposal / task-rejected / etc.); per-row buttons need to
  // gate by kind, not just by type.  Generalised: ANY field in
  // `appliesTo` beyond the type+state pair is treated as an exact-or-
  // any-of match against the item's same-named field.
  //
  //   appliesTo: { type: 'inbox-item', kind: 'subtask-proposal' }
  //     → matches items where item.type==='inbox-item' AND
  //                            item.kind==='subtask-proposal'.
  //
  //   appliesTo: { type: 'task', kind: ['urgent', 'urgent-blocked'] }
  //     → array form for any-of (mirrors F-SP3-a's state semantics).
  //
  // Forward-additive: existing manifests with just `{type, state}`
  // gates keep working unchanged.
  for (const [field, gate] of Object.entries(appliesTo)) {
    if (field === 'type' || field === 'state') continue;  // already handled
    if (gate === undefined) continue;
    const values = Array.isArray(gate) ? gate : [gate];
    if (!values.includes(item[field])) return false;
  }

  return true;
}
