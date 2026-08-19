/**
 * Per-circle sealing — the REAL-POD slice of the S4 pod foundation
 * (circleControlAgent + the @onderling/pod-client sealing substrate), run against a
 * **running Community Solid Server** instead of the in-memory pod that
 * `circleSealing.test.js` uses. This closes the "real-pod verify" item of
 * REMAINING-WORK §4 E2: it proves the sealing substrate behaves identically over
 * real HTTP/Solid as it does in memory —
 *   • the versioned, recipient-wrapped group key persists on a real pod
 *     (podKeyStore read/write round-trips over the network), and
 *   • SEALED content written through `SealedPodClient` lands as ciphertext the
 *     pod host can't read, and opens back to plaintext for a current recipient,
 *   • a removed member can no longer unwrap (forward secrecy) after key rotation.
 *
 * Convention mirrors `packages/pod-client/test/**.css.test.js`: gated on a running
 * CSS via `CSS_URL` + client-credentials — skips cleanly otherwise, so `npm test`
 * and the repo sweep stay green without any server. Provision creds with
 * `../feedback/scripts/bootstrap-owner.js (the onderling-feedback repo)` (CSS_URL=… node …) and run:
 *
 *   CSS_URL=http://localhost:3000/ \
 *   CSS_CLIENT_ID=… CSS_CLIENT_SECRET=… \
 *   CSS_WEBID=http://localhost:3000/<pod>/profile/card#me \
 *   CSS_CIRCLE_ROOT=http://localhost:3000/<pod>/circle-seal \
 *   npx vitest run test/circleSealing.css.test.js
 *
 * ⚠️ Scope: this verifies the KEY-STORE persistence + the CONTENT seal round-trip
 * on a real pod — the parts that were only ever exercised in memory. ACL
 * grant/revoke uses a mock `sharing` ON PURPOSE: real CSS-ACP grant observability
 * is the documented KNOWN-RED gap (Inrupt 3.0.0 ↔ CSS 7.1.9; see
 * sharing.css.test.js), tracked separately as the per-circle-agent / OIDC
 * restructuring phase. Mocking it keeps THIS test's signal — "sealing works on a
 * real pod" — clean and un-flaky.
 *
 * Provenance: writing this verify exposed two substrate bugs the in-memory
 * `MemPodClient` masked — both a non-existent `decode:'text'` mode falling through
 * to `auto`: (1) `podKeyStore.read` JSON-parsed an already-decoded OBJECT → null →
 * the control agent silently dropped members; (2) `SealedPodClient.read` got raw
 * BYTES so `open()` never saw the `fp1:` envelope. Fixed in pod-client (→ this is
 * the fitness function that keeps them fixed). See REMAINING-WORK §4 S4.
 */
import { describe, it, expect, beforeAll } from 'vitest';

const CSS_URL = process.env.CSS_URL;
const HAVE_OIDC = !!(process.env.CSS_CLIENT_ID && process.env.CSS_CLIENT_SECRET);
const SUITE = CSS_URL && HAVE_OIDC ? describe : describe.skip;

let PodClient, SolidOidcAuth, createSealedPodClient, generateKeypair;
let createCircleControlAgent, SolidVault, VaultMemory;

beforeAll(async () => {
  if (!CSS_URL || !HAVE_OIDC) return;
  ({ PodClient, SolidOidcAuth, createSealedPodClient, generateKeypair } = await import('@onderling/pod-client'));
  ({ VaultMemory } = await import('@onderling/vault'));
  ({ SolidVault } = await import('@onderling/oidc-session'));
  ({ createCircleControlAgent } = await import('../src/v2/circleControlAgent.js'));
});

function mockSharing() {
  const grants = []; const revokes = [];
  return { grant: async (o) => { grants.push(o); }, revoke: async (o) => { revokes.push(o); }, grants, revokes };
}


