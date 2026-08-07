/**
 * atoms — the SDK ATOM CATALOGUE (cluster B · Layer 1, the "general verbs" arc).
 *
 * THESIS (`PLAN-capability-arc.md` Layer 1): almost every app operation is a noun-specific
 * spelling of a small set of GENERAL verbs — `addTask`/`addItem`/`createBoard` are all
 * *create a typed thing*; `markComplete` is one lifecycle verb; `grab`/`claim` = self-assign.
 * A manifest op already declares `verb` + `appliesTo.type`, so the atom is LATENT in the
 * manifest; this module makes the vocabulary AUTHORITATIVE so:
 *   1. a capability becomes a clean **(verb × noun)** pair (the B gate keys off this, not 128 opIds);
 *   2. a new noun gets the standard verbs "for free" by declaring which atoms apply;
 *   3. the LLM learns a tiny verb vocabulary + the noun set (maps NL → `(verb, noun)`).
 *
 * This is a SUPERSET of `validate.js`'s legacy `VERBS` (the item-store method mirror). VERBS
 * stays as-is (back-compat); the atom catalogue is the richer, forward source of truth: each
 * atom carries a category, whether it targets one item vs a collection, human semantics, and
 * accepted ALIASES (the real spellings apps already ship — `add`≡`create`, `remove`≡`delete`,
 * `reassign`≡`assign`, `edit`/`patch`≡`update`, `read`≡`get`, `grab`≡`claim`, `done`≡`complete`).
 *
 * NOT every verb reduces to an atom — the ~20% DOMAIN TAIL (folio `sync`/`watch`, stoop
 * `report`/`mute`, household `register`, `help`, …) is genuinely orthogonal. A manifest declares
 * those in `manifest.domainVerbs`; the `{atoms:true}` validator mode (see `validate.js`) then
 * requires every `op.verb` to be an atom (or alias) OR a declared domain verb — the fitness
 * function against verb drift (a new noun-specific verb sneaking in silently).
 */

/**
 * @typedef {'crud'|'lifecycle'|'graph'} AtomCategory
 * @typedef {Object} Atom
 * @property {string}        verb      canonical verb (the real spelling apps ship)
 * @property {AtomCategory}  category  crud (create/read a thing) · lifecycle (state transition) · graph (containment/sharing)
 * @property {'item'|'collection'} targets  one item, or a collection of a noun type
 * @property {string[]}      aliases   accepted synonym spellings that mean the same atom
 * @property {string}        semantics one-line meaning (doubles as the LLM/authoring hint)
 */

/** @type {ReadonlyArray<Atom>} */
export const ATOMS = Object.freeze([
  // ── CRUD ────────────────────────────────────────────────────────────────
  { verb: 'add',       category: 'crud',      targets: 'item',       aliases: ['create'],        semantics: 'Create a new item of a noun type.' },
  { verb: 'list',      category: 'crud',      targets: 'collection', aliases: [],                semantics: 'Read a collection of items of a noun type (with optional filter).' },
  { verb: 'get',       category: 'crud',      targets: 'item',       aliases: ['read'],          semantics: 'Read a single item by id.' },
  { verb: 'update',    category: 'crud',      targets: 'item',       aliases: ['edit', 'patch'], semantics: 'Mutate fields of an existing item.' },
  { verb: 'remove',    category: 'crud',      targets: 'item',       aliases: ['delete'],        semantics: 'Delete an item.' },
  // ── LIFECYCLE (state transitions on an item) ────────────────────────────
  { verb: 'complete',  category: 'lifecycle', targets: 'item',       aliases: ['done'],          semantics: 'Mark an item done.' },
  { verb: 'claim',     category: 'lifecycle', targets: 'item',       aliases: ['grab'],          semantics: 'Self-assign an open item.' },
  { verb: 'confirm',   category: 'lifecycle', targets: 'item',       aliases: [],                semantics: 'Confirm a pending claim so the claimant may act (the authority ratifies a claim request).' },
  { verb: 'reassign',  category: 'lifecycle', targets: 'item',       aliases: ['assign'],        semantics: 'Assign or transfer an item to a member.' },
  { verb: 'submit',    category: 'lifecycle', targets: 'item',       aliases: [],                semantics: 'Submit an item for review (workflow transition).' },
  { verb: 'approve',   category: 'lifecycle', targets: 'item',       aliases: [],                semantics: 'Approve a submitted item.' },
  { verb: 'reject',    category: 'lifecycle', targets: 'item',       aliases: [],                semantics: 'Reject a submitted item.' },
  { verb: 'revoke',    category: 'lifecycle', targets: 'item',       aliases: [],                semantics: 'Undo an assignment or grant.' },
  { verb: 'archive',   category: 'lifecycle', targets: 'item',       aliases: [],                semantics: 'Reversibly retire an item.' },
  { verb: 'unarchive', category: 'lifecycle', targets: 'item',       aliases: [],                semantics: 'Restore an archived item.' },
  // ── GRAPH (containment cross-audience sharing) ──────────────────────
  { verb: 'share',     category: 'graph',     targets: 'item',       aliases: [],                semantics: 'Expose an item into another audience (cross-circle ref, posture floor, no transitive grant).' },
  { verb: 'move',      category: 'graph',     targets: 'item',       aliases: [],                semantics: 'Reparent an item within a container graph.' },
]);

