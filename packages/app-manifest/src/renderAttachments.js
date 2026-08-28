/**
 * renderAttachments — the ATTACHMENT projector.
 *
 * An AFFORDANCE projector (family (b), a peer of `renderSlash`/`renderChat`/
 * `renderGate` — NOT a platform shell). It turns the manifest's ops into ONE
 * invocation surface: the attach ("+") menu. Each menu entry, when tapped,
 * compiles to the SAME `{ opId, args }` a slash command does and hands it to
 * `callSkill` — "attach a photo" is just the `embed-file` op firing.
 *
 * Modeled line-for-line on the slash `commandMenu` filter in
 * `renderChat.js` (the `.filter(op => op?.surfaces?.slash?.command).map(...)`
 * pattern): it filters `manifest.operations` on a NEW `op.surfaces.attach`
 * block and maps each to an attach-menu entry. This is the "one declaration,
 * every surface" property — a single `surfaces.attach` on an op makes it
 * appear here, exactly as `surfaces.slash` makes it appear in the slash menu.
 *
 * Pure. Deterministic: entries follow manifest declaration order (the
 * internal/order.js invariant the other projectors share).
 *
 * @param {import('./schema.js').Manifest} manifest
 * @returns {{ attachMenu: Array<{ label: string, opId: string,
 *   params?: import('./schema.js').Param[], itemType?: string, group?: string }> }}
 *   `attachMenu` — the ordered attach-menu entries. Tapping entry `e` yields
 *   `{ opId: e.opId, args }` → `callSkill`, identical to a slash command
 *   firing. `params` (when present) tells the picker which args to gather;
 *   `itemType` is the attachable noun the op produces (for grouping / the
 *   item-type registry); `group` is the optional menu section.
 */
export function renderAttachments(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('renderAttachments: manifest required');
  }
  const ops = Array.isArray(manifest.operations) ? manifest.operations : [];

  // The attach-menu filter — the exact shape of renderChat's commandMenu
  // filter, keyed on `surfaces.attach` instead of `surfaces.slash.command`.
  const attachMenu = ops
    .filter((op) => op?.surfaces?.attach)
    .map((op) => {
      const a = op.surfaces.attach;
      const itemType = a.itemType ?? singleType(op.appliesTo?.type);
      return {
        label: a.label ?? op.id,
        opId:  op.id,
        ...(Array.isArray(op.params) && op.params.length ? { params: op.params } : {}),
        ...(itemType ? { itemType } : {}),
        ...(a.group ? { group: a.group } : {}),
        // How the entry is invoked. `'media'` bypasses dispatch entirely; absent means the waist.
        ...(a.via ? { via: a.via } : {}),
      };
    });

  return { attachMenu };
}

/** The single attachable noun of an op, when `appliesTo.type` names exactly one. */
function singleType(type) {
  if (typeof type === 'string') return type;
  if (Array.isArray(type) && type.length === 1 && typeof type[0] === 'string') return type[0];
  return undefined;
}
