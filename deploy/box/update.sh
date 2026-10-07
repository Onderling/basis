#!/usr/bin/env bash
# deploy/box/update.sh — keep a box on the release branch of every repo it runs.
#
# Run by the systemd timer every minute (or by hand). Deterministic and boring:
#   1. HOLD present → do nothing.
#   2. per repo: ask the remote for the release branch's sha (`ls-remote`, one request); the same sha as
#      state.json → nothing to do, nothing fetched. Otherwise fetch it (with its tags).
#   3. otherwise check the new sha out (detached), rebuild + restart the roles from that repo,
#   4. wait for every enabled role's health script (HEALTH_TIMEOUT, 60 s),
#   5. green → write state.json; red → check the previous sha back out, restart, write
#      state.json with rolledBack + the failing role, and say so (log + one Telegram line).
# It never touches .env. It never runs a migration: a release that needs a data reset says so in its
# tag message ("RESET") and is refused unless ALLOW_RESET=1 is in the environment.
#
#   BOX_DIR=/opt/onderling deploy/box/update.sh            # the timer runs exactly this
#   BOX_DIR=… FORCE=1 deploy/box/update.sh                 # rebuild even without a new sha
#
# A release this box rolled back or refused (RESET) is tried again after RETRY_AFTER seconds (300, the old
# timer's rhythm), not on every one-minute tick: `.refused-<repo>` holds its sha and when.

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"
load_conf
# Work from the box directory: the timer and `sudo -u onderling` both inherit a cwd the box user may not
# read (root's shell in /home/ubuntu, mode 750) and docker compose stats "." before doing anything.
cd "$BOX_DIR"

