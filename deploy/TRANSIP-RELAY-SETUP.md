# Bringing the relay up on your TransIP VPS

A single linear path: **domain → server → Docker → repo → env → up → verify.** Every command is
copy-paste. Expected output is shown after each step, so you can tell "worked" from "looked like it
worked". Nothing here needs a decision except the two values in step 0.

This puts the **relay only** on the box (Caddy + relay). The Solid pod and the companion node use
the same compose file and can be added later with one command — step 9 shows how.

> **Why a domain at all:** browsers refuse a WebSocket from an `https://` page unless it is real
> `wss://` over valid TLS, and Let's Encrypt only issues certificates for **names**, never bare IPs.
> That is the entire reason this isn't just "run it on the IP".

---

## 0. The two values you choose

| | value | used for |
|---|---|---|
| `RELAY_DOMAIN` | **`relay.onderling.org`** (suggested) | what clients connect to: `wss://relay.onderling.org` |
| `POD_DOMAIN` | **`pod.onderling.org`** (suggested) | the Solid pod later — **create its DNS record now anyway**, see step 1 |

Write down your VPS's **public IPv4** from the TransIP control panel (*VPS → your VPS → the
"IP addresses" panel*). Everything below calls it `<VPS_IP>`.

---

## 1. DNS at TransIP (do this first — certificates depend on it)

TransIP is both your VPS host and your registrar, so this is one panel:

**Control panel → Domains → `onderling.org` → DNS.** Add two A-records:

| name | type | TTL | value |
|---|---|---|---|
| `relay` | A | 300 | `<VPS_IP>` |
| `pod` | A | 300 | `<VPS_IP>` |

Add `pod` even though the pod isn't running yet: it costs nothing, and it means Caddy gets that
certificate now, so adding the pod later needs **no DNS work and no certificate wait**.

Give it a minute, then check from your laptop — this must print your VPS IP before you go on:

```bash
dig +short relay.onderling.org
dig +short pod.onderling.org
```

> A short TTL (300) is deliberate while setting up: if you ever move the box, the change propagates
> in minutes instead of hours. You can raise it later.

---

## 2. Log in and take five minutes of hygiene

```bash
ssh root@<VPS_IP>          # or your non-root user, if you set one up at order time

# system up to date
apt-get update && apt-get -y upgrade

# a clock that is right — TLS and signatures both care
timedatectl set-ntp true; timedatectl | head -3
```

**Firewall.** A TransIP VPS has *no* separate cloud firewall layer to fight (unlike Oracle) — there
is only the OS. Two checks:

```bash
# 1) is ufw active on this box?
ufw status

#    if it says "Status: active", open the two ports Caddy needs:
ufw allow 80/tcp && ufw allow 443/tcp

# 2) if you switched ON the firewall in the TransIP control panel,
#    allow TCP 80 and 443 there as well. If you never touched it, skip.
```

Ports **80 and 443 only**. The relay's own port (8787) stays private — Caddy reaches it inside
Docker's network, and nothing outside should.

---

## 3. Install Docker + the compose plugin

```bash
apt-get install -y ca-certificates curl git
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Check:

```bash
docker --version && docker compose version
```

> Expected: a Docker version ≥ 24 and a Compose version ≥ 2. Docker starts on boot by default, and
> the compose services are marked `restart: unless-stopped`, so the relay comes back by itself after
> a reboot.

---

## 4. Give the server read-only access to the repo

The repo is private, so the box needs its own key. Generate it **on the VPS**:

```bash
ssh-keygen -t ed25519 -C "relay-vps" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
```

Copy that one line, then in the browser: **GitHub → the `Onderling/basis` repo → Settings → Deploy
keys → Add deploy key**. Title it `relay-vps`, paste the key, and leave **"Allow write access"
OFF**.

Verify from the VPS:

```bash
ssh -T git@github.com     # expect: "Hi Onderling/basis! You've successfully authenticated…"
```

> Your private plans, designs and notes (`plans/`, `_archive/`, root `PLAN-*`) are gitignored and
> live only on your laptop — a deploy key exposes code, never those.

---

## 5. Clone and configure

```bash
cd /opt
git clone git@github.com:Onderling/basis.git onderling
cd onderling/deploy

