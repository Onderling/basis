# DEPLOY-RUNBOOK — get the relay (+ CSS pod + companion) online

Turnkey guide to putting the Onderling backend on a **free** host the moment you
provision one. Three paths, all accurate against the configs already in `deploy/`:

- **Path C — Local stack + tunnel** *(no account, no card — start here for testing)*:
  run the stack on your own machine, expose it with `cloudflared`/`ngrok` for a
  real public `wss://`. Host = your machine (up while you test). **Recommended for
  right-now testing.**
- **Path A — Koyeb**: fastest *hosted* option, auto-TLS, real WebSockets — but
  signup now asks for payment info. Scales to zero after ~1h idle, so not a 24/7
  hold.
- **Path B — Oracle Cloud Always-Free VM**: a real always-on host, the whole
  stack (relay + CSS pod + companion) via `docker compose`, TLS via Caddy +
  Let's Encrypt. Free forever, but needs a credit card for identity verification
  and a domain name.

Both paths reuse the **existing, docker-verified** service configs — no service
code changes. Env var names below are quoted verbatim from the per-service
`deploy/*/.env.example` files; don't substitute invented names.

> **TLS reality (read once).** Browsers refuse a WebSocket unless it is real
> `wss://` over valid TLS. A raw IP or a self-signed cert will **not** work for a
> browser client. Path A gets valid TLS free from Koyeb. Path B gets it from
> Caddy + Let's Encrypt, which needs a **domain** (Let's Encrypt won't issue for
> a bare IP). There is no browser-usable path without valid TLS on a real domain.

---

## What you provide vs what's automated

| | You provide (only you can) | Automated by this runbook |
|---|---|---|
| **Path C** | nothing — `cloudflared`/`ngrok` installed + your machine up; (optional) free CF account for a stable pod URL | local `up -d`, the tunnel command, client wiring |
| **Path A** | Koyeb account (asks for payment info); (optional) R2 creds, Expo token | repo/image deploy, env, TLS, the `wss://` URL |
| **Path B** | Oracle account + CC; a domain + DNS A-records; (optional) R2 creds, Expo token; the WAC-vs-ACP pod choice | Docker + compose install, `up -d`, Caddy TLS, service wiring |

Everything after the account/provisioning/domain/secrets is the copy-paste
commands here.

---

## Path A — Koyeb (fastest, auto-TLS)

Koyeb's free tier runs one web service from a Dockerfile or a prebuilt image,
gives it a public `https://<app>.koyeb.app` domain with managed TLS, and supports
WebSockets. It **scales to zero after ~1 hour idle** — the next connection pays a
cold start. Fine for active testing; not a persistent 24/7 relay. Free-tier
services also have **no persistent disk**, so Path A hosts the **relay only**
(the relay's queue/registry are in-memory by design — see `deploy/README.md`
note 1). The pod + companion need volumes → use Path B for those.

### A1. Deploy the relay

