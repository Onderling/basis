/**
 * companion-node R3.2 — the agent-proxy boundary against a REAL Solid pod, with
 * a REAL on-device Solid-OIDC session (the last honesty gap in the R3 story).
 *
 * R3.0/R3.1 proved the agent-proxy network-adversary boundary HERMETICALLY: the
 * device's "authenticated fetch" was a MOCK over an in-memory pod, and its
 * "OIDC session / DPoP" were just a `secret` string the mock closed over. That
 * proved the WIRING (the host holds no secret; the device is the authoritative
 * scope check; every byte transits the device fetch) — but the claim "DPoP is
 * minted ON THE DEVICE, per request" was itself MOCKED.
 *
 * R3.2 replaces the mock with the genuine article:
 *   - The DEVICE runs a real `SolidVault` client-credentials OIDC session vs a
 *     Community Solid Server (the `sharing.css.test.js` / `SolidVault.css.test.js`
 *     pattern), and its `SolidOidcAuth.getAuthenticatedFetch()` — an Inrupt
 *     session fetch that mints a fresh DPoP proof per request — is injected as
 *     `registerPodProxy`'s `authFetch`. NOTHING in podProxy.js changes: it always
 *     took `authFetch` as a collaborator; R3.2 just feeds it the REAL one.
 *   - The HOST swaps to `PodClient({ auth: agent-proxy })` on delegation and
 *     lists + writes + reads a REAL resource in a REAL CSS scratch container —
 *     every pod HTTP request proxied back over a REAL relay to the device, whose
 *     real DPoP-signed fetch executes it against the CSS.
 *
 * What R3.2 proves that R3.0/R3.1 could not:
 *   (a) the resource GENUINELY lands on the CSS (read back both through the proxy
 *       AND directly with the device's own fetch — real bytes on a real server);
 *   (b) the DPoP is REAL, PER-REQUEST, and ON-DEVICE — captured off `globalThis.
 *       fetch` (the device session's only network egress; the host never fetches
 *       the pod), each proxied request carrying a distinct `DPoP` JWT + a `DPoP`
 *       (not `Bearer`) Authorization; corroborated by the fact that the session's
 *       bare access token, presented as a plain Bearer, is REJECTED by the CSS
 *       (⇒ the token is DPoP-bound ⇒ the successful requests carried a valid,
 *       on-device-minted proof);
 *   (c) the HOST holds NO credential — a deep scan of the host graph / its
 *       CapabilityAuth for the device's access/refresh-token material finds
 *       nothing; only the scoped capability token (a grant, not a secret);
 *   (d) an out-of-scope request is DENIED BY THE DEVICE before any fetch — now
 *       over a real network fetch, unchanged from R3.0/R3.1.
 *
 * GATE (sacred): skips cleanly when `CSS_URL` / client-credentials are unset —
 * EXACTLY like `sharing.css.test.js` — so CI (no CSS) stays green. Boot a CSS
 * and point this at it via the same env vars to run it for real:
 *   CSS_URL=… CSS_WEBID=… CSS_OIDC_ISSUER=… CSS_CLIENT_ID=… CSS_CLIENT_SECRET=… \
 *   npx vitest run test/companionAgentProxy.css.test.js
 * (or drive it end-to-end via packages/pod-client/scripts/css-sharing-harness.mjs's
 * account-provisioning shape.)
 *
 * R3.3 (streaming / size caps) is the only remaining R3 tail — NOT built here.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { AgentIdentity, Agent, Parts } from '@onderling/core';
import { VaultMemory }                 from '@onderling/vault';
import { RelayTransport }              from '@onderling/transports';

import { startCompanionNode }          from '../src/index.js';
import { buildDevPodSource }           from '../src/podSource.js';
import { authorizePod, deliverPodDelegation } from '../src/authorizePod.js';
import { registerPodProxy }            from '../src/podProxy.js';

/* ── the gate — identical shape to sharing.css.test.js (:39-41) ─────────────── */
const CSS_URL         = process.env.CSS_URL;
const HAVE_OIDC       = !!(process.env.CSS_CLIENT_ID && process.env.CSS_CLIENT_SECRET);
const SUITE           = CSS_URL && HAVE_OIDC ? describe : describe.skip;

