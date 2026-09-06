# @onderling-app/companion-node — PaaS image.
#
#   Build context = repo ROOT (the pnpm workspace):
#     docker build -f deploy/companion-node/Dockerfile -t onderling-companion .
#
# Focused install of the companion + its dependency subtree (it pulls @onderling/*
# packages AND @onderling-app/folio). Uses the package's own bin (src/boot.js),
# which already reads COMPANION_RELAY_URL / PORT / HOST / COMPANION_NODE_CONFIG_DIR.
# pinned by digest so a rollback rebuilds EXACTLY the previous release (deploy/box); re-vet + re-pin to update
FROM node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.33.4 --activate

WORKDIR /app
COPY . .

RUN pnpm install --filter "@onderling-app/companion-node..." \
 && pnpm store prune || true

ENV NODE_ENV=production
# Persistent identity vault (host keypair). Mount a volume here so the host's
# mesh identity survives restarts/redeploys.
ENV COMPANION_NODE_CONFIG_DIR=/data/companion
RUN mkdir -p /data/companion

# The companion connects OUT to the deployed relay (COMPANION_RELAY_URL); it does
# not need an inbound port of its own. If you run it with a local in-process relay
# (no COMPANION_RELAY_URL), expose PORT.
CMD ["node", "apps/companion-node/src/boot.js"]
