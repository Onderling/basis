/**
 * companion-node R3.0 — the agent-proxy NETWORK-ADVERSARY boundary, hermetic.
 *
 * R2b proved a real DELEGATION boundary (the host proves the grant was for IT,
 * from ITS owner) but enforcement stayed IN-PROCESS on the host — the host held
 * the pod client directly. R3.0 crosses the boundary R2b is not: the host runs a
 * real `PodClient`/`SolidPodSource` whose only proxied seam is `fetch`; every pod
 * HTTP request is shipped back over the REAL relay to the DELEGATING DEVICE
 * (`CapabilityAuth` mode `agent-proxy`). The device holds the pod's OIDC session
 * (DPoP minted on-device — MOCKED here) AND is the AUTHORITATIVE scope check, so
 * no pod secret ever reaches the host.
 *
 * Hermetic: the device's "authenticated fetch" is a MOCK over an in-memory pod
 * that serves LDP-container Turtle (the exact contract a real Solid pod serves,
 * so the host's Inrupt `getSolidDataset` parses it unchanged). The CSS/real-DPoP
 * proof is R3.2, NOT this slice.
 *
 * We assert RESULTS — real content / an opaque deny with NO bytes / an explicit
 * error identity — over a REAL `startRelay` + `RelayTransport`, never merely that
 * a call ran.
 */
import { describe, it, expect, afterEach } from 'vitest';

import { Agent, AgentIdentity, Parts } from '@onderling/core';
import { VaultMemory }                 from '@onderling/vault';
import { RelayTransport }              from '@onderling/transports';

import { startCompanionNode }          from '../src/index.js';
import { buildDevPodSource }           from '../src/podSource.js';
import { authorizePod, deliverPodDelegation } from '../src/authorizePod.js';
import { registerPodProxy }            from '../src/podProxy.js';

const POD_ROOT = 'https://companion.pod.invalid/';

/* teardown registry */
const cleanups = [];
afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop();
    try { await fn(); } catch { /* best-effort */ }
  }
});

/* ── the device's MOCK authenticated fetch over an in-memory pod ────────────── */

/** Build an LDP BasicContainer Turtle body listing `children` (absolute urls). */
function containerTurtle(containerUrl, children) {
  const head = `@prefix ldp: <http://www.w3.org/ns/ldp#> .\n<${containerUrl}> a ldp:Container, ldp:BasicContainer`;
  if (children.length === 0) return `${head} .\n`;
  const contains = children.map((c) => `<${c}>`).join(', ');
  return `${head} ;\n  ldp:contains ${contains} .\n`;
}

function turtleResponse(url, body) {
  const res = new Response(body, {
    status: 200, statusText: 'OK',
    headers: { 'content-type': 'text/turtle' },
  });
  try { Object.defineProperty(res, 'url', { value: url }); } catch { /* ignore */ }
  return res;
}

/** Case-insensitive header lookup over a plain-object header bag. */
function headerGet(headers, name) {
  if (!headers) return undefined;
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (String(k).toLowerCase() === want) return v;
  }
  return undefined;
}

/** Normalise a proxied request body (Uint8Array from b64decode, or string) to bytes. */
function toBytes(body) {
  if (body == null)                 return new Uint8Array();
  if (body instanceof Uint8Array)   return body;
  if (body instanceof ArrayBuffer)  return new Uint8Array(body);
  if (typeof body === 'string')     return new TextEncoder().encode(body);
  return new Uint8Array();
}

/**
 * A device-side in-memory pod + its MOCK authenticated fetch (a spy).
 *
 * `secret` is baked into the "OIDC session" the fetch closes over — it stands in
 * for the access-token / DPoP key a real device session would hold. It is NEVER
 * emitted in a response, so the NO-SECRET-ON-HOST assertion can scan the host
 * graph for it and prove it never crossed the wire.
 *
 * R3.1 — a minimal LDP-ish store that honours the FULL method set the device may
 * be asked to execute: GET/HEAD (read), PUT/POST/PATCH (write), DELETE (delete),
 * with per-resource `etag`s and faithful `If-Match` → 412 conflict semantics so a
 * stale-etag write round-trips as a real 412 back through the proxy.
 */