The relay builds from the **repo root** with `deploy/relay/Dockerfile`
(`deploy/relay/railway.json` documents the same build; Koyeb doesn't read
`railway.json`, so set the Dockerfile path in Koyeb's UI).

1. Sign up at koyeb.com (GitHub login is simplest; no card required).
2. **Create Web Service** → **GitHub** and pick this repo + the branch you deploy
   from, **or** **Docker** and point at a prebuilt image if you push one.
3. Build settings:
   - **Builder: Dockerfile**, Dockerfile path `deploy/relay/Dockerfile`.
   - **Build context / work dir: the repo root** (`.`). The image does a focused
     pnpm install of `@onderling/relay...` from the workspace root — the context
     must be the root, not `deploy/relay/`.
4. **Port / health:** expose the port Koyeb injects via `$PORT`. The relay reads
   `PORT` automatically (`deploy/relay/.env.example` → `PORT`, `HOST=0.0.0.0`).
   For the health check use **HTTP GET `/`** — the relay answers `200` with
   `@onderling/relay — WebSocket endpoint only`.
5. **Env** (from `deploy/relay/.env.example`). Messaging-only needs **none**
   (Koyeb injects `PORT`). Optional:
   - Media edge (all required together): `R2_ENDPOINT`, `R2_BUCKET`,
     `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_REGION` (default `auto`),
     and **`BLOB_GATE_UPLOADERS`** (comma-separated actor ids; **empty = nobody**,
     deny-by-default — a real media deploy must set this).
   - Push wake: `PUSH_PROVIDER=expo` (+ optional `EXPO_ACCESS_TOKEN`).
   - **Do NOT set `TLS_CERT`/`TLS_KEY`** — Koyeb terminates TLS; the relay runs
     plain HTTP behind the proxy.
6. Deploy. You get `https://<app>.koyeb.app`. Clients then use:
   - messaging: **`wss://<app>.koyeb.app`**
   - media edge: **`https://<app>.koyeb.app/blob-gate`**

### A2. Point clients at it

- Relay transport: `RelayTransport({ relayUrl: 'wss://<app>.koyeb.app' })`
- Media (Vite web client): `VITE_CIRCLE_MEDIA_EDGE_URL=https://<app>.koyeb.app/blob-gate`
  (confirmed consumed at `apps/basis/web/v2/circleApp.js`).

**Caveats to keep in mind:** cold start after idle; no persistent disk (relay
offline-queue/push-registry reset on the scale-to-zero restart — matches the
current in-memory relay design). For pod + companion, or a true always-on relay,
use Path B.

> **Not verified without an account:** Koyeb's exact button labels can drift
> ("Create Web Service" / build-source picker / health-check form). The concepts
> above — Dockerfile builder + repo-root context, `$PORT`, HTTP `/` health check,
> the env keys — are correct; confirm the current UI wording on first deploy.

---

## Path B — Oracle Cloud Always-Free VM (real always-on, whole stack)

Oracle Cloud's **Always Free** tier gives a genuinely always-on VM at no cost:
either an **Ampere ARM (A1)** shape (up to 4 OCPU / 24 GB across your free
allowance) or a small **AMD `VM.Standard.E2.1.Micro`**. ARM Ampere is the roomier
pick. If Oracle capacity is unavailable in your region, **GCP's `e2-micro`**
Always-Free VM (one region, us-west1/us-central1/us-east1) is a drop-in fallback —
same Docker + Caddy steps below.

You run the full stack with `docker compose` + the TLS overlay in this repo, and
**Caddy terminates TLS → public `wss://<RELAY_DOMAIN>`**.

### B0. Provider deltas — TransIP VPS (or any plain VPS you get root on)

Path B was written against Oracle Cloud, but only **provisioning** and the
**firewall** are provider-specific. On a **TransIP VPS** — or any plain VPS with a
public IPv4 — substitute these and everything from B4 on is identical:

| Step | Oracle Cloud | TransIP (or any plain VPS) |
|---|---|---|
| **B1** provision | Always-Free ARM/AMD shape | Any VPS — the relay is tiny (1 vCPU / 2 GB is ample). Image: **Ubuntu 24.04 LTS**. Add your SSH key at order time, or under *VPS → Settings → SSH keys* (then reinstall/rescue to apply). |
| **B2** DNS | your registrar, wherever it is | **TransIP is your registrar too** → Control panel → *Domains* → `<your-domain>` → *DNS*. Add the A-records there; same panel, no third party. |
| **B3** firewall | security list **AND** OS firewall (the double gotcha) | **No security-list layer**, so the double gotcha halves. TransIP VPSes boot with an open OS firewall — usually nothing to do. Check only: (a) if you switched on the control panel's *firewall*, allow TCP **80** + **443** there; (b) if you enabled `ufw` on the box: `sudo ufw allow 80/tcp && sudo ufw allow 443/tcp`. |
| **B4–B8** | — | identical, no changes |

**IPv6:** TransIP assigns an IPv6 block. Adding `AAAA` records alongside the `A`
records is optional; Caddy serves both and Let's Encrypt validates over either.

**Sizing reality:** relay-only idles at a few tens of MB. The 2 GB tier only starts
to matter when the CSS pod + companion join it later.

### B1. Provision the VM

1. Create an Oracle Cloud account (needs a credit card for identity check; the
   Always-Free resources are not charged).
2. **Compute → Instances → Create instance.** Choose an **Always-Free-eligible**
   shape (`VM.Standard.A1.Flex`, ARM, is the recommended one; `E2.1.Micro` also
   works). Image: **Ubuntu 22.04/24.04 LTS** (these commands assume Ubuntu/Debian).
3. Add your SSH public key; note the assigned **public IP**.

### B2. DNS

Point A-records at the VM's public IP **before** first `up` (Caddy needs them to
resolve for the ACME challenge):

```
relay.example.com   A   <VM_PUBLIC_IP>
pod.example.com     A   <VM_PUBLIC_IP>
```

Use whatever domain you control; `relay.` and `pod.` are just examples matching
`deploy/.env`.

### B3. Firewall — the double-gotcha (open ONLY 80 + 443)

Oracle needs **BOTH** gates open, and this trips people up constantly:

