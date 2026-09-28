/**
 * Atom discipline — the FITNESS FUNCTION for B · Layer 1 (the general-verb arc).
 *
 * Every REAL app manifest must pass `validateManifest(m, { atoms: true })`: each op.verb
 * is a known SDK atom (or alias) OR is declared in `manifest.domainVerbs`.  This fails CI
 * the moment a new noun-specific verb is added without either mapping it to an atom or
 * naming it as domain-specific — the drift guard `PLAN-capability-arc.md` Layer 1 calls for.
 *
 * (The `mockManifests.js` trio — tasks/stoop/folio chat-shell surfaces — is a KNOWN-DRIFT
 * concern reconciled separately; it is intentionally NOT covered here.)
 */
import { describe, it, expect } from 'vitest';
import { validateManifest, opNouns, canonicalAtom } from '@onderling/app-manifest';

import { householdManifest }  from '../../household/manifest.js';
import { calendarManifest }   from '../../calendar/manifest.js';
import { tasksManifest }      from '../../tasks-v0/manifest.js';
import { folioManifest }      from '../../folio/manifest.js';
import { stoopManifest }      from '../../stoop/manifest.js';
import { agentsManifest }     from '../../agents/manifest.js';
import { basisManifest } from '../manifest.js';

const MANIFESTS = [
  ['household',   householdManifest],
  ['calendar',    calendarManifest],
  ['tasks-v0',    tasksManifest],
  ['folio',       folioManifest],
  ['stoop',       stoopManifest],
  ['agents',      agentsManifest],
  ['basis', basisManifest],
];

describe('atom discipline (B · Layer 1 fitness function)', () => {
  for (const [name, manifest] of MANIFESTS) {
    it(`${name}: every op.verb is an atom or a declared domainVerb`, () => {
      const { ok, errors } = validateManifest(manifest, { atoms: true });
      // Only assert on verb-discipline errors — unrelated pre-existing validation
      // concerns (if any) aren't this guard's job.
      const verbErrors = errors.filter((e) => e.code === 'unknown-verb' || e.code === 'atom-in-domain-verbs');
      expect(verbErrors, JSON.stringify(verbErrors, null, 2)).toEqual([]);
      expect(ok).toBe(true);
    });
  }

  it('the guard actually bites: an undeclared non-atom verb fails', () => {
    const bad = {
      app: 'x', itemTypes: ['thing'],
      operations: [{ id: 'frobnicateThing', verb: 'frobnicate' }],
    };
    const { ok, errors } = validateManifest(bad, { atoms: true });
    expect(ok).toBe(false);
    expect(errors.some((e) => e.code === 'unknown-verb')).toBe(true);
  });

  it('declaring the verb in domainVerbs lets it through', () => {
    const good = {
      app: 'x', itemTypes: ['thing'], domainVerbs: { frobnicate: 'write' },
      operations: [{ id: 'frobnicateThing', verb: 'frobnicate' }],
    };
    expect(validateManifest(good, { atoms: true }).ok).toBe(true);
  });

  it('an atom (or alias) in domainVerbs is itself an error', () => {
    const wrong = {
      app: 'x', itemTypes: ['thing'], domainVerbs: { create: 'write' },
      operations: [{ id: 'addThing', verb: 'add' }],
    };
    const { errors } = validateManifest(wrong, { atoms: true });
    expect(errors.some((e) => e.code === 'atom-in-domain-verbs')).toBe(true);
  });
});

/**
 * Noun-declaration discipline — the §1a CLOSURE guard (PLAN-capability-arc §1a; decisions.md
 * 2026-07-02 declared-authoritative).
 *
 * A manifest that has ANY noun-bearing atom op (an atom verb that names an item-type noun via
 * `appliesTo.type` or a `type`-enum param) MUST declare `nouns` — i.e. be DECLARED-AUTHORITATIVE.
 * Otherwise its member-facing capability surface is implicit/derived and drifts: the gate keys off a
 * set nobody wrote down, and a broad `appliesTo` silently mints capabilities on internal itemTypes
 * (the exact #79 noise this arc removed). Declaring `nouns` makes the surface the author's explicit
 * choice; this guard fails CI the moment a noun-bearing op ships without that declaration.
 *
 * basis is legitimately EXEMPT: it's the shell/unifier manifest — every op is an app-level
 * command (help/settings/mute/newthread/…) that names NO item noun (0 noun-capabilities), so there is
 * nothing to curate. Adding an empty `nouns:{}` would be WORSE than nothing — it would flip basis
 * to declared-authoritative, so a future chat-thread/chat-message op's capability would be silently
 * DROPPED (declared-authoritative curates out underived pairs) while this guard still passed. So the
 * rule is deliberately "noun-bearing ops ⇒ must declare", not "every manifest must declare".
 */
const nounBearingAtomOps = (m) => {
  const itemTypes = Array.isArray(m?.itemTypes) ? m.itemTypes : [];
  return (Array.isArray(m?.operations) ? m.operations : []).filter(
    (op) => canonicalAtom(op?.verb) && opNouns(op, itemTypes).length > 0,
  );
};

describe('noun-declaration discipline (§1a closure)', () => {
  for (const [name, manifest] of MANIFESTS) {
    it(`${name}: declares \`nouns\` iff it has noun-bearing atom ops`, () => {
      const hasNounOps = nounBearingAtomOps(manifest).length > 0;
      const declaresNouns = manifest?.nouns && typeof manifest.nouns === 'object' && !Array.isArray(manifest.nouns);
      if (hasNounOps) {
        // The real invariant: any app whose ops name nouns must curate an explicit surface.
        expect(declaresNouns, `${name} has noun-bearing ops but no \`nouns\` declaration (§1a)`).toBe(true);
      } else {
        // Shell/unifier manifests (basis) must NOT declare a vacuous nouns block — see doc above.
        expect(declaresNouns, `${name} has no noun-bearing ops; it must not declare a vacuous \`nouns\``).toBeFalsy();
      }
    });
  }

  it('the guard bites: a noun-bearing atom op with no `nouns` declaration fails', () => {
    const undeclared = {
      app: 'x', itemTypes: ['thing'],
      operations: [{ id: 'addThing', verb: 'add', appliesTo: { type: 'thing' } }],
    };
    expect(nounBearingAtomOps(undeclared).length).toBeGreaterThan(0);
    const declaresNouns = undeclared.nouns && typeof undeclared.nouns === 'object';
    expect(declaresNouns).toBeFalsy();   // → the per-manifest assertion above would fail for this shape
  });

  it('declaring the noun satisfies the guard', () => {
    const declared = {
      app: 'x', itemTypes: ['thing'], nouns: { thing: { atoms: ['add'] } },
      operations: [{ id: 'addThing', verb: 'add', appliesTo: { type: 'thing' } }],
    };
    expect(declared.nouns && typeof declared.nouns === 'object').toBe(true);
  });
});
