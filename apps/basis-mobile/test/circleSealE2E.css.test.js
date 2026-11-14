/**
 * E2E: sign-in → real-pod seal (mobile auth path, against a running CSS).
 *
 * The FULL chain a signed-in mobile user exercises, end to end:
 *   OidcSessionRN.adoptTokens(token)  →  getAuthenticatedFetch (bearer)  →  realPodRouting
 *   →  createCirclePodProducer over the REAL pod  →  seal content + grow the roster.
 * The only non-interactive substitution is the TOKEN: client-credentials (CSS issues a
 * BEARER token — verified) instead of the interactive sign-in REDIRECT (which needs a real
 * IdP,). Everything downstream — the session's authenticated fetch, the routing, the
 * producer, the sealing — is the real code path.
 *
 * Gated on `CSS_URL` + client-credentials (skips clean otherwise). Provision with
 * `../feedback/scripts/bootstrap-owner.js (the onderling-feedback repo)`.
 */
import { describe, it, expect, beforeAll } from 'vitest';

const CSS_URL = process.env.CSS_URL;
const HAVE = !!(CSS_URL && process.env.CSS_CLIENT_ID && process.env.CSS_CLIENT_SECRET && process.env.CSS_WEBID);
const SUITE = HAVE ? describe : describe.skip;

let OidcSessionRN, generateKeypair, createCirclePodProducer, createCircleControlAgentRouter, seedCircleRoster;
let setCirclePodSession, getActiveRealPodRouting;

beforeAll(async () => {
  if (!HAVE) return;
  ({ OidcSessionRN } = await import('@onderling/oidc-session-rn'));
  ({ generateKeypair } = await import('@onderling/pod-client'));
  ({ createCirclePodProducer, createCircleControlAgentRouter, seedCircleRoster } =
    await import('../../basis/src/v2/circlePodProducer.js'));
  ({ setCirclePodSession, getActiveRealPodRouting } = await import('../src/core/circlePods.js'));
});

/** A client-credentials BEARER token from CSS (no DPoP) — what adoptTokens stores. */
async function cssBearerToken() {
  const base = CSS_URL.replace(/\/$/, '');
  const oidc = await (await fetch(`${base}/.well-known/openid-configuration`)).json();
  const basic = Buffer.from(`${encodeURIComponent(process.env.CSS_CLIENT_ID)}:${encodeURIComponent(process.env.CSS_CLIENT_SECRET)}`).toString('base64');
  const res = await fetch(oidc.token_endpoint, {
    method: 'POST',
    headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials&scope=webid',
  });
  const tok = await res.json();
  if (!tok.access_token) throw new Error(`no token: ${JSON.stringify(tok).slice(0, 200)}`);
  return tok.access_token;
}

function memStore() {
  const m = new Map();
  return {
    getItemAsync: async (k) => (m.has(k) ? m.get(k) : null),
    setItemAsync: async (k, v) => { m.set(k, String(v)); },
    deleteItemAsync: async (k) => { m.delete(k); },
  };
}

class MemVault {
  #m = new Map();
  async get(k) { return this.#m.get(k); }
  async set(k, v) { this.#m.set(k, String(v)); }
}

SUITE('e2e: mobile sign-in → real-pod seal (CSS)', () => {
  it('a signed-in OidcSessionRN routes a sealed circle to the real pod; seeded member decrypts', async () => {
    // 1) "sign in" — adopt a real CSS bearer token into the real OidcSessionRN
    const session = new OidcSessionRN({ store: memStore(), appId: 'e2e' });
    await session.adoptTokens({ accessToken: await cssBearerToken(), webid: process.env.CSS_WEBID });
    expect(session.isAuthenticated()).toBe(true);

    // 2) share it → real-pod routing comes from the session's authenticated fetch
    setCirclePodSession({ current: session });
    const routing = getActiveRealPodRouting();
    expect(routing).toBeTruthy();
    expect(routing.podRoot).toBe(process.env.CSS_WEBID.replace(/profile\/card#me$/, ''));

    // 3) a p2 circle producer over the REAL pod (via the session fetch)
    const circleId = `e2e-${generateKeypair().publicKey.replace(/[^a-zA-Z0-9]/g, '').slice(-10)}`;
    const prod = await createCirclePodProducer({
      circleId, storagePosture: 'p2', vault: new MemVault(), generateKeypair,
      sealingKeyPair: generateKeypair(),   // the device's per-circle key pair, as the app's agent hands it
      makePodClient: routing.makePodClient, circleRootUri: routing.circleRootUri(circleId),
    });
    expect(prod.controlAgent).not.toBeNull();

    // 4) seal content on the real pod, and seed a prior member who can then decrypt
    const self = await prod.sealingIdentity.ensure();
    const sealed = (await prod.controlAgent.sealingStrategy(self.privateKey)).seal('e2e — op een echte pod, ingelogd');
    const bob = generateKeypair();
    const pods = new Map([[circleId, prod]]);
    const router = createCircleControlAgentRouter((id) => pods.get(id) ?? null);
    const callSkill = async (app, op) => (op === 'listGroupMembers'
      ? { members: [{ webid: 'did:bob', sealingPublicKey: bob.publicKey, role: 'member' }] } : {});
    expect(await seedCircleRoster({ callSkill, circleId, router })).toBe(1);
    expect((await prod.controlAgent.sealingStrategy(bob.privateKey)).open(sealed)).toBe('e2e — op een echte pod, ingelogd');

    setCirclePodSession(null);
  }, 60_000);
});
