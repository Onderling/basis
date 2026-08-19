/**
 * renderA2A — the projection that lets another agent invoke a declared op.
 *
 * The assertions that matter are about AUTHORITY, not shape: a projected op must demand a token, a
 * withheld op must be unreachable no matter what token is presented, and an op's handler must reach the
 * waist with the caller's args intact. Everything else is bookkeeping.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderA2A, NEVER_DELEGABLE } from '../src/renderA2A.js';

const manifest = {
  app: 'household',
  operations: [
    { id: 'addItem',           verb: 'add',  surfaces: { chat: { hint: 'Add an item to a list.' } } },
    { id: 'revealOwnerPhrase', verb: 'reveal-owner-phrase', surfaces: {} },
  ],
};

describe('renderA2A projects declared ops into kernel skills', () => {
  it('names each op `app.opId`, so a token for one cannot name another', () => {
    const skills = renderA2A(manifest, { callSkill: async () => ({}) });
    expect(skills.map((s) => s.id)).toEqual(['household.addItem', 'household.revealOwnerPhrase']);
  });

  it('demands a presented token for a reachable op — authority is never inferred from reachability', () => {
    const [addItem] = renderA2A(manifest, { callSkill: async () => ({}) });
    expect(addItem.policy).toBe('requires-token');
    expect(addItem.visibility).toBe('authenticated');
  });

  it('marks a withheld op `never`, so no token can reach it', () => {
    const skills = renderA2A(manifest, { callSkill: async () => ({}) });
    const reveal = skills.find((s) => s.id === 'household.revealOwnerPhrase');
    expect(reveal.policy, 'a phrase-revealing op was delegable').toBe('never');
  });

  it('the handler reaches the waist with the op and the caller’s args', async () => {
    const callSkill = vi.fn(async () => ({ ok: true }));
    const [addItem] = renderA2A(manifest, { callSkill });
    const res = await addItem.handler({ parts: [{ data: { type: 'shopping', text: 'milk' } }] });
    expect(callSkill).toHaveBeenCalledWith('household', 'addItem', { type: 'shopping', text: 'milk' });
    expect(res).toEqual({ ok: true });
  });

  it('an op called with no args still reaches the waist, with an empty object', async () => {
    const callSkill = vi.fn(async () => ({}));
    const [addItem] = renderA2A(manifest, { callSkill });
    await addItem.handler({ parts: [] });
    expect(callSkill).toHaveBeenCalledWith('household', 'addItem', {});
  });

  it('takes several manifests, and the first declaration of an id wins', () => {
    const other = { app: 'stoop', operations: [{ id: 'listOpen', verb: 'list', surfaces: {} }] };
    const dupe  = { app: 'household', operations: [{ id: 'addItem', verb: 'remove', surfaces: {} }] };
    const skills = renderA2A([manifest, other, dupe], { callSkill: async () => ({}) });
    expect(skills.map((s) => s.id)).toEqual(['household.addItem', 'household.revealOwnerPhrase', 'stoop.listOpen']);
  });

  it('the withhold list covers secret material, device ceremonies and authority over authority', () => {
    // Named individually so removing one is a deliberate edit with a failing test, not a quiet deletion.
    for (const id of [
      'household.revealOwnerPhrase', 'household.restoreOwnerPhrase',
      'household.enrollDevice', 'household.revokeDevice',
      'household.grantSurface', 'household.revokeSurface', 'household.listSurfaceGrants',
    ]) expect(NEVER_DELEGABLE.has(id), `${id} fell out of the withhold list`).toBe(true);
  });

  it('refuses to build without a waist to call', () => {
    expect(() => renderA2A(manifest, {})).toThrow(/callSkill required/);
  });
});
