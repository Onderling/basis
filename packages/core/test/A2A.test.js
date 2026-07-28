/**
 * Group H — A2A layer tests.
 *
 * Uses real HTTP servers (port 0) for A2ATransport integration tests.
 * No external network calls — all peers are in-process.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { AgentIdentity }  from '../src/identity/AgentIdentity.js';
import { VaultMemory }    from '@onderling/vault';
import { InternalBus, InternalTransport } from '../src/transport/InternalTransport.js';
import { Agent }          from '../src/Agent.js';
import { TextPart, DataPart, Parts } from '../src/Parts.js';

import { AgentCardBuilder } from '../src/a2a/AgentCardBuilder.js';
import { A2ATLSLayer }      from '../src/a2a/A2ATLSLayer.js';
import { A2AAuth }          from '../src/a2a/A2AAuth.js';
import { A2ATransport }     from '../src/a2a/A2ATransport.js';
import { discoverA2A }      from '../src/a2a/a2aDiscover.js';
import { sendA2ATask }      from '../src/a2a/a2aTaskSend.js';
import { sendA2AStreamTask } from '../src/a2a/a2aTaskSubscribe.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

async function makeAgent(label = 'agent') {
  const id        = await AgentIdentity.generate(new VaultMemory());
  const bus       = new InternalBus();
  const transport = new InternalTransport(bus, id.pubKey);
  const agent     = new Agent({ identity: id, transport, label });
  await agent.start();
  return agent;
}

/** Start an A2ATransport server backed by the given agent. Returns { transport, url }. */
async function startA2AServer(agent) {
  const transport = new A2ATransport({ agent, port: 0 });
  await transport.connect();
  const url = `http://localhost:${transport.serverPort}`;
  return { transport, url };
}

// ── AgentCardBuilder ──────────────────────────────────────────────────────────

describe('AgentCardBuilder', () => {
  let agent;
  beforeEach(async () => {
    agent = await makeAgent('Card Test');
    agent.register('public-skill', async () => [], {
      description: 'A public skill',
      visibility: 'public',
    });
    agent.register('auth-skill', async () => [], {
      description: 'Authenticated only',
      visibility: 'authenticated',
    });
    agent.register('private-skill', async () => [], {
      visibility: 'private',
    });
  });
  afterEach(() => agent.stop());

  it('returns required A2A card fields', () => {
    const builder = new AgentCardBuilder({ agent, config: { url: 'https://example.com' } });
    const card = builder.build(0);
    expect(card.name).toBeDefined();
    expect(card.version).toBe('1.0');
    expect(card.capabilities).toBeDefined();
    expect(card.skills).toBeInstanceOf(Array);
    expect(card.authentication.schemes).toContain('Bearer');
  });

  it('includes x-onderling extension with pubKey', () => {
    const builder = new AgentCardBuilder({ agent });
    const card = builder.build(0);
    expect(card['x-onderling'].pubKey).toBe(agent.pubKey);
  });

  it('tier 0 — includes only public skills', () => {
    const builder = new AgentCardBuilder({ agent });
    const ids = builder.build(0).skills.map(s => s.id);
    expect(ids).toContain('public-skill');
    expect(ids).not.toContain('auth-skill');
    expect(ids).not.toContain('private-skill');
  });

  it('tier 1 — includes public and authenticated skills', () => {
    const builder = new AgentCardBuilder({ agent });
    const ids = builder.build(1).skills.map(s => s.id);
    expect(ids).toContain('public-skill');
    expect(ids).toContain('auth-skill');
    expect(ids).not.toContain('private-skill');
  });

  it('skill cards have required fields', () => {
    const builder = new AgentCardBuilder({ agent });
    const skill = builder.build(0).skills.find(s => s.id === 'public-skill');
    expect(skill.id).toBe('public-skill');
    expect(skill.description).toBe('A public skill');
    expect(skill.inputModes).toBeInstanceOf(Array);
    expect(skill.outputModes).toBeInstanceOf(Array);
  });
});

// ── A2ATLSLayer ───────────────────────────────────────────────────────────────

