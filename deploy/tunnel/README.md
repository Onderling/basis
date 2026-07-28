# deploy/tunnel — a durable cloudflared tunnel for the local stack

Hardens the "run the stack on my own machine + tunnel it out" testing path (deploy
runbook Path C) so it survives crashes, logout, and reboot. Pairs with
`restart: unless-stopped` on the compose services.

## Install (one-time)

```bash
# cloudflared must already be at ~/.local/bin/cloudflared (see DEPLOY-RUNBOOK Path C)
install -m755 deploy/tunnel/onderling-tunnel.sh      ~/.local/bin/onderling-tunnel.sh
install -Dm644 deploy/tunnel/onderling-tunnel.service ~/.config/systemd/user/onderling-tunnel.service
systemctl --user daemon-reload
systemctl --user enable --now onderling-tunnel.service
loginctl enable-linger "$USER"    # run without login + start on boot
```

The current public URL is written to **`~/.onderling-relay-url`**:

```bash
RELAY_URL="$(cat ~/.onderling-relay-url | sed s/https:/wss:/)"
node deploy/smoke/smoke.mjs "$RELAY_URL"
```

Manage it: `systemctl --user {status,restart,stop} onderling-tunnel.service`.

### Already running the old `onderling-tunnel.service`?

Retire it once — the new unit replaces it:

```bash
systemctl --user disable --now onderling-tunnel.service
rm -f ~/.config/systemd/user/onderling-tunnel.service ~/.local/bin/onderling-tunnel.sh ~/.onderling-relay-url
# then run the Install block above
```

## What this does and does NOT give you

- ✅ Survives the process crashing, you logging out, and (with linger) a reboot —
  as long as the **machine is on** and Docker is up (`restart: unless-stopped`).
- ⚠️ The URL is a cloudflared **quick tunnel**, so it **rotates on every (re)start** —
  read `~/.onderling-relay-url` for the current one. It is stable only while the
  service stays up.

## Getting a truly STABLE URL (no card)

Two no-card ways to a URL that never rotates:

1. **ngrok free static domain** — a free ngrok account gives ONE reserved
   `something.ngrok-free.app`. No domain of your own needed. Swap this service's
   `ExecStart` for `ngrok http --domain=<your>.ngrok-free.app 8787`.
2. **Cloudflare NAMED tunnel** — needs a **domain** you add to a (free) Cloudflare
   account: `cloudflared tunnel create onderling` + a DNS route → a stable
   `relay.<yourdomain>`. This also unblocks tunnelling the **pod** (CSS bakes its
   base URL into WebIDs, so it needs a stable URL — see the runbook's pod gotcha).

For genuine 24/7 independent of this machine, run the whole thing on an
always-on device (a Pi / old laptop / NAS) — which is also the user-hosted
companion-node direction — or an Oracle/GCP always-free VM (card for verification).