function makeDevicePod({ files, secret }) {
  let etagSeq = 0;
  const nextEtag = () => `"etag-${++etagSeq}"`;
  // pathname → { path, body, contentType, etag }
  const store = new Map(files.map((f) => [f.path, { ...f, etag: nextEtag() }]));
  const calls = [];                                        // spy: every fetch the DEVICE ran
  // The "session" the device would use to mint DPoP. Held ONLY here, on-device.
  const session = { accessToken: secret, dpopPrivateKey: `${secret}-dpop` };

  async function authFetch(url, init = {}) {
    const method = String(init.method || 'GET').toUpperCase();
    calls.push({ url: String(url), method });
    // (a real device fetch would sign with `session` here — mocked)
    void session;
    const u = new URL(String(url));
    const path = u.pathname;

    // ── reads (R3.0) ────────────────────────────────────────────────────────
    if (method === 'GET' && path.endsWith('/')) {
      // Direct children of this container.
      const kids = new Set();
      for (const key of store.keys()) {
        if (!key.startsWith(path) || key === path) continue;
        const rest  = key.slice(path.length);
        const slash = rest.indexOf('/');
        kids.add(u.origin + (slash === -1 ? key : path + rest.slice(0, slash + 1)));
      }
      return turtleResponse(String(url), containerTurtle(String(url), [...kids]));
    }
    if (method === 'GET') {
      const f = store.get(path);
      if (!f) return new Response(null, { status: 404, statusText: 'Not Found' });
      const res = new Response(f.body, {
        status: 200, statusText: 'OK',
        headers: { 'content-type': f.contentType || 'application/octet-stream', etag: f.etag },
      });
      try { Object.defineProperty(res, 'url', { value: String(url) }); } catch { /* ignore */ }
      return res;
    }
    if (method === 'HEAD') {
      const f = store.get(path);
      if (!f) return new Response(null, { status: 404, statusText: 'Not Found' });
      return new Response(null, {
        status: 200, statusText: 'OK',
        headers: { 'content-type': f.contentType || 'application/octet-stream', etag: f.etag },
      });
    }

    // ── writes (R3.1) — honour the If-Match precondition → 412 on mismatch ───
    if (method === 'PUT' || method === 'POST' || method === 'PATCH') {
      const ifMatch = headerGet(init.headers, 'if-match');
      const cur     = store.get(path);
      if (ifMatch != null && (!cur || cur.etag !== ifMatch)) {
        return new Response(null, { status: 412, statusText: 'Precondition Failed' });
      }
      const contentType = headerGet(init.headers, 'content-type') || cur?.contentType || 'application/octet-stream';
      const etag        = nextEtag();
      store.set(path, { path, body: toBytes(init.body), contentType, etag });
      const created = !cur;
      return new Response(null, {
        status:     created ? 201 : 205,
        statusText: created ? 'Created' : 'Reset Content',
        headers:    { etag },
      });
    }

    // ── delete (R3.1) — also honours If-Match ────────────────────────────────
    if (method === 'DELETE') {
      const ifMatch = headerGet(init.headers, 'if-match');
      const cur     = store.get(path);
      if (ifMatch != null && (!cur || cur.etag !== ifMatch)) {
        return new Response(null, { status: 412, statusText: 'Precondition Failed' });
      }
      if (!cur) return new Response(null, { status: 404, statusText: 'Not Found' });
      store.delete(path);
      return new Response(null, { status: 205, statusText: 'Reset Content' });
    }

    return new Response(null, { status: 405, statusText: 'Method Not Allowed' });
  }

  return { authFetch, calls, secret, store };
}

/* ── boot helpers ───────────────────────────────────────────────────────────── */

/** Boot an agent-proxy host: fail-closed for delegation, pod source proxied.
 *  `maxBodyBytes` (R3.3) sets the host's request-side proxy body cap.
 *  `preFilter` (R3-advisory) toggles the host-side local scope pre-filter:
 *    - default `true`  — production default: the advisory ScopedPodClient sits
 *      in FRONT of the agent-proxy client (a local out-of-scope deny is fast).
 *    - `false`         — BYPASS the pre-filter (raw proxy client, exact R3.0
 *      behaviour) so a test can prove the DEVICE denies authoritatively with the
 *      advisory gate removed — the pre-filter is NEVER the sole gate in a proof. */
async function bootProxyHost({ owner, container, maxBodyBytes, preFilter = true }) {
  // The held pod source is IRRELEVANT under agent-proxy (we replace it with a
  // proxy PodClient on delegation) — we only reuse its containerUri.
  const podSource = await buildDevPodSource({ podRoot: POD_ROOT, container, files: [] });
  const host = await startCompanionNode({
    identityVault:  new VaultMemory(),
    gate:           false,                 // isolate the pod leg from the R2 skill gate
    podProxy:       true,                  // R3.0 — agent-proxy swap on delegation
    podPreFilter:   preFilter,             // R3-advisory — host-side local scope pre-filter
    podMaxBodyBytes: maxBodyBytes,         // R3.3 — request-side body cap (undefined ⇒ 16 MiB default)
    podSource,                             // supplies containerUri
    podOwnerPubKey: owner.pubKey,          // trust root ⇒ fail-closed boot
  });
  cleanups.push(() => host.stop());
  return host;
}

/**
 * R3-advisory — spy on the HOST's proxy round-trips. Monkeypatches
 * `host.agent.invoke` to count `pod.proxyRequest` invocations. The agent-proxy
 * fetch (`CapabilityAuth.#makeProxyFetch`) calls `host.agent.invoke(deviceAddr,
 * 'pod.proxyRequest', …)` via the closure in `buildProxyPodSource`; the closure
 * reads `agent.invoke` at call time, so patching the same object is observed.
 * A FAST LOCAL DENY records ZERO such invokes (no relay round-trip); a device
 * round-trip records ≥1. This is the direct, observable proof of "which gate fired".
 */
function spyProxyInvokes(host) {
  const real = host.agent.invoke.bind(host.agent);
  const calls = [];
  host.agent.invoke = (addr, skill, payload, opts) => {
    if (skill === 'pod.proxyRequest') calls.push({ addr, skill });
    return real(addr, skill, payload, opts);
  };
  return { calls, restore: () => { host.agent.invoke = real; } };
}

/** A real device agent (== the pod owner) that also serves pod.proxyRequest.
 *  `maxBodyBytes` (R3.3) sets the device's response-side proxy body cap. */
async function makeOwnerDevice(host, owner, devicePod, { maxBodyBytes } = {}) {
  const agent = new Agent({
    identity:  owner,
    transport: new RelayTransport({ relayUrl: host.relayUrl, identity: owner }),
    label:     'device',
  });
  await agent.start();
  await agent.hello(host.agent.address);
  registerPodProxy(agent, {
    authFetch:           devicePod.authFetch,
    grantIssuerIdentity: owner,                 // we honour only grants WE issued
    expectedHostPubKey:  host.agent.address,    // only that host may proxy through us
    maxBodyBytes,                               // R3.3 — response-side cap (undefined ⇒ 16 MiB default)
  });
  cleanups.push(() => agent.stop?.());
  return agent;
}

/** Invoke listFiles({source:'pod'}) on the host over the wire; return the reply. */
async function listPodOverWire(device, host) {
  return Parts.data(await device.invoke(host.agent.address, 'listFiles', { source: 'pod' }));
}

