/**
 * stdioMcpServer.test.js — the JSON-RPC 2.0 / NDJSON framing + the MCP
 * `initialize`→`initialized`→`tools/*` lifecycle, over an INJECTED line stream.
 *
 * Reuses the #63 grant/revoke harness (two in-process core.Agents on one
 * InternalBus; `agent.invoke` === callSkill; PolicyEngine + CapabilityToken +
 * TokenRegistry). Drives a real gated agent through the framed stdio path via
 * an in-memory duplex loopback (NO real process/stdio/sockets — that's DEFERRED).
 *
 * Proves:
 *   • the full initialize → initialized → tools/list → tools/call handshake;
 *   • `initialize` returns the advertised `tools` capability + serverInfo;
 *   • a `tools/call` BEFORE initialize is rejected (JSON-RPC ServerError);
 *   • an authorized call runs the skill and returns the MCP result framed as a
 *     JSON-RPC success response;
 *   • an UNGRANTED/REVOKED call comes back as an MCP `isError` tool-result inside
 *     a JSON-RPC success (gate held, skill NOT executed);
 *   • an unknown METHOD → JSON-RPC method-not-found error.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory }          from '@onderling/vault';
import {
  Agent, AgentIdentity,
  InternalBus, InternalTransport,
  TrustRegistry, PolicyEngine, TokenRegistry,
  TextPart, Parts,
} from '@onderling/core';
import {
  RemoteHandlerRegistry,
  grantRemoteCapability,
} from '@onderling/secure-agent';
import {
  createStdioMcpServer,
  createDuplexLoopback,
  createStdioTestClient,
  JsonRpcErrorCode,
  PROTOCOL_VERSIONS,
} from '../src/index.js';

const MANIFEST = {
  app: 'demo',
  operations: [
    { id: 'op.compute', verb: 'add', appliesTo: { type: 'task' },
      params: [{ name: 'text', kind: 'string', required: true }],
      surfaces: { chat: { hint: 'Compute a thing.' } } },
  ],
};

/** Caller (Alice) + host (Bob) on one bus, plus a framed stdio server for Alice. */
async function makeStdioTier() {
  const bus = new InternalBus();
  const idA = await AgentIdentity.generate(new VaultMemory());
  const idB = await AgentIdentity.generate(new VaultMemory());
  const alice = new Agent({ identity: idA, transport: new InternalTransport(bus, idA.pubKey), tokenRegistry: new TokenRegistry(new VaultMemory()) });
  const trB   = new TrustRegistry(new VaultMemory());
  const bobRevocations = new TokenRegistry(new VaultMemory());
  const bob   = new Agent({ identity: idB, transport: new InternalTransport(bus, idB.pubKey), trustRegistry: trB });
  alice.addPeer(bob.address, bob.pubKey); bob.addPeer(alice.address, alice.pubKey);
  await alice.start(); await bob.start();

  const calls = { n: 0 };
  bob.register('remote.compute', async (ctx) => {
    calls.n++;
    const args = Parts.data(ctx.parts) || {};
    return [TextPart(`ran:${args.text ?? ''}`)];
  }, { visibility: 'authenticated', policy: 'requires-token' });

  // Issuer-side revocation is CONSTRUCTED into the engine — there is no setter, so Bob's list is
  // named where the gate is built and nothing can replace it later.
  const pe = new PolicyEngine({
    trustRegistry: trB, skillRegistry: bob.skills, agentPubKey: bob.pubKey,
    isRevoked: (id) => bobRevocations.isRevoked(id),
  });
  Object.defineProperty(bob, 'policyEngine', { get: () => pe, configurable: true });
  await trB.setTier(alice.pubKey, 'authenticated');
  await trB.setTier(bob.pubKey,   'trusted');

  const registry = new RemoteHandlerRegistry();
  registry.register('op.compute', { remoteAddress: bob.address, skillId: 'remote.compute' });

  // Injected duplex loopback: server end wired to Alice's stdio server, client
  // end driven as the MCP client. (Stands in for the DEFERRED real stdio pipe.)
  const { a: clientEnd, b: serverEnd } = createDuplexLoopback();
  createStdioMcpServer({ agent: alice, manifest: MANIFEST, input: serverEnd, output: serverEnd, dispatch: { registry } });
  const client = createStdioTestClient(clientEnd);

  return { alice, bob, client, clientEnd, registry, bobRevocations, calls, skillId: 'remote.compute' };
}

/** Run the standard handshake and assert the advertised capabilities. */
async function handshake(client) {
  const init = await client.request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '0.0.0' },
  });
  client.notify('notifications/initialized');
  return init;
}

describe('createStdioMcpServer — initialize handshake + capability negotiation', () => {
  it('initialize returns protocolVersion, serverInfo, and the advertised `tools` capability', async () => {
    const { alice, bob, client } = await makeStdioTier();
    const init = await handshake(client);
    expect(init.jsonrpc).toBe('2.0');
    expect(init.result.protocolVersion).toBe('2025-06-18');
    expect(init.result.capabilities.tools).toBeTruthy();
    expect(init.result.serverInfo.name).toBe('@onderling/mcp-bridge');
    await alice.stop(); await bob.stop();
  });

  it('negotiates down to our preferred version when the client asks for an unknown one', async () => {
    const { alice, bob, client } = await makeStdioTier();
    const init = await client.request('initialize', { protocolVersion: '1999-01-01', capabilities: {} });
    expect(init.result.protocolVersion).toBe(PROTOCOL_VERSIONS[0]);
    await alice.stop(); await bob.stop();
  });

  it('ping is answered before initialization', async () => {
    const { alice, bob, client } = await makeStdioTier();
    const pong = await client.request('ping', {});
    expect(pong.result).toEqual({});
    await alice.stop(); await bob.stop();
  });
});

