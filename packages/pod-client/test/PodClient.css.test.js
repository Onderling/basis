/**
 * CSS integration test for PodClient.
 *
 * Requires a running Community Solid Server.  Gated on `process.env.CSS_URL`
 * (e.g. `http://localhost:3000/`); skips otherwise.
 *
 * For the OIDC path, additionally requires `CSS_CLIENT_ID` + `CSS_CLIENT_SECRET`
 * (a client-credentials pair from CSS's `/idp/credentials/`).
 *
 * For the capability-token path, no extra env is needed — the test mints a
 * fresh `PodCapabilityToken` from a generated `AgentIdentity`.
 */
import { describe, it, expect, beforeAll } from 'vitest';

const CSS_URL = process.env.CSS_URL;
const SUITE   = CSS_URL ? describe : describe.skip;

// Dynamically resolve the auth concretes so the file evaluates even if
// A5b1 hasn't merged in some weird state.  We never actually run if !CSS_URL.
let CapabilityAuth, SolidOidcAuth, PodClient, AgentIdentity, VaultMemory, PodCapabilityToken, SolidVault;

beforeAll(async () => {
  if (!CSS_URL) return;
  ({ PodClient, CapabilityAuth, SolidOidcAuth } = await import('../src/index.js'));
  ({ AgentIdentity, PodCapabilityToken } = await import('@onderling/core'));
  ({ VaultMemory } = await import('@onderling/vault'));
  ({ SolidVault } = await import('@onderling/oidc-session'));
});

SUITE('PodClient — CSS integration', () => {
  const scratch = process.env.CSS_SCRATCH || 'scratch/';

  it('round-trips read/write/list with CapabilityAuth', async () => {
    const vault    = new VaultMemory();
    const issuer   = await AgentIdentity.generate(vault);
    const subject  = await AgentIdentity.generate(new VaultMemory());

    const token = await PodCapabilityToken.issue(issuer, {
      subject:   subject.pubKey,
      pod:       CSS_URL,
      scopes:    [`pod.*:/${scratch}`],
      expiresIn: 60_000,
    });

    const auth   = new CapabilityAuth({ token: token.toString(), mode: 'pod-direct' });
    const client = new PodClient({ podRoot: CSS_URL, auth });

    const uri = `${CSS_URL}${scratch}cap-${Date.now()}.txt`;
    await client.write(uri, 'hello-cap', { contentType: 'text/plain', force: true });
    const r = await client.read(uri, { decode: 'string' });
    expect(r.content).toBe('hello-cap');
    await client.delete(uri);
  });

  it('round-trips read/write with SolidOidcAuth (skips if CSS_CLIENT_ID is missing)', async () => {
    if (!process.env.CSS_CLIENT_ID || !process.env.CSS_CLIENT_SECRET) return;

    const vault = new VaultMemory();
    const sv = new SolidVault({ webid: process.env.CSS_WEBID || `${CSS_URL}profile/card#me`, vault });
    await sv.login({
      clientId:     process.env.CSS_CLIENT_ID,
      clientSecret: process.env.CSS_CLIENT_SECRET,
      oidcIssuer:   process.env.CSS_OIDC_ISSUER || CSS_URL,
    });

    const auth   = new SolidOidcAuth({ vault: sv });
    const client = new PodClient({ podRoot: CSS_URL, auth });

    const uri = `${CSS_URL}${scratch}oidc-${Date.now()}.txt`;
    await client.write(uri, 'hello-oidc', { contentType: 'text/plain', force: true });
    const r = await client.read(uri, { decode: 'string' });
    expect(r.content).toBe('hello-oidc');
    await client.delete(uri);
    await client.close();
  });

  // L936 (a): a real pod answers a PUT with no ETag, so a client remembers what it WROTE and checks it at its next default
  // write. Two clients with their own memory (two devices): A's own second write goes through; after B writes, A's next
  // default write is a ConflictError and B's change stays.
  it('after a write, the next default write builds on what this client wrote, or refuses (skips without CSS_CLIENT_ID)', async () => {
    if (!process.env.CSS_CLIENT_ID || !process.env.CSS_CLIENT_SECRET) return;
    const login = async () => {
      const sv = new SolidVault({ webid: process.env.CSS_WEBID || `${CSS_URL}profile/card#me`, vault: new VaultMemory() });
      await sv.login({ clientId: process.env.CSS_CLIENT_ID, clientSecret: process.env.CSS_CLIENT_SECRET, oidcIssuer: process.env.CSS_OIDC_ISSUER || CSS_URL });
      return new PodClient({ podRoot: CSS_URL, auth: new SolidOidcAuth({ vault: sv }) });
    };
    const [a, b] = [await login(), await login()];
    const uri = `${CSS_URL}${scratch}written-${Date.now()}.txt`;
    await a.write(uri, 'a-1', { contentType: 'text/plain' });
    await a.write(uri, 'a-2', { contentType: 'text/plain' });
    await a.write(uri, 'a-3', { contentType: 'text/plain' });          // its own third write: no 412 on its own change (the old client sent the ETag from before its second write)
    expect((await b.read(uri, { decode: 'string' })).content).toBe('a-3');
    await b.write(uri, 'b-1', { contentType: 'text/plain' });          // another device writes (it read first)
    await expect(a.write(uri, 'a-5', { contentType: 'text/plain' })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await b.read(uri, { decode: 'string' })).content, 'B\'s change stays').toBe('b-1');
    await a.read(uri);                                                  // A reads, then its write builds on that read
    await a.write(uri, 'a-4', { contentType: 'text/plain' });
    expect((await b.read(uri, { decode: 'string' })).content).toBe('a-4');
    await a.delete(uri, { force: true });
    await a.close(); await b.close();
  });
});