cp caddy/.env.example .env
nano .env
```

Set exactly these three (leave the optional blocks commented out for now):

```ini
RELAY_DOMAIN=relay.onderling.org
POD_DOMAIN=pod.onderling.org
ACME_EMAIL=fritsderoos@gmail.com
```

`.env` is gitignored — it never travels back.

---

## 6. Bring it up

From `/opt/onderling/deploy`:

```bash
docker compose -f docker-compose.yml -f docker-compose.tls.yml up -d --build caddy relay
```

The first build takes a few minutes (it compiles a native SQLite module). Then:

```bash
docker compose -f docker-compose.yml -f docker-compose.tls.yml ps
```

> Expected: `caddy` and `relay` both `Up`. Only caddy publishes ports (80, 443).

Watch Caddy get the certificates — this is the step that either just works or tells you exactly
what's wrong:

```bash
docker compose -f docker-compose.yml -f docker-compose.tls.yml logs caddy | grep -i "certificate\|error"
```

> Expected: lines like `certificate obtained successfully` for **both** domains. Certificates and
> the ACME account key live in the `caddy-data` volume — **don't delete that volume**, or you
> re-issue from scratch and can hit Let's Encrypt's rate limits.

---

## 7. Verify it for real

**a. From the VPS — the relay answers over TLS:**

```bash
curl -s https://relay.onderling.org/
```

> Expected exactly: `@onderling/relay — WebSocket endpoint only`

**b. From the VPS — the full wire protocol** (this is the one that matters: it proves registration,
two-party delivery, offline hold-and-flush, and fan-out):

```bash
docker compose -f docker-compose.yml -f docker-compose.tls.yml exec relay \
  sh -lc 'cp /app/deploy/smoke/smoke.mjs /app/packages/relay/_smoke.mjs \
          && node /app/packages/relay/_smoke.mjs wss://relay.onderling.org'
```

> Expected: `=== 8/8 checks passed ===`
>
> (The copy is needed because this workspace installs per package — the script must sit next to a
> `node_modules` that has `ws`.)

**c. From your laptop** — same command, run against the public name, proving it works from outside
your server:

```bash
cd ~/expotest/canopy-mono/packages/relay
node ../../deploy/smoke/smoke.mjs wss://relay.onderling.org
```

**d. From your laptop — the FULL journey acceptance run** (the strongest check there is: the same
walks a person makes — circles, membership, sealed content, the enroll ceremony — driven over the
relay you just deployed, instead of an in-process one):

```bash
cd ~/expotest/canopy-mono/apps/basis
ONDERLING_RELAY_URL=wss://relay.onderling.org npx vitest run relay
```

> Expected: **15 files / 57 tests passed**. If exactly `chatRealReceive.relay.repro` and/or
> `governanceRealReceive.relay.repro` fail with *"Test timed out in 5000ms"* at an agent-boot line,
> that is the known load flake, not your relay — re-run those two files alone and they pass.

If all four pass, the relay is live, correct, and the apps can use it.

---

## 8. Point the apps at it

- Web/mobile transport: `RelayTransport({ relayUrl: 'wss://relay.onderling.org' })`
- Media edge (only once you enable R2): `https://relay.onderling.org/blob-gate`

---

## 9. Later, without redoing any of this

```bash
cd /opt/onderling && git pull                       # update to a newer build
cd deploy && docker compose -f docker-compose.yml -f docker-compose.tls.yml up -d --build caddy relay

# add the Solid pod + companion when you want them (DNS is already in place):
docker compose -f docker-compose.yml -f docker-compose.tls.yml up -d --build

# push wake (only gates waking a CLOSED phone; messaging works without it):
#   add PUSH_PROVIDER=expo to .env, then re-run the up command
```

---

## If something goes wrong

| Symptom | Cause | Fix |
|---|---|---|
| Caddy logs `no such host` / ACME challenge fails | DNS not live yet, or points elsewhere | `dig +short relay.onderling.org` must print `<VPS_IP>`; wait for TTL, then `docker compose … restart caddy` |
| ACME times out; port 80 unreachable | firewall | `ufw status` → allow 80/tcp + 443/tcp; check the TransIP control-panel firewall too |
| `curl https://…` hangs, `curl http://…` works | 443 blocked but 80 open | same as above — open 443 |
| Relay container restarts in a loop | check the reason, don't guess | `docker compose … logs relay \| tail -30` |
| Smoke: `register timeout` | you're running an **old** relay image or an old smoke script | `git pull` on the VPS, then re-run step 6 (the handshake is challenge-first; both sides must be current) |
| Smoke: `Cannot find package 'ws'` | script run from a directory with no `node_modules` | use the exact command in 7b (it copies the script next to the relay's own `node_modules`) |
| Everything fine, but a phone on mobile data can't connect | app still pointing at the old/local relay | step 8 — the client URL must be `wss://relay.onderling.org` |

**Rate-limit caution:** Let's Encrypt allows ~5 certificates per domain per week. If you find
yourself re-issuing repeatedly while debugging, uncomment the `acme_ca` staging line in
`deploy/caddy/Caddyfile`, get it working, then remove it for real certificates.
