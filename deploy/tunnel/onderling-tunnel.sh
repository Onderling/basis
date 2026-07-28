#!/usr/bin/env bash
# onderling-tunnel.sh — run the cloudflared tunnel to the local relay and record the
# current public URL to ~/.onderling-relay-url. Under the systemd user service
# (Restart=always + linger) this survives crashes / logout / reboot.
#
# Naming migration 2026-07-28: the URL is also written to the legacy ~/.canopy-relay-url for one
# window, so anything already reading that path (an old checkout, a shell alias) keeps working.
#
# NOTE: a cloudflared QUICK tunnel gets a fresh random URL on each (re)start, so
# read ~/.onderling-relay-url for the current one. A truly STABLE URL needs either an
# ngrok free static domain (no card, no domain) or a Cloudflare NAMED tunnel with a
# domain you control.
set -uo pipefail
URLFILE="$HOME/.onderling-relay-url"
URLFILE_LEGACY="$HOME/.canopy-relay-url"
CF="$HOME/.local/bin/cloudflared"
"$CF" tunnel --url http://localhost:8787 --no-autoupdate 2>&1 | while IFS= read -r line; do
  printf '%s\n' "$line"
  if [[ "$line" == *trycloudflare.com* ]]; then
    u=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' <<<"$line" | head -1)
    [[ -n "${u:-}" ]] && { printf '%s\n' "$u" > "$URLFILE"; printf '%s\n' "$u" > "$URLFILE_LEGACY"; }
  fi
done
