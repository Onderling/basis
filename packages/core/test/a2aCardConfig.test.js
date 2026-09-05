/**
 * A2ATransport serves the agent card with the host's `cardConfig` merged in — the way an external bot
 * declares `redact: 'pre-send'` (basis's pre-send floor) without owning the card builder.
 */
import { describe, it, expect } from 'vitest';
import { A2ATransport } from '../src/a2a/A2ATransport.js';

describe('A2ATransport — cardConfig on the served card', () => {
  it('puts name/description and the redact ask on /.well-known/agent.json', async () => {
    const agent = { pubKey: 'PK', label: 'x', skills: { all: () => [] } };
    const tx = new A2ATransport({ agent, port: 0, host: '127.0.0.1', cardConfig: { name: 'Feedback bot', description: 'listens', redact: 'pre-send' } });
    await tx.connect();
    try {
      const card = await (await fetch(`http://127.0.0.1:${tx.serverPort}/.well-known/agent.json`)).json();
      expect(card.name).toBe('Feedback bot');
      expect(card.description).toBe('listens');
      expect(card['x-onderling'].redact).toBe('pre-send');
      expect(card['x-onderling'].pubKey).toBe('PK');
    } finally { await tx.disconnect?.(); }
  });
});
