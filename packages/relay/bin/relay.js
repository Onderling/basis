#!/usr/bin/env node
/**
 * @onderling/relay — CLI entry point.
 *
 * Reads options from env vars (or argv for port):
 *   PORT             default 8787
 *   HOST             default 0.0.0.0
 *   TLS_CERT         path to PEM cert (enables wss://)
 *   TLS_KEY          path to PEM key
 *   STATIC_DIR       optional directory to serve over HTTP
 *
 * Usage:
 *   npx @onderling/relay
 *   PORT=9000 STATIC_DIR=./public npx @onderling/relay
 *   TLS_CERT=cert.pem TLS_KEY=key.pem npx @onderling/relay
 */
import { readFileSync } from 'node:fs';
import { startRelay, getLanIp } from '../src/server.js';

const port     = parseInt(process.argv[2] ?? process.env.PORT ?? '8787', 10);
const host     = process.env.HOST ?? '0.0.0.0';
const staticDir = process.env.STATIC_DIR ?? null;

let tlsCert = null, tlsKey = null;
if (process.env.TLS_CERT && process.env.TLS_KEY) {
  tlsCert = readFileSync(process.env.TLS_CERT);
  tlsKey  = readFileSync(process.env.TLS_KEY);
}

// Bound mode (batch 7) — same knob as the PaaS entrypoint: `ACCEPTED_GROUPS` inline JSON or
// `ACCEPTED_GROUPS_FILE`; unset ⇒ open mode, unchanged. Unparseable ⇒ refuse boot, loudly.
let acceptedGroups;
{
  const raw = process.env.ACCEPTED_GROUPS
    ?? (process.env.ACCEPTED_GROUPS_FILE ? readFileSync(process.env.ACCEPTED_GROUPS_FILE, 'utf8') : null);
  if (raw != null) {
    acceptedGroups = JSON.parse(raw);
    if (!Array.isArray(acceptedGroups)) throw new Error('ACCEPTED_GROUPS must be a JSON array');
  }
}

const { tls } = await startRelay({
  port, host,
  tlsCert, tlsKey,
  serveStaticDir: staticDir,
  acceptedGroups,
  log: true,
});

const scheme   = tls ? 'https' : 'http';
const wsScheme = tls ? 'wss'   : 'ws';
const lanIp    = getLanIp();

console.log('');
console.log('  @onderling/relay');
console.log('  ─────────────────────────────────────');
console.log(`  Local:    ${scheme}://localhost:${port}`);
if (lanIp) {
  console.log(`  Network:  ${scheme}://${lanIp}:${port}`);
  console.log(`  Relay WS: ${wsScheme}://${lanIp}:${port}`);
}
console.log('');