describe('A2ATLSLayer', () => {
  it('encrypt is a pass-through', () => {
    const layer = new A2ATLSLayer();
    const env = { _v: 1, _p: 'OW', payload: 'data' };
    expect(layer.encrypt(env)).toBe(env);
  });

  it('decryptAndVerify is a pass-through', () => {
    const layer = new A2ATLSLayer();
    const env = { _v: 1, _p: 'OW', payload: 'data' };
    expect(layer.decryptAndVerify(env)).toBe(env);
  });

  it('validateInbound returns tier 0 when no a2aAuth', async () => {
    const layer = new A2ATLSLayer();
    const result = await layer.validateInbound({ headers: {} });
    expect(result).toEqual({ tier: 0, claims: null, peerId: null });
  });

  it('wrapOutbound returns unchanged init when no a2aAuth', async () => {
    const layer = new A2ATLSLayer();
    const init = { method: 'POST', headers: {} };
    expect(await layer.wrapOutbound('https://peer.example.com', init)).toBe(init);
  });

  it('wrapOutbound adds Authorization header when a2aAuth has a token', async () => {
    const vault = new VaultMemory();
    const auth  = new A2AAuth({ vault });
    await auth.storeToken('https://peer.example.com', 'my-token');
    const layer = new A2ATLSLayer({ a2aAuth: auth });
    const init  = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
    const result = await layer.wrapOutbound('https://peer.example.com', init);
    expect(result.headers.Authorization).toBe('Bearer my-token');
    expect(result.headers['Content-Type']).toBe('application/json');
  });
});

// ── A2AAuth ───────────────────────────────────────────────────────────────────

describe('A2AAuth', () => {
  let vault, auth;
  beforeEach(() => {
    vault = new VaultMemory();
    auth  = new A2AAuth({ vault });
  });

  it('validateInbound returns tier 0 when no Authorization header', async () => {
    const result = await auth.validateInbound({ headers: {} });
    expect(result.tier).toBe(0);
    expect(result.claims).toBeNull();
  });

  it('validateInbound returns tier 0 for non-Bearer auth', async () => {
    const result = await auth.validateInbound({ headers: { authorization: 'Basic abc' } });
    expect(result.tier).toBe(0);
  });

  it('validateInbound returns tier 1 for valid non-expired JWT', async () => {
    const payload = { sub: 'https://caller.example.com', exp: Math.floor(Date.now() / 1000) + 3600 };
    const jwt = _makeJwt(payload);
    const result = await auth.validateInbound({ headers: { authorization: `Bearer ${jwt}` } });
    expect(result.tier).toBe(1);
    expect(result.claims.sub).toBe('https://caller.example.com');
    expect(result.peerId).toBe('https://caller.example.com');
  });

  it('validateInbound returns tier 0 for expired JWT', async () => {
    const payload = { sub: 'peer', exp: Math.floor(Date.now() / 1000) - 10 };
    const jwt = _makeJwt(payload);
    const result = await auth.validateInbound({ headers: { authorization: `Bearer ${jwt}` } });
    expect(result.tier).toBe(0);
  });

  it('validateInbound returns tier 0 for malformed JWT', async () => {
    const result = await auth.validateInbound({ headers: { authorization: 'Bearer not.a.jwt' } });
    expect(result.tier).toBe(0);
  });

  it('storeToken / getToken round-trip', async () => {
    await auth.storeToken('https://peer.example.com', 'tok123');
    expect(await auth.getToken('https://peer.example.com')).toBe('tok123');
  });

  it('getToken returns null when no token stored', async () => {
    expect(await auth.getToken('https://unknown.example.com')).toBeNull();
  });

  it('buildHeaders returns empty object when no token', async () => {
    expect(await auth.buildHeaders('https://peer.example.com')).toEqual({});
  });

  it('buildHeaders returns Authorization header when token exists', async () => {
    await auth.storeToken('https://peer.example.com', 'tok456');
    const headers = await auth.buildHeaders('https://peer.example.com');
    expect(headers.Authorization).toBe('Bearer tok456');
  });
});

// ── A2ATransport — HTTP server ────────────────────────────────────────────────

