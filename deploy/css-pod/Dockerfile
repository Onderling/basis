# Community Solid Server (CSS) — deployable Solid pod image.
#
#   Build context = deploy/css-pod (self-contained; NOT the monorepo):
#     docker build -f deploy/css-pod/Dockerfile -t onderling-pod deploy/css-pod
#
# CSS is an independent npm package (@solid/community-server, pinned at 7.2.0) — it does NOT
# depend on the onderling workspace, so this image is small and standalone. The repo
# harnesses (packages/pod-client/scripts/css-*.mjs) boot exactly this via
# `npx @solid/community-server@7.2.0 -c <config>`; here we pin it into the image.
FROM node:20-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*

# Pin CSS into the image at the EXACT version the repo's harnesses and browser walks test (scripts/css-harness.mjs):
# a new release must not change what our pods do without a test run on it.
RUN npm install -g @solid/community-server@7.2.0

# Persistent pod storage — MOUNT A VOLUME here (WebIDs + all pod data live here).
ENV CSS_ROOT_FILE_PATH=/data/pod
RUN mkdir -p /data/pod

# WAC (@css:config/file.json) vs ACP (@css:config/file-acp.json) — Frits's
# pod-target decision. Default WAC (the repo's green path); override CSS_CONFIG.
ENV CSS_CONFIG=@css:config/file.json
ENV CSS_PORT=3000
# CSS bakes WebIDs with the base URL → it MUST match the public domain.
ENV CSS_BASE_URL=http://localhost:3000/

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--", "/entrypoint.sh"]