1. **Security list / NSG (Oracle's virtual firewall):** VCN → the instance's
   subnet → Security List → **Add Ingress Rules** for TCP **80** and **443** from
   `0.0.0.0/0`. Without this, packets never reach the VM.
2. **The VM's OS firewall:** Oracle's Ubuntu images ship with restrictive
   `iptables` rules (and Oracle Linux uses `firewalld`). Opening the security
   list is **not enough** — you must also open the port inside the VM:

   ```bash
   # Ubuntu / Debian (iptables — the Oracle Ubuntu default):
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80  -j ACCEPT
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
   sudo netfilter-persistent save     # persist across reboot (iptables-persistent)

   # …or, if you use ufw instead:
   sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
   ```

**Only open 80 + 443.** The relay (8787) and pod (3000) are proxied internally by
Caddy over the Docker network — do not expose them publicly. (Compose still
publishes 8787/3000 on the host for debugging; the firewall is the real external
gate, so leaving them closed keeps them private.)

### B4. Install Docker + the compose plugin

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"   # then log out/in so `docker` runs without sudo
```

### B5. Get the code + set env

> **Private repo → use a READ-ONLY deploy key.** The VM needs read access to clone.
> On the VM: `ssh-keygen -t ed25519 -C "relay-vm" -f ~/.ssh/id_ed25519 -N ""`, then add
> the printed `~/.ssh/id_ed25519.pub` at GitHub → the repo → *Settings → Deploy keys* →
> *Add deploy key*, leaving **"Allow write access" OFF**. Then clone with the SSH URL.
> The private plan/design corpus (`plans/`, `_archive/`, root `PLAN-*`) is gitignored, so
> a deploy key exposes code only — never the private docs.

```bash
git clone git@github.com:Onderling/basis.git onderling-mono
cd onderling-mono/deploy

cp caddy/.env.example .env
# Edit .env: RELAY_DOMAIN, POD_DOMAIN, ACME_EMAIL (and optional R2_* / push).
nano .env
```

`.env` is git-ignored — do not commit it. `docker compose` auto-loads it from
`deploy/` and injects the values into Caddy (`RELAY_DOMAIN`, `POD_DOMAIN`,
`ACME_EMAIL`) and the relay (the optional `R2_*` / push keys).

### B6. Pod choice — WAC vs ACP (decide before first boot)

`deploy/css-pod/.env.example` / the compose file default to **WAC**:

- **WAC** (`CSS_CONFIG=@css:config/file.json`) — the repo's proven-green path,
  `universalAccess` works. Simplest; use this unless you specifically need ACP.
- **ACP** (`CSS_CONFIG=@css:config/file-acp.json`) — the Inrupt/ACP posture; the
  repo ships a proven direct `.acr` writer for it.

To switch to ACP, override `CSS_CONFIG` on the `pod` service (add it to the
`pod.environment` block in `docker-compose.tls.yml`, or export it before `up`).

> **Inrupt pods are HOSTED, not self-hosted.** If you want an Inrupt-ecosystem
> pod you **sign up at Inrupt PodSpaces** (start.inrupt.com) — there is no Inrupt
> pod server to run here. The "CSS + Inrupt" mix means: self-host the CSS pod with
> this compose (WAC or ACP), and separately register an Inrupt-hosted pod. This
> runbook self-hosts CSS.

### B7. Bring the stack up with TLS

```bash
# from onderling-mono/deploy, with .env filled and DNS + firewall done:

# RELAY-ONLY (recommended first bring-up — the piece that gates client testing):
docker compose -f docker-compose.yml -f docker-compose.tls.yml up -d --build caddy relay

# …or the FULL stack (relay + CSS pod + companion + Caddy):
docker compose -f docker-compose.yml -f docker-compose.tls.yml up -d --build
```

Relay-only still needs `POD_DOMAIN` set in `.env` (the Caddyfile names that site) —
point its A-record at the same IP and Caddy simply holds a valid, unused certificate
until the day you start the pod. Adding the pod later is then one command, no DNS or
cert work.

The full command builds + starts **relay + CSS pod + companion + Caddy**. Caddy requests
Let's Encrypt certs for `RELAY_DOMAIN` and `POD_DOMAIN` on first boot (needs the
DNS A-records live and 80/443 reachable — B2/B3). Certs + the ACME account key
persist in the `caddy-data` volume, so restarts don't re-issue.

Watch it come up / confirm certs:

```bash
docker compose -f docker-compose.yml -f docker-compose.tls.yml ps
docker compose -f docker-compose.yml -f docker-compose.tls.yml logs -f caddy
```

The result:

- messaging: **`wss://<RELAY_DOMAIN>`**
- media edge: **`https://<RELAY_DOMAIN>/blob-gate`**
- pod: **`https://<POD_DOMAIN>/`** (equals `CSS_BASE_URL`)

### B7a. Acceptance — run the real journeys against the deployment

`deploy/smoke` proves the wire protocol. To prove **people's journeys** work over the new relay —
circles, membership folds, sealed content, the enroll ceremony — point the existing relay walks at
it with one env var (they default to an in-process relay, so this is the same suite either way):

```bash
cd apps/basis
ONDERLING_RELAY_URL=wss://<RELAY_DOMAIN> npx vitest run relay
```

Rehearsed locally before any deploy (2026-08-22): green in-process, green against the containerised
image over `ws://`, and green through Caddy over `wss://` — so a failure here points at the
deployment (DNS, proxy, firewall), not at the code.

### B8. How the services are wired (already done for you)

The overlay wires everything on the Docker network; you don't hand-edit these:

| Wire | Value | Where |
|---|---|---|
| Companion → relay | `COMPANION_RELAY_URL=ws://relay:8787` | base compose (internal, plaintext over the compose net — no TLS hop needed internally) |
| Companion identity vault | `COMPANION_NODE_CONFIG_DIR=/data/companion` | base compose, on the `companion-data` volume (stable mesh identity across restarts) |
| Pod public URL | `CSS_BASE_URL=https://<POD_DOMAIN>/` | overlay (must equal the public pod domain — CSS bakes it into every WebID) |
| Caddy → relay | `reverse_proxy relay:8787` | `caddy/Caddyfile` (wss:// + /blob-gate) |
| Caddy → pod | `reverse_proxy pod:3000` | `caddy/Caddyfile` |
| Caddy → companion `/manage` | `handle /manage* { reverse_proxy companion:8790 }` | `caddy/Caddyfile` (only live when management is ON — see B8a) |

Client-side (your apps, not on the VM):

- `RelayTransport({ relayUrl: 'wss://<RELAY_DOMAIN>' })`
- `VITE_CIRCLE_MEDIA_EDGE_URL=https://<RELAY_DOMAIN>/blob-gate`
- pod onboarding → `https://<POD_DOMAIN>/`

### B8a. Optional — the online `/manage` interface (6d)

The companion node can serve an owner-only web dashboard (node status · tenants ·
revoke a grant) at **`https://<RELAY_DOMAIN>/manage`**, fronted by Caddy on the same
domain. It is **opt-in** and **off by default**.

To turn it on, set ONE variable in `deploy/.env`:

```bash
# your DEVICE's pubKey — the ONLY key allowed to manage this node.
# (basis → your identity; or read the companion's own host key from its logs.)
COMPANION_MANAGE_OWNER_PUBKEY=<your-device-pubkey>
```

Then `docker compose … up -d` (B7). The overlay already wires the companion to serve
on `companion:8790` (internal only — never published to the host) and Caddy to route
`/manage` there. Auth is a **pairing flow, never a password**: open
`https://<RELAY_DOMAIN>/manage`, it shows a code, you **approve that code from your
phone** (basis → your companion node → approve), and the browser gets a scoped,
revocable session token. Leave `COMPANION_MANAGE_OWNER_PUBKEY` empty and management
stays off (the `/manage` route simply has no upstream).

### B9. Update / restart

> **Prefer the box runner.** `deploy/box/install.sh` does B4–B9 in one shot and keeps the machine on
> the `live` branch by itself (a 5-minute timer, health gate, rollback) — see `deploy/box/README.md`.
> The commands below are the manual path it automates.


```bash
git pull
docker compose -f docker-compose.yml -f docker-compose.tls.yml up -d --build
```

Volumes (`pod-data`, `companion-data`, `caddy-data`) persist across this.

---

## Path C — Local stack + tunnel (ZERO account, ZERO card — best for testing)

Both Koyeb and Oracle now want payment info at signup. For *testing* you don't
need a rented host at all: run the stack you already have (`docker-compose.yml`)
on your own machine and expose it through a **tunnel** that terminates real TLS
and gives you a public `https://` / `wss://` URL. This is the fastest way to a
browser-reachable + iOS-reachable endpoint, with **no account and no card**.

Trade-off: the "host" is your machine, so *always-on = while your machine is up*.
Perfect for a test session (browser client, multi-pod, iOS wake, companion);
swap to Path B when you later want a genuinely always-on companion node.

### C1. Bring the stack up locally (no TLS overlay — the tunnel provides TLS)

```bash
# from onderling-mono/deploy, with .env filled (RELAY_* / POD_* / optional R2_*/push):
docker compose up -d          # relay :8787, CSS pod :3000, companion (internal)
```

The companion reaches the relay over the internal docker network
(`COMPANION_RELAY_URL=ws://relay:8787`) — it needs **no** tunnel of its own.
Only the two *client-facing* ports get tunnelled: relay `:8787` and pod `:3000`.

### C2. Tunnel with `cloudflared` (recommended — unlimited, no signup for a quick tunnel)

```bash
# install once (Linux): see https://developers.cloudflare.com/cloudflare-tunnel/
# then, one tunnel per client-facing port (two terminals, or run detached):
cloudflared tunnel --url http://localhost:8787   # → https://<rand-A>.trycloudflare.com  (relay)
cloudflared tunnel --url http://localhost:3000   # → https://<rand-B>.trycloudflare.com  (pod)
```

Each prints a `https://<random>.trycloudflare.com` URL that proxies WebSocket
fine → real `wss://`. **ngrok** is an equivalent fallback (`ngrok http 8787`),
simpler UX but the free tier caps connections and rotates the URL.

### C3. Point clients at the tunnel URLs

- Relay transport: `RelayTransport({ relayUrl: 'wss://<rand-A>.trycloudflare.com' })`
- Media (Vite web): `VITE_CIRCLE_MEDIA_EDGE_URL=https://<rand-A>.trycloudflare.com/blob-gate`
- Pod base: `CSS_BASE_URL=https://<rand-B>.trycloudflare.com/`

> **Pod gotcha — stable URL for the pod.** CSS bakes its public base URL into the
> WebIDs / OIDC issuer it mints, so a quick-tunnel URL that **rotates on every
> restart breaks existing WebIDs**. The relay is fine with a rotating URL (it
> holds no durable identity); the **pod is not**. For pod testing across restarts
> use a **named tunnel** instead of a quick one: a *free* Cloudflare account (still
> **no card**) + any domain you've added to Cloudflare's free plan gives you a
> stable `pod.<yourdomain>` → set `CSS_BASE_URL` to that once and it sticks. If
> you only need a single session, the quick tunnel is fine as-is.

### C4. iOS / device note

A `trycloudflare.com` (or named-tunnel) URL is a *real* public TLS endpoint, so
it satisfies iOS ATS + the browser `wss://` requirement — the same reliable-wake
and mobile-client testing you'd do against Path B works here, as long as your
machine + the tunnels stay up for the test run.

---

## The confidential LLM proxy — not deployable here

There is no server to host for the confidential LLM path: `deploy/llm-proxy/` is
the **client** side only (attestation verifier). A stock container can't produce
the SEV-SNP/TDX attestation the client enforces, so it's deliberately not a PaaS
service. For early testing route ordinary LLM calls through a normal provider;
for a real attested route point `createConfidentialLlm` at a managed confidential
endpoint (e.g. Privatemode). Full detail: `deploy/llm-proxy/README.md`.

---

## Recap — what Frits still must provide

- **Path A (Koyeb):** a Koyeb account. Optional: R2 creds (media), Expo token
  (push). Everything else — build, env, TLS, the `wss://` URL — is above.
- **Path B (Oracle VM):** an Oracle account + credit card (verification only), a
  **domain** with A-records for `RELAY_DOMAIN`/`POD_DOMAIN`, and the WAC-vs-ACP
  pod decision. Optional: R2 creds, Expo token. The provision→deploy→TLS→wiring
  commands are all above.
- **Path C (local + tunnel):** *nothing* — no account, no card. Just `cloudflared`
  (or `ngrok`) installed and your machine up for the test run. Optional free
  Cloudflare account (still no card) if you want a stable pod URL across restarts.

**For testing right now, Path C is the recommendation** — it's the only path with
no signup wall, and it gives the same real `wss://` endpoint the clients need.

## Validation status of these configs

- `docker compose -f docker-compose.yml -f docker-compose.tls.yml config` — **validated** (merges cleanly; pod `CSS_BASE_URL` → HTTPS domain, Caddy on 80/443, relay env passthrough).
- Base `docker-compose.yml config` — **validated** standalone (local no-TLS dev still works).
- `caddy/Caddyfile` — **validated** with `caddy validate` (caddy:2 image); formatted with `caddy fmt`.
- Not run end-to-end (no cloud host / accounts here). A live cert issue + a real
  browser `wss://` handshake should be confirmed on first deploy. Koyeb's exact
  UI wording is the one step described by concept rather than verified buttons.
