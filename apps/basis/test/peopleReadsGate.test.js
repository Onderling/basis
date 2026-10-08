/**
 * The people reads by rule, without a model: the household bot's deterministic gate reads "wie doet de lamp", "wat moet
 * Bob doen" and "wie is er zaterdag" (and their English twins) as the three reads — the chores' open read with words,
 * someone's own chores by name, one day of the week overview. Talk that only looks like them stays the model's.
 */
import { describe, it, expect } from 'vitest';
import { listsGateRules } from '../src/v2/circleGate.js';
import { templateLists } from '../src/v2/householdTemplate.js';

const NAMES = { 'circle.lists.template.shopping': 'Boodschappen', 'circle.lists.template.chores': 'Klusjes', 'circle.lists.template.repairs': 'Reparaties', 'circle.lists.template.schedule': 'Agenda' };
const rules = listsGateRules('nl', templateLists((k) => NAMES[k] ?? k));
const gate = (text) => { for (const r of rules) { const c = r.command(text); if (c) return c; } return null; };

describe('the gate reads the people reads', () => {
  it('who does a chore: the open read with the words', () => {
    expect(gate('wie doet de lamp')).toMatchObject({ opId: 'listOpen', args: { text: 'lamp' } });
    expect(gate('Wie doet de lamp?')).toMatchObject({ opId: 'listOpen', args: { text: 'lamp' } });
    expect(gate('wie gaat de ramen doen')).toMatchObject({ opId: 'listOpen', args: { text: 'ramen' } });
    expect(gate('who does the lamp')).toMatchObject({ opId: 'listOpen', args: { text: 'lamp' } });
    for (const talk of ['wie doet mee', 'wie doet wat', 'wie doet er zaterdag wat', 'who does what']) expect(gate(talk), talk).toBeNull();
  });

  it('someone\'s chores: their own read, by the name said; one\'s own stays the plain read', () => {
    expect(gate('wat moet Bob doen')).toMatchObject({ opId: 'listMine', args: { who: 'Bob' } });
    expect(gate('wat moet Bob nog doen')).toMatchObject({ opId: 'listMine', args: { who: 'Bob' } });
    expect(gate('welke klusjes heeft Ann?')).toMatchObject({ opId: 'listMine', args: { who: 'Ann' } });
    expect(gate('what does Bob still have to do')).toMatchObject({ opId: 'listMine', args: { who: 'Bob' } });
    expect(gate('wat moet ik nog doen')).toEqual({ opId: 'listMine', args: {} });
    expect(gate('wat moet je doen')).toBeNull();
    // the list read keeps its own words
    expect(gate('wat staat er op de klusjes')).toMatchObject({ opId: 'listEntries', args: { list: 'Klusjes' } });
  });

  it('one day: the week overview with the day said', () => {
    expect(gate('wie is er zaterdag')).toMatchObject({ opId: 'weekOverview', args: { day: 'zaterdag' }, appOrigin: 'assistant' });
    expect(gate('wat is er morgen')).toMatchObject({ opId: 'weekOverview', args: { day: 'morgen' } });
    expect(gate('wat staat er vrijdag')).toMatchObject({ opId: 'weekOverview', args: { day: 'vrijdag' } });
    expect(gate('who is in on saturday')).toMatchObject({ opId: 'weekOverview', args: { day: 'saturday' } });
    expect(gate('wat staat er deze week')).toEqual({ opId: 'weekOverview', args: {}, appOrigin: 'assistant' });
    expect(gate('wie is er')).toBeNull();
  });
});
