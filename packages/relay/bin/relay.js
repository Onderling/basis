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
 *   PUSH_WAKE        'expo' wires the ExpoPushSender so an offline enqueue can wake a
 *                    registered device (EXPO_ACCESS_TOKEN optional — Expo's push API works
 *                    without one unless the project enforces enhanced security). Unset ⇒ no
 *                    push sender: the relay ignores register-push-token and never contacts a
 *                    push provider — the zero-metadata floor.
 *   PUSH_TOKENS_DB   sqlite path for the address↔token map; makes wakes survive a relay
 *                    restart (a sleeping device never reconnects to re-register). Memory-only
 *                    when unset.
 *
 * Usage:
 *   npx @onderling/relay
 *   PORT=9000 STATIC_DIR=./public npx @onderling/relay
 *   TLS_CERT=cert.pem TLS_KEY=key.pem npx @onderling/relay
 *   PUSH_WAKE=expo PUSH_TOKENS_DB=./push-tokens.db npx @onderling/relay
 */
import { readFileSync } from 'node:fs';
import { startRelay, getLanIp } from '../src/server.js';
import { ExpoPushSender, PushTokenRegistry, SqlitePushTokenStore } from '../src/push/index.js';

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

// Push wake (the delivery ladder's last rung) — operator-enabled, never on by default.
let pushSender = null;
let pushTokenRegistry;
if (process.env.PUSH_WAKE === 'expo') {
  pushSender = new ExpoPushSender({ accessToken: process.env.EXPO_ACCESS_TOKEN || undefined });
  if (process.env.PUSH_TOKENS_DB) {
    const { default: Database } = await import('better-sqlite3');   // throws loudly when not installed
    pushTokenRegistry = new PushTokenRegistry({
      store: new SqlitePushTokenStore({ path: process.env.PUSH_TOKENS_DB, Database }),
    });
  }
} else if (process.env.PUSH_WAKE) {
  throw new Error(`PUSH_WAKE=${process.env.PUSH_WAKE} is not a known push sender (only 'expo')`);
}

const { tls } = await startRelay({
  port, host,
  tlsCert, tlsKey,
  serveStaticDir: staticDir,
  acceptedGroups,
  pushSender,
  ...(pushTokenRegistry ? { pushTokenRegistry } : {}),
  log: true,
});

const scheme   = tls ? 'https' : 'http';
const wsScheme = tls ? 'wss'   : 'ws';
const lanIp    = getLanIp();

console.log('');
console.log('  @onderling/relay');
console.log('  ─────────────────────────────────────');
console.log(`  Local:    ${scheme}://localhost:${port}`);
console.log(`  Push:     ${pushSender ? `expo wake enabled${process.env.PUSH_TOKENS_DB ? ` (tokens: ${process.env.PUSH_TOKENS_DB})` : ' (tokens: memory — lost on restart)'}` : 'off (no wake, no provider contact)'}`);
if (lanIp) {
  console.log(`  Network:  ${scheme}://${lanIp}:${port}`);
  console.log(`  Relay WS: ${wsScheme}://${lanIp}:${port}`);
}
console.log('');
