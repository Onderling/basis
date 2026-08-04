#!/usr/bin/env bash
#
# reconstruct-tree.sh — rebuild the working node_modules after `pnpm install`.
#
# WHY THIS EXISTS (and why it is a script, not a note):
# Internal deps are still wired with the `file:` protocol. pnpm COPIES a `file:`
# dependency instead of symlinking it, and a copied package cannot resolve its own
# `workspace:` deps — so a clean `pnpm install` produces a tree where mid-graph
# packages (e.g. @onderling/logger, @onderling/core) go missing and most suites
# fail to collect. Until the `file:`->`workspace:*` migration (the batch-2
# workspace-protocol cleanup) removes the copies for good, THIS script converts the
# copies to symlinks — exactly the layout `workspace:*` would produce — and
# materialises a few external deps that are imported but not hoisted by the flat
# layout. Idempotent: safe to run repeatedly; only fixes what is not already a link.
#
# THE FULL REBUILD FROM A CLEAN CHECKOUT IS THEREFORE:
#     pnpm install            # uses the pinned pnpm + the pnpm.overrides in package.json
#     bash scripts/reconstruct-tree.sh
#
# This is the guaranteed path back to the current working tree. Nothing here is
# destructive beyond replacing a copied dependency dir with a symlink to its source.

set -euo pipefail
cd "$(dirname "$0")/.."

log() { printf '  %s\n' "$*"; }

# 1) app-level @onderling copies -> symlinks to the real package (../../../../packages/<name>)
app_links=0
for app in apps/*; do
  [ -d "$app/node_modules/@onderling" ] || continue
  for d in "$app"/node_modules/@onderling/*; do
    [ -e "$d" ] || continue
    [ -L "$d" ] && continue
    name=$(basename "$d")
    [ -d "packages/$name" ] || continue
    rm -rf "$d"
    ln -s "../../../../packages/$name" "$d"
    app_links=$((app_links + 1))
  done
done
log "app-level copies -> symlinks: $app_links"

# 2) package-level @onderling copies -> symlinks to the real package (../../../<name>)
pkg_links=0
for pkg in packages/*; do
  [ -d "$pkg/node_modules/@onderling" ] || continue
  for d in "$pkg"/node_modules/@onderling/*; do
    [ -e "$d" ] || continue
    [ -L "$d" ] && continue
    name=$(basename "$d")
    [ -d "packages/$name" ] || continue
    rm -rf "$d"
    ln -s "../../../$name" "$d"
    pkg_links=$((pkg_links + 1))
  done
done
log "package-level copies -> symlinks: $pkg_links"

# 3) external deps imported-but-not-hoisted by the flat layout. These ARE declared now
#    (see the recovery commit), so a fresh install usually provides them; this is an
#    idempotent safety net that links them from an existing install if they are absent.
ensure_link() { # <link-path> <relative-source>
  if [ ! -e "$1" ]; then
    mkdir -p "$(dirname "$1")"
    ln -s "$2" "$1"
    log "linked $(basename "$(dirname "$1")")/$(basename "$1")"
  fi
}
ensure_link packages/pod-client/node_modules/@noble/hashes  ../../../core/node_modules/@noble/hashes
ensure_link packages/transports/node_modules/tweetnacl      ../../core/node_modules/tweetnacl
ensure_link packages/secure-agent/node_modules/tweetnacl    ../../core/node_modules/tweetnacl
ensure_link apps/basis/node_modules/tweetnacl               ../../../packages/core/node_modules/tweetnacl
ensure_link apps/basis/node_modules/nkn-sdk                 ../../../packages/transports/node_modules/nkn-sdk
# internal workspace dep used only by a test, declared but not always hoisted into the leaf:
ensure_link packages/item-store/node_modules/@onderling/item-types  ../../../item-types

echo "tree reconstructed — run a suite (e.g. 'cd apps/stoop && npx vitest run') to confirm."