const CSS_WEBID       = process.env.CSS_WEBID || (CSS_URL ? `${CSS_URL}profile/card#me` : undefined);
const CSS_OIDC_ISSUER = process.env.CSS_OIDC_ISSUER || CSS_URL;
const CSS_POD_ROOT    = process.env.CSS_POD_ROOT;
const CSS_SCRATCH     = process.env.CSS_SCRATCH ?? '';

/* Lazily imported (only when the gate is ON) — mirrors sharing.css.test.js :45-50.
 * SolidVault comes from @onderling/oidc-session via a RELATIVE path (the established
 * repo pattern — index.js reaches into apps/folio the same way — because
 * @onderling/oidc-session is not a declared dep of apps/companion-node, whereas
 * @onderling/pod-client is). */
let SolidVault, SolidOidcAuth, SolidPodSource, PodClient;

/* ── helpers ────────────────────────────────────────────────────────────────── */

/** Deep-scan an object graph for a substring (proves a secret is / isn't present). */
function graphContains(root, needle) {
  if (typeof needle !== 'string' || needle.length === 0) return false;
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
      if (typeof key === 'string' && key.includes(needle)) return true;
      try { stack.push(v[key]); } catch { /* getters may throw — ignore */ }
    }
  }
  return false;
}

/** Read a header off a Headers instance OR a plain object, case-insensitively. */
function headerGet(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === 'function') return headers.get(name) ?? undefined;
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (String(k).toLowerCase() === want) return v;
  }
  return undefined;
}

/** Invoke listFiles({source:'pod'}) on the host over the wire; return the reply. */
async function listPodOverWire(device, host) {
  return Parts.data(await device.invoke(host.agent.address, 'listFiles', { source: 'pod' }));
}

/* ─────────────────────────────────────────────────────────────────────────── */

