/**
 * capabilities — derive a manifest's (verb × noun) CAPABILITY SET (B · Layer 1).
 *
 * A capability is an `{ atom, noun }` pair — "you may `add` a `task`", "you may `complete` a
 * `shopping` item".  This is the unit the B security gate authorises (default-deny at
 * `callSkill`) and the creation wizard renders as toggles.  It comes from two sources, unioned:
 *
 *   1. DECLARED — `manifest.nouns[noun].atoms` (the explicit surface; a noun can declare an atom
 *      that has no bespoke op yet → the capability exists "for free", ready for a generic handler).
 *   2. DERIVED — read off each op's `verb` + where it names its noun.  Ops name the noun in two
 *      ways in this codebase: `appliesTo.type` (markComplete/claim/…) OR an enum PARAM **named
 *      `type`** whose `of` lists the item types (household addItem/listOpen).  Both are handled,
 *      plus the `'*'` wildcard.  The param name MUST be `type` — a value-enum param (mode/action/
 *      lang/kind/…) lists option VALUES (nkn/on/en/…), NOT nouns, and must never leak into the
 *      capability set (it produced junk freedom-matrix rows like `submit·nkn` / `List·en`).
 *
 * `resolveAtom(manifest, atom, noun)` returns the concrete opId implementing a capability (or null
 * = declared-but-unimplemented).  `capabilitiesOf(manifest)` returns the full deduped set.  Neither
 * requires a `nouns` declaration — an un-migrated manifest still yields its capabilities via DERIVED,
 * so the gate works app-wide before every app declares `nouns`.
 */

import { canonicalAtom } from './atoms.js';

/** The noun types an op names — via appliesTo.type (string|array|'*') and/or a type-enum param. */
export function opNouns(op, itemTypes = [], declaredNouns = null) {
  // A KIND the manifest declares as a noun of its own is the op's noun, instead of the type it narrows (a loan is an
  // `offer` of kind `lend`; the `lend` rows gate `markReturned`): decided by the DECLARATION, never by which keys are
  // on, so switching the kind's row off can never fall back to the type's row. A kind nobody declares (tasks' inbox
  // items) leaves the op on its type.
  const kindsIn = op?.appliesTo?.kind == null ? [] : (Array.isArray(op.appliesTo.kind) ? op.appliesTo.kind : [op.appliesTo.kind]);
  const declaredKinds = declaredNouns ? kindsIn.filter((k) => typeof k === 'string' && declaredNouns.has(k)) : [];
  if (declaredKinds.length) return declaredKinds;
  const set = new Set();
  const at = op?.appliesTo?.type;
  const declared = at == null ? [] : (Array.isArray(at) ? at : [at]);
  for (const t of declared) {
    if (t === '*') for (const it of itemTypes) set.add(it);   // wildcard → every itemType
    else if (typeof t === 'string') set.add(t);
  }
  // Only a param NAMED `type` names nouns — a value-enum (mode/action/lang/…) lists option values,
  // not item types, and would otherwise pollute the capability set with rows like `submit·nkn`.
  for (const p of (Array.isArray(op?.params) ? op.params : [])) {
    if (p?.name === 'type' && p?.kind === 'enum' && Array.isArray(p.of)) {
      for (const t of p.of) if (typeof t === 'string') set.add(t);
    }
  }
  return [...set];
}

/** The nouns a manifest declares (`manifest.nouns`' keys), or null when it declares none. */
export function declaredNounsOf(manifest) {
  const nouns = manifest?.nouns;
  return nouns && typeof nouns === 'object' && !Array.isArray(nouns) && Object.keys(nouns).length ? new Set(Object.keys(nouns)) : null;
}

/** True iff `op` implements the (canonical) `atom` on `noun`. */
function opImplements(op, atom, noun, itemTypes, declaredNouns) {
  if (canonicalAtom(op?.verb) !== atom) return false;
  return opNouns(op, itemTypes, declaredNouns).includes(noun);
}

/**
 * Stable key for one (app × atom × noun) capability. The single spelling both the gate and the
 * freedom template use (the space separators can't occur in app/atom/noun tokens). Lives here so
 * capabilityGate (basis) and freedom.js agree by construction.
 */
export function capabilityKey(app, atom, noun) {
  return `${app} ${atom} ${noun}`;
}

/**
 * The opId implementing the capability (atom × noun), or `null` if none does.
 * `atom` may be an alias — it's canonicalised first.
 * @returns {string|null}
 */
export function resolveAtom(manifest, atom, noun) {
  const canonical = canonicalAtom(atom);
  if (!canonical) return null;
  const itemTypes = Array.isArray(manifest?.itemTypes) ? manifest.itemTypes : [];
  const declared = declaredNounsOf(manifest);
  for (const op of (Array.isArray(manifest?.operations) ? manifest.operations : [])) {
    if (typeof op?.id === 'string' && opImplements(op, canonical, noun, itemTypes, declared)) return op.id;
  }
  return null;
}

