/**
 * TWO WRITERS, ONE KEY FILE, A REAL POD. Two instances of the founder's device (two tabs, or the page before and after a
 * reload) each hold the circle's control agent over the same `.keys/group.json` on a Community Solid Server, and each
 * adds a different member at the same moment. Both members must end up holding the key. Before, each wrote the file as
 * it had read it: one write won and the other member silently lost the key, or the loser hit a 412 and the change was
 * dropped. The walk saw exactly that 412 on the founder's page ('enrolling a device … 412 Precondition Failed').
 *
 * Runs in the `*.css.test.js` tier (`node scripts/run-integration.mjs --provision --only=circleKeyFileRace`).
 */
import { describe, it, expect, beforeAll } from 'vitest';

const CSS_URL = process.env.CSS_URL;
const HAVE_OIDC = !!(process.env.CSS_CLIENT_ID && process.env.CSS_CLIENT_SECRET);
const SUITE = CSS_URL && HAVE_OIDC ? describe : describe.skip;

let PodClient, SolidOidcAuth, generateKeypair, unwrapGroupKey, VaultMemory, SolidVault, createCircleControlAgent;

beforeAll(async () => {
  if (!CSS_URL || !HAVE_OIDC) return;
  ({ PodClient, SolidOidcAuth, generateKeypair, unwrapGroupKey } = await import('@onderling/pod-client'));
  ({ VaultMemory } = await import('@onderling/vault'));
  ({ SolidVault } = await import('@onderling/oidc-session'));
  ({ createCircleControlAgent } = await import('../src/v2/circleControlAgent.js'));
});

SUITE('the circle key file under two writers on a real pod (CSS)', () => {
  const podBase = (process.env.CSS_CIRCLE_ROOT || `${CSS_URL}circles`).replace(/\/$/, '');

  /** An authenticated PodClient with its OWN ETag memory, as each tab or device has. */
  async function makeRealPodClient() {
    const sv = new SolidVault({ webid: process.env.CSS_WEBID || `${CSS_URL}profile/card#me`, vault: new VaultMemory() });
    await sv.login({ clientId: process.env.CSS_CLIENT_ID, clientSecret: process.env.CSS_CLIENT_SECRET, oidcIssuer: process.env.CSS_OIDC_ISSUER || CSS_URL });
    return new PodClient({ podRoot: CSS_URL, auth: new SolidOidcAuth({ vault: sv }) });
  }
  const noAcl = { grant: async () => {}, revoke: async () => {} };   // this test is about the key file, not the ACL
  const opens = (res, priv) => { try { unwrapGroupKey(res, priv); return true; } catch { return false; } };

  it('two members added at the same moment by two instances of the founder both hold the key', async () => {
    const circleId = `race-${generateKeypair().publicKey.replace(/[^a-zA-Z0-9]/g, '').slice(-10)}`;
    const circleRootUri = `${podBase}/${circleId}`;
    const controllerKey = generateKeypair();   // the founder's device key, the same in both tabs
    const founder = generateKeypair();
    const [podA, podB] = await Promise.all([makeRealPodClient(), makeRealPodClient()]);
    const tab = (podClient) => createCircleControlAgent({
      circleId, storagePosture: 'p2', podClient, sharing: noAcl, controllerKey, circleRootUri,
      roster: [{ webId: 'ref:founder', publicKey: founder.publicKey, role: 'admin' }],
    });
    const one = tab(podA); const two = tab(podB);
    await one.bootstrap();
    await two.members();   // both tabs exist before anyone joins

    const members = Array.from({ length: 4 }, (_, i) => ({ webId: `ref:m${i}`, kp: generateKeypair() }));
    // interleave: each tab adds two members, all four at once
    await Promise.all(members.map((m, i) => (i % 2 ? two : one).addMember({ webId: m.webId, publicKey: m.kp.publicKey })));

    const stored = await one.keyStore.read();
    for (const m of members) expect(opens(stored, m.kp.privateKey), `${m.webId} holds the key`).toBe(true);
    expect(opens(stored, founder.privateKey), 'the founder still holds it').toBe(true);
  }, 120_000);
});