SUITE('companion-node R3.2 — agent-proxy over a REAL CSS with a REAL on-device OIDC session', () => {
  const cleanups = [];

  // Shared, booted-once fixture (the CSS login is the expensive part).
  let owner;                 // the device identity (== pod owner)
  let deviceVault;           // the SolidVault's token store (on-device secret home)
  let sv;                    // the device's real SolidVault OIDC session
  let deviceAuthFetch;       // SolidOidcAuth.getAuthenticatedFetch() — the DPoP-minting fetch
  let deviceSource;          // a direct (non-proxied) SolidPodSource for provision/verify/cleanup
  let podRoot;               // the CSS pod root (token `pod`)
  let cssOrigin;             // origin of the CSS (to filter the fetch spy)

  let host, device;          // the companion host + the device agent (real relay)
  let podClient;             // the host's agent-proxy PodClient (swapped in on delegation)
  let scratchRel;            // pod-relative scratch container, e.g. 'companion-r32-<ts>/'
  let containerUri;          // absolute CSS scratch container URI
  let targetRel, targetUri;  // the canonical test resource (relative + absolute)
  const CONTENT = '# R3.2\n\nWritten THROUGH the agent-proxy, executed on-device via real DPoP.\n';

  beforeAll(async () => {
    if (!CSS_URL || !HAVE_OIDC) return;                       // gate OFF — nothing to boot
    ({ SolidVault }   = await import('../../../packages/oidc-session/index.js'));
    ({ SolidOidcAuth, SolidPodSource, PodClient } = await import('@onderling/pod-client'));

    // ── 1. the DEVICE's real Solid-OIDC session (client-credentials vs the CSS) ──
    //     Same pattern as sharing.css.test.js :57-68 / SolidVault.css.test.js :45-56.
    deviceVault = new VaultMemory();
    sv = new SolidVault({ webid: CSS_WEBID, oidcIssuer: CSS_OIDC_ISSUER, vault: deviceVault });
    await sv.login({
      clientId:     process.env.CSS_CLIENT_ID,
      clientSecret: process.env.CSS_CLIENT_SECRET,
    });
    // Pod root: prefer an explicit CSS_POD_ROOT, else CSS_URL (which the harness
    // convention sets to the owner's pod root, as sharing.css.test.js uses it),
    // else fall back to deriving it from the WebID profile.
    podRoot = CSS_POD_ROOT ?? CSS_URL ?? await sv.getPodRoot();
    if (!podRoot) throw new Error('R3.2: could not determine pod root (set CSS_POD_ROOT or CSS_URL, or ensure the WebID carries pim:storage)');
    if (!podRoot.endsWith('/')) podRoot += '/';
    cssOrigin = new URL(podRoot).origin;

    // The device presents its OIDC session via SolidOidcAuth — whose
    // getAuthenticatedFetch() already matches the (url, init) shape registerPodProxy
    // expects. NO adapter, and NO change to podProxy.js, is required: the device's
    // real DPoP-minting fetch drops straight into the mock's slot.
    deviceAuthFetch = new SolidOidcAuth({ vault: sv }).getAuthenticatedFetch();
    deviceSource    = new SolidPodSource({ podUrl: podRoot, fetch: deviceAuthFetch });

    // ── 2. provision an idempotent, unique CSS scratch container ────────────────
    scratchRel   = `${CSS_SCRATCH}companion-r32-${Date.now()}-${Math.random().toString(36).slice(2, 8)}/`;
    containerUri = `${podRoot}${scratchRel}`;
    targetRel    = `${scratchRel}r32.md`;
    targetUri    = `${podRoot}${targetRel}`;
    // Create the container (CSS honours PUT to a URI ending in '/' with a
    // BasicContainer type link). Idempotent: unique name per run.
    {
      const res = await deviceAuthFetch(containerUri, {
        method:  'PUT',
        headers: { 'content-type': 'text/turtle', link: '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"' },
      });
      if (!res.ok && res.status !== 205) {
        throw new Error(`R3.2: failed to provision scratch container ${containerUri}: ${res.status}`);
      }
    }
    cleanups.push(async () => {
      // Delete the resource first, then the (now-empty) container.
      try { await deviceAuthFetch(targetUri,    { method: 'DELETE' }); } catch { /* best-effort */ }
      try { await deviceAuthFetch(containerUri, { method: 'DELETE' }); } catch { /* best-effort */ }
    });

    // ── 3. boot the companion HOST (agent-proxy) + the DEVICE agent (real relay) ─
    owner = await AgentIdentity.generate(new VaultMemory());

    // The held pod source is IRRELEVANT under agent-proxy — it only supplies the
    // container URI the proxy PodClient browses. Point it at the CSS container.
    const heldPodSource = await buildDevPodSource({ podRoot, container: scratchRel, files: [] });
    host = await startCompanionNode({
      identityVault:  new VaultMemory(),
      gate:           false,                 // isolate the pod leg from the R2 skill gate
      podProxy:       true,                  // R3.0 agent-proxy swap on delegation
      // Bypass the host's advisory local pre-filter. It is DEFAULT-ON in production and denies an
      // out-of-scope request locally, with the deliberately distinct `POD_FORBIDDEN` — which is why
      // case (d) below read red: it asserts the DEVICE's `FORBIDDEN`, and the host was answering
      // first, so the proof it claims to make was not being made. The pre-filter is pure local
      // logic — no pod, no transport — and is proven in the hermetic twin, which bypasses here for
      // the same reason. What only THIS suite can prove is the device denying across a real relay
      // with a real DPoP fetch, so that is what it is composed to prove.
      podPreFilter:   false,
      podSource:      heldPodSource,         // supplies containerUri (= the CSS scratch container)
      podRoot,                               // token `pod` binding (acceptDelegation verify)
      podOwnerPubKey: owner.pubKey,          // trust root ⇒ fail-closed boot
    });
    cleanups.push(() => host.stop());

    device = new Agent({
      identity:  owner,
      transport: new RelayTransport({ relayUrl: host.relayUrl, identity: owner }),
      label:     'device',
    });
    await device.start();
    await device.hello(host.agent.address);
    // ── THE R3.2 SWAP: inject the REAL device DPoP-minting fetch (was a mock) ────
    registerPodProxy(device, {
      authFetch:           deviceAuthFetch,
      grantIssuerIdentity: owner,
      expectedHostPubKey:  host.agent.address,
    });
    cleanups.push(() => device.stop?.());

    // ── 4. delegate a scoped read+write grant for the CSS scratch container ─────
    const token = await authorizePod(owner, host.agent.address, {
      scopes: [`pod.read:/${scratchRel}`, `pod.write:/${scratchRel}`],
      pod:    podRoot,
    });
    const ack = await deliverPodDelegation(device, host.agent.address, token);
    expect(ack.ok).toBe(true);
    podClient = host.store.getPodSource().podClient;

    // ── 5. the canonical proxied WRITE (host → relay → device DPoP fetch → CSS) ──
    await podClient.write(targetUri, CONTENT, { contentType: 'text/markdown' });
  }, 120_000);

  afterAll(async () => {
    while (cleanups.length) {
      const fn = cleanups.pop();
      try { await fn(); } catch { /* best-effort */ }
    }
  });

  it('(a) the resource GENUINELY exists on the CSS — read back through the proxy AND directly by the device', async () => {
    // Read-back THROUGH the proxy (host → device DPoP fetch → CSS).
    const back = await podClient.read(targetUri, { decode: 'string' });
    expect(back.content).toBe(CONTENT);

    // Read-back DIRECTLY with the device's own fetch, bypassing the host entirely —
    // proves the bytes truly persisted on the CSS, not merely round-tripped through
    // the proxy's Response reconstruction.
    const direct = await deviceSource.read(targetRel);
    expect(new TextDecoder().decode(direct.content)).toBe(CONTENT);

    // …and the resource is visible LISTING the container OVER THE WIRE.
    const listed = await listPodOverWire(device, host);
    expect(listed.error).toBeUndefined();
    expect(listed.source).toBe('pod');
    expect(listed.items.some((i) => i.name === 'r32.md')).toBe(true);
  }, 60_000);

  it('(b) DPoP is REAL, PER-REQUEST, and ON-DEVICE — distinct DPoP JWT per proxied request; bare Bearer is rejected', async () => {
    // Spy on the ONLY network egress the device session uses (globalThis.fetch —
    // confirmed: Inrupt authn-node client-credentials builds its DPoP fetch over
    // the global fetch, with no injected fetch). The host NEVER fetches the pod
    // (agent-proxy → relay), so every captured CSS request is the DEVICE's.
    const realFetch = globalThis.fetch;
    const captured  = [];
    globalThis.fetch = async (input, init) => {
      const u = typeof input === 'string' ? input : (input?.url ?? String(input));
      if (typeof u === 'string' && u.startsWith(cssOrigin)) {
        captured.push({
          url:    u,
          method: String(init?.method || 'GET').toUpperCase(),
          dpop:   headerGet(init?.headers, 'dpop'),
          authz:  headerGet(init?.headers, 'authorization'),
        });
      }
      return realFetch(input, init);
    };

    let accessToken;
    try {
      // Two proxied reads → two independent pod requests through the device fetch.
      await podClient.read(targetUri, { decode: 'string' });
      await podClient.read(targetUri, { decode: 'string' });

      // The device's raw access token lives ONLY on-device (its SolidVault store).
      accessToken = await deviceVault.get(`solid-oidc:${CSS_WEBID}:access_token`);
    } finally {
      globalThis.fetch = realFetch;
    }

    // Captured requests to the target resource, executed by the device session.
    const hits = captured.filter((c) => c.url === targetUri || c.url.startsWith(targetUri));
    expect(hits.length).toBeGreaterThanOrEqual(2);
    // REAL DPoP: every request carries a non-empty DPoP JWT header AND a
    // `DPoP`-scheme Authorization (never a bare Bearer).
    for (const h of hits) {
      expect(typeof h.dpop).toBe('string');
      expect(h.dpop.length).toBeGreaterThan(0);
      expect(String(h.authz || '')).toMatch(/^DPoP /);
    }
    // PER-REQUEST: each proxied request minted a FRESH proof (distinct jti/htu ⇒
    // distinct header string) — not one reused token.
    expect(new Set(hits.map((h) => h.dpop)).size).toBeGreaterThanOrEqual(2);

    // BEARER-ALONE-REJECTED: the very same access token, presented as a plain
    // Bearer with NO DPoP proof, is refused by the CSS (401/403) — i.e. the token
    // is DPoP-BOUND, so the successful proxied requests above necessarily carried
    // a valid, on-device-minted DPoP proof. (A bare bearer could never have
    // succeeded.)
    expect(typeof accessToken).toBe('string');
    expect(accessToken.length).toBeGreaterThan(0);
    const bare = await realFetch(targetUri, { headers: { authorization: `Bearer ${accessToken}` } });
    expect([401, 403]).toContain(bare.status);
  }, 60_000);

  it('(c) the HOST holds NO credential — no access/refresh-token material anywhere in its graph, only the scoped grant', async () => {
    const accessToken  = await deviceVault.get(`solid-oidc:${CSS_WEBID}:access_token`);
    const refreshToken = await deviceVault.get(`solid-oidc:${CSS_WEBID}:refresh_token`);
    expect(typeof accessToken).toBe('string');   // sanity: the secret DOES exist — on the DEVICE

    // The device's OIDC secrets exist ONLY on the device — nowhere in the host's
    // boot graph or its (agent-proxy) pod client.
    expect(graphContains(host, accessToken)).toBe(false);
    expect(graphContains(podClient, accessToken)).toBe(false);
    if (typeof refreshToken === 'string' && refreshToken.length > 0) {
      expect(graphContains(host, refreshToken)).toBe(false);
      expect(graphContains(podClient, refreshToken)).toBe(false);
    }

    // The ONLY credential-shaped thing the host holds is the signed capability
    // token — a SCOPED GRANT (issuer/subject/pod/scopes/sig), not a pod secret:
    // it carries no access-token / DPoP / refresh material.
    const wire = (await authorizePod(owner, host.agent.address, {
      scopes: [`pod.read:/${scratchRel}`], pod: podRoot,
    })).toJSON();
    expect(wire.issuer).toBe(owner.pubKey);
    expect(wire.subject).toBe(host.agent.address);
    for (const forbidden of ['accessToken', 'access_token', 'dpop', 'dpopKey', 'idToken', 'id_token', 'refreshToken', 'refresh_token', 'privateKey']) {
      expect(Object.prototype.hasOwnProperty.call(wire, forbidden)).toBe(false);
    }
    // Belt-and-braces: the delegation the host installed doesn't smuggle the secret.
    expect(graphContains(wire, accessToken)).toBe(false);
  }, 60_000);

  it('(d) an OUT-OF-SCOPE request is DENIED BY THE DEVICE before any fetch — over the real fetch', async () => {
    // A sibling container NOT covered by the grant (same pod, different path).
    const outContainer = `${podRoot}${CSS_SCRATCH}companion-r32-OUTOFSCOPE-${Date.now()}/`;
    const outUri       = `${outContainer}secret.md`;

    const realFetch = globalThis.fetch;
    const cssHits   = [];
    globalThis.fetch = async (input, init) => {
      const u = typeof input === 'string' ? input : (input?.url ?? String(input));
      if (typeof u === 'string' && u.includes('companion-r32-OUTOFSCOPE')) cssHits.push(u);
      return realFetch(input, init);
    };

    let readErr, writeErr;
    try {
      try { await podClient.read(outUri, { decode: 'string' }); }
      catch (e) { readErr = e; }
      try { await podClient.write(outUri, 'EVIL', { contentType: 'text/markdown' }); }
      catch (e) { writeErr = e; }
    } finally {
      globalThis.fetch = realFetch;
    }

    // Denied by the DEVICE — opaque 403 → FORBIDDEN (CapabilityError), for both read and write.
    // Distinct from the host pre-filter's POD_FORBIDDEN, so a host-side deny can never be mistaken
    // for the device-authoritative one this case exists to prove.
    expect(readErr?.code).toBe('FORBIDDEN');
    expect(writeErr?.code).toBe('FORBIDDEN');

    // DEVICE-AUTHORITATIVE: the scope-check fired BEFORE any fetch — the device's
    // real DPoP fetch NEVER touched the out-of-scope path (no CSS request made).
    expect(cssHits).toEqual([]);

    // And nothing was created on the CSS (a direct device read finds nothing).
    let existsErr;
    try { await deviceSource.read(`${CSS_SCRATCH}companion-r32-OUTOFSCOPE-does-not-exist.md`); }
    catch (e) { existsErr = e; }
    expect(existsErr).toBeDefined();
  }, 60_000);
});
