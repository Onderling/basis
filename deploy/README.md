# deploy/ — one-push PaaS deploy for the Onderling backend services

This directory makes the Onderling backend **one-push-deployable to a PaaS**
(Railway is the default; Fly.io / Render are portable equivalents). It contains,
per service, a portable **Dockerfile**, a **`railway.json`**, and an
**`.env.example`**, plus a local **`docker-compose.yml`** that runs the whole
stack in containers.

**What's deployable today**

| Service | Dir | Status | Persistent volume |
|---|---|---|---|
| **Relay** (messaging + media edge + push wake) | `relay/` | ✅ **build + BOOT + wire-protocol verified** 2026-08-22 (image boots; `deploy/smoke` 8/8 against the container: two-party delivery, offline hold + flush, fan-out) | none required¹ |
| **Companion node** (folio agent over the mesh) | `companion-node/` | ✅ builds; uses the package's own `bin` | **yes** — identity vault |
| **Solid pod** (Community Solid Server) | `css-pod/` | ✅ standalone CSS image (not the monorepo) | **yes** — pod data |
| **llm-proxy** (confidential LLM) | `llm-proxy/` | ⛔ **no server to host** — see `llm-proxy/README.md` | — |

¹ The relay's offline queue is in-memory: **a relay restart drops whatever it was
holding for offline devices.** Bounded in practice — the lanes' own catch-ups
(membership/governance/keys pull-all, chat/tasks frontier replay) re-deliver from the
SENDERS' logs when devices next meet, so the queue is an optimisation, not the record.
A durable `SqliteQueueStore` class exists in the package but has **no consumer** —
`ForwardQueue` takes no store (see REMAINING-WORK's ledger). The push-token registry
DOES persist when you set `PUSH_TOKENS_DB`.

## Self-updating VPS: `deploy/box/`

For a machine you get root on, `deploy/box/install.sh` installs Docker, clones the repos at `live`,
asks for a profile and hostnames, brings the roles up behind Caddy and installs a timer that keeps the
box on the release branch (health gate, rollback, `HOLD` to freeze). Roles are compose fragments under
`deploy/roles/` (this repo: `relay`, `caddy`); another repo plugs in by honouring the same three-file
contract. → [`deploy/box/README.md`](box/README.md).

## The monorepo-in-Docker approach (why the Dockerfiles look the way they do)

The relay + companion live in a **pnpm workspace** (`node-linker=hoisted`,
`link-workspace-packages=true`, `shared-workspace-lockfile=false`). A standalone
image therefore:

1. **Builds from the repo ROOT** (`context = .`), so the whole workspace is present.
2. Does a **focused install** — `pnpm install --filter "<pkg>..."` — which pulls
   only that service **plus its workspace dependency subtree**, never the 17
   RN/Expo apps. The root **`.dockerignore`** additionally drops mobile build
   artifacts + private docs so the build context stays small.
3. Because `shared-workspace-lockfile=false`, pnpm installs **per-package**
   (`packages/<pkg>/node_modules`) — there is **no root `node_modules`**. So the
   relay's deploy entrypoint imports the relay by its **real workspace path**
   (`../../packages/relay/index.js`), not the `@onderling/relay` bare specifier. The
   package's own `@onderling/*` deps still resolve from its own `node_modules`.
4. `better-sqlite3` is native → the image installs `python3 make g++` to build it.

The **CSS pod is different**: Community Solid Server is an independent npm package
(no Onderling deps), so `css-pod/Dockerfile` builds standalone from `deploy/css-pod`
(a small, fast image) rather than the monorepo.

## Deploy order (do this top-to-bottom)

The relay is the linchpin — everything else points at it. Deploy in this order.

> **Self-hosting on your own VM/VPS?** This section is the PaaS path. For a VPS you get
> root on (TransIP, Hetzner, Oracle, …) use `DEPLOY-RUNBOOK.md` **Path B** — Docker
> Compose + the TLS overlay + Caddy/Let's Encrypt, with the provider deltas in **B0**
> and a relay-only first bring-up in **B7**.

### 1. Relay (first — everything attaches to it)

1. Create a Railway project → **New Service → Deploy from Repo** → point it at this
   repo, branch `feat/paas-deploy-configs`.
2. In the service settings set **Config-as-code path** to `deploy/relay/railway.json`
   (or set the Dockerfile path to `deploy/relay/Dockerfile` manually). Build context
   is the repo root.
3. Set env from `relay/.env.example`. For messaging-only, none are required (Railway
   injects `PORT`). For the **media edge**, set the `R2_*` block + `BLOB_GATE_UPLOADERS`.
   For **push**, set `PUSH_PROVIDER=expo` (+ optional `EXPO_ACCESS_TOKEN`).
4. Add a **public domain** (Railway → Settings → Networking → Generate Domain, or a
   custom domain). The PaaS terminates TLS, so:
   - clients connect at **`wss://<relay-domain>`**
   - the media edge is **`https://<relay-domain>/blob-gate`**
5. **Do NOT set `TLS_CERT`/`TLS_KEY`** — the relay runs plain HTTP behind the proxy.

### 2. Solid pod (CSS) — the real pod

1. New Service → this repo → config path `deploy/css-pod/railway.json` (Dockerfile
   `deploy/css-pod/Dockerfile`, context `deploy/css-pod`).
2. Attach a **Volume** at `/data/pod` (Railway → service → Volumes).
3. Set env from `css-pod/.env.example`. **Critical:** `CSS_BASE_URL` must equal the
   service's **public URL** (CSS bakes it into every WebID). Set the domain first,
   then set `CSS_BASE_URL=https://<pod-domain>/`, then deploy.
4. **Pod-target decision (yours):**
   - **WAC** (default): `CSS_CONFIG=@css:config/file.json` — the repo's proven-green
     path (`universalAccess` works).
   - **ACP**: `CSS_CONFIG=@css:config/file-acp.json` — the Inrupt/ACP posture; the
     repo has a proven **direct `.acr` writer** for it (`css-acp-writer-harness.mjs`).

### 3. Companion node (attaches to the relay)

1. New Service → this repo → config path `deploy/companion-node/railway.json`.
2. Attach a **Volume** at `/data/companion` (the host identity vault — the mesh
   address must be stable across restarts, so devices keep trusting it).
3. Set env from `companion-node/.env.example`:
   - `COMPANION_RELAY_URL=wss://<relay-domain>` — the relay from step 1.
   - `COMPANION_NODE_CONFIG_DIR=/data/companion` (matches the volume).

### 4. Wire the clients

Point the apps at the deployed stack:
- `RelayTransport({ relayUrl: 'wss://<relay-domain>' })`
- `VITE_CIRCLE_MEDIA_EDGE_URL=https://<relay-domain>/blob-gate` (media)
- pod onboarding → the CSS pod at `https://<pod-domain>/`

## Local full stack (containers) — for the automated harness

```bash
docker compose -f deploy/docker-compose.yml up --build
#   relay      ws://localhost:8787
#   pod (CSS)  http://localhost:3000/
#   companion  connects to relay, hosts the folio agent
```

This is the deployable stack the e2e harness (PLAN §2) can run against on one
machine before pushing to a PaaS.

## Fly.io / Render equivalents (Railway is default, all portable)

The Dockerfiles are plain — nothing is Railway-specific. To retarget:

**Fly.io** (`fly.toml`, per service — `fly launch --dockerfile deploy/relay/Dockerfile`):
```toml
app = "onderling-relay"
[build]
  dockerfile = "deploy/relay/Dockerfile"
[http_service]
  internal_port = 8787
  force_https = true
[[mounts]]              # companion + css only
  source = "data"
  destination = "/data"
```
Fly volumes: `fly volumes create data --size 1`. Set the internal port to 3000 for
the CSS pod.

**Render** (`render.yaml`):
```yaml
services:
  - type: web
    name: onderling-relay
    runtime: docker
    dockerfilePath: deploy/relay/Dockerfile
    dockerContext: .
  - type: web
    name: onderling-pod
    runtime: docker
    dockerfilePath: deploy/css-pod/Dockerfile
    dockerContext: deploy/css-pod
    disk: { name: pod, mountPath: /data/pod, sizeGB: 1 }
```

On every PaaS the same rules hold: proxy terminates TLS (no TLS env on the relay);
attach volumes for the companion (`/data/companion`) and pod (`/data/pod`);
`CSS_BASE_URL` must equal the pod's public URL.

## What Frits still needs to provide

- **A PaaS account** (Railway) + a **domain** (or use the generated `*.railway.app`).
- **The pod-target decision** — WAC vs ACP (step 2.4).
- **An R2 bucket** + S3 creds (for the media edge) — `R2_*` in `relay/.env.example`.
- **One push credential** (Expo token) — only if enabling push wake.
- **`BLOB_GATE_UPLOADERS`** — the actor ids allowed to upload media (deny-by-default).

Everything above is turnkey: connect the repo, set env, deploy. No service code
changes are required to go live.
