/**
 * mij#personas — MOBILE host wiring for the "Mij → persona's" surface
 * (src/core/mijHost.js, the module CircleMijScreen consumes).
 *
 * web ≡ mobile by construction: the read-model is the SHARED
 * buildMijViewModel (apps/basis/src/v2/personaView.js — pinned by
 * apps/basis/test/personaView.test.js); what THIS file guards is the mobile
 * half of the host wiring — the exact op sequence web's openAboutMePanel
 * fires (listAgents → getProfileProperties/getProfileDisclosure per persona →
 * getPersonaRelease per enabled context) and the edit ops the screen calls,
 * asserted at the logic level like the other mobile screen tests (vitest
 * excludes src/screens entirely).
 */
import { describe, it, expect, vi } from 'vitest';

import {
  loadMijModel, setGeneralProperty, addGeneralOffering, offeringKeyFor,
  createPersona, toggleDisclosure,
} from '../src/core/mijHost.js';

/* The web-test fixture shapes (personaView.test.js), served op-shaped: the
 * LIVE registry replies ({agents}, {properties}, {disclosure}, {ok, released}). */
const REGISTRY = {
  default: {
    name: 'default',
    properties: {
      place:   { mode: 'own', value: 'Amsterdam' },
      ageBand: { mode: 'own', value: '35-54' },
      zeilen:  { mode: 'own', value: { kind: 'hobby', text: 'leren zeilen', tags: ['zeilen', 'water'] } },
    },
    disclosure: { perContext: { 'circle-1': { place: { enabled: true, rung: 'municipality' }, ageBand: { enabled: false } } } },
  },
  werk: {
    name: 'Werk',
    properties: {
      place:   { mode: 'own', value: 'Utrecht' },
      ageBand: { mode: 'inherit' },
    },
    disclosure: { perContext: { 'circle-2': { place: { enabled: true, rung: null } } } },
  },
};
const CIRCLES = [
  { id: 'circle-1', name: 'Circle', charter: { requests: [{ key: 'place', maxRung: 'municipality', purpose: 'spreiding' }] } },
  { id: 'circle-2', name: 'Werkclub' },
];

/** A callSkill double serving the agents ops from the fixture registry. */
function makeCallSkill() {
  return vi.fn(async (origin, opId, args) => {
    expect(origin).toBe('agents');
    switch (opId) {
      case 'listAgents':
        return { agents: Object.entries(REGISTRY).map(([agentId, e]) => ({ agentId, name: e.name, role: 'profile' })) };
      case 'getProfileProperties':
        return { properties: REGISTRY[args.id]?.properties ?? {} };
      case 'getProfileDisclosure':
        return { disclosure: REGISTRY[args.id]?.disclosure ?? { perContext: {} } };
      case 'getPersonaRelease': {
        // The release under the chosen rung — Amsterdam/Utrecht pass through whole here.
        const props = REGISTRY[args.id]?.properties ?? {};
        const released = {};
        for (const k of String(args.keys).split(',')) {
          if (props[k]?.mode === 'own') released[k] = props[k].value;
        }
        return { ok: true, released };
      }
      default:
        return { ok: true };
    }
  });
}

