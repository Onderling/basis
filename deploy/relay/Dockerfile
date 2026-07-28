# @onderling/relay — PaaS image.
#
#   Build context = repo ROOT (the pnpm workspace):
#     docker build -f deploy/relay/Dockerfile -t onderling-relay .
#
# The relay lives in a pnpm monorepo whose @onderling/* deps resolve as workspace
# links (node-linker=hoisted, link-workspace-packages=true). A standalone image
# therefore builds from the workspace root and does a FOCUSED install of just the
# relay + its dependency subtree (`--filter "@onderling/relay..."`) — never the 17
# RN/Expo apps. `better-sqlite3` is a native module → build toolchain in one stage.
FROM node:20-bookworm-slim

# native build deps for better-sqlite3 (kept minimal; slim base + prune after)
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.33.4 --activate

WORKDIR /app
COPY . .

# Focused install: relay + its workspace dependency subtree only.
RUN pnpm install --filter "@onderling/relay..." \
 && pnpm store prune || true

ENV NODE_ENV=production
ENV HOST=0.0.0.0
# PaaS injects PORT; default matches the relay's historical port.
ENV PORT=8787
EXPOSE 8787

# Runs plain HTTP behind the PaaS proxy (proxy terminates TLS → public wss://).
CMD ["node", "deploy/relay/entrypoint.mjs"]
