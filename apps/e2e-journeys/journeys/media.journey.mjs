// J-media: full-size media over the blob-gate edge against a REAL S3 bucket
// (MinIO, standing in for R2). Proves the media-infra live path end-to-end:
//   • gap-2 — circleMemberActors resolves a circle roster → member SIGNING pubkeys
//     (the ACL/token subject space); an unresolvable member is dropped + counted.
//   • upload — a whitelisted uploader gets a presigned PUT and stores CIPHERTEXT in S3.
//   • grant  — the uploader grants the blob key to the circle members (signing keys).
//   • read   — a granted member gets a presigned GET, pulls the ciphertext from S3,
//     and opens it with the group key; a NON-granted peer is denied (opaque 403);
//     a non-uploader cannot get an upload URL (deny-by-default).
//
// GATED: skips cleanly unless a MinIO (or any S3) is reachable (MINIO_URL, default
// :9000). Starts its own relay with the blob-gate mounted (relayUrl unused).
import { AgentIdentity, CapabilityToken } from '@onderling/core';
import { VaultMemory }                    from '@onderling/vault';
import { startRelay, MemoryBlobAclStore } from '@onderling/relay';
import { createS3Bucket }                 from '@onderling/blob-gateway/adapters/s3';
import { createCapabilityVerifier }       from '@onderling/blob-gateway/adapters/capability-verifier';
import { circleMemberActors }             from '../../basis/src/v2/circleMemberActors.js';
import { generateGroupKey, sealWithGroupKey, openWithGroupKey } from '@onderling/pod-client/sealing';
import { checker } from './_util.mjs';

export const name = 'J-media (blob edge → real S3, grant/read/deny)';

const MINIO  = process.env.MINIO_URL    || 'http://127.0.0.1:9000';
const BUCKET = process.env.MINIO_BUCKET || 'onderling-media';
const KEY    = process.env.MINIO_KEY    || 'onderlingadmin';
const SECRET = process.env.MINIO_SECRET || 'onderlingsecret123';

async function s3Reachable() {
  try { return (await fetch(`${MINIO}/minio/health/live`, { signal: AbortSignal.timeout(2500) })).ok; } catch { return false; }
}

export async function run() {
  if (!(await s3Reachable())) return { skipped: true, reason: `no S3/MinIO at ${MINIO} (start minio + set MINIO_URL)` };
  const { results, check } = checker();

  const bucket = createS3Bucket({ endpoint: MINIO, region: 'us-east-1', bucket: BUCKET, accessKeyId: KEY, secretAccessKey: SECRET });
  const uploader = await AgentIdentity.generate(new VaultMemory());   // in the edge `uploaders` allow-list
  const bob = await AgentIdentity.generate(new VaultMemory());        // a circle member (granted)
  const eve = await AgentIdentity.generate(new VaultMemory());        // a non-member

  const acl = new MemoryBlobAclStore();
  const relay = await startRelay({
    port: 0,
    blobGate: {
      verifyToken: createCapabilityVerifier({ requiredSkill: 'media.read', requireSelfIssued: true }),
      bucket, acl, uploaders: [uploader.pubKey], ttl: 120,
    },
  });
  const gateUrl = `http://127.0.0.1:${relay.port}/blob-gate`;
  const tokenFor = async (id) => (await CapabilityToken.issue(id, { subject: id.pubKey, agentId: 'blob-gate', skill: 'media.read', expiresIn: 3_600_000 })).toString();
  const authJson = (tok) => ({ authorization: `Bearer ${tok}`, 'content-type': 'application/json' });

  try {
    // ── gap 2: roster → signing-pubkey actors (webid === signing pubKey) ────────
    const roster = [{ webid: bob.pubKey }, { webid: 'https://id.example/not-yet-captured' }];
    const members = { resolveByWebid: async (w) => (w === bob.pubKey ? { pubKey: bob.pubKey } : null) };
    const { actors, unresolved } = await circleMemberActors(members, roster);
    check('gap-2: circleMemberActors resolves roster → member SIGNING pubkeys (drops unresolvable)',
      actors.length === 1 && actors[0] === bob.pubKey && unresolved === 1);

    // ── seal a "photo" (storage holds only ciphertext) ──────────────────────────
    const groupKey = generateGroupKey();
    const PHOTO = 'JPEG:strand-bbq-kinderen-2026';
    const sealed = sealWithGroupKey(PHOTO, groupKey);
    const bucketKey = `circle-42/photo-${Date.now().toString(36)}.enc`;
    const ref = `blob://${bucketKey}`;
    const upTok = await tokenFor(uploader);

    // ── upload: presigned PUT → ciphertext lands in the real S3 ─────────────────
    const upUrl = await (await fetch(`${gateUrl}/upload-url`, { method: 'POST', headers: authJson(upTok), body: JSON.stringify({ key: bucketKey }) })).json();
    check('uploader gets a presigned PUT URL from the edge', typeof upUrl.url === 'string');
    const put = await fetch(upUrl.url, { method: 'PUT', body: sealed });
    check('ciphertext PUT genuinely lands in the real S3 (MinIO)', put.ok);

    // ── grant the blob to the circle members (the resolved signing keys) ────────
    const grant = await (await fetch(`${gateUrl}/grant`, { method: 'POST', headers: authJson(upTok), body: JSON.stringify({ key: ref, actors: [uploader.pubKey, bob.pubKey] }) })).json();
    check('uploader grants the blob to the circle members', grant.ok === true && grant.granted === 2);

    // ── granted member reads: presigned GET → pull ciphertext → open ────────────
    const bobTok = await tokenFor(bob);
    const read = await fetch(`${gateUrl}?ref=${encodeURIComponent(ref)}`, { headers: { authorization: `Bearer ${bobTok}` } });
    const readBody = await read.json();
    check('granted member gets a presigned GET URL', read.status === 200 && typeof readBody.url === 'string');
    const cipherBack = await (await fetch(readBody.url)).text();
    check('the ciphertext round-trips from real S3', cipherBack === sealed);
    check('member opens the full-size photo with the group key', openWithGroupKey(cipherBack, groupKey) === PHOTO);

    // ── denials (deny-by-default on the token subject = signing key) ────────────
    const eveTok = await tokenFor(eve);
    const eveRead = await fetch(`${gateUrl}?ref=${encodeURIComponent(ref)}`, { headers: { authorization: `Bearer ${eveTok}` } });
    check('a NON-granted peer is denied a read (opaque 403, no URL)', eveRead.status === 403);
    const eveUp = await fetch(`${gateUrl}/upload-url`, { method: 'POST', headers: authJson(eveTok), body: JSON.stringify({ key: 'evil' }) });
    check('a non-uploader cannot get an upload URL (deny-by-default)', eveUp.status === 403);
  } finally {
    await relay.stop?.().catch?.(() => {});
  }
  return results;
}
