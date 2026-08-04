#!/usr/bin/env node
/**
 * deploy/relay — PaaS entrypoint for @onderling/relay.
 *
 * This is a DEPLOY artifact, not service logic: it reads config from env and
 * composes the relay's already-exported seams (`startRelay`, `ExpoPushSender`,
 * the blob-gateway `createS3Bucket` + `createCapabilityVerifier`). It never
 * changes relay behaviour — every feature is opt-in via env and degrades to a
 * plain messaging relay when its env is absent.
 *
 * Why not `packages/relay/bin/relay.js`?  That CLI only wires PORT/HOST/TLS/
 * static. This entrypoint additionally wires the two production seams a hosted
 * relay needs: the media blob-gate (R2/S3) and push wake (Expo). Behind a PaaS
 * proxy the relay runs PLAIN HTTP (the proxy terminates TLS → wss://), so no
 * TLS_CERT/KEY is set here; the public URL is wss:// via the proxy.
 *
 * Env (all optional except PORT, which the PaaS injects):
 *   PORT                     listen port (PaaS injects this; default 8787)
 *   HOST                     bind host (default 0.0.0.0)
 *
 *   -- media blob-gate (enable by setting R2_* ) --
 *   R2_ENDPOINT              https://<account>.r2.cloudflarestorage.com
 *   R2_BUCKET                bucket name
 *   R2_ACCESS_KEY_ID         S3 access key id
 *   R2_SECRET_ACCESS_KEY     S3 secret
 *   R2_REGION                default 'auto' (R2 ignores region)
 *   BLOB_GATE_ROUTE          mount path (default '/blob-gate')
 *   BLOB_GATE_TTL            presigned-URL lifetime seconds (default 60)
 *   BLOB_GATE_SKILL          required capability skill (default 'media.read')
 *   BLOB_GATE_UPLOADERS      comma-separated actor ids allowed to /grant+/upload-url
 *                            (DEFAULT empty = NOBODY; a real deploy sets this)
 *
 *   -- push wake (enable by setting PUSH_PROVIDER=expo) --
 *   PUSH_PROVIDER            'expo' to enable Expo push wake (else no push)
 *   EXPO_ACCESS_TOKEN        optional Expo enhanced-security access token
 */
// Imported by real workspace path, not the '@onderling/relay' bare specifier: the
// monorepo installs per-package (shared-workspace-lockfile=false), so there is no
// root node_modules linking @onderling/relay. The package's OWN @onderling/* deps still
// resolve from packages/relay/node_modules — only this outer hop must be relative.
import { readFileSync } from 'node:fs';
import { startRelay, getLanIp, ExpoPushSender } from '../../packages/relay/index.js';

const port = parseInt(process.env.PORT ?? '8787', 10);
const host = process.env.HOST ?? '0.0.0.0';

// ── media blob-gate (opt-in via R2_*) ────────────────────────────────────────
let blobGate = null;
if (process.env.R2_ENDPOINT && process.env.R2_BUCKET) {
  // Real workspace paths (same reason as the relay import above). These map to
  // blob-gateway's './adapters/s3' + './adapters/capability-verifier' exports.
  const { createS3Bucket } = await import(
    '../../packages/blob-gateway/src/adapters/s3Bucket.js'
  );
  const { createCapabilityVerifier } = await import(
    '../../packages/blob-gateway/src/adapters/capabilityVerifier.js'
  );
  const bucket = createS3Bucket({
    endpoint: process.env.R2_ENDPOINT,
    region: process.env.R2_REGION ?? 'auto',
    bucket: process.env.R2_BUCKET,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    fetch: globalThis.fetch,
  });
  const uploaders = (process.env.BLOB_GATE_UPLOADERS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  blobGate = {
    // Media Phase-1 posture: sealed-only, self-issued capability tokens,
    // deny-by-default (mirrors companion-node/src/mediaEdge.js buildDevMediaEdge).
    verifyToken: createCapabilityVerifier({
      requiredSkill: process.env.BLOB_GATE_SKILL ?? 'media.read',
      requireSelfIssued: true,
    }),
    bucket,
    uploaders,
    ttl: parseInt(process.env.BLOB_GATE_TTL ?? '60', 10),
    route: process.env.BLOB_GATE_ROUTE ?? '/blob-gate',
  };
}

// ── push wake (opt-in via PUSH_PROVIDER=expo) ────────────────────────────────
let pushSender = null;
if ((process.env.PUSH_PROVIDER ?? '').toLowerCase() === 'expo') {
  pushSender = new ExpoPushSender({
    fetch: globalThis.fetch,
    accessToken: process.env.EXPO_ACCESS_TOKEN || undefined,
  });
}

// ── bound mode (batch 7) — the relay refuses clients outside the configured circles ──────────────
// `ACCEPTED_GROUPS` = inline JSON, or `ACCEPTED_GROUPS_FILE` = path to a JSON file; either way an
// array of `{ groupId, adminPubKey, requiredRole?, quotas?, revokedMembers? }` (GroupAuthVerifier's
// shape). Unset/empty ⇒ open mode, exactly as before — existing deployments change nothing. A value
// that does not parse REFUSES BOOT: a relay silently open when its operator asked for bound is the
// worst of both.
let acceptedGroups;
{
  const inline = process.env.ACCEPTED_GROUPS ?? null;
  const file   = process.env.ACCEPTED_GROUPS_FILE ?? null;
  const raw    = inline ?? (file ? readFileSync(file, 'utf8') : null);
  if (raw != null) {
    acceptedGroups = JSON.parse(raw);   // throws → boot fails loudly, by design
    if (!Array.isArray(acceptedGroups)) throw new Error('ACCEPTED_GROUPS must be a JSON array');
  }
}

const { port: boundPort, tls } = await startRelay({
  port,
  host,
  blobGate,
  pushSender,
  acceptedGroups,
  log: true,
});

const wsScheme = tls ? 'wss' : 'ws';
console.log('');
console.log('  @onderling/relay  (PaaS entrypoint)');
console.log('  ─────────────────────────────────────');
console.log(`  Listening:  http://${host}:${boundPort}  (proxy terminates TLS → ${wsScheme}://)`);
console.log(`  Media edge: ${blobGate ? `ON  route=${blobGate.route}  uploaders=${blobGate.uploaders.length}` : 'off (set R2_* to enable)'}`);
console.log(`  Push wake:  ${pushSender ? 'ON (expo)' : 'off (set PUSH_PROVIDER=expo to enable)'}`);
const lan = getLanIp();
if (lan) console.log(`  LAN:        ws://${lan}:${boundPort}`);
console.log('');

const shutdown = () => process.exit(0);
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
