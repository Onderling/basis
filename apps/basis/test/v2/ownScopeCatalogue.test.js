/**
 * The person's own "+" asks the manifests for the OWN scope: the model's tools, the "/" list and the plain phrases all
 * come from where each op says it is offered (declared once on the op). Against the real composed manifests: the own
 * catalogue holds the own note, the own appointment and the own-list acts, and no act that lives only in a circle.
 */
import { describe, it, expect } from 'vitest';
import { renderChat, inScope, opScopes } from '@onderling/app-manifest';
import { catalogueManifests } from '../../src/v2/manifestSources.js';

const ARGS = { skillRegistry: { invoke: async () => null }, toSkillCtx: () => ({}) };
const ownTools = () => catalogueManifests().flatMap((m) => renderChat(m, ARGS, { scope: 'own' }).toolCatalogue.map((t) => `${m.app}.${t.id}`));
const nouns = (scope) => catalogueManifests().flatMap((m) => Object.entries(m.nouns ?? {}).filter(([, d]) => inScope(d, scope)).map(([n]) => `${m.app}.${n}`));

describe('the own "+" catalogue comes from the declarations', () => {
  it('holds the own appointment, the own lists\' acts and feedback', () => {
    const tools = ownTools();
    for (const id of ['calendar.addEvent', 'lists.createList', 'lists.addToList', 'lists.listEntries', 'lists.markListItemDone', 'basis.feedback']) {
      expect(tools).toContain(id);
    }
  });
  it('the own note is a noun offered there', () => {
    expect(nouns('own')).toContain('household.note');
  });
  it('holds no act that lives only in a circle (a household chore, a shop visit, a circle\'s members)', () => {
    const tools = ownTools();
    for (const id of ['lists.makeChore', 'lists.shopVisit']) expect(tools).not.toContain(id);
    const onlyCircle = catalogueManifests().flatMap((m) => (m.operations ?? []).filter((op) => !opScopes(op).includes('own')).map((op) => `${m.app}.${op.id}`));
    expect(onlyCircle.length).toBeGreaterThan(20);
    expect(tools.filter((t) => onlyCircle.includes(t))).toEqual([]);
  });
});
