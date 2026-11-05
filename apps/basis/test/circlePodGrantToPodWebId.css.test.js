/**
 * A circle member is named on the roster by a roster ref (their circle address), not a Solid WebID. The group key is
 * wrapped to that ref's sealing key; the pod read grant has to name the WebID the member's pod session signs in as, or
 * the pod refuses them however correct the wrap is. This proves, on a real ACP server with two separate accounts:
 *   - before the join the member is refused (403);
 *   - joined with their pod WebID (`podAgent`), they read the circle's item with their OWN session;
 *   - the owner's device reloads (a fresh producer over the same vault, the roster re-seeded WITHOUT the WebID) and then
 *     removes the member: the grant it revokes is still the WebID, so the member is refused again.
 *
 * Gated like circlePod2Pod: CSS_URL + CSS_A_* (owner) + CSS_B_* (member). `node scripts/run-integration.mjs --provision
 * --only=circlePodGrantToPodWebId` boots an ACP server and mints both.
 */
import { describe, it, expect, beforeAll } from 'vitest';

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

const refused = async (client, uri) => {
  try { await client.read(uri, { decode: 'string' }); return false; } catch { return true; }
};

SUITE('a circle member reads the pod with the WebID they joined with (CSS, ACP)', () => {
  const aliceBase = (process.env.CSS_A_ROOT || `${CSS_URL}alice/circles`).replace(/\/$/, '');

  it('refused before, reads after, refused after the owner reloads and removes them', async () => {
    const alice = await authFor({ clientId: process.env.CSS_A_CLIENT_ID, clientSecret: process.env.CSS_A_CLIENT_SECRET, webid: process.env.CSS_A_WEBID });
    const ben = await authFor({ clientId: process.env.CSS_B_CLIENT_ID, clientSecret: process.env.CSS_B_CLIENT_SECRET, webid: process.env.CSS_B_WEBID });

    const circleId = `pw-${generateKeypair().publicKey.replace(/[^a-zA-Z0-9]/g, '').slice(-12)}`;
    const circleRootUri = `${aliceBase}/${circleId}`;
    const vault = new MemVault();   // the owner device's vault: survives the reload below
    const build = () => createCirclePodProducer({
      circleId, storagePosture: 'p2', vault, generateKeypair,
      makePodClient: () => alice.client, circleRootUri,
      sharing: createCirclePodSharing({ fetch: alice.fetch, ownerWebId: alice.webid }),
    });
    const prod = await build();
    const self = await prod.sealingIdentity.ensure();
    const itemUri = `${circleRootUri}/items/note.json`;
    const sealed0 = (await prod.controlAgent.sealingStrategy(self.privateKey)).seal('alleen voor de kring');
    await alice.client.write(itemUri, JSON.stringify({ sealed: sealed0 }), { contentType: 'application/json' });

    const benKey = generateKeypair();
    const ref = `circle-address-of-ben-${circleId}`;    // what the roster names him by: no pod session holds it
    expect(await refused(ben.client, itemUri)).toBe(true);

    const router = createCircleControlAgentRouter((id) => (id === circleId ? current : null));
    let current = prod;
    await router.addMember({ webId: ref, publicKey: benKey.publicKey, role: 'member', groupId: circleId, podAgent: ben.webid });

    const benRead = await ben.client.read(itemUri, { decode: 'string' });
    const benText = typeof benRead === 'string' ? benRead : benRead?.content;
    expect(benText).toBeTruthy();
    const opened = (await prod.controlAgent.sealingStrategy(benKey.privateKey)).open(JSON.parse(benText).sealed);
    expect(opened).toBe('alleen voor de kring');

    // the owner's device reloads: a fresh producer over the same vault, the roster seeded as at boot (no WebID)
    current = await build();
    await router.addMember({ webId: ref, publicKey: benKey.publicKey, role: 'member', groupId: circleId });
    await router.removeMember({ webId: ref, groupId: circleId });
    expect(await refused(ben.client, itemUri)).toBe(true);
  }, 120_000);
});