/** Deep-scan an object graph for a substring (proves a secret is/ isn't present). */
function graphContains(root, needle) {
  const seen = new Set();
  const stack = [root];
  while (stack.length) {
    const v = stack.pop();
    if (v == null) continue;
    if (typeof v === 'string') { if (v.includes(needle)) return true; continue; }
    if (typeof v !== 'object') continue;
    if (seen.has(v)) continue;
    seen.add(v);
    for (const key of Object.keys(v)) {
      if (key.includes(needle)) return true;
      try { stack.push(v[key]); } catch { /* getters may throw — ignore */ }
    }
  }
  return false;
}

/* ─────────────────────────────────────────────────────────────────────────── */

describe('companion-node R3.0 — agent-proxy: the network-adversary boundary (hermetic)', () => {
  it('PROXIED ALLOW: /notes/ list returns real content whose bytes transited the DEVICE fetch', async () => {
    const owner = await AgentIdentity.generate(new VaultMemory());
    const devicePod = makeDevicePod({
      secret: 'oidc-access-SECRET-notes',
      files: [
        { path: '/notes/welcome.md',  body: '# Welcome\n\nThis note lives in the pod.\n', contentType: 'text/markdown' },
        { path: '/photos/secret.jpg', body: 'PRIVATE-PHOTO-BYTES',                        contentType: 'image/jpeg' },
      ],
    });
    const host   = await bootProxyHost({ owner, container: 'notes/' });
    const device = await makeOwnerDevice(host, owner, devicePod);

    // Deliver a /notes/ grant (owner → host).
    const token = await authorizePod(owner, host.agent.address, {
      scopes: ['pod.read:/notes/'], pod: POD_ROOT,
    });
    const ack = await deliverPodDelegation(device, host.agent.address, token);
    expect(ack.ok).toBe(true);

    // Spy on the host's GLOBAL fetch — the proxy must NEVER hit it for the pod.
    const realFetch = globalThis.fetch;
    const hostGlobalPodCalls = [];
    globalThis.fetch = async (input, init) => {
      const u = typeof input === 'string' ? input : input?.url;
      if (typeof u === 'string' && u.includes('companion.pod.invalid')) {
        hostGlobalPodCalls.push(u);
      }
      return realFetch(input, init);
    };

    let res;
    try {
      res = await listPodOverWire(device, host);
    } finally {
      globalThis.fetch = realFetch;
    }

    // RESULT: real pod content is returned.
    expect(res.error).toBeUndefined();
    expect(res.source).toBe('pod');
    expect(res.items.some((i) => i.name === 'welcome.md')).toBe(true);

    // The bytes transited the DEVICE's mock fetch (a GET on /notes/).
    expect(devicePod.calls.some((c) => c.method === 'GET' && c.url.endsWith('/notes/'))).toBe(true);
    // …and the host's global fetch never touched the pod.
    expect(hostGlobalPodCalls).toEqual([]);
  }, 20_000);

  it('DEVICE-AUTHORITATIVE DENY: /photos/ read is denied BY THE DEVICE — opaque, no bytes, no device fetch (pre-filter BYPASSED)', async () => {
    const owner = await AgentIdentity.generate(new VaultMemory());
    const devicePod = makeDevicePod({
      secret: 'oidc-access-SECRET-photos',
      files: [
        { path: '/photos/secret.jpg', body: 'PRIVATE-PHOTO-BYTES', contentType: 'image/jpeg' },
      ],
    });
    // The host is configured to browse /photos/, but the grant only covers /notes/.
    // R3-advisory: BYPASS the host pre-filter (`preFilter: false`) so this proof
    // stays DEVICE-AUTHORITATIVE — the out-of-scope request must actually REACH the
    // device and be denied THERE, exactly as R3.0 proved. With the advisory pre-filter
    // ON, the HOST would deny this locally first (see the FAST LOCAL DENY test); this
    // test deliberately removes that gate so the DEVICE's authority is proven ALONE.
    const host   = await bootProxyHost({ owner, container: 'photos/', preFilter: false });
    const device = await makeOwnerDevice(host, owner, devicePod);

    const token = await authorizePod(owner, host.agent.address, {
      scopes: ['pod.read:/notes/'], pod: POD_ROOT,   // grants /notes/, host browses /photos/
    });
    const ack = await deliverPodDelegation(device, host.agent.address, token);
    expect(ack.ok).toBe(true);                        // delegation is valid + installed

    // The host DID ship the request to the device (no local pre-filter to stop it).
    const spy = spyProxyInvokes(host);
    let res;
    try { res = await listPodOverWire(device, host); }
    finally { spy.restore(); }

    // Denied — no bytes, no leak of the private path/content.
    expect(res.items).toEqual([]);
    expect(res.error).toMatch(/pod list failed/i);
    expect(JSON.stringify(res)).not.toMatch(/secret\.jpg|PRIVATE-PHOTO-BYTES/);

    // The request REACHED the device (a real relay round-trip happened) …
    expect(spy.calls.length).toBeGreaterThan(0);
    // … and was denied BY THE DEVICE: its scope-check fired BEFORE any fetch — the
    // mock authenticated fetch was NEVER called for the out-of-scope path.
    expect(devicePod.calls.some((c) => c.url.includes('/photos/'))).toBe(false);
  }, 20_000);

  it('NO SECRET ON HOST: the host graph / CapabilityAuth holds no OIDC / DPoP / access-token material', async () => {
    const owner = await AgentIdentity.generate(new VaultMemory());
    const SECRET = 'oidc-access-SECRET-nohost';
    const devicePod = makeDevicePod({
      secret: SECRET,
      files: [{ path: '/notes/welcome.md', body: '# Welcome\n', contentType: 'text/markdown' }],
    });
    const host   = await bootProxyHost({ owner, container: 'notes/' });
    const device = await makeOwnerDevice(host, owner, devicePod);

    const token = await authorizePod(owner, host.agent.address, {
      scopes: ['pod.read:/notes/'], pod: POD_ROOT,
    });
    await deliverPodDelegation(device, host.agent.address, token);
    // Drive one real proxied list so the credential path is fully exercised.
    const ok = await listPodOverWire(device, host);
    expect(ok.items.some((i) => i.name === 'welcome.md')).toBe(true);

    const podClient = host.store.getPodSource().podClient;

    // The device's session secret (access token / DPoP key) exists ONLY on the
    // device — it is nowhere in the host's boot graph or its pod client.
    expect(graphContains(host, SECRET)).toBe(false);
    expect(graphContains(podClient, SECRET)).toBe(false);
    // Belt-and-braces: it isn't in what the host received off the wire either.
    expect(JSON.stringify(ok)).not.toContain(SECRET);

    // The ONLY credential-shaped thing the host holds is the signed capability
    // token — a SCOPED GRANT (issuer/subject/pod/scopes/sig), not a pod secret:
    // it carries no access_token / dpop / id_token / private-key field.
    const wire = token.toJSON();
    expect(wire.issuer).toBe(owner.pubKey);
    expect(wire.subject).toBe(host.agent.address);
    expect(wire.scopes).toEqual(['pod.read:/notes/']);
    for (const forbidden of ['accessToken', 'access_token', 'dpop', 'idToken', 'id_token', 'privateKey']) {
      expect(Object.prototype.hasOwnProperty.call(wire, forbidden)).toBe(false);
    }
  }, 20_000);

  it('DEVICE-UNREACHABLE: with the device stopped, the host pod list fails with an explicit device-unreachable', async () => {
    const owner = await AgentIdentity.generate(new VaultMemory());
    const devicePod = makeDevicePod({
      secret: 'oidc-access-SECRET-offline',
      files: [{ path: '/notes/welcome.md', body: '# Welcome\n', contentType: 'text/markdown' }],
    });
    const host   = await bootProxyHost({ owner, container: 'notes/' });
    const device = await makeOwnerDevice(host, owner, devicePod);

    const token = await authorizePod(owner, host.agent.address, {
      scopes: ['pod.read:/notes/'], pod: POD_ROOT,
    });
    await deliverPodDelegation(device, host.agent.address, token);

    // It works while the device is up…
    const up = await listPodOverWire(device, host);
    expect(up.items.some((i) => i.name === 'welcome.md')).toBe(true);

    // …now the device goes offline. The proxied fetch must degrade EXPLICITLY.
    await device.stop();

    const containerUri = host.store.getPodSource().containerUri;
    let caught;
    try {
      await host.store.getPodSource().podClient.list(containerUri);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(hasCauseCode(caught, 'device-unreachable')).toBe(true);
  }, 25_000);
});

/* ─────────────────────────────────────────────────────────────────────────── */

/** Install a host-global-fetch spy that records any pod-touching call. */
function spyHostGlobalPodFetch() {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const u = typeof input === 'string' ? input : input?.url;
    if (typeof u === 'string' && u.includes('companion.pod.invalid')) calls.push(u);
    return realFetch(input, init);
  };
  return { calls, restore: () => { globalThis.fetch = realFetch; } };
}