describe('createStdioMcpServer — lifecycle gating', () => {
  it('tools/call BEFORE initialize is rejected with a JSON-RPC ServerError', async () => {
    const { alice, bob, client, calls } = await makeStdioTier();
    const reply = await client.request('tools/call', { name: 'op.compute', arguments: { text: 'x' } });
    expect(reply.error).toBeTruthy();
    expect(reply.error.code).toBe(JsonRpcErrorCode.ServerError);
    expect(reply.result).toBeUndefined();
    expect(calls.n).toBe(0);                       // never dispatched
    await alice.stop(); await bob.stop();
  });

  it('tools/list BEFORE initialize is likewise rejected', async () => {
    const { alice, bob, client } = await makeStdioTier();
    const reply = await client.request('tools/list', {});
    expect(reply.error.code).toBe(JsonRpcErrorCode.ServerError);
    await alice.stop(); await bob.stop();
  });
});

describe('createStdioMcpServer — full framed exchange over the loopback', () => {
  it('initialize → initialized → tools/list → tools/call (authorized) runs the gated skill', async () => {
    const { alice, bob, client, skillId, calls } = await makeStdioTier();
    await grantRemoteCapability({ hostAgent: bob, callerAgent: alice, skillId, expiresIn: 60_000 });

    await handshake(client);

    const list = await client.request('tools/list', {});
    expect(list.result.tools.map((t) => t.name)).toEqual(['op.compute']);
    expect(list.result.tools[0].inputSchema.required).toEqual(['text']);

    const call = await client.request('tools/call', { name: 'op.compute', arguments: { text: 'yo' } });
    expect(call.jsonrpc).toBe('2.0');
    expect(call.error).toBeUndefined();            // tool result framed as JSON-RPC success
    expect(call.result.isError).toBeUndefined();
    expect(call.result.content[0]).toEqual({ type: 'text', text: 'ran:yo' });
    expect(calls.n).toBe(1);

    await alice.stop(); await bob.stop();
  });

  it('UNGRANTED tools/call → MCP isError tool-result in a JSON-RPC success, skill NOT executed', async () => {
    const { alice, bob, client, calls } = await makeStdioTier();
    await handshake(client);

    const call = await client.request('tools/call', { name: 'op.compute', arguments: { text: 'x' } });
    expect(call.error).toBeUndefined();            // gate deny is a TOOL-level result, not a transport error
    expect(call.result.isError).toBe(true);
    expect(call.result._meta.code).toBe('denied_or_failed');
    expect(calls.n).toBe(0);                       // gate held: skill never ran
    await alice.stop(); await bob.stop();
  });

  it('REVOKED tools/call → the call that worked now returns isError, no further execution', async () => {
    const { alice, bob, client, skillId, bobRevocations, calls } = await makeStdioTier();
    const token = await grantRemoteCapability({ hostAgent: bob, callerAgent: alice, skillId, expiresIn: 60_000 });
    await handshake(client);

    const ok = await client.request('tools/call', { name: 'op.compute', arguments: { text: 'a' } });
    expect(ok.result.isError).toBeUndefined();
    expect(calls.n).toBe(1);

    await bobRevocations.revoke(token.id);

    const denied = await client.request('tools/call', { name: 'op.compute', arguments: { text: 'b' } });
    expect(denied.result.isError).toBe(true);
    expect(calls.n).toBe(1);                        // NOT executed again
    await alice.stop(); await bob.stop();
  });

  it('tools/call for a tool NOT in the manifest → MCP unknown-tool isError (no dispatch)', async () => {
    const { alice, bob, client, calls } = await makeStdioTier();
    await handshake(client);
    const call = await client.request('tools/call', { name: 'op.rogue', arguments: {} });
    expect(call.result.isError).toBe(true);
    expect(call.result._meta.code).toBe('unknown_tool');
    expect(calls.n).toBe(0);
    await alice.stop(); await bob.stop();
  });

  it('an unknown METHOD → JSON-RPC method-not-found error', async () => {
    const { alice, bob, client } = await makeStdioTier();
    await handshake(client);
    const reply = await client.request('resources/list', {});
    expect(reply.result).toBeUndefined();
    expect(reply.error.code).toBe(JsonRpcErrorCode.MethodNotFound);
    await alice.stop(); await bob.stop();
  });

  it('re-initialize after the handshake → JSON-RPC InvalidRequest', async () => {
    const { alice, bob, client } = await makeStdioTier();
    await handshake(client);
    const again = await client.request('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
    expect(again.error.code).toBe(JsonRpcErrorCode.InvalidRequest);
    await alice.stop(); await bob.stop();
  });

  it('a malformed line on the wire → a JSON-RPC ParseError reply (stream not crashed)', async () => {
    const { alice, bob, client, clientEnd } = await makeStdioTier();
    // Capture raw server output on the client end.
    const raw = [];
    clientEnd.onData((chunk) => raw.push(chunk));
    client.sendRaw('this is not json\n');
    await new Promise((r) => setTimeout(r, 0));
    const joined = raw.join('');
    expect(joined).toContain('"error"');
    expect(joined).toContain(String(JsonRpcErrorCode.ParseError));
    // Stream still alive: a subsequent request still works.
    const pong = await client.request('ping', {});
    expect(pong.result).toEqual({});
    await alice.stop(); await bob.stop();
  });
});
