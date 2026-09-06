# The basis assistant on Telegram — the personal box's bot (apps/basis/bin/telegram-runner.mjs):
# the same assistant engine the web and mobile shells use, reached through a Telegram bot, with the
# household lists in a data dir. Same monorepo-in-Docker shape as the relay + companion images.
#
#   Build context = repo ROOT (the pnpm workspace):
#     docker build -f deploy/assistant/Dockerfile -t onderling-assistant .
FROM node:20-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.33.4 --activate

WORKDIR /app
COPY . .

# Focused install, then the second half of installing in this tree: relink-workspace materialises the
# @onderling/* links a per-package install leaves out (a transitive workspace dep of a workspace dep
# — e.g. app-manifest → item-types — is otherwise unresolvable at runtime). See CLAUDE.md.
RUN pnpm install --filter "@onderling-app/basis..." \
 && node scripts/relink-workspace.mjs \
 && pnpm store prune || true

ENV NODE_ENV=production
RUN mkdir -p /data/assistant
VOLUME ["/data/assistant"]

# TG_BOT_TOKEN · TG_ALLOWED_CHAT_IDS · PRIVATEMODE_API_KEY come from the box's .env (roles/assistant.yml).
CMD ["node", "apps/basis/bin/telegram-runner.mjs", "--data-dir", "/data/assistant", "--walk-log", "/data/assistant/walks/"]
