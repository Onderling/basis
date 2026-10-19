/** An extension noun's free atoms answer to `<noun word> <atom>` (never a bare verb, which stays the first-party nouns'). */
import { describe, it, expect } from 'vitest';
import { synthesizeGenericOps } from '../src/genericOpSynth.js';
import { plantsManifest } from '../../example-plants/manifest.js';

describe('an extension noun\'s synthetic ops', () => {
  it('answer to "plant add …", not "add …"', () => {
    const add = synthesizeGenericOps(plantsManifest).find((o) => o.__generic.atom === 'add');
    expect(add.surfaces.slash.match.verbs).toEqual([['plant', 'add']]);
  });
});

describe('the chat gate for an extension noun', () => {
  it('"plant add Monstera" is the plant\'s add; a bare "add Monstera" is not', async () => {
    const { renderGate } = await import('@onderling/app-manifest');
    const [rule] = renderGate({ ...plantsManifest, operations: synthesizeGenericOps(plantsManifest) });
    const call = rule.command('plant add Monstera');
    expect(call).toMatchObject({ opId: '__generic__:plants:add:plants.plant', args: { body: 'Monstera' }, appOrigin: 'plants' });
    expect(rule.command('add Monstera')).toBe(null);
  });
});