describe('A2ATransport server', () => {
  let agent, transport, baseUrl;

  beforeEach(async () => {
    agent = await makeAgent('Server Agent');
    agent.register('echo', async ({ parts }) => parts, { visibility: 'public' });
    agent.register('greet', async ({ parts }) => {
      const name = Parts.text(parts) ?? 'stranger';
      return [TextPart(`Hello, ${name}!`)];
    }, { visibility: 'public' });
    agent.register('stream-skill', async function* ({ parts }) {
      yield [TextPart('chunk-1')];
      yield [TextPart('chunk-2')];
    }, { visibility: 'public' });
    agent.register('fail-skill', async () => {
      throw new Error('intentional failure');
    }, { visibility: 'public' });

    ({ transport, url: baseUrl } = await startA2AServer(agent));
  });

  afterEach(async () => {
    await transport.disconnect();
    await agent.stop();
  });

  it('GET /.well-known/agent.json returns agent card', async () => {
    const resp = await fetch(`${baseUrl}/.well-known/agent.json`);
    expect(resp.ok).toBe(true);
    const card = await resp.json();
    expect(card.name).toBeDefined();
    expect(card.skills).toBeInstanceOf(Array);
    expect(card['x-onderling'].pubKey).toBe(agent.pubKey);
  });

  it('POST /tasks/send runs skill and returns completed result', async () => {
    const resp = await fetch(`${baseUrl}/tasks/send`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        id:      'task-1',
        skillId: 'greet',
        message: { role: 'user', parts: [TextPart('Alice')] },
      }),
    });
    expect(resp.ok).toBe(true);
    const result = await resp.json();
    expect(result.status).toBe('completed');
    expect(Parts.text(result.artifacts[0].parts)).toBe('Hello, Alice!');
  });

  it('POST /tasks/send returns failed when skill throws', async () => {
    const resp = await fetch(`${baseUrl}/tasks/send`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        id:      'task-2',
        skillId: 'fail-skill',
        message: { role: 'user', parts: [] },
      }),
    });
    const result = await resp.json();
    expect(result.status).toBe('failed');
    expect(result.error.message).toContain('intentional failure');
  });

  it('POST /tasks/send returns 404 for unknown skill', async () => {
    const resp = await fetch(`${baseUrl}/tasks/send`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id: 'x', skillId: 'no-such-skill', message: { role: 'user', parts: [] } }),
    });
    expect(resp.status).toBe(404);
  });

  it('POST /tasks/sendSubscribe streams SSE chunks from generator', async () => {
    const resp = await fetch(`${baseUrl}/tasks/sendSubscribe`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body:    JSON.stringify({ id: 'task-3', skillId: 'stream-skill', message: { role: 'user', parts: [] } }),
    });
    expect(resp.ok).toBe(true);
    expect(resp.headers.get('content-type')).toContain('text/event-stream');

    const text  = await resp.text();
    const lines = text.split('\n').filter(l => l.startsWith('data:'));
    const events = lines.map(l => JSON.parse(l.slice(5).trim()));

    const chunks = events.filter(e => e.type === 'chunk');
    const done   = events.find(e => e.type === 'done');

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(Parts.text(chunks[0].parts)).toBe('chunk-1');
    expect(done.status).toBe('completed');
  });

  it('GET /tasks/:id returns task status', async () => {
    const resp = await fetch(`${baseUrl}/tasks/task-unknown`);
    expect(resp.status).toBe(404);
  });
});

// ── A2ATransport — _put client ────────────────────────────────────────────────

describe('A2ATransport _put (client)', () => {
  let serverAgent, serverTransport, baseUrl;
  let clientTransport;

  beforeEach(async () => {
    serverAgent = await makeAgent('Server');
    serverAgent.register('add', async ({ parts }) => {
      const { a, b } = Parts.data(parts) ?? {};
      return [DataPart({ result: a + b })];
    }, { visibility: 'public' });

    ({ transport: serverTransport, url: baseUrl } = await startA2AServer(serverAgent));

    // A2ATransport used as a pure client (no HTTP server, no full Agent start).
    // Must use A2ATLSLayer as security layer — A2A auth is at HTTP level, not nacl.box.
    const id = await AgentIdentity.generate(new VaultMemory());
    clientTransport = new A2ATransport({ agent: null, port: null });
    clientTransport._setAddress(id.pubKey);
    clientTransport.useSecurityLayer(new A2ATLSLayer());
  });

  afterEach(async () => {
    await serverTransport.disconnect();
    await serverAgent.stop();
  });

  it('RQ _put → POST /tasks/send → resolves RS via _receive', async () => {
    const rs = await clientTransport.request(
      baseUrl,
      { type: 'task', taskId: 'put-test-1', skillId: 'add', parts: [DataPart({ a: 3, b: 4 })] },
      5000,
    );
    expect(rs.payload.status).toBe('completed');
    expect(Parts.data(rs.payload.parts).result).toBe(7);
  });
});

// ── a2aDiscover ───────────────────────────────────────────────────────────────

describe('a2aDiscover', () => {
  let agent, transport, baseUrl;

  beforeEach(async () => {
    agent = await makeAgent('Discoverable');
    agent.register('hello', async () => [TextPart('hi')], { visibility: 'public' });
    ({ transport, url: baseUrl } = await startA2AServer(agent));
  });

  afterEach(async () => {
    await transport.disconnect();
    await agent.stop();
  });

  it('fetches card and returns an A2A peer record', async () => {
    const caller = await makeAgent('Caller');
    const record = await discoverA2A(caller, baseUrl);
    expect(record.type).toBe('a2a');
    expect(record.url).toBe(baseUrl);
    expect(record.name).toBeDefined();
    expect(record.skills).toBeInstanceOf(Array);
    expect(record.reachable).toBe(true);
    await caller.stop();
  });

  it('peer record includes skills from card', async () => {
    const caller = await makeAgent('Caller');
    const record = await discoverA2A(caller, baseUrl);
    const ids = record.skills.map(s => s.id);
    expect(ids).toContain('hello');
    await caller.stop();
  });

  it('throws when agent card is not reachable', async () => {
    const caller = await makeAgent('Caller');
    await expect(discoverA2A(caller, 'http://localhost:1', { timeout: 500 }))
      .rejects.toThrow('A2A discovery failed');
    await caller.stop();
  });

  it('upserts into provided peerGraph', async () => {
    const caller   = await makeAgent('Caller');
    const upserted = [];
    const fakePeerGraph = { upsert: async r => upserted.push(r) };
    await discoverA2A(caller, baseUrl, { peerGraph: fakePeerGraph });
    expect(upserted).toHaveLength(1);
    expect(upserted[0].url).toBe(baseUrl);
    await caller.stop();
  });
});