/**
 * Resolve HOW a capability `(atom × noun)` is served:
 *  - `{ kind:'op', opId }`            — a bespoke op implements it → dispatch that op.
 *  - `{ kind:'generic', atom, noun }` — the noun DECLARES the atom but no op implements it → serve with the
 *                                       generic store-backed handler (`createGenericAtomHandlers`). This is
 *                                       "declare a noun → get CRUD free": a new app declares the atom on the
 *                                       noun and the CRUD is served unwritten.
 *  - `{ kind:'none' }`                — not a capability of this manifest (non-atom, or undeclared + unimplemented).
 * `atom` may be an alias — it's canonicalised first.
 * @returns {{kind:'op', opId:string} | {kind:'generic', atom:string, noun:string} | {kind:'none'}}
 */
export function resolveCapability(manifest, atom, noun) {
  const canonical = canonicalAtom(atom);
  if (!canonical) return { kind: 'none' };
  const opId = resolveAtom(manifest, canonical, noun);
  if (opId) return { kind: 'op', opId };
  const nouns = (manifest?.nouns && typeof manifest.nouns === 'object' && !Array.isArray(manifest.nouns)) ? manifest.nouns : {};
  const declared = Array.isArray(nouns[noun]?.atoms) ? nouns[noun].atoms.map(canonicalAtom) : [];
  if (declared.includes(canonical)) return { kind: 'generic', atom: canonical, noun };
  return { kind: 'none' };
}

/**
 * @typedef {Object} Capability
 * @property {string}      noun    the item type
 * @property {string}      atom    the canonical atom verb
 * @property {string|null} opId    the op implementing it, or null (declared-but-unimplemented)
 * @property {'declared'|'derived'} source  whether it came from manifest.nouns or from an op
 */

/**
 * The full deduped (verb × noun) capability set of a manifest.
 *
 * DECLARED-AUTHORITATIVE (decision 2026-07-02, docs/decisions.md): when a manifest DECLARES `nouns`,
 * that declaration IS its member-facing capability surface — the set is exactly the declared
 * (noun × atom) pairs and ops only FILL the implementing `opId`. A pair an op would DERIVE but the
 * author did NOT declare is dropped (the author curates; e.g. a broad `appliesTo` no longer mints
 * capabilities on internal/view-shape itemTypes). Without a `nouns` declaration, ops ARE the surface
 * (every op's atom × noun is derived) — the fallback for un-migrated manifests, so the gate works
 * app-wide before every app declares nouns.
 * @returns {Capability[]}
 */
export function capabilitiesOf(manifest) {
  const itemTypes = Array.isArray(manifest?.itemTypes) ? manifest.itemTypes : [];
  const byKey = new Map();   // `${noun}\u0000${atom}` → Capability
  const key = (noun, atom) => `${noun}\u0000${atom}`;

  // 1. Declared — manifest.nouns[noun].atoms.
  const nouns = (manifest?.nouns && typeof manifest.nouns === 'object' && !Array.isArray(manifest.nouns))
    ? manifest.nouns : {};
  // DECLARED-AUTHORITATIVE (decision 2026-07-02): a manifest that declares nouns curates its OWN
  // capability surface — non-declared derived pairs are dropped (see doc above + docs/decisions.md).
  const declaredAuthoritative = Object.keys(nouns).length > 0;
  for (const [noun, decl] of Object.entries(nouns)) {
    for (const rawAtom of (Array.isArray(decl?.atoms) ? decl.atoms : [])) {
      const atom = canonicalAtom(rawAtom);
      if (!atom) continue;
      byKey.set(key(noun, atom), { noun, atom, opId: resolveAtom(manifest, atom, noun), source: 'declared' });
    }
  }

  // 2. Derived — every op's (atom × noun), for atoms only (domain verbs aren't capabilities here).
  for (const op of (Array.isArray(manifest?.operations) ? manifest.operations : [])) {
    const atom = canonicalAtom(op?.verb);
    if (!atom || typeof op?.id !== 'string') continue;
    for (const noun of opNouns(op, itemTypes, declaredNounsOf(manifest))) {
      const k = key(noun, atom);
      if (byKey.has(k)) {
        const cap = byKey.get(k);
        if (cap.opId == null) cap.opId = op.id;   // fill in a resolved op for a declared-only pair
      } else if (!declaredAuthoritative) {
        byKey.set(k, { noun, atom, opId: op.id, source: 'derived' });   // derived surface (no nouns decl)
      }
    }
  }

  return [...byKey.values()];
}

/** The canonical atom verbs available for a given noun (declared ∪ derived), sorted. */
export function atomsForNoun(manifest, noun) {
  return capabilitiesOf(manifest)
    .filter((c) => c.noun === noun)
    .map((c) => c.atom)
    .filter((a, i, arr) => arr.indexOf(a) === i)
    .sort();
}
