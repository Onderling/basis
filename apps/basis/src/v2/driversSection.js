/**
 * The person's drivers in three sections — Offerings · Interests · Goals — one projection both shells paint, and the
 * arguments every add / edit / remove sends through the waist (`agents:setProfileDriver`, `removeProfileDriver`), so
 * no shell derives a key or a kind.
 *
 * A driver is a profile property (`{kind, text, tags}`); release per circle is the profile's disclosure, by key, as
 * for every property. Offerings are keyed by their phrase (as before); a goal by its phrase under `goal:` so the same
 * words as an offering never overwrite it; interests are ONE driver (`interests`) whose tags carry the meaning.
 * Other driver kinds (hobby, desire, …) have no section here and are left as they are.
 */
import { offeringKeyFor } from '../core/offeringsMigration.js';
import { INTERESTS_DRIVER_KEY } from '../core/interestsMigration.js';

export const DRIVER_SECTION_IDS = Object.freeze(['offerings', 'interests', 'goals']);

const SECTIONS = Object.freeze({
  offerings: { kind: 'offering', labelKey: 'circle.mij.offerings_label' },
  interests: { kind: 'interest', labelKey: 'circle.mij.interests_label' },
  goals:     { kind: 'goal',     labelKey: 'circle.mij.goals_label' },
});

const norm = (tag) => String(tag ?? '').trim().toLowerCase();
const tagsOf = (tags) => (Array.isArray(tags) ? tags : String(tags ?? '').split(',')).map(norm).filter(Boolean);

/**
 * @param {Array<{key: string, kind: string, text?: string, tags?: string[]}>} drivers  the persona's driver rows
 * @returns {Array<{id: string, labelKey: string, kind: string, rows?: object[], key?: string, tags?: string[]}>}
 */
export function driverSections(drivers = []) {
  const list = Array.isArray(drivers) ? drivers : [];
  const interests = list.find((d) => d?.kind === 'interest' && d.key === INTERESTS_DRIVER_KEY);
  return DRIVER_SECTION_IDS.map((id) => {
    const { kind, labelKey } = SECTIONS[id];
    if (id === 'interests') return { id, kind, labelKey, key: INTERESTS_DRIVER_KEY, tags: [...(interests?.tags ?? [])] };
    return { id, kind, labelKey, rows: list.filter((d) => d?.kind === kind) };
  });
}

/**
 * The `setProfileDriver` arguments (without the persona id) for an add or an edit in a section; null when there is
 * nothing to write. Interests write their whole tag list (see `interestTagsAfter`).
 * @param {'offerings'|'interests'|'goals'} section
 * @param {{text?: string, tags?: string|string[]}} input
 */
export function driverWriteArgs(section, { text = '', tags = '' } = {}) {
  const spec = SECTIONS[section];
  if (!spec) return null;
  if (section === 'interests') {
    const list = tagsOf(tags);
    return { key: INTERESTS_DRIVER_KEY, kind: 'interest', text: '', tags: list.join(',') };
  }
  const phrase = String(text ?? '').trim();
  const tagText = Array.isArray(tags) ? tags.join(',') : String(tags ?? '').trim();
  if (!phrase && !tagText) return null;
  const base = offeringKeyFor({ text: phrase, tags: tagText });
  return { key: section === 'goals' ? `goal:${base}` : base, kind: spec.kind, text: phrase, tags: tagText };
}

/** The interest tags after one add or one remove (normalised; an existing tag is not doubled). */
export function interestTagsAfter(current = [], { add = null, remove = null } = {}) {
  let tags = tagsOf(current);
  if (remove != null) tags = tags.filter((x) => x !== norm(remove));
  if (add != null && norm(add) && !tags.includes(norm(add))) tags = [...tags, norm(add)];
  return tags;
}