// ── sendA2ATask ───────────────────────────────────────────────────────────────

describe('sendA2ATask', () => {
  let agent, transport, baseUrl;

  beforeEach(async () => {
    agent = await makeAgent('Task Server');
    agent.register('upper', async ({ parts }) => {
      const text = Parts.text(parts) ?? '';
      return [TextPart(text.toUpperCase())];
    }, { visibility: 'public' });
    agent.register('always-fail', async () => {
      throw new Error('forced failure');
    }, { visibility: 'public' });

    ({ transport, url: baseUrl } = await startA2AServer(agent));
  });

  afterEach(async () => {
    await transport.disconnect();
    await agent.stop();
  });

  it('returns a Task that resolves completed with result parts', async () => {
    const caller = await makeAgent('Caller');
    const task   = sendA2ATask(caller, baseUrl, 'upper', [TextPart('hello')]);
    const result = await task.done();
    expect(result.state).toBe('completed');
    expect(Parts.text(result.parts)).toBe('HELLO');
    await caller.stop();
  });

  it('returns a Task that resolves failed when skill throws', async () => {
    const caller = await makeAgent('Caller');
    const task   = sendA2ATask(caller, baseUrl, 'always-fail', []);
    await expect(task.done()).rejects.toThrow();
    expect(task.state).toBe('failed');
    await caller.stop();
  });

  it('returns a Task that fails for unknown skill', async () => {
    const caller = await makeAgent('Caller');
    const task   = sendA2ATask(caller, baseUrl, 'no-such-skill', []);
    await expect(task.done()).rejects.toThrow();
    expect(task.state).toBe('failed');
    await caller.stop();
  });

  it('starts in working state', () => {
    const caller = makeAgent('Caller').then(c => {
      const task = sendA2ATask(c, baseUrl, 'upper', [TextPart('x')]);
      expect(task.state).toBe('working');
      return c;
    });
  });
});

// ── sendA2AStreamTask ─────────────────────────────────────────────────────────

describe('sendA2AStreamTask', () => {
  let agent, transport, baseUrl;

  beforeEach(async () => {
    agent = await makeAgent('Stream Server');
    agent.register('count', async function* () {
      for (let i = 1; i <= 3; i++) yield [TextPart(`${i}`)];
    }, { visibility: 'public' });
    agent.register('single', async ({ parts }) => parts, { visibility: 'public' });

    ({ transport, url: baseUrl } = await startA2AServer(agent));
  });

  afterEach(async () => {
    await transport.disconnect();
    await agent.stop();
  });

  it('streams chunks via task.stream() and completes', async () => {
    const caller = await makeAgent('Caller');
    const task   = sendA2AStreamTask(caller, baseUrl, 'count', []);

    const chunks = [];
    for await (const chunk of task.stream()) {
      chunks.push(Parts.text(chunk));
    }

    expect(chunks).toEqual(['1', '2', '3']);
    expect(task.state).toBe('completed');
    await caller.stop();
  });

  it('task.done() resolves after stream finishes', async () => {
    const caller = await makeAgent('Caller');
    const task   = sendA2AStreamTask(caller, baseUrl, 'count', []);
    const result = await task.done();
    expect(result.state).toBe('completed');
    await caller.stop();
  });

  it('non-generator skill via sendSubscribe returns single-chunk stream', async () => {
    const caller = await makeAgent('Caller');
    const task   = sendA2AStreamTask(caller, baseUrl, 'single', [TextPart('hi')]);
    const result = await task.done();
    expect(result.state).toBe('completed');
    await caller.stop();
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal unsigned JWT with the given payload (for testing only). */
function _makeJwt(payload) {
  const header  = _b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const body    = _b64url(JSON.stringify(payload));
  return `${header}.${body}.`;
}

function _b64url(str) {
  return Buffer.from(str).toString('base64url');
}