# The roles a release touches: of the changed repos' roles, those whose declared build paths saw a change.
# FORCE (the install's first bring-up) and a repo we cannot diff mean "all of them".
affected_roles() {
  local out=() name r list
  for name in "$@"; do
    list="$BOX_DIR/.changed-$name"
    if [ "${FORCE:-0}" = 1 ] || [ ! -s "$list" ]; then
      for r in $(roles_of_repo "$name"); do out+=("$r"); done
    else
      for r in $(roles_of_repo "$name"); do role_affected "$r" "$list" && out+=("$r"); done
    fi
  done
  [ ${#out[@]} -eq 0 ] || printf '%s\n' "${out[@]}"
}

apply() {   # build the affected roles, bring the stack up, reload Caddy when its rendered file changed
  local cmd; cmd="$(compose_cmd)"
  local caddy_changed=1
  if render_caddyfile; then caddy_changed=0; fi
  local roles=(); mapfile -t roles < <(affected_roles "$@")
  if [ ${#roles[@]} -eq 0 ]; then
    log "no role's build paths changed — nothing to rebuild"
  else
    eval "$cmd build --pull ${roles[*]}"
  fi
  REBUILT_ROLES=" ${roles[*]+${roles[*]}} "; export REBUILT_ROLES
  eval "$cmd up -d --remove-orphans"
  if [ "$caddy_changed" = 0 ]; then reload_caddy || true; fi
  return 0
}

# BY HAND, back to the version before the newest green one (`ROLLBACK=1`): for the release whose health gate was green
# but which the household says is wrong. The abandoned version is not taken again on the next tick; a newer one is.
if [ "${ROLLBACK:-0}" = 1 ]; then
  rolled=()
  for name in $(repo_names); do
    d="$(repo_dir "$name")"; target="$(prevgood_sha "$name")"
    [ -n "$target" ] || continue
    cur="$($GIT -C "$d" rev-parse HEAD)"
    [ "$target" = "$cur" ] && continue
    $GIT -C "$d" diff --name-only "$target" "$cur" > "$BOX_DIR/.changed-$name" 2>/dev/null || : > "$BOX_DIR/.changed-$name"
    echo "$cur" > "$BOX_DIR/.abandoned-$name"
    $GIT -C "$d" checkout -q -f "$target"
    mv "$BOX_DIR/.prevgood-$name" "$BOX_DIR/.good-$name"   # the restored version is the good one again
    rolled+=("$name")
  done
  [ ${#rolled[@]} -eq 0 ] && { log "ROLLBACK: no earlier good version to return to"; exit 1; }
  if apply "${rolled[@]}" && failed="$(health_gate)"; then
    write_state true
    log "rolled back by hand: ${rolled[*]} — healthy"; alert "rolled back by hand: ${rolled[*]}"
    exit 0
  fi
  write_state true "${failed:-build}"
  log "rolled back by hand: ${rolled[*]} — health gate RED (role: ${failed:-build})"; alert "rollback by hand of ${rolled[*]} is not healthy"
  exit 1
fi

[ -f "$BOX_DIR/HOLD" ] && { log "HOLD present — not updating"; exit 0; }

# THE FRESH EXPORT COMES FIRST: before the first checkout, the running assistant writes the household's export named by
# the outgoing version (the shelf in its data dir; `bin/export-now.mjs`). If it fails the update is HELD — nothing is
# checked out — and says so. An assistant that is NOT running cannot be asked: the update goes ahead only when its shelf
# already holds an export younger than a day (the honest floor); otherwise it is held too — a broken assistant is
# exactly when a fresh export is worth waiting for.
exported=0
pre_update_export() {   # pre_update_export <outgoing sha>
  [ "$exported" = 1 ] && return 0
  exported=1
  role_names | grep -qx assistant || return 0
  local cmd; cmd="$(compose_cmd)"
  if ! eval "$cmd ps --status running --services" 2>/dev/null | grep -qx assistant; then
    # read its volume without starting it: an export file on its shelf from the last day
    if [ -n "$(eval "$cmd run --rm --no-deps -T --entrypoint sh assistant -c \"find /data/assistant/exports -maxdepth 1 -name '*.json' -mmin -1440 2>/dev/null | head -1\"" 2>/dev/null)" ]; then
      log "assistant not running — its shelf holds an export younger than a day; going ahead"; return 0
    fi
    HOLD_REASON="assistant not running and no export younger than a day"
    return 1
  fi
  if eval "$cmd exec -T assistant node apps/basis/bin/export-now.mjs --sha $1" >>"$BOX_DIR/box.log" 2>&1; then
    log "pre-update export written ($1)"; return 0
  fi
  return 1
}

changed=()
declare -A previous tried
for name in $(repo_names); do
  d="$(repo_dir "$name")"; br="$(repo_branch "$name")"
  [ -d "$d/.git" ] || die "repo $name not cloned at $d"
  cur="$(state_sha "$name")"
  [ -z "$cur" ] && cur="$($GIT -C "$d" rev-parse HEAD)"
  previous[$name]="$cur"
  # ask first, fetch only on news: one small request a minute, nothing written while the branch stands still
  # (a failed ask falls through to the fetch, which says so itself)
  if [ "${FORCE:-0}" != 1 ]; then
    remote="$($GIT -C "$d" ls-remote -q origin "refs/heads/$br" 2>>"$BOX_DIR/box.log" | cut -f1)" || remote=""
    [ -n "$remote" ] && [ "$remote" = "$cur" ] && continue
    # a release rolled back BY HAND is not taken again; a newer one is
    [ -n "$remote" ] && [ "$remote" = "$(cat "$BOX_DIR/.abandoned-$name" 2>/dev/null)" ] && continue
    # a release this box refused (RESET) or rolled back is tried again at the old five-minute rhythm, not every
    # minute — no rebuild loop, no alert a minute (ALLOW_RESET asks again at once)
    if [ -n "$remote" ] && [ -f "$BOX_DIR/.refused-$name" ] && [ "${ALLOW_RESET:-0}" != 1 ]; then
      read -r rsha rat < "$BOX_DIR/.refused-$name" || true
      if [ "$remote" = "${rsha:-}" ] && [ $(( $(date +%s) - ${rat:-0} )) -lt "${RETRY_AFTER:-300}" ]; then continue; fi
    fi
  fi
  $GIT -C "$d" fetch -q origin "$br" --tags 2>>"$BOX_DIR/box.log" || { log "fetch failed for $name — keeping $(state_sha "$name")"; continue; }
  new="$($GIT -C "$d" rev-parse "origin/$br")"
  if [ "$new" = "$cur" ] && [ "${FORCE:-0}" != 1 ]; then continue; fi
  if [ "${FORCE:-0}" != 1 ] && [ "$new" = "$(cat "$BOX_DIR/.abandoned-$name" 2>/dev/null)" ]; then continue; fi
  msg="$($GIT -C "$d" tag -l --format='%(contents:subject)' --points-at "$new" 2>/dev/null | head -1)"
  if [[ "$msg" == *RESET* ]] && [ "${ALLOW_RESET:-0}" != 1 ]; then
    log "$name: $new is tagged RESET — refusing without ALLOW_RESET=1"; alert "$name: release $new needs a data reset; held"
    echo "$new $(date +%s)" > "$BOX_DIR/.refused-$name"; continue
  fi
  if ! pre_update_export "$cur"; then
    log "${HOLD_REASON:-pre-update export failed} — update held"; alert "update held: ${HOLD_REASON:-the export before updating failed}"
    exit 1
  fi
  log "$name: $cur → $new ($br)"
  $GIT -C "$d" diff --name-only "$cur" "$new" > "$BOX_DIR/.changed-$name" 2>/dev/null || : > "$BOX_DIR/.changed-$name"
  $GIT -C "$d" checkout -q -f "$new"
  tried[$name]="$new"
  changed+=("$name")
done

[ ${#changed[@]} -eq 0 ] && exit 0

if apply "${changed[@]}" && failed="$(health_gate)"; then
  mark_good
  write_state false
  for name in "${changed[@]}"; do rm -f "$BOX_DIR/.refused-$name" "$BOX_DIR/.abandoned-$name"; done
  log "updated: ${changed[*]} — healthy"
  # Every release builds an image and leaves its build cache behind; on the household tablet that reached 25 GB of a
  # 56 GB disk in a month (2026-10-08), and a full disk fails the NEXT update's build. So after a healthy update the
  # cache is trimmed to a budget (BOX_BUILD_CACHE_MAX, default 5gb — enough for the next build to reuse layers) and
  # dangling images go. Best-effort: never fails an update. Not after a rollback: that cache is what the retry reuses.
  cache_max="${BOX_BUILD_CACHE_MAX:-5gb}"
  $DOCKER builder prune -f --max-used-space "$cache_max" >/dev/null 2>&1 \
    || $DOCKER builder prune -f --keep-storage "$cache_max" >/dev/null 2>&1 || true   # older Docker: --keep-storage
  $DOCKER image prune -f >/dev/null 2>&1 || true
  exit 0
fi

failed="${failed:-build}"
log "health gate RED (role: $failed) — rolling back ${changed[*]}"
for name in "${changed[@]}"; do
  # back to the last version that passed the gate (else the one this run started from)
  target="$(good_sha "$name")"; [ -n "$target" ] || target="${previous[$name]}"
  $GIT -C "$(repo_dir "$name")" checkout -q -f "$target"
  echo "${tried[$name]} $(date +%s)" > "$BOX_DIR/.refused-$name"   # tried again after RETRY_AFTER, not every minute
done
apply "${changed[@]}" || log "rollback rebuild failed too — box needs a human"
write_state true "$failed"
alert "update of ${changed[*]} failed health ($failed); back on the previous release"
exit 1