/** Canonical verb → Atom. */
const BY_CANONICAL = new Map(ATOMS.map((a) => [a.verb, a]));

/** Every accepted spelling (canonical + alias) → its Atom. */
const BY_ANY = (() => {
  const m = new Map();
  for (const a of ATOMS) {
    m.set(a.verb, a);
    for (const alias of a.aliases) m.set(alias, a);
  }
  return m;
})();

/** Canonical atom verbs only (no aliases). */
export const ATOM_VERBS = Object.freeze(ATOMS.map((a) => a.verb));

/**
 * CANONICAL_ATOMS — the single authoritative verb set of the **verb × noun
 * algebra** (uniforme-representatie). This is the named anchor the enforcement
 * fitness (`test/verbAlgebra.test.js`) and `docs/conventions/manifest-standard.md`
 * point at: a `manifest.nouns[noun].atoms` entry that is not one of these
 * (in its CANONICAL spelling — aliases are declared via their canonical form)
 * is a rogue verb and fails the guard.
 *
 * It is the AUTHORITATIVE SUPERSET: every atom any app manifest declares today
 * is a subset of this list (add/list/get/update/remove/complete/claim/confirm/
 * reassign/submit/approve/reject/revoke/archive/unarchive/share/move). Adding a
 * new canonical verb to the algebra = adding one `Atom` to `ATOMS` above (with
 * its category/aliases/semantics), which flows here automatically.
 *
 * Alias to `ATOM_VERBS` so there is ONE source (CLAUDE.md invariant #3) — this
 * name exists to make the CONVENTION greppable under the `CANONICAL_ATOMS`
 * label.
 *
 * ⚠ `claim` here is the ATOM (lifecycle verb: self-assign an open item — a CAS
 * on the item's assignee, in-place). It is DISTINCT from the `claim` **noun**
 * (`@onderling/item-types` `claim` item-type — a standalone binding to an
 * offer/request/job). Verb `claim` ≠ noun `claim`. See atoms.js `claim` above,
 * `packages/item-types/src/types/claim.js`, and the manifest-standard "verb ×
 * noun algebra" section.
 *
 * @type {ReadonlyArray<string>}
 */
export const CANONICAL_ATOMS = ATOM_VERBS;

/** Every accepted spelling — canonical verbs AND aliases. */
export const ATOM_VERBS_WITH_ALIASES = Object.freeze([...BY_ANY.keys()]);

/**
 * True iff `verb` is a known SDK atom — a canonical verb OR an accepted alias.
 * (Contrast `isCanonicalVerb` in validate.js, which is the legacy item-store mirror.)
 * @param {string} verb
 */
export function isAtom(verb) { return BY_ANY.has(verb); }

/**
 * The canonical atom verb for any accepted spelling, or `null` if it isn't an atom.
 * e.g. `canonicalAtom('create') → 'add'`, `canonicalAtom('grab') → 'claim'`.
 * @param {string} verb
 * @returns {string|null}
 */
export function canonicalAtom(verb) { return BY_ANY.get(verb)?.verb ?? null; }

/**
 * Classify a verb into its atom, or `null` for a domain/unknown verb.
 * @param {string} verb
 * @returns {(Atom & { canonical: string, viaAlias: boolean }) | null}
 */
export function classifyVerb(verb) {
  const atom = BY_ANY.get(verb);
  if (!atom) return null;
  return { ...atom, canonical: atom.verb, viaAlias: verb !== atom.verb };
}

/** The Atom for a canonical verb (no alias resolution), or `undefined`. */
export function atomFor(canonicalVerb) { return BY_CANONICAL.get(canonicalVerb); }
