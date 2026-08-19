/**
 * replyEmbeds — S6.A foundation: turn a dispatch reply's items into the
 * manifest-driven inline buttons the circle chat renders (the "inline menu").
 *
 * The v2 bot reply is text today; this extracts the item snapshots a reply
 * carries (a created task, a listed set, an event, a file) and runs them through
 * the EXISTING `computeEmbedButtons` (manifest `surfaces.ui.control` +
 * `appliesTo`) to produce per-item action buttons (Claim / Mark complete / RSVP …).
 * The buttons ride the existing `payload.buttons` channel on the bot event, so
 * web (S6.A) + mobile (already renders `payload.buttons`) surface them, and a tap
 * dispatches the op. Pure — no DOM, no agent; unit-testable.
 *
 * This is the shared substrate for S6.B (an op whose surface opens a screen is
 * just a button that routes to a panel) and S6.C (per-circle/user prefs filter
 * which buttons render).
 */

import { computeEmbedButtons } from '../core/embedButtons.js';
// B · (4c) — apply the per-capability consequence (grey/hide/limit) to inline affordances.
import { affordanceTreatment, canonicalAtom } from '@onderling/app-manifest';

// Default item `type` per appOrigin so `computeEmbedButtons`' appliesTo.type
// matches when a reply item doesn't carry an explicit `type` (a task list often
// returns bare `{id, state, label}`).
const ORIGIN_DEFAULT_TYPE = { tasks: 'task', calendar: 'event', folio: 'file' };

/** Extract item snapshots `{id, type, state, label, fields}` from a dispatch reply. */
export function snapshotsFromReply(reply, { appOrigin } = {}) {
  if (!reply || typeof reply !== 'object') return [];
  const p = (reply.payload && typeof reply.payload === 'object') ? reply.payload : reply;
  const defaultType = ORIGIN_DEFAULT_TYPE[appOrigin];
  const out = [];
  const seen = new Set();
  const push = (it) => {
    if (!it || typeof it !== 'object') return;
    const rawId = it.id ?? it.taskId ?? it.itemId ?? it.eventId ?? it.fileId;
    if (rawId == null || rawId === '') return;
    const id = String(rawId);
    if (seen.has(id)) return;
    seen.add(id);
    out.push({
      id,
      type:  it.type ?? defaultType,
      state: it.state ?? it.status,
      label: it.label ?? it.title ?? it.text ?? it.name ?? id,
      fields: it,
    });
  };
  for (const k of ['task', 'item', 'event', 'file']) if (p[k]) push(p[k]);
  for (const k of ['items', 'tasks', 'events', 'files', 'results']) if (Array.isArray(p[k])) p[k].forEach(push);
  return out;
}

/** Truncate a label for a button face. */
function clip(s, n = 24) {
  const str = String(s ?? '');
  return str.length > n ? `${str.slice(0, n - 1)}…` : str;
}

// snapshot `type` → canonical embed `type` (embedChips vocabulary). Unmapped
// types pass through (the chip just falls back to the 🔗 icon).
const SNAP_TYPE_TO_EMBED = { event: 'calendar-event' };

/**
 * Build `embeds[]` for the SINGLE item a reply ACTED ON (created / modified) —
 * the singular `task`/`item`/`event`/`file` keys, NOT list arrays (a "5 tasks"
 * list shouldn't spawn 5 chips; its items already get inline buttons). The title
 * is taken from the reply, so the circle chip needs no resolution.
 *
 * @returns {{type:string, ref:string, title?:string}[]}
 */
export function embedsFromReply(reply, { appOrigin } = {}) {
  if (!reply || typeof reply !== 'object') return [];
  const p = (reply.payload && typeof reply.payload === 'object') ? reply.payload : reply;
  const defaultType = ORIGIN_DEFAULT_TYPE[appOrigin];
  const out = [];
  const seen = new Set();
  for (const k of ['task', 'item', 'event', 'file']) {
    const it = p[k];
    if (!it || typeof it !== 'object') continue;
    const rawId = it.id ?? it.taskId ?? it.itemId ?? it.eventId ?? it.fileId;
    if (rawId == null || rawId === '') continue;
    const ref = String(rawId);
    if (seen.has(ref)) continue;
    seen.add(ref);
    const snapType = it.type ?? defaultType ?? 'task';
    const type = SNAP_TYPE_TO_EMBED[snapType] ?? snapType;
    const title = it.label ?? it.title ?? it.text ?? it.name ?? null;
    out.push({ type, ref, ...(title ? { title: String(title) } : {}) });
  }
  return out;
}

/**
 * Build the circle inline buttons for a reply's items.
 *
 * @returns {Array<{id, label, opId, itemId}>}  ride `payload.buttons`; the host's
 *          tap handler resolves the op's target arg from the catalog + dispatches.
 */
export function embedButtonsForReply({ reply, appOrigin, manifestsByOrigin, maxButtons = 12, capabilityMatrix = [] } = {}) {
  if (!appOrigin || !manifestsByOrigin) return [];
  const snaps = snapshotsFromReply(reply, { appOrigin });
  const ops = manifestsByOrigin?.[appOrigin]?.operations;
  const out = [];
  const seen = new Set();
  for (const snap of snaps) {
    const embed = { appOrigin, snapshot: { id: snap.id, type: snap.type, state: snap.state, fields: snap.fields } };
    for (const b of computeEmbedButtons({ manifestsByOrigin, embed })) {
      const key = `${b.opId}:${b.itemId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // B · (4c) — grey/hide the affordance per the member's effective capability + consequence.
      const verb = Array.isArray(ops) ? ops.find((o) => o?.id === b.opId)?.verb : undefined;
      const treatment = affordanceTreatment(capabilityMatrix, { app: appOrigin, atom: verb ? canonicalAtom(verb) : null, noun: snap.type });
      if (treatment === 'hide') continue;
      out.push({
        id: key, label: `${b.label} · ${clip(snap.label)}`, opId: b.opId, itemId: b.itemId,
        ...(treatment === 'grey' ? { disabled: true } : {}),
      });
      if (out.length >= maxButtons) return out;
    }
  }
  return out;
}