describe('loadMijModel — the web openAboutMePanel read sequence, mobile half', () => {
  it('fires listAgents → per-persona props/disclosure → per-enabled-context release', async () => {
    const callSkill = makeCallSkill();
    await loadMijModel({ callSkill, personaId: 'werk', circles: CIRCLES });
    const calls = callSkill.mock.calls.map(([, opId, args]) => [opId, args]);
    expect(calls[0]).toEqual(['listAgents', {}]);
    expect(calls).toContainEqual(['getProfileProperties', { id: 'default' }]);
    expect(calls).toContainEqual(['getProfileDisclosure', { id: 'default' }]);
    expect(calls).toContainEqual(['getProfileProperties', { id: 'werk' }]);
    expect(calls).toContainEqual(['getProfileDisclosure', { id: 'werk' }]);
    // releases ONLY where a context has an enabled key (ageBand enabled:false stays out)
    expect(calls).toContainEqual(['getPersonaRelease', { id: 'default', contextId: 'circle-1', keys: 'place' }]);
    expect(calls).toContainEqual(['getPersonaRelease', { id: 'werk', contextId: 'circle-2', keys: 'place' }]);
    expect(calls.filter(([op]) => op === 'getPersonaRelease')).toHaveLength(2);
  });

  it('builds the SHARED view-model: truth layer + persona cards + per-circle rows', async () => {
    const m = await loadMijModel({ callSkill: makeCallSkill(), circles: CIRCLES });
    expect(m.ok).toBe(true);
    expect(m.defaultId).toBe('default');
    // section 1 — the general persona with ladder hints + the skill/driver chip
    expect(m.general.properties.find((p) => p.key === 'place')).toMatchObject({ value: 'Amsterdam' });
    expect(m.general.drivers).toHaveLength(1);
    expect(m.general.drivers[0]).toMatchObject({ key: 'zeilen', kind: 'hobby', tags: ['zeilen', 'water'] });
    // section 2 — own / inherit / absent against the general persona
    const werk = m.personas.find((p) => p.id === 'werk');
    expect(werk.entries.find((e) => e.key === 'place')).toMatchObject({ state: 'own', value: 'Utrecht' });
    expect(werk.entries.find((e) => e.key === 'ageBand')).toMatchObject({ state: 'inherit', value: '35-54' });
    expect(werk.entries.find((e) => e.key === 'role').state).toBe('absent');
    // section 3 — enabled rows with the RELEASED value + charter + addable
    const c1 = m.circles.find((c) => c.circleId === 'circle-1');
    expect(c1.rows).toEqual([
      { personaId: 'default', personaName: 'default', key: 'place', rung: 'municipality', released: 'Amsterdam', l10n: null },
    ]);
    expect(c1.charter).toEqual({ requests: CIRCLES[0].charter.requests });
    expect(c1.addable.sort()).toEqual(['ageBand', 'zeilen']);
    const c2 = m.circles.find((c) => c.circleId === 'circle-2');
    expect(c2.rows[0]).toMatchObject({ personaId: 'werk', released: 'Utrecht', rung: null });
    expect(c2.charter).toBe(null);
  });

  it('keeps the default + the tapped persona even when listAgents degrades', async () => {
    const callSkill = vi.fn(async (origin, opId) => {
      if (opId === 'listAgents') throw new Error('offline');
      if (opId === 'getProfileProperties') return { properties: {} };
      if (opId === 'getProfileDisclosure') return { disclosure: { perContext: {} } };
      return { ok: true };
    });
    const m = await loadMijModel({ callSkill, personaId: 'werk', circles: [] });
    expect(m.personas.map((p) => p.id)).toEqual(['default', 'werk']);
    expect(m.ok).toBe(true);   // the default persona is always present → the surface renders
  });
});

describe('the edit ops — same calls the web host fires (verify the dispatch shape)', () => {
  it('setGeneralProperty targets the GENERAL persona (the truth layer)', async () => {
    const callSkill = vi.fn(async () => ({ ok: true }));
    await setGeneralProperty({ callSkill, defaultId: 'default', key: 'place', value: 'Utrecht' });
    expect(callSkill).toHaveBeenCalledWith('agents', 'setProfileProperty', { id: 'default', key: 'place', value: 'Utrecht' });
  });

  it('addGeneralOffering sends setProfileDriver kind=offering on the default profile, keyed by the phrase (web parity)', async () => {
    const callSkill = vi.fn(async () => ({ ok: true }));
    await addGeneralOffering({ callSkill, defaultId: 'default', text: 'Fietsen repareren', tags: 'fiets, gereedschap' });
    expect(callSkill).toHaveBeenCalledWith('agents', 'setProfileDriver', {
      id: 'default', key: 'fietsen repareren', kind: 'offering', text: 'Fietsen repareren', tags: 'fiets, gereedschap',
    });
    // the exact web derivation: (text || tags) → trim → lowercase → first 40 chars
    expect(offeringKeyFor({ text: '', tags: 'X'.repeat(50) })).toBe('x'.repeat(40));
  });

  it('createPersona / toggleDisclosure mirror createProfile / setProfileDisclosure', async () => {
    const callSkill = vi.fn(async () => ({ ok: true }));
    await createPersona({ callSkill, name: 'werk' });
    expect(callSkill).toHaveBeenCalledWith('agents', 'createProfile', { id: 'werk' });

    await toggleDisclosure({ callSkill, personaId: 'werk', contextId: 'circle-2', key: 'place', enabled: false });
    expect(callSkill).toHaveBeenCalledWith('agents', 'setProfileDisclosure', { id: 'werk', contextId: 'circle-2', key: 'place', enabled: false });
    // the dashed share-affordance path: no personaId → the general persona
    await toggleDisclosure({ callSkill, defaultId: 'default', contextId: 'circle-1', key: 'ageBand', enabled: true });
    expect(callSkill).toHaveBeenCalledWith('agents', 'setProfileDisclosure', { id: 'default', contextId: 'circle-1', key: 'ageBand', enabled: true });
  });

  it('op failures degrade silently (the screen re-reads persisted state either way)', async () => {
    const callSkill = vi.fn(async () => { throw new Error('offline'); });
    await expect(setGeneralProperty({ callSkill, key: 'place', value: 'x' })).resolves.toBeUndefined();
    await expect(createPersona({ callSkill, name: 'x' })).resolves.toBeUndefined();
  });
});