SUITE('per-circle sealing — CSS integration (real pod)', () => {
  // a unique container under the owner's pod so reruns don't collide
  const circleRoot = (process.env.CSS_CIRCLE_ROOT || `${CSS_URL}circle-seal`).replace(/\/$/, '');

  /** Authenticated PodClient via client-credentials (same path as sharing.css.test.js). */
  async function makeClient() {
    const vault = new VaultMemory();
    const sv = new SolidVault({ webid: process.env.CSS_WEBID || `${CSS_URL}profile/card#me`, vault });
    await sv.login({
      clientId: process.env.CSS_CLIENT_ID,
      clientSecret: process.env.CSS_CLIENT_SECRET,
      oidcIssuer: process.env.CSS_OIDC_ISSUER || CSS_URL,
    });
    return new PodClient({ podRoot: CSS_URL, auth: new SolidOidcAuth({ vault: sv }) });
  }

  it('p2 circle: group key persists on the pod + sealed content round-trips; leave rotates (forward secrecy)', async () => {
    const podClient = await makeClient();
    const controller = generateKeypair();
    const alice = generateKeypair();
    const bob = generateKeypair();
    const sharing = mockSharing();

    // a fresh per-test root so the key resource starts absent. NB: an ed25519
    // public key's PREFIX is a constant SPKI/DER header (MCowBQYD…), so slice(0,N)
    // collides across runs — take the (unique) TAIL and strip base64url -/_ so the
    // suffix is path-safe.
    const uniq = controller.publicKey.replace(/[^a-zA-Z0-9]/g, '').slice(-16);
    const root = `${circleRoot}-${uniq}`;

    const cca = createCircleControlAgent({
      circleId: 'css-c1', storagePosture: 'p2',
      podClient, sharing, controllerKey: controller, circleRootUri: root,
    });
    expect(cca).not.toBeNull();

    // bootstrap writes the group-key resource onto the REAL pod
    await cca.bootstrap();
    await cca.addMember({ webId: 'did:alice', publicKey: alice.publicKey });
    await cca.addMember({ webId: 'did:bob', publicKey: bob.publicKey });
    expect(sharing.grants).toHaveLength(2);

    // the key resource is really on the pod: read it back with a plain authed GET → ciphertext only
    const rawKey = await podClient.read(`${root}/.keys/group.json`, { decode: 'text' });
    const rawKeyText = typeof rawKey === 'string' ? rawKey : rawKey?.content;
    expect(rawKeyText).toBeTruthy();
    expect(rawKeyText).not.toContain(alice.privateKey);   // host holds wrapped keys, not raw

    // Alice (a current recipient) resolves the content-sealing strategy from the pod-held key
    const stratA = await cca.sealingStrategy(alice.privateKey);
    const sealed = createSealedPodClient(podClient, stratA);
    const noteUri = `${root}/shared/post.txt`;
    await sealed.write(noteUri, 'hallo buurt — alleen voor de circle');

    // the host sees CIPHERTEXT (read raw, undecoded) — confidentiality holds on a real pod
    const rawNote = await podClient.read(noteUri, { decode: 'text' });
    const rawNoteText = typeof rawNote === 'string' ? rawNote : rawNote?.content;
    expect(rawNoteText).not.toContain('hallo buurt');

    // Bob (also a current recipient) opens it transparently → plaintext round-trip over the pod
    const stratB = await cca.sealingStrategy(bob.privateKey);
    const opened = await createSealedPodClient(podClient, stratB).read(noteUri);
    expect(opened.content).toBe('hallo buurt — alleen voor de circle');

    // Alice leaves: ACL revoked + group key rotated on the pod → she can no longer unwrap
    await cca.removeMember({ webId: 'did:alice' });
    expect(sharing.revokes).toHaveLength(1);
    await expect(cca.sealingStrategy(alice.privateKey)).rejects.toThrow();

    // Bob is still a recipient after rotation → still reads (the rotated key re-wrapped to him)
    const stratB2 = await cca.sealingStrategy(bob.privateKey);
    expect(typeof stratB2?.open).toBe('function');
  }, 60_000);
});
