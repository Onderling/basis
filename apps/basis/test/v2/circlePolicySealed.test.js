/**
 * A CIRCLE'S POLICY IS SEALED AT REST ON WEB AND MOBILE, as it already is on the box. The web app kept each circle's
 * policy — and its version snapshots — as plain JSON in localStorage, mobile in AsyncStorage; the box seals its copy.
 * One wrapper (`sealedKeyValue`, beside `sealedLocalBackend`) seals the VALUES with the shell's content key (keys stay
 * legible, so the versions store can still list them); a plain value written before this still reads.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { groupKeyStrategy } from '@onderling/pod-client';
import { setShellContentSeal, sealedKeyValue } from '../../src/v2/localStoreSeal.js';
import { localCirclePolicyStore } from '../../src/v2/circlePolicyStore.js';
import { localCircleRecipeStore, addRecipe } from '../../src/v2/circleRecipe.js';
import { localCircleRulesStore, RULES_FIELDS } from '../../src/v2/circleRules.js';
import { makeCirclePolicyStoreRN, makeCircleRecipeStoreRN, makeCircleRulesStoreRN } from '../../../basis-mobile/src/core/circleStoresRN.js';

const KEY = 'A'.repeat(43);
/** localStorage's shape (sync, enumerable), its contents inspectable. */
function webStorage() {
  const m = new Map();
  return {
    raw: m,
    getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); },
    key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; },
  };
}
/** AsyncStorage's shape. */
function rnStorage() {
  const m = new Map();
  return {
    raw: m,
    getItem: async (k) => (m.has(k) ? m.get(k) : null), setItem: async (k, v) => { m.set(k, String(v)); }, removeItem: async (k) => { m.delete(k); },
    getAllKeys: async () => [...m.keys()],
  };
}
const allRaw = (s) => [...s.raw.entries()].map(([k, v]) => `${k}=${v}`).join('\n');

describe('a circle\'s policy at rest', () => {
  beforeEach(() => setShellContentSeal(groupKeyStrategy({ groupKey: KEY })));
  afterEach(() => setShellContentSeal(null));

  it('web: the policy and its version snapshots are sealed; the store reads them back', async () => {
    const s = webStorage();
    const store = localCirclePolicyStore(s);
    await store.update('c1', { llmTool: 'off', agents: 'no' });
    await store.update('c1', { llmTool: 'local' });
    expect(s.raw.size, 'the policy and at least one version are stored').toBeGreaterThan(1);
    expect(allRaw(s)).not.toMatch(/llmTool|agents/);
    expect((await localCirclePolicyStore(s).get('c1')).llmTool).toBe('local');
  });

  it('mobile: the same, over AsyncStorage', async () => {
    const s = rnStorage();
    const store = makeCirclePolicyStoreRN(s);
    await store.update('c1', { llmTool: 'off', agents: 'no' });
    await store.update('c1', { llmTool: 'local' });
    expect(allRaw(s)).not.toMatch(/llmTool|agents/);
    expect((await makeCirclePolicyStoreRN(s).get('c1')).llmTool).toBe('local');
  });

  it('the recipe and the rules beside it: sealed on web and mobile, read back', async () => {
    const field = RULES_FIELDS[0];
    for (const [s, recipe, rules] of [[webStorage(), localCircleRecipeStore, localCircleRulesStore], [rnStorage(), makeCircleRecipeStoreRN, makeCircleRulesStoreRN]]) {
      await recipe(s).set('c1', addRecipe(null, 'geheim-recept'));
      await rules(s).update('c1', { [field]: 'geheime-regel' });
      expect(allRaw(s)).not.toMatch(/geheim-recept|geheime-regel|recipes/);
      expect((await recipe(s).get('c1')).recipes[0].name).toBe('geheim-recept');
      expect((await rules(s).get('c1'))[field]).toBe('geheime-regel');
    }
  });

  it('a plain value written before sealing still reads; before the key exists nothing is written in the clear', async () => {
    const s = webStorage();
    s.setItem('cc.circlePolicy.old', JSON.stringify({ llmTool: 'off' }));
    expect((await localCirclePolicyStore(s).get('old')).llmTool).toBe('off');
    setShellContentSeal(null);
    const kv = sealedKeyValue(s);
    await expect(kv.setItem('cc.circlePolicy.x', '{"llmTool":"local"}')).rejects.toThrow(/unsealed|no content key/);
    expect(s.raw.has('cc.circlePolicy.x')).toBe(false);
  });
});
