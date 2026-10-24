/**
 * "Wat hebben we nodig?" — the question the old household parser answered with the shopping list (its last grammar
 * nobody else took over, L444's extraction). It reads the household's general shopping list (the template's shopping
 * role, never a name), with or without "in/op de winkel"; English the same.
 */
import { describe, it, expect } from 'vitest';
import { listsGateRules } from '../../src/v2/circleGate.js';
import { templateLists } from '../../src/v2/householdTemplate.js';

const LISTS = templateLists((k) => ({ 'circle.lists.template.shopping': 'Boodschappen', 'circle.lists.template.chores': 'Klusjes' }[k] ?? k));
const gateOp = (text, lang = 'nl') => { for (const r of listsGateRules(lang, LISTS)) { const c = r.command(text); if (c) return c; } return null; };

describe('what do we need', () => {
  it('reads the shopping list — Dutch and English, with or without a place, with or without the question mark', () => {
    for (const line of ['Wat hebben we nodig?', 'wat hebben we nodig', 'wat hebben we nodig bij de Jumbo?', 'What do we need?', 'what do we need at the market']) {
      expect(gateOp(line), line).toMatchObject({ opId: 'listEntries', args: { list: 'Boodschappen' } });
    }
  });
  it('a line that merely contains "nodig" is not the question', () => {
    expect(gateOp('we hebben geen melk nodig')).not.toMatchObject({ opId: 'listEntries', args: { list: 'Boodschappen' } });
  });
});
