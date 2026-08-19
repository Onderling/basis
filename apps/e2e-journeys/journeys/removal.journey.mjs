// J-removal: policy-based member removal + the coupling fix (the MEDIUM security finding).
//   • COUPLING (both policies): removal now revokes the departed's MESH PROOF too, not just
//     the content key — so an ex-member loses content access AND mesh membership.
//   • FORWARD SECRECY (both): the departed cannot open content sealed AFTER removal.
//   • GRACEFUL (default): retained history is left intact → the departed keeps access to content
//     they ALREADY had (on their device).
//   • BAN (hostile): history is re-sealed to EXCLUDE the departed → no server-fetchable old key
//     remains for them, while remaining members keep their access.
// Hermetic crypto + a real GroupManager (no relay/pod). Uses the REAL createControlAgent.
import { AgentIdentity, GroupManager } from '@onderling/core';
import { VaultMemory }                 from '@onderling/vault';
import { createControlAgent, unwrapGroupKey, openSealedAcrossVersions, sealWithGroupKey, generateKeypair } from '@onderling/pod-client/sealing';
import { checker } from './_util.mjs';

export const name = 'J-removal (policy-based removal + mesh-proof coupling)';

const opened = (content, res, priv) => { try { return openSealedAcrossVersions(content, res, priv); } catch { return null; } };

/** Build a fresh circle: control-agent (controller + A + B) + a GroupManager holding A/B proofs. */
async function buildCircle(groupId, tag) {
  const adminId = await AgentIdentity.generate(new VaultMemory());
  const vault = new VaultMemory();
  const gm = new GroupManager({ identity: adminId, vault });
  const controller = generateKeypair();
  const mk = async () => ({ webId: (await AgentIdentity.generate(new VaultMemory())).pubKey, seal: generateKeypair() });
  const A = await mk(), B = await mk();
  await gm.issueProof(A.webId, groupId);
  await gm.issueProof(B.webId, groupId);

  let stored = null;
  const keyStore = { read: async () => stored, write: async (r) => { stored = r; } };
  const revoked = [];
  const revokeMeshProof = async (t) => { revoked.push(t.webId); await gm.revokeProof(t.webId, groupId); };
  const ca = createControlAgent({
    sharing: { grant: async () => {}, revoke: async () => {} },
    containerUri: `urn:circle:${groupId}`, keyStore, controllerKey: controller,
    roster: [
      { webId: A.webId, publicKey: A.seal.publicKey, role: 'member' },
      { webId: B.webId, publicKey: B.seal.publicKey, role: 'member' },
    ],
    revokeMeshProof,
  });
  await ca.bootstrap();
  const v1gk = unwrapGroupKey(stored, controller.privateKey);
  const contentV1 = sealWithGroupKey(`geheim-onder-v1-${tag}`, v1gk);
  const proofPresent = async (webId) => (JSON.parse((await vault.get(`group-admin:${groupId}`)) ?? '[]')).some((p) => p.memberPubKey === webId);
  return { ca, controller, A, B, revoked, contentV1, proofPresent, res: () => stored };
}

export async function run() {
  const { results, check } = checker();

  // ── GRACEFUL removal ────────────────────────────────────────────────────────
  {
    const c = await buildCircle('circle-graceful', 'g');
    const before = await c.proofPresent(c.A.webId);
    const r = await c.ca.removeMember({ webId: c.A.webId, policy: 'graceful' });
    const res = c.res();
    const v2gk = unwrapGroupKey(res, c.controller.privateKey);
    const contentV2 = sealWithGroupKey('geheim-onder-v2-g', v2gk);

    check('graceful — COUPLING: the departed’s mesh proof is revoked (was present → now gone)',
      before && r.proofRevoked === true && c.revoked.includes(c.A.webId) && !(await c.proofPresent(c.A.webId)));
    check('graceful — FORWARD secrecy: the departed cannot open NEW content',
      opened(contentV2, res, c.A.seal.privateKey) === null);
    check('graceful — the departed KEEPS access to content they already had (history intact)',
      opened(c.contentV1, res, c.A.seal.privateKey) === 'geheim-onder-v1-g');
    check('graceful — a remaining member still opens both old + new content',
      opened(c.contentV1, res, c.B.seal.privateKey) === 'geheim-onder-v1-g' && opened(contentV2, res, c.B.seal.privateKey) === 'geheim-onder-v2-g');
  }

  // ── BAN removal (hostile) ───────────────────────────────────────────────────
  {
    const c = await buildCircle('circle-ban', 'b');
    const r = await c.ca.removeMember({ webId: c.A.webId, policy: 'ban' });
    const res = c.res();
    const v2gk = unwrapGroupKey(res, c.controller.privateKey);
    const contentV2 = sealWithGroupKey('geheim-onder-v2-b', v2gk);

    check('ban — COUPLING: the departed’s mesh proof is revoked',
      r.proofRevoked === true && r.banned === true && !(await c.proofPresent(c.A.webId)));
    check('ban — FORWARD secrecy: the departed cannot open NEW content',
      opened(contentV2, res, c.A.seal.privateKey) === null);
    check('ban — the departed can NO LONGER open OLD content either (history re-sealed to exclude them)',
      opened(c.contentV1, res, c.A.seal.privateKey) === null);
    check('ban — a remaining member STILL opens the old content (re-seal kept them)',
      opened(c.contentV1, res, c.B.seal.privateKey) === 'geheim-onder-v1-b');
  }

  return results;
}
