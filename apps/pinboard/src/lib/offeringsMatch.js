/**
 * skillsMatch — re-export shim around `@onderling/identity-resolver`.
 *
 * **2026-05-08:** the implementation + the two JSON data files
 * (`skillsTaxonomy.json` + `tagNormalisation.json`) lifted into the
 * identity-resolver substrate (Tasks V1 = rule-of-two consumer per
 * `Project Files/Pinboard/migration-tasks-v1-lifts-2026-05-08.md`).
 * **2026-07-17:** `skillsTaxonomy.json` moved on to
 * `@onderling/agent-registry` (skills→property fold-in: the taxonomy
 * is the coarse rung of the `skill` property descriptor); this shim +
 * identity-resolver's re-exports are unchanged for consumers.
 *
 * The taxonomy is Pinboard-shaped today (categories: `vervoer`,
 * `huishouden`, etc.). When a real OSS-flavour consumer needs
 * different categories, the substrate gains a per-app overlay.
 * Until then: shipped as-is, frozen.
 */

export {
  TAXONOMY,
  normaliseTag,
  categoryFor,
  isKnownCategory,
} from '@onderling/identity-resolver';
