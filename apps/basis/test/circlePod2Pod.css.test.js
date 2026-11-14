/**
 * ≥2-POD cross-device/cross-identity acceptance for the per-circle producer (the
 * "true acceptance" the roadmap flagged as device-gated). Two SEPARATE real-pod
 * identities on a running CSS:
 *   - ALICE owns the circle's pod (creates it, seals content, runs the producer).
 *   - BEN is a SECOND account with its OWN pod + OWN OIDC identity, added to the
 *     circle roster.
 *
 * Proves two distinct things:
 *   (1) CRYPTO membership across pods — content alice seals on her pod can be
 *       OPENED with ben's key once the router wraps the group key to him. (This is
 *       the cryptographic half; transport-independent.)
 *   (2) CROSS-IDENTITY POD READ — can ben, authenticated as HIMSELF, fetch the
 *       circle resources off alice's pod? This is what a real multi-device circle
 *       needs (each member reads the shared pod with their own credentials), and it
 *       depends on the producer wiring a REAL ACL `sharing` (grant ACP to the
 *       member's webid). The producer defaults `sharing` to a no-op, so this test
 *       MEASURES the result rather than assuming it — documenting exactly where the
 *       cross-identity boundary is today.
 *
 * Gated on TWO sets of client-credentials (alice + ben) + CSS_URL. Skips clean
 * otherwise. Provision both with ../feedback/scripts/bootstrap-owner.js (the onderling-feedback repo)
 * (POD_NAME=alice, then POD_NAME=ben). Run:
 *   CSS_URL=http://localhost:3000/ \
 *   CSS_A_CLIENT_ID=… CSS_A_CLIENT_SECRET=… CSS_A_WEBID=…/ann/profile/card#me \
 *   CSS_B_CLIENT_ID=… CSS_B_CLIENT_SECRET=… CSS_B_WEBID=…/ben/profile/card#me \
 *   npx vitest run test/circlePod2Pod.css.test.js
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { produceWithPair } from './support/deviceSealingKeyPair.js';

const CSS_URL = process.env.CSS_URL;
const HAVE_A = !!(process.env.CSS_A_CLIENT_ID && process.env.CSS_A_CLIENT_SECRET && process.env.CSS_A_WEBID);
const HAVE_B = !!(process.env.CSS_B_CLIENT_ID && process.env.CSS_B_CLIENT_SECRET && process.env.CSS_B_WEBID);
const SUITE = CSS_URL && HAVE_A && HAVE_B ? describe : describe.skip;

let PodClient, SolidOidcAuth, generateKeypair, SolidVault, VaultMemory;
let createCirclePodProducer, createCircleControlAgentRouter, createCirclePodSharing;

beforeAll(async () => {
  if (!(CSS_URL && HAVE_A && HAVE_B)) return;
  ({ PodClient, SolidOidcAuth, generateKeypair } = await import('@onderling/pod-client'));
  ({ VaultMemory } = await import('@onderling/vault'));
  ({ SolidVault } = await import('@onderling/oidc-session'));
  ({ createCirclePodProducer, createCircleControlAgentRouter } = await import('../src/v2/circlePodProducer.js'));
  ({ createCirclePodSharing } = await import('../src/v2/circlePodSharing.js'));
});

class MemVault {
  #m = new Map();
  async get(k) { return this.#m.get(k); }
  async set(k, v) { this.#m.set(k, String(v)); }
  async delete(k) { this.#m.delete(k); }
  async has(k) { return this.#m.has(k); }
}

async function authFor({ clientId, clientSecret, webid }) {
  const vault = new VaultMemory();
  const sv = new SolidVault({ webid, vault });
  await sv.login({ clientId, clientSecret, oidcIssuer: process.env.CSS_OIDC_ISSUER || CSS_URL });
  const auth = new SolidOidcAuth({ vault: sv });
  return { client: new PodClient({ podRoot: CSS_URL, auth }), fetch: auth.getAuthenticatedFetch(), webid };
}

SUITE('per-circle producer — ≥2-pod cross-identity (CSS)', () => {
  const aliceBase = (process.env.CSS_A_ROOT || `${CSS_URL}alice/circles`).replace(/\/$/, '');

  it('crypto membership crosses pods AND a member reads the circle pod with their OWN auth (real ACP grant)', async () => {
    const alice = await authFor({
      clientId: process.env.CSS_A_CLIENT_ID, clientSecret: process.env.CSS_A_CLIENT_SECRET, webid: process.env.CSS_A_WEBID,
    });
    const ben = await authFor({
      clientId: process.env.CSS_B_CLIENT_ID, clientSecret: process.env.CSS_B_CLIENT_SECRET, webid: process.env.CSS_B_WEBID,
    });

    const circleId = `xp-${generateKeypair().publicKey.replace(/[^a-zA-Z0-9]/g, '').slice(-12)}`;
    const circleRootUri = `${aliceBase}/${circleId}`;

    // ALICE: per-circle producer on HER real pod (p2 sealed), wired with a REAL WAC
    // `sharing` over her authenticated fetch (no more no-op) → addMember grants ACP.
    const sharing = createCirclePodSharing({ fetch: alice.fetch, ownerWebId: alice.webid });
    const prod = await produceWithPair({
      circleId, storagePosture: 'p2', vault: new MemVault(),
      generateKeypair,
      makePodClient: () => alice.client,
      circleRootUri,
      sharing,
    });
    expect(prod.controlAgent).not.toBeNull();

    const benKey = generateKeypair();           // ben's sealing keypair (his device identity)
    const self = await prod.sealingIdentity.ensure();

    // BEFORE joining: ben can't open. The router both (a) wraps the group key to ben
    // AND (b) grants ben ACP read on the whole circle container.
    await expect(prod.controlAgent.sealingStrategy(benKey.privateKey)).rejects.toThrow();
    const router = createCircleControlAgentRouter((id) => (id === circleId ? prod : null));
    await router.addMember({ webId: ben.webid, publicKey: benKey.publicKey, role: 'member', groupId: circleId });

    // (1) CRYPTO membership across pods: ben decrypts content alice sealed on her pod.
    const sealed = (await prod.controlAgent.sealingStrategy(self.privateKey)).seal('over twee pods heen');
    expect((await prod.controlAgent.sealingStrategy(benKey.privateKey)).open(sealed)).toBe('over twee pods heen');

    // Alice persists a sealed item under the circle root (now a member-readable container).
    const itemUri = `${circleRootUri}/items/note.json`;
    await alice.client.write(itemUri, JSON.stringify({ sealed }), { contentType: 'application/json' });

    // (2) CROSS-IDENTITY POD READ: BEN, authenticated as HIMSELF, reads the item off
    // ALICE's pod — the true multi-device path. With the real ACP grant this now works.
    const benRead = await ben.client.read(itemUri, { decode: 'string' });
    const benText = typeof benRead === 'string' ? benRead : benRead?.content;
    expect(benText).toBeTruthy();                                   // ✓ 200, not 403
    const fetchedSealed = JSON.parse(benText).sealed;
    const reopened = (await prod.controlAgent.sealingStrategy(benKey.privateKey)).open(fetchedSealed);
    expect(reopened).toBe('over twee pods heen');                  // ✓ ben fetched + decrypted off alice's pod

    // (3) FORWARD SECRECY at the ACL layer: after leave, ben's read is revoked.
    await router.removeMember({ webId: ben.webid, groupId: circleId });
    let revokedDenied = false;
    try { await ben.client.read(itemUri, { decode: 'string' }); }
    catch { revokedDenied = true; }
    expect(revokedDenied).toBe(true);                              // ✓ removed member can no longer read
  }, 120_000);
});
