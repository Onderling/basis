// WHERE an op is offered is declared ONCE, on the op (`scopes`: own, circle, contact; default circle), and read by the
// chat, slash and gate projections; a button (`surfaces.attach.buttonIn`) may only narrow it. No surface names a place
// of its own (the validator refuses it). Fable's ruling (A) on the "+" as a conversation, 2026-11-16.
import { describe, it, expect } from 'vitest';
import { renderChat, renderSlash, renderGate, renderAttachments, validateManifest, opScopes, inScope } from '../src/index.js';

const manifest = {
  app: 'demo', name: 'Demo', version: '1.0.0',
  operations: [
    { id: 'circleOnly', params: [], surfaces: { chat: { hint: 'a circle act' }, slash: { command: 'circleonly', match: { verbs: ['kring'] } } } },
    { id: 'ownAndCircle', scopes: ['own', 'circle'], params: [],
      surfaces: { chat: { hint: 'both' }, slash: { command: 'both', match: { verbs: ['beide'] } }, attach: { label: 'x', buttonIn: ['own'] } } },
    { id: 'ownOnly', scopes: ['own'], params: [], surfaces: { chat: { hint: 'own act' }, slash: { command: 'ownonly', match: { verbs: ['eigen'] } } } },
  ],
};
const ARGS = { skillRegistry: { invoke: async () => null }, toSkillCtx: () => ({}) };
const toolNames = (m, scope) => renderChat(m, ARGS, scope ? { scope } : {}).toolCatalogue.map((t) => t.id);

describe('the place an op is offered is declared once, on the op', () => {
  it('opScopes: the declared places, else a circle', () => {
    expect(opScopes(manifest.operations[0])).toEqual(['circle']);
    expect(opScopes(manifest.operations[1])).toEqual(['own', 'circle']);
    expect(inScope(manifest.operations[2], 'circle')).toBe(false);
    expect(inScope(manifest.operations[2], undefined)).toBe(true);
  });
  it('the model\'s tools for the own scope hold only ops offered there; with no scope asked, all (as today)', () => {
    expect(toolNames(manifest, 'own').sort()).toEqual(['ownAndCircle', 'ownOnly']);
    expect(toolNames(manifest, 'circle').sort()).toEqual(['circleOnly', 'ownAndCircle']);
    expect(toolNames(manifest).length).toBe(3);
  });
  it('the "/" list and the gate phrases follow the same declaration', () => {
    const own = renderSlash(manifest, { scope: 'own' });
    expect(own.parse('kring iets')?.skillId ?? null).toBe(null);
    expect(own.parse('eigen iets')?.skillId).toBe('ownOnly');
    const gateCircle = renderGate([manifest], { scope: 'circle' }).map((r) => r.command('eigen iets')).filter(Boolean);
    expect(gateCircle.map((c) => c.opId ?? c.skillId)).not.toContain('ownOnly');
  });
  it('a button only narrows: buttonIn, else the op\'s places', () => {
    const menu = renderAttachments(manifest).attachMenu;
    expect(menu.find((e) => e.opId === 'ownAndCircle').scopes).toEqual(['own']);
  });
  it('the validator refuses a place on a surface, and a button wider than its op', () => {
    const onSurface = { ...manifest, operations: [{ id: 'x', params: [], surfaces: { attach: { label: 'x', scopes: ['own'] } } }] };
    expect(validateManifest(onSurface).errors.some((e) => e.code === 'scope-on-surface')).toBe(true);
    const wider = { ...manifest, operations: [{ id: 'y', scopes: ['own'], params: [], surfaces: { attach: { label: 'y', buttonIn: ['circle'] } } }] };
    expect(validateManifest(wider).errors.some((e) => e.code === 'button-wider-than-op')).toBe(true);
    expect(validateManifest(manifest).errors.filter((e) => /scope|button/.test(e.code ?? ''))).toEqual([]);
    // a noun's error names the noun's own attach, not a surfaces path the noun does not have
    const noun = { ...manifest, itemTypes: ['note'], nouns: { note: { atoms: ['add'], attach: { label: 'n', scopes: ['own'] } } } };
    expect(validateManifest(noun).errors.find((e) => e.code === 'scope-on-surface').path).toMatch(/\/nouns\/note\/attach\/scopes$/);
  });
});
