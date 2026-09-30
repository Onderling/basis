/**
 * A list made by mistake can go ("werktaken" on the test bot). `removeList` takes the list and everything on it; it is
 * the admin's on a household bot, and it asks first (a danger confirm, in the household's words).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { bootRealAgentNode, teardown } from './support/pairRealAgents.js';
import { listsManifest } from '../../lists/manifest.js';
import { resolveDispatch } from '../src/router.js';
import { mergeManifests } from '../src/manifestMerge.js';
import { BOT_OP_MAP } from '../src/v2/botOpMap.js';

const nodes = [];
afterAll(() => teardown(nodes));

describe('removing a list', () => {
  it('takes the list and its entries; the admin\'s; and it asks first', async () => {
    const node = await bootRealAgentNode('lists-remove');
    nodes.push(node);
    const call = (a, o, x) => node.agent.callSkill(a, o, x);
    await call('lists', 'createList', { text: 'Boodschappen' });
    await call('lists', 'createList', { text: 'werktaken' });
    await call('lists', 'addToList', { list: 'werktaken', text: 'mail beantwoorden' });
    const gone = await call('lists', 'removeList', { list: 'werktaken' });
    expect(gone.ok, JSON.stringify(gone)).toBe(true);
    const names = ((await call('lists', 'listLists', {})).items ?? []).map((i) => i.label ?? i.text);
    expect(names).toContain('Boodschappen');
    expect(names).not.toContain('werktaken');
    expect((await call('lists', 'removeList', { list: 'werktaken' })).ok).toBe(false);

    expect(BOT_OP_MAP.admin).toContain('removeList');
    expect(BOT_OP_MAP.member).not.toContain('removeList');
    const r = resolveDispatch({ kind: 'slash', opId: 'removeList', args: { list: 'Boodschappen' } }, mergeManifests([{ manifest: listsManifest }]));
    expect(r.kind).toBe('needsConfirm');
    expect(r.messageKey).toBe('circle.lists.remove_list_confirm');
  }, 90_000);
});
