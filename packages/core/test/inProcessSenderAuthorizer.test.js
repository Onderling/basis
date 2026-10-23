/**
 * The internal bus's roster: a layer that faces no wire admits exactly the keys `adoptInProcessPeer` bound on its bus.
 *
 * Before this, each in-process layer had no sender authorizer at all — it accepted any key that signed correctly
 * ("NO ROSTER AUTHORIZER INSTALLED", five times per boot). The bus is a closed set this process built from the objects
 * themselves, so the layer's roster is its own adoption record, read live: an adopted peer still passes, a key the bus
 * did not adopt is refused even when it signs correctly, and a layer that adopted nobody admits nobody.
 */
import { describe, it, expect } from 'vitest';
import { Agent } from '../src/Agent.js';
import { AgentIdentity } from '../src/identity/AgentIdentity.js';
import { VaultMemory } from '@onderling/vault';
import { InternalBus, InternalTransport } from '../src/transport/InternalTransport.js';
import { TextPart, Parts } from '../src/Parts.js';
import { createInProcessSenderAuthorizer, IN_PROCESS_SENDER } from '../src/index.js';

async function agentOn(bus) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const agent = new Agent({ identity: id, transport: new InternalTransport(bus, id.pubKey, { identity: id }) });
  await agent.start();
  return { agent, id };
}
const adopt = (from, to, toId) => from.security.adoptInProcessPeer(from.transport, to.transport, toId);

/** host ↔ app adopted both ways, the app's layer closed to what it adopted — the shape realAgent builds. */
async function closedPair() {
  const bus = new InternalBus();
  const { agent: host, id: hostId } = await agentOn(bus);
  const { agent: app, id: appId } = await agentOn(bus);
  app.register('greet', async ({ parts }) => [TextPart(`hi ${Parts.text(parts) ?? ''}`)], { visibility: 'public' });
  adopt(host, app, appId);
  adopt(app, host, hostId);
  app.security.setSenderAuthorizer(createInProcessSenderAuthorizer(app.security));
  return { bus, host, app };
}

describe('the internal bus\'s roster', () => {
  it('an adopted peer still passes, and nothing is accepted by absence', async () => {
    const { host, app } = await closedPair();
    expect(app.security.hasSenderAuthorizer).toBe(true);
    expect(Parts.text(await host.invoke(app.address, 'greet', [TextPart('host')]))).toBe('hi host');
    expect(app.security.senderAuthorizationsByAbsence).toBe(0);
  });

  it('a key the bus did not adopt is refused, though it signs correctly', async () => {
    const { bus, app } = await closedPair();
    const { agent: stranger } = await agentOn(bus);   // on the same bus, never adopted by the app
    const before = app.security.refusedUnauthorizedSenders;
    // its hello is genuinely signed — and refused at the app's door, so the app never learns its key
    await stranger.hello(app.address, 500).catch(() => {});
    expect(app.security.refusedUnauthorizedSenders).toBeGreaterThan(before);
    expect(app.security.getPeerKey(stranger.address)).toBe(null);
    await expect(stranger.invoke(app.address, 'greet', [TextPart('x')], { timeoutMs: 500 })).rejects.toThrow();
  });

  it('read live: a layer that has adopted nobody admits nobody; adoption after install opens exactly that key', async () => {
    const bus = new InternalBus();
    const { agent: app } = await agentOn(bus);
    const { agent: host, id: hostId } = await agentOn(bus);
    const authorize = createInProcessSenderAuthorizer(app.security);
    expect(authorize({ senderKey: hostId.pubKey })).toEqual({ allow: false, reason: IN_PROCESS_SENDER.NONE_ADOPTED });
    adopt(app, host, hostId);
    expect(authorize({ senderKey: hostId.pubKey })).toEqual({ allow: true, reason: IN_PROCESS_SENDER.ADOPTED });
    expect(authorize({ senderKey: 'someone-else' })).toEqual({ allow: false, reason: IN_PROCESS_SENDER.NOT_ADOPTED });
    app.security.unregisterPeer(host.address);
    expect(authorize({ senderKey: hostId.pubKey }).allow).toBe(false);
  });

  it('fails closed when the layer cannot answer', () => {
    expect(createInProcessSenderAuthorizer({ inProcessPeerKeys: () => { throw new Error('x'); } })({ senderKey: 'k' }).allow).toBe(false);
    expect(createInProcessSenderAuthorizer(null)({ senderKey: 'k' }).allow).toBe(false);
  });
});
