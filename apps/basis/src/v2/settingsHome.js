/**
 * The person's settings behind the gear on Mij, projected from the manifest's one declaration (`settingsGroups`) for
 * both shells: the home's rows (each group, then the door to the circles' own settings), a group's sections in their
 * declared order, and the set of section ids that live under the gear — the old My data page paints none of those.
 * Pure: no shell lists a section by hand, and the order, kinds and custody marks are the manifest's.
 */

const groupsOf = (manifest) => (Array.isArray(manifest?.settingsGroups) ? manifest.settingsGroups : []);

/**
 * @param {object} manifest
 * @returns {{ groups: Array<{id: string, labelKey: string, sections: Array<{id: string, kind: string, custody: boolean, target?: object}>}>,
 *   perCircle: {id: string, labelKey: string, target: object}|null }}
 */
export function settingsHomeFor(manifest) {
  const groups = [];
  let perCircle = null;
  for (const g of groupsOf(manifest)) {
    if (g?.id === 'per-circle') { perCircle = { id: g.id, labelKey: g.labelKey, target: g.target }; continue; }
    groups.push({
      id: g.id,
      labelKey: g.labelKey,
      sections: (g.sections ?? []).map((s) => ({ id: s.id, kind: s.kind, custody: s.custody === true, ...(s.target ? { target: s.target } : {}) })),
    });
  }
  return { groups, perCircle };
}

/** One group, by id, or null. */
export function settingsGroupFor(manifest, groupId) {
  return settingsHomeFor(manifest).groups.find((g) => g.id === groupId) ?? null;
}

/** Every section id declared under the gear: the old My data page paints none of these. */
export function settingsSectionIds(manifest) {
  return new Set(settingsHomeFor(manifest).groups.flatMap((g) => g.sections.map((s) => s.id)));
}

/**
 * The settings group an action from Mij opens: a device row, an agent row and a device offer ("open my data") all land
 * on Apparaten & sleutels, where devices, agents and the enrol live. Null for an action no group answers.
 * @param {{kind?: string}|null} action
 * @returns {string|null}
 */
export function settingsGroupForAction(action) {
  return action?.kind === 'open-my-data' || action?.kind === 'open-mydata' ? 'devices-keys' : null;
}
