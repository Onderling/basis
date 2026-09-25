/**
 * THE PERSONA'S HANDLE PREFILLS THE JOIN STEP (step 2 of the persona brief).
 *
 * A persona is a profile, and a profile has properties. `handle` becomes one of them, so the persona you join
 * AS brings the name you use when you are that persona — instead of typing it again in every circle.
 *
 * PREFILL, NEVER OVERRIDE. That is the whole contract, and it is what makes this safe to run on every change
 * of the picker: it fills an empty field and never touches one a person has put their hands on. Uniqueness is
 * unchanged — it stays per circle, at the fold, and a prefilled handle that collides gets the same
 * `handle-taken` prompt any typed one would.
 */
import { describe, it, expect } from 'vitest';
import { applyPersonaHandle, setPersona } from '../../src/core/wizards/joinGroupState.js';

const viewWith = (handle) => async (app, op, args) => {
  if (op !== 'getPersonaView') return {};
  return { ok: true, id: args.id, properties: handle ? { handle } : {}, disclosure: { perContext: {} } };
};

describe('applyPersonaHandle — the persona brings its handle', () => {
  it('fills an empty handle from the chosen persona', async () => {
    const state = setPersona({ handle: '' }, 'buurt');
    const r = await applyPersonaHandle({ state, callSkill: viewWith('bram-buurt') });
    expect(state.handle).toBe('bram-buurt');
    expect(r).toMatchObject({ applied: true });
  });

  it('NEVER overrides a handle the person typed', async () => {
    // The one rule. A picker a person can go back to must not undo their own words when they do.
    const state = setPersona({ handle: 'mine' }, 'buurt');
    await applyPersonaHandle({ state, callSkill: viewWith('bram-buurt') });
    expect(state.handle).toBe('mine');
  });

  it('leaves the field alone when joining minimally — no persona, no default to bring', async () => {
    const state = setPersona({ handle: '' }, null);
    const r = await applyPersonaHandle({ state, callSkill: viewWith('bram-buurt') });
    expect(state.handle).toBe('');
    expect(r).toMatchObject({ applied: false });
  });

  it('leaves it alone when the persona has no handle of its own', async () => {
    const state = setPersona({ handle: '' }, 'buurt');
    await applyPersonaHandle({ state, callSkill: viewWith(null) });
    expect(state.handle).toBe('');
  });

  it('refuses a stored handle that is not a valid one, rather than prefilling a field that will be rejected', async () => {
    // A property can hold anything — it is a free-form key/value store. The join field has a rule (3–30,
    // lowercase, digits, _ and -), and prefilling something it will refuse hands the person an error they
    // did not cause and cannot explain.
    const state = setPersona({ handle: '' }, 'buurt');
    await applyPersonaHandle({ state, callSkill: viewWith('NO') });
    expect(state.handle).toBe('');
  });

  it('a failing read changes nothing — the field keeps whatever it had', async () => {
    const state = setPersona({ handle: '' }, 'buurt');
    const r = await applyPersonaHandle({ state, callSkill: async () => { throw new Error('offline'); } });
    expect(state.handle).toBe('');
    expect(r).toMatchObject({ applied: false });
  });
});