const decodeBytes = (b) => new TextDecoder().decode(toBytes(b));

describe('companion-node R3.1 — agent-proxy WRITE/DELETE: the full method set over the boundary', () => {
  it('PROXIED WRITE→READ-BACK: a pod.write:/notes/ grant PUTs through the proxy; the DEVICE executes it; bytes round-trip', async () => {
    const owner = await AgentIdentity.generate(new VaultMemory());
    const devicePod = makeDevicePod({ secret: 'oidc-access-SECRET-write', files: [] });
    const host   = await bootProxyHost({ owner, container: 'notes/' });
    const device = await makeOwnerDevice(host, owner, devicePod);

    const token = await authorizePod(owner, host.agent.address, {
      scopes: ['pod.read:/notes/', 'pod.write:/notes/'], pod: POD_ROOT,
    });
    const ack = await deliverPodDelegation(device, host.agent.address, token);
    expect(ack.ok).toBe(true);

    const podClient = host.store.getPodSource().podClient;
    const target    = `${POD_ROOT}notes/new.md`;
    const CONTENT   = '# New\n\nWritten THROUGH the agent-proxy, executed on the device.\n';

    const spy = spyHostGlobalPodFetch();
    let back;
    try {
      await podClient.write(target, CONTENT, { contentType: 'text/markdown' });
      back = await podClient.read(target, { decode: 'string' });
    } finally {
      spy.restore();
    }

    // RESULT: the bytes round-trip through the proxy write→read.
    expect(back.content).toBe(CONTENT);
    // The write transited the DEVICE's authenticated fetch as a real PUT…
    expect(devicePod.calls.some((c) => c.method === 'PUT' && c.url.endsWith('/notes/new.md'))).toBe(true);
    // …and actually landed in the device's pod.
    expect(devicePod.store.has('/notes/new.md')).toBe(true);
    expect(decodeBytes(devicePod.store.get('/notes/new.md').body)).toBe(CONTENT);
    // The host's own global fetch never touched the pod — every byte went via the device.
    expect(spy.calls).toEqual([]);
  }, 20_000);

  it('412 CONFLICT round-trips: a stale-etag If-Match write → the device 412s → the host surfaces a ConflictError', async () => {
    const owner = await AgentIdentity.generate(new VaultMemory());
    const devicePod = makeDevicePod({ secret: 'oidc-access-SECRET-412', files: [] });
    const host   = await bootProxyHost({ owner, container: 'notes/' });
    const device = await makeOwnerDevice(host, owner, devicePod);

    const token = await authorizePod(owner, host.agent.address, {
      scopes: ['pod.read:/notes/', 'pod.write:/notes/'], pod: POD_ROOT,
    });
    expect((await deliverPodDelegation(device, host.agent.address, token)).ok).toBe(true);

    const podClient = host.store.getPodSource().podClient;
    const target    = `${POD_ROOT}notes/race.md`;

    // First write creates the file; the host learns its etag (into its etag map).
    await podClient.write(target, 'v1', { contentType: 'text/markdown' });

    // Someone else mutates the resource out-of-band: its DEVICE-side etag advances,
    // while the host still holds the OLD etag → its next If-Match is stale.
    const cur = devicePod.store.get('/notes/race.md');
    devicePod.store.set('/notes/race.md', { ...cur, etag: '"etag-BUMPED-BY-ANOTHER-WRITER"' });

    const callsBefore = devicePod.calls.length;
    let caught;
    try {
      await podClient.write(target, 'v2', { contentType: 'text/markdown' });
    } catch (err) { caught = err; }

    // The 412 status/statusText transited the proxy faithfully → mapped to CONFLICT.
    expect(caught).toBeDefined();
    expect(caught.code).toBe('CONFLICT');            // ConflictError
    // The device DID run the (conflicting) PUT — the deny is a real HTTP 412, not a scope deny.
    expect(devicePod.calls.slice(callsBefore).some((c) => c.method === 'PUT')).toBe(true);
    // The stale write did NOT land — v1 is intact on the device.
    expect(decodeBytes(devicePod.store.get('/notes/race.md').body)).toBe('v1');
  }, 20_000);

  it('OUT-OF-SCOPE WRITE/DELETE DENIED BY THE DEVICE: a read-only token cannot PUT or DELETE — opaque, no device fetch, nothing changed', async () => {
    const owner = await AgentIdentity.generate(new VaultMemory());
    const devicePod = makeDevicePod({
      secret: 'oidc-access-SECRET-rodeny',
      files: [{ path: '/notes/existing.md', body: 'ORIGINAL-CONTENT', contentType: 'text/markdown' }],
    });
    const host   = await bootProxyHost({ owner, container: 'notes/', preFilter: false });
    const device = await makeOwnerDevice(host, owner, devicePod);

    // READ-ONLY grant — no pod.write:, no pod.delete:.
    const token = await authorizePod(owner, host.agent.address, {
      scopes: ['pod.read:/notes/'], pod: POD_ROOT,
    });
    expect((await deliverPodDelegation(device, host.agent.address, token)).ok).toBe(true);

    const podClient = host.store.getPodSource().podClient;

    // R3-advisory: this test is named "DENIED BY THE DEVICE" — it boots with the
    // pre-filter BYPASSED (`preFilter: false` above) so the wrong-ACTION request
    // genuinely reaches the DEVICE and the DEVICE denies (code FORBIDDEN), not the
    // host's advisory local gate (which would deny with the distinct POD_FORBIDDEN).
    // PUT attempt → denied at the device (wrong ACTION: read token, write method).
    let wErr;
    try { await podClient.write(`${POD_ROOT}notes/evil.md`, 'EVIL', { contentType: 'text/markdown' }); }
    catch (e) { wErr = e; }
    expect(wErr).toBeDefined();
    expect(wErr.code).toBe('FORBIDDEN');             // opaque 403 → CapabilityError

    // DELETE attempt on an EXISTING in-container file → still denied (no delete scope).
    let dErr;
    try { await podClient.delete(`${POD_ROOT}notes/existing.md`); }
    catch (e) { dErr = e; }
    expect(dErr).toBeDefined();
    expect(dErr.code).toBe('FORBIDDEN');

    // The device NEVER executed a mutating fetch — the scope-check fired BEFORE fetch.
    expect(devicePod.calls.some((c) => ['PUT', 'POST', 'PATCH', 'DELETE'].includes(c.method))).toBe(false);
    // Nothing was created; the existing file is byte-for-byte untouched.
    expect(devicePod.store.has('/notes/evil.md')).toBe(false);
    expect(decodeBytes(devicePod.store.get('/notes/existing.md').body)).toBe('ORIGINAL-CONTENT');
  }, 20_000);

  it('DELETE within scope removes the file; a DELETE outside scope is denied by the device', async () => {
    const owner = await AgentIdentity.generate(new VaultMemory());
    const devicePod = makeDevicePod({
      secret: 'oidc-access-SECRET-delete',
      files: [
        { path: '/notes/gone.md',   body: 'BYE',   contentType: 'text/markdown' },
        { path: '/photos/keep.jpg', body: 'PHOTO', contentType: 'image/jpeg' },
      ],
    });
    // R3-advisory: pre-filter BYPASSED so the out-of-scope /photos/ DELETE is
    // proven DENIED BY THE DEVICE (code FORBIDDEN), not by the host's local gate.
    const host   = await bootProxyHost({ owner, container: 'notes/', preFilter: false });
    const device = await makeOwnerDevice(host, owner, devicePod);

    const token = await authorizePod(owner, host.agent.address, {
      scopes: ['pod.read:/notes/', 'pod.delete:/notes/'], pod: POD_ROOT,
    });
    expect((await deliverPodDelegation(device, host.agent.address, token)).ok).toBe(true);

    const podClient = host.store.getPodSource().podClient;

    // In-scope delete → the file is gone, via a real DEVICE DELETE.
    await podClient.delete(`${POD_ROOT}notes/gone.md`);
    expect(devicePod.store.has('/notes/gone.md')).toBe(false);
    expect(devicePod.calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/notes/gone.md'))).toBe(true);

    // Out-of-scope delete (/photos/) → denied by the device; the file survives, no device DELETE fired.
    let err;
    try { await podClient.delete(`${POD_ROOT}photos/keep.jpg`); }
    catch (e) { err = e; }
    expect(err).toBeDefined();
    expect(err.code).toBe('FORBIDDEN');
    expect(devicePod.store.has('/photos/keep.jpg')).toBe(true);
    expect(devicePod.calls.some((c) => c.method === 'DELETE' && c.url.includes('/photos/'))).toBe(false);
  }, 20_000);
});

/* ─────────────────────────────────────────────────────────────────────────── */

describe('companion-node R3.3 — agent-proxy SIZE CAP: the base64-over-WS safety floor (both directions, no silent truncation)', () => {
  const CAP = 64;                                  // tiny cap so tests need no MBs
  const OVERSIZE_MARKER = 'OVERSIZE-BODY-CONTENT-DO-NOT-LEAK';
  // A body comfortably over CAP that carries a marker we can scan for leaks.
  const OVERSIZE_BODY = `${OVERSIZE_MARKER}-${'x'.repeat(400)}`;

  it('RESPONSE OVER CAP: a GET whose body exceeds maxBodyBytes → distinct payload-too-large, NO truncated/partial bytes, no crash', async () => {
    const owner = await AgentIdentity.generate(new VaultMemory());
    const devicePod = makeDevicePod({
      secret: 'oidc-access-SECRET-respcap',
      files: [{ path: '/notes/big.md', body: OVERSIZE_BODY, contentType: 'text/markdown' }],
    });
    const host   = await bootProxyHost({ owner, container: 'notes/', maxBodyBytes: CAP });
    const device = await makeOwnerDevice(host, owner, devicePod, { maxBodyBytes: CAP });

    const token = await authorizePod(owner, host.agent.address, {
      scopes: ['pod.read:/notes/'], pod: POD_ROOT,
    });
    expect((await deliverPodDelegation(device, host.agent.address, token)).ok).toBe(true);

    const podClient = host.store.getPodSource().podClient;
    const target    = `${POD_ROOT}notes/big.md`;

    let caught;
    try { await podClient.read(target, { decode: 'string' }); }
    catch (err) { caught = err; }

    // Distinct oversized identity — NOT a generic failure, NOT device-unreachable.
    expect(caught).toBeDefined();
    expect(hasCauseCode(caught, 'payload-too-large')).toBe(true);
    expect(hasCauseCode(caught, 'device-unreachable')).toBe(false);
    // The device DID fetch (a real GET) then REFUSED — it saw the body over cap.
    expect(devicePod.calls.some((c) => c.method === 'GET' && c.url.endsWith('/notes/big.md'))).toBe(true);
    // NO partial/corrupt bytes surfaced: the oversized content never reaches the host.
    expect(JSON.stringify(caught, Object.getOwnPropertyNames(caught))).not.toContain(OVERSIZE_MARKER);
    expect(String(caught?.message ?? '')).not.toContain(OVERSIZE_MARKER);
    // The refused size/limit are reported so the caller knows exactly what was refused.
    const tooBig = causeWithCode(caught, 'payload-too-large');
    expect(tooBig.limit).toBe(CAP);
    expect(tooBig.size).toBeGreaterThan(CAP);
  }, 20_000);

  it('REQUEST OVER CAP: a PUT whose body exceeds maxBodyBytes → refused on the HOST before invoke; the device never received the write', async () => {
    const owner = await AgentIdentity.generate(new VaultMemory());
    const devicePod = makeDevicePod({ secret: 'oidc-access-SECRET-reqcap', files: [] });
    const host   = await bootProxyHost({ owner, container: 'notes/', maxBodyBytes: CAP });
    const device = await makeOwnerDevice(host, owner, devicePod, { maxBodyBytes: CAP });

    const token = await authorizePod(owner, host.agent.address, {
      scopes: ['pod.read:/notes/', 'pod.write:/notes/'], pod: POD_ROOT,
    });
    expect((await deliverPodDelegation(device, host.agent.address, token)).ok).toBe(true);

    const podClient = host.store.getPodSource().podClient;
    const target    = `${POD_ROOT}notes/toobig.md`;

    let caught;
    const spy = spyHostGlobalPodFetch();
    try { await podClient.write(target, OVERSIZE_BODY, { contentType: 'text/markdown' }); }
    catch (err) { caught = err; }
    finally { spy.restore(); }

    // Distinct oversized identity, refused on THIS side.
    expect(caught).toBeDefined();
    expect(hasCauseCode(caught, 'payload-too-large')).toBe(true);
    // The device NEVER received the write — no PUT/POST/PATCH for that path fired
    // (the giant frame was never shipped), and nothing landed in the pod.
    expect(devicePod.calls.some((c) => ['PUT', 'POST', 'PATCH'].includes(c.method) && c.url.endsWith('/notes/toobig.md'))).toBe(false);
    expect(devicePod.store.has('/notes/toobig.md')).toBe(false);
    // The host's own global fetch never touched the pod either.
    expect(spy.calls).toEqual([]);
  }, 20_000);

  it('WITHIN CAP still round-trips: a small write→read under the cap is unchanged (R3.0/R3.1 regression with the cap in place)', async () => {
    const owner = await AgentIdentity.generate(new VaultMemory());
    const devicePod = makeDevicePod({ secret: 'oidc-access-SECRET-undercap', files: [] });
    const host   = await bootProxyHost({ owner, container: 'notes/', maxBodyBytes: CAP });
    const device = await makeOwnerDevice(host, owner, devicePod, { maxBodyBytes: CAP });

    const token = await authorizePod(owner, host.agent.address, {
      scopes: ['pod.read:/notes/', 'pod.write:/notes/'], pod: POD_ROOT,
    });
    expect((await deliverPodDelegation(device, host.agent.address, token)).ok).toBe(true);

    const podClient = host.store.getPodSource().podClient;
    const target    = `${POD_ROOT}notes/tiny.md`;
    const TINY      = 'under the cap';               // < CAP bytes

    await podClient.write(target, TINY, { contentType: 'text/markdown' });
    const back = await podClient.read(target, { decode: 'string' });

    // Bytes round-trip intact — the cap does not touch under-cap payloads.
    expect(back.content).toBe(TINY);
    expect(decodeBytes(devicePod.store.get('/notes/tiny.md').body)).toBe(TINY);
    expect(devicePod.calls.some((c) => c.method === 'PUT' && c.url.endsWith('/notes/tiny.md'))).toBe(true);
  }, 20_000);

  it('ERROR DISTINCTNESS: device-unreachable vs payload-too-large vs FORBIDDEN are each a distinct, branchable code', async () => {
    const owner = await AgentIdentity.generate(new VaultMemory());
    const devicePod = makeDevicePod({
      secret: 'oidc-access-SECRET-distinct',
      files: [
        { path: '/notes/big.md',    body: OVERSIZE_BODY,  contentType: 'text/markdown' },
        { path: '/notes/small.md',  body: 'ok',           contentType: 'text/markdown' },
        { path: '/photos/secret.jpg', body: 'PRIVATE',    contentType: 'image/jpeg' },
      ],
    });
    // R3-advisory: pre-filter BYPASSED so the FORBIDDEN branch is proven
    // DEVICE-authoritative (the /photos/ read reaches the device and it denies) —
    // the payload-too-large and device-unreachable branches are in-scope and
    // reach the device regardless of the pre-filter.
    const host   = await bootProxyHost({ owner, container: 'notes/', maxBodyBytes: CAP, preFilter: false });
    const device = await makeOwnerDevice(host, owner, devicePod, { maxBodyBytes: CAP });

    // Read-only /notes/ grant: /photos/ is out of scope → FORBIDDEN.
    const token = await authorizePod(owner, host.agent.address, {
      scopes: ['pod.read:/notes/'], pod: POD_ROOT,
    });
    expect((await deliverPodDelegation(device, host.agent.address, token)).ok).toBe(true);
    const podClient = host.store.getPodSource().podClient;

    // (1) FORBIDDEN — out-of-scope read, device-authoritative opaque 403.
    let fErr;
    try { await podClient.read(`${POD_ROOT}photos/secret.jpg`, { decode: 'string' }); }
    catch (e) { fErr = e; }
    // (2) payload-too-large — in-scope but over the cap.
    let oErr;
    try { await podClient.read(`${POD_ROOT}notes/big.md`, { decode: 'string' }); }
    catch (e) { oErr = e; }

    // (3) device-unreachable — device offline.
    await device.stop();
    let uErr;
    try { await podClient.read(`${POD_ROOT}notes/small.md`, { decode: 'string' }); }
    catch (e) { uErr = e; }

    expect(fErr).toBeDefined();
    expect(oErr).toBeDefined();
    expect(uErr).toBeDefined();

    // Each carries ITS code and NEITHER of the other two — no conflation.
    expect(hasCauseCode(fErr, 'FORBIDDEN')).toBe(true);
    expect(hasCauseCode(fErr, 'payload-too-large')).toBe(false);
    expect(hasCauseCode(fErr, 'device-unreachable')).toBe(false);

    expect(hasCauseCode(oErr, 'payload-too-large')).toBe(true);
    expect(hasCauseCode(oErr, 'FORBIDDEN')).toBe(false);
    expect(hasCauseCode(oErr, 'device-unreachable')).toBe(false);

    expect(hasCauseCode(uErr, 'device-unreachable')).toBe(true);
    expect(hasCauseCode(uErr, 'payload-too-large')).toBe(false);
    expect(hasCauseCode(uErr, 'FORBIDDEN')).toBe(false);
  }, 25_000);
});

/* ─────────────────────────────────────────────────────────────────────────── */

describe('companion-node R3-advisory — host-side local scope pre-filter (advisory; device stays authoritative)', () => {
  // The advisory pre-filter re-adds R2b.1's `ScopedPodClient` in FRONT of the
  // agent-proxy `PodClient` (§R3 decision #4's deferred follow-up). It is a
  // latency optimization + defence-in-depth: an obviously out-of-scope request
  // is denied LOCALLY, without a relay round-trip. The DEVICE remains the sole
  // load-bearing authority (proven by the BYPASSED-pre-filter tests above and by
  // DEVICE STILL AUTHORITATIVE below). The two gates carry DISTINCT deny codes —
  // the local gate `POD_FORBIDDEN`, the device gate `FORBIDDEN` — so a local
  // deny can never be mistaken for a device-authoritative one.

  it('FAST LOCAL DENY: an out-of-scope read is denied BY THE HOST PRE-FILTER, with NO relay round-trip (device never invoked)', async () => {
    const owner = await AgentIdentity.generate(new VaultMemory());
    const devicePod = makeDevicePod({
      secret: 'oidc-access-SECRET-fastdeny',
      files: [{ path: '/photos/secret.jpg', body: 'PRIVATE-PHOTO-BYTES', contentType: 'image/jpeg' }],
    });
    // Host browses /photos/, grant only covers /notes/ — obviously out of scope.
    // Pre-filter DEFAULT ON (production default).
    const host   = await bootProxyHost({ owner, container: 'photos/' });
    const device = await makeOwnerDevice(host, owner, devicePod);

    const token = await authorizePod(owner, host.agent.address, {
      scopes: ['pod.read:/notes/'], pod: POD_ROOT,
    });
    expect((await deliverPodDelegation(device, host.agent.address, token)).ok).toBe(true);

    const podClient = host.store.getPodSource().podClient;

    const spy = spyProxyInvokes(host);
    let err;
    try { await podClient.read(`${POD_ROOT}photos/secret.jpg`, { decode: 'string' }); }
    catch (e) { err = e; }
    finally { spy.restore(); }

    // RESULT: denied at the LOCAL advisory gate — distinct POD_FORBIDDEN code
    // (NOT the device's FORBIDDEN), so we KNOW which gate fired.
    expect(err).toBeDefined();
    expect(err.code).toBe('POD_FORBIDDEN');
    expect(err.status).toBe(403);
    // THE OPTIMIZATION: no relay round-trip happened — the host never shipped a
    // `pod.proxyRequest` to the device (contrast DEVICE-AUTHORITATIVE DENY, where
    // the request DID reach the device). This is the latency win.
    expect(spy.calls.length).toBe(0);
    // The device was not touched AT ALL — its authenticated fetch never ran.
    expect(devicePod.calls.length).toBe(0);
    // Opaque: no content/path of the private resource leaks in the deny.
    expect(JSON.stringify(err, Object.getOwnPropertyNames(err))).not.toMatch(/PRIVATE-PHOTO-BYTES/);
  }, 20_000);

  it('DEVICE STILL AUTHORITATIVE: with the pre-filter BYPASSED, the SAME out-of-scope read round-trips and is denied BY THE DEVICE', async () => {
    const owner = await AgentIdentity.generate(new VaultMemory());
    const devicePod = makeDevicePod({
      secret: 'oidc-access-SECRET-defence',
      files: [{ path: '/photos/secret.jpg', body: 'PRIVATE-PHOTO-BYTES', contentType: 'image/jpeg' }],
    });
    // IDENTICAL scenario to FAST LOCAL DENY, but the advisory pre-filter is
    // BYPASSED — so the DEVICE is the ONLY gate. This proves the device remains
    // load-bearing: the pre-filter is defence-in-depth, never the sole authority.
    const host   = await bootProxyHost({ owner, container: 'photos/', preFilter: false });
    const device = await makeOwnerDevice(host, owner, devicePod);

    const token = await authorizePod(owner, host.agent.address, {
      scopes: ['pod.read:/notes/'], pod: POD_ROOT,
    });
    expect((await deliverPodDelegation(device, host.agent.address, token)).ok).toBe(true);

    const podClient = host.store.getPodSource().podClient;

    const spy = spyProxyInvokes(host);
    let err;
    try { await podClient.read(`${POD_ROOT}photos/secret.jpg`, { decode: 'string' }); }
    catch (e) { err = e; }
    finally { spy.restore(); }

    // RESULT: denied by the DEVICE — the device gate's FORBIDDEN (CapabilityError),
    // NOT the local POD_FORBIDDEN. The device is load-bearing.
    expect(err).toBeDefined();
    expect(hasCauseCode(err, 'FORBIDDEN')).toBe(true);
    expect(hasCauseCode(err, 'POD_FORBIDDEN')).toBe(false);
    // The request DID reach the device (a real relay round-trip) — contrast the
    // FAST LOCAL DENY above (zero invokes).
    expect(spy.calls.length).toBeGreaterThan(0);
    // …and the DEVICE denied BEFORE any fetch — its scope-check is authoritative.
    expect(devicePod.calls.some((c) => c.url.includes('/photos/'))).toBe(false);
    // Opaque still: nothing leaks.
    expect(JSON.stringify(err, Object.getOwnPropertyNames(err))).not.toMatch(/PRIVATE-PHOTO-BYTES/);
  }, 20_000);

  it('IN-SCOPE UNCHANGED: a normal write→read still round-trips through BOTH gates (pre-filter is advisory, not restrictive)', async () => {
    const owner = await AgentIdentity.generate(new VaultMemory());
    const devicePod = makeDevicePod({ secret: 'oidc-access-SECRET-inscope', files: [] });
    // Pre-filter DEFAULT ON.
    const host   = await bootProxyHost({ owner, container: 'notes/' });
    const device = await makeOwnerDevice(host, owner, devicePod);

    const token = await authorizePod(owner, host.agent.address, {
      scopes: ['pod.read:/notes/', 'pod.write:/notes/'], pod: POD_ROOT,
    });
    expect((await deliverPodDelegation(device, host.agent.address, token)).ok).toBe(true);

    const podClient = host.store.getPodSource().podClient;
    const target    = `${POD_ROOT}notes/hello.md`;
    const CONTENT   = '# Hello\n\nIn-scope through the advisory pre-filter AND the device.\n';

    const spy = spyProxyInvokes(host);
    let back;
    try {
      await podClient.write(target, CONTENT, { contentType: 'text/markdown' });
      back = await podClient.read(target, { decode: 'string' });
    } finally {
      spy.restore();
    }

    // RESULT: the pre-filter PASSED (in scope) and delegated — bytes round-trip.
    expect(back.content).toBe(CONTENT);
    // The request round-tripped through the DEVICE (advisory ALLOW does not
    // short-circuit): a real PUT + GET transited the device's authenticated fetch.
    expect(spy.calls.length).toBeGreaterThan(0);
    expect(devicePod.calls.some((c) => c.method === 'PUT' && c.url.endsWith('/notes/hello.md'))).toBe(true);
    expect(devicePod.calls.some((c) => c.method === 'GET' && c.url.endsWith('/notes/hello.md'))).toBe(true);
    expect(decodeBytes(devicePod.store.get('/notes/hello.md').body)).toBe(CONTENT);
  }, 20_000);
});

/** Walk an error's `.cause` chain looking for a specific `.code`. */
function hasCauseCode(err, code) {
  let e = err;
  const seen = new Set();
  while (e && !seen.has(e)) {
    seen.add(e);
    if (e.code === code) return true;
    e = e.cause;
  }
  return false;
}

/** Walk an error's `.cause` chain and return the first error with `.code === code`. */
function causeWithCode(err, code) {
  let e = err;
  const seen = new Set();
  while (e && !seen.has(e)) {
    seen.add(e);
    if (e.code === code) return e;
    e = e.cause;
  }
  return undefined;
}
