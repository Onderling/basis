/**
 * Handling a task logs nothing by itself: the wire path used to print `[handleTaskRequest] <skill> from <caller
 * prefix>` for EVERY inbound task — noise on every host, and on a shared one (the box's companion) a line per caller.
 */
import { describe, it, expect, vi } from 'vitest';
import { Agent } from '../src/Agent.js';
import { AgentIdentity } from '../src/identity/AgentIdentity.js';
import { VaultMemory } from '@onderling/vault';
import { InternalBus, InternalTransport } from '../src/transport/InternalTransport.js';
import { DataPart } from '../src/Parts.js';
import { handleTaskRequest } from '../src/protocol/taskExchange.js';

describe('an inbound task on the wire path', () => {
  it('is answered without a log line naming the skill or the caller', async () => {
    const bus = new InternalBus();
    const bId = await AgentIdentity.generate(new VaultMemory());
    const b = new Agent({ identity: bId, transport: new InternalTransport(bus, bId.pubKey, { identity: bId }) });
    await b.start();
    b.register('ping', async () => [DataPart({ pong: true })], { visibility: 'public' });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const reply = await new Promise((resolve) => {
        const t = { respond: async (_to, _re, payload) => resolve(payload), sendOneWay: async () => {} };
        handleTaskRequest(b, { _from: 'caller-address-xyz', _id: 'w1', _transport: t, payload: { type: 'task', taskId: 't1', skillId: 'ping', parts: [] } });
      });
      expect(reply).toBeTruthy();
      expect(log.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('handleTaskRequest') || l.includes('caller-addre'))).toEqual([]);
    } finally { log.mockRestore(); await b.stop?.(); }
  });
});
