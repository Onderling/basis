#!/usr/bin/env bash
# deploy/box/update.sh — keep a box on the release branch of every repo it runs.
#
# Run by the systemd timer every 5 minutes (or by hand). Deterministic and boring:
#   1. HOLD present → do nothing.
#   2. per repo: fetch the release branch; same sha as state.json → nothing to do.
#   3. otherwise check the new sha out (detached), rebuild + restart the roles from that repo,
#   4. wait for every enabled role's health script (HEALTH_TIMEOUT, 60 s),
#   5. green → write state.json; red → check the previous sha back out, restart, write
#      state.json with rolledBack + the failing role, and say so (log + one Telegram line).
# It never touches .env. It never runs a migration: a release that needs a data reset says so in its
# tag message ("RESET") and is refused unless ALLOW_RESET=1 is in the environment.
#
#   BOX_DIR=/opt/onderling deploy/box/update.sh            # the timer runs exactly this
#   BOX_DIR=… FORCE=1 deploy/box/update.sh                 # rebuild even without a new sha

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"
load_conf

[ -f "$BOX_DIR/HOLD" ] && { log "HOLD present — not updating"; exit 0; }

changed=()
declare -A previous
for name in $(repo_names); do
  d="$(repo_dir "$name")"; br="$(repo_branch "$name")"
  [ -d "$d/.git" ] || die "repo $name not cloned at $d"
  $GIT -C "$d" fetch -q origin "$br" --tags 2>>"$BOX_DIR/box.log" || { log "fetch failed for $name — keeping $(state_sha "$name")"; continue; }
  new="$($GIT -C "$d" rev-parse "origin/$br")"
  cur="$(state_sha "$name")"
  [ -z "$cur" ] && cur="$($GIT -C "$d" rev-parse HEAD)"
  previous[$name]="$cur"
  if [ "$new" = "$cur" ] && [ "${FORCE:-0}" != 1 ]; then continue; fi
  msg="$($GIT -C "$d" tag -l --format='%(contents:subject)' --points-at "$new" 2>/dev/null | head -1)"
  if [[ "$msg" == *RESET* ]] && [ "${ALLOW_RESET:-0}" != 1 ]; then
    log "$name: $new is tagged RESET — refusing without ALLOW_RESET=1"; alert "$name: release $new needs a data reset; held"; continue
  fi
  log "$name: $cur → $new ($br)"
  $GIT -C "$d" checkout -q -f "$new"
  changed+=("$name")
done

[ ${#changed[@]} -eq 0 ] && exit 0

apply() {   # build + (re)start the roles that belong to the changed repos, then the whole stack up
  local cmd; cmd="$(compose_cmd)"
  render_caddyfile
  local roles=()
  for name in "$@"; do for r in $(roles_of_repo "$name"); do roles+=("$r"); done; done
  eval "$cmd build --pull ${roles[*]}"
  eval "$cmd up -d --remove-orphans"
}

if apply "${changed[@]}" && failed="$(health_gate)"; then
  write_state false
  log "updated: ${changed[*]} — healthy"
  exit 0
fi

failed="${failed:-build}"
log "health gate RED (role: $failed) — rolling back ${changed[*]}"
for name in "${changed[@]}"; do $GIT -C "$(repo_dir "$name")" checkout -q -f "${previous[$name]}"; done
apply "${changed[@]}" || log "rollback rebuild failed too — box needs a human"
write_state true "$failed"
alert "update of ${changed[*]} failed health ($failed); back on the previous release"
exit 1
