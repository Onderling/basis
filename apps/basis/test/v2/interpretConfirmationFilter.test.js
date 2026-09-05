/**
 * A model reply that looks like an act is a fabrication (seen live 2026-09-05: "✓ added to shopping: …"
 * twice, nothing added). The interpreter drops it so the no-match path answers honestly.
 */
import { describe, it, expect } from 'vitest';
import { interpretToCommand, looksLikeConfirmation } from '../../src/v2/interpretCommand.js';

const catalogue = { opsById: new Map([['addItem', { op: { id: 'addItem', verb: 'add', params: [{ name: 'text', kind: 'string', required: true }], surfaces: { chat: { hint: 'add' } } }, appOrigin: 'household' }]]) };

describe('looksLikeConfirmation', () => {
  it('spots a check mark or a leading added/done in either language', () => {
    for (const s of ['✓ added to shopping: kaas', 'Added kaas to the list', 'Toegevoegd: kaas', 'Gedaan!', 'marked complete: kaas']) expect(looksLikeConfirmation(s)).toBe(true);
    for (const s of ['Welke lijst bedoel je?', 'Ik kan alleen lijsten beheren.', 'Hoi!']) expect(looksLikeConfirmation(s)).toBe(false);
  });
});

describe('interpretToCommand — several calls in one turn', () => {
  it('carries the second and later tool calls as `more`', async () => {
    const llm = { invoke: async () => ({ toolCall: { id: 'addItem', args: { type: 'shopping', text: 'stokbrood' } }, toolCalls: [
      { id: 'addItem', args: { type: 'shopping', text: 'stokbrood' } }, { id: 'addItem', args: { type: 'shopping', text: 'braadlappen' } }, { id: 'addItem', args: { type: 'shopping', text: 'geurkazen' } },
    ], replyText: null }) };
    const r = await interpretToCommand('stokbrood, braadlappen en geurkazen', { catalogue, llm });
    expect(r.opId).toBe('addItem');
    expect(r.more.map((m) => m.args.text)).toEqual(['braadlappen', 'geurkazen']);
  });
});

describe('interpretToCommand', () => {
  it('drops a fabricated confirmation instead of surfacing it as a reply', async () => {
    const llm = { invoke: async () => ({ toolCall: null, replyText: '✓ added to shopping: braadlappen' }) };
    expect(await interpretToCommand('ik wil braadlappen kopen', { catalogue, llm })).toBeNull();
    const honest = { invoke: async () => ({ toolCall: null, replyText: 'Welke lijst bedoel je?' }) };
    expect(await interpretToCommand('iets', { catalogue, llm: honest })).toEqual({ reply: 'Welke lijst bedoel je?' });
  });
});
