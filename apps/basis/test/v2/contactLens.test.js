/**
 * CHOOSING WHAT A CONTACT SEES OF YOU — in the add flow, and later on the thread (L125, Frits 2026-09-24: "both").
 *
 * Adding a contact recorded the default persona on every path, and there was no moment to choose another. Now the
 * paths a person is present for (a scan, a link, the add box) ask first — persona and disclosure level, both
 * prefilled — and the thread header can change either later. Both go through this one module; the shells paint.
 *
 * The lens, not a second you: the contact talks to the same identity whatever is chosen (ledger L123). What the
 * choice changes is the RELEASE on the pair circle: the level sets the persona's disclosure for that circle, and
 * the persona's release is what the pair roster says there.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  contactAddSheetModel, addContactAs, changeContactLens, contactLensModel, presetFromDisclosure,
} from '../../src/v2/contactLens.js';
import { pairCircleIdFor } from '../../src/v2/pairCircleId.js';
import { personaPresetKeys } from '../../src/v2/memberCards.js';

const card = (o = {}) => {
  const json = JSON.stringify({ webid: 'them', displayName: 'Anne', handle: 'anne', ...o });
  return `onderling-contact://${Buffer.from(json).toString('base64url')}`;
};

function fakeSkills({ personas = [{ agentId: 'default', name: 'Frits', role: 'profile' }, { agentId: 'buurt', name: 'Buurt', role: 'profile' }], usual = 'profile', perContext = {} } = {}) {
  const calls = [];
  const callSkill = vi.fn(async (app, op, args) => {
    calls.push({ app, op, args });
    if (op === 'listAgents') return { items: personas };
    if (op === 'getProfileProperties') return { properties: { 'reveal.default': usual } };
    if (op === 'getPersonaView') return { properties: {}, disclosure: { perContext } };
    if (op === 'whoAmI') return { webid: 'me' };
    if (op === 'addContactFromQr') return { contact: { webid: 'them', persona: args.persona } };
    if (op === 'setContactPersona') return { contact: { webid: args.webid, persona: args.persona } };
    return { ok: true };
  });
  return { callSkill, calls };
}

describe('the add sheet', () => {
  it('names the contact from the card and prefills the default persona and your usual level', async () => {
    const { callSkill } = fakeSkills({ usual: 'handle' });
    const m = await contactAddSheetModel({ payload: card(), callSkill });
    expect(m.name).toBe('Anne');
    expect(m.persona).toBe('default');
    expect(m.revealPreset).toBe('handle');
    expect(m.personas.map((p) => p.id)).toEqual(['default', 'buurt']);
  });

  it('is null for something that is not a contact card — the shell adds nothing and says so', async () => {
    const { callSkill } = fakeSkills();
    expect(await contactAddSheetModel({ payload: 'not a card', callSkill })).toBeNull();
  });
});

describe('adding AS a persona', () => {
  it('sets the chosen level for the pair circle BEFORE the add, then records the persona on the row', async () => {
    const { callSkill, calls } = fakeSkills();
    const r = await addContactAs({ callSkill, payload: card(), persona: 'buurt', revealPreset: 'handle' });
    expect(r.contact.persona).toBe('buurt');
    const pairId = pairCircleIdFor('me', 'them');
    const disclosures = calls.filter((c) => c.op === 'setProfileDisclosure');
    expect(disclosures.length).toBeGreaterThan(0);
    expect(disclosures.every((c) => c.args.id === 'buurt' && c.args.contextId === pairId)).toBe(true);
    const iAdd = calls.findIndex((c) => c.op === 'addContactFromQr');
    expect(calls.findIndex((c) => c.op === 'setProfileDisclosure')).toBeLessThan(iAdd);
    expect(calls[iAdd].args.persona).toBe('buurt');
  });
});

describe('changing it later, on the thread', () => {
  it('records the new persona, sets its level for the pair circle, and says its release there', async () => {
    const { callSkill, calls } = fakeSkills();
    const shareRelease = vi.fn(async () => ({ ok: true }));
    const r = await changeContactLens({
      callSkill, contactId: 'them', persona: 'buurt', revealPreset: 'full', shareRelease, pairCircleExists: true,
    });
    const pairId = pairCircleIdFor('me', 'them');
    expect(calls.find((c) => c.op === 'setContactPersona').args).toMatchObject({ webid: 'them', persona: 'buurt' });
    expect(shareRelease).toHaveBeenCalledWith(pairId, 'buurt');
    expect(r.releaseShared).toBe(true);
  });

  it('with no pair circle yet, only the row and the level change — the founding will carry them', async () => {
    const { callSkill } = fakeSkills();
    const shareRelease = vi.fn();
    const r = await changeContactLens({ callSkill, contactId: 'them', persona: 'buurt', revealPreset: 'handle', shareRelease, pairCircleExists: false });
    expect(shareRelease).not.toHaveBeenCalled();
    expect(r.releaseShared).toBe(false);
  });
});

describe('reading the lens back for the header', () => {
  it('shows the row\'s persona and the level the row records', async () => {
    const { callSkill } = fakeSkills();
    const m = await contactLensModel({ callSkill, row: { webid: 'them', persona: 'buurt', revealPreset: 'full' } });
    expect(m.persona).toBe('buurt');
    expect(m.revealPreset).toBe('full');
  });

  it('a row that records no level: read from the disclosure for the pair circle', async () => {
    const pairId = pairCircleIdFor('me', 'them');
    const ctx = {};
    for (const k of [...personaPresetKeys('handle'), ...personaPresetKeys('profile')]) ctx[k] = { enabled: true };
    const { callSkill } = fakeSkills({ perContext: { [pairId]: ctx } });
    const m = await contactLensModel({ callSkill, row: { webid: 'them', persona: 'buurt' } });
    expect(m.persona).toBe('buurt');
    expect(m.revealPreset).toBe('profile');
  });

  it('a row that records no persona shows the default — the backfill\'s own proven value', async () => {
    const { callSkill } = fakeSkills();
    const m = await contactLensModel({ callSkill, row: { webid: 'them' } });
    expect(m.persona).toBe('default');
  });

  it('presetFromDisclosure: the highest tier whose keys are all enabled; nothing enabled = the floor', () => {
    const all = {};
    for (const p of ['handle', 'profile', 'full']) for (const k of personaPresetKeys(p)) all[k] = { enabled: true };
    // `full` adds no persona keys of its own, so it cannot be read back — the row records it instead
    expect(presetFromDisclosure(all)).toBe('profile');
    expect(presetFromDisclosure({})).toBe('handle');
  });
});

describe('the pair circle is the roster\'s own', () => {
  it('uses the pair roster\'s id function when the shell hands one in — the two can never disagree', async () => {
    const { callSkill, calls } = fakeSkills();
    await addContactAs({ callSkill, payload: card(), persona: 'buurt', revealPreset: 'handle', pairCircleIdOf: (w) => `pair-of-${w}` });
    const d = calls.filter((c) => c.op === 'setProfileDisclosure');
    expect(d.length).toBeGreaterThan(0);
    expect(d.every((c) => c.args.contextId === 'pair-of-them')).toBe(true);
    expect(calls.some((c) => c.op === 'whoAmI')).toBe(false);
  });
});
