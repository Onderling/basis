#!/usr/bin/env bash
# start-relay.sh — start the @onderling/relay broker on this machine.
#
# Convenience wrapper around `node packages/relay/bin/relay.js`.
# Prints the LAN-reachable WebSocket URL on startup; copy it into
# Settings → Relay-server on each phone, then restart the app.
#
# Usage:
#   ./scripts/start-relay.sh              # listens on port 8787
#   ./scripts/start-relay.sh 9000         # custom port
#   PORT=9000 ./scripts/start-relay.sh
#   TLS_CERT=cert.pem TLS_KEY=key.pem ./scripts/start-relay.sh
#
# Env vars (forwarded to the CLI):
#   PORT       — default 8787 (overridden by argv[1] when given)
#   HOST       — default 0.0.0.0 (bind interface)
#   TLS_CERT   — PEM cert path; enables wss://
#   TLS_KEY    — PEM key path
#   STATIC_DIR — optional dir to serve over HTTP
#
# Stop with Ctrl-C.

set -euo pipefail

# Resolve the repo root from this script's location so the script
# works regardless of caller's CWD.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

PORT="${1:-${PORT:-8787}}"

cd "$REPO_ROOT"
exec node packages/relay/bin/relay.js "$PORT"
