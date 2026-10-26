#!/usr/bin/env bash
# deploy/box/lib.sh — shared pieces of the box runner (sourced by install.sh and update.sh).
#
# A box is one directory (BOX_DIR, default /opt/onderling) holding:
#   box.conf      the profile: which repos, which roles, which hostnames (shell-sourceable KEY=VALUE)
#   .env          secrets + hostnames for docker compose; never written by update.sh
#   state.json    what is RUNNING: per repo the sha + tag + when — the answer to "what are testers on?"
#   HOLD          present = update.sh does nothing (freeze the box during a walk)
#   repos/<name>  one git checkout per repo, detached at the release branch's sha
#   data/         volumes + the generated Caddyfile
#   box.log       one line per event
#
# The role contract a repo honours (so the feedback repo — or a partner's — plugs in the same way):
#   deploy/roles/<role>.yml      a docker compose fragment; its build contexts are relative to the file
#   deploy/roles/<role>.health   optional executable: exit 0 = healthy; gets the box env + COMPOSE
#   deploy/roles/<role>.caddy    optional Caddy site snippet; ${VARS} are substituted from .env

set -u

BOX_DIR="${BOX_DIR:-/opt/onderling}"
DOCKER="${DOCKER:-docker}"          # tests point this at a fake
GIT="${GIT:-git}"
CURL="${CURL:-curl}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-onderling}"

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" | tee -a "$BOX_DIR/box.log" >&2; }
die() { log "ERROR: $*"; exit 1; }

load_conf() {
  [ -f "$BOX_DIR/box.conf" ] || die "no $BOX_DIR/box.conf — run install.sh first"
  # shellcheck disable=SC1090
  . "$BOX_DIR/box.conf"
  : "${REPOS:?box.conf: REPOS is required (name=url#branch …)}"
  : "${ROLES:?box.conf: ROLES is required (role@repo …)}"
  check_companion_nearby
}

# Refused here, at the top level, not inside compose_cmd: a `die` in a `$(…)` only leaves the subshell.
check_companion_nearby() {
  case "${COMPANION_NEARBY:-off}" in off|false|0|'') return 0 ;; esac
  role_names | grep -qx companion || return 0
  if role_names | grep -qxE 'relay|caddy'; then
    die "COMPANION_NEARBY needs the companion on the host network, and this box runs the relay or Caddy, which reach it by its compose name; turn it on for a personal box only"
  fi
  [ -f "$(role_file companion nearby.yml)" ] || die "COMPANION_NEARBY is set but $(role_file companion nearby.yml) is missing"
}

# The companion's radio data port: fixed, so the firewall knows what to open (box.conf COMPANION_NEARBY_PORT).
nearby_port() { echo "${COMPANION_NEARBY_PORT:-45210}"; }

# THE VAULT PASSPHRASE LIVES IN .env (BOX_VAULT_PASSPHRASE), outside every volume the box backs up: a snapshot that held
# the sealed stores and the key that opens them would open everything. A box made before kept it as vault.passphrase in
# the assistant's volume ($1, that volume's directory; empty when there is none): moved here once, the file deleted.
# A box with neither gets a fresh one. Two that differ are left for the operator (the assistant refuses to boot on them).
# Idempotent; one log line when it acts; the value is never printed. Called by install.sh (update.sh never writes .env).
vault_passphrase_into_env() {
  local vdir="${1:-}" env="$BOX_DIR/.env" f="" have="" old=""
  [ -n "$vdir" ] && f="$vdir/vault.passphrase"
  have="$(sed -n 's/^BOX_VAULT_PASSPHRASE=//p' "$env" 2>/dev/null | tail -1)"
  [ -n "$f" ] && [ -f "$f" ] && old="$(tr -d '\n' < "$f")"
  if [ -n "$have" ] && [ -n "$old" ] && [ "$have" != "$old" ]; then
    log "vault passphrase: .env and the assistant's volume hold two different ones — both left; keep the one the vault was made with"
    return 1
  fi
  if [ -z "$have" ]; then
    local val="$old"
    [ -n "$val" ] || val="$(head -c 32 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n')"
    touch "$env"; chmod 600 "$env"
    printf 'BOX_VAULT_PASSPHRASE=%s\n' "$val" >> "$env"
    if [ -n "$old" ]; then log "vault passphrase moved from the assistant's volume into .env"; else log "vault passphrase made in .env"; fi
  fi
  if [ -n "$old" ]; then rm -f "$f"; [ -n "$have" ] && log "vault passphrase: removed the copy in the assistant's volume (.env holds it)"; fi
  return 0
}

# The home LAN's interface: the one the default route leaves by (LAN_IFACE overrides; set but empty means "none").
lan_iface() {
  if [ "${LAN_IFACE+set}" = set ]; then echo "$LAN_IFACE"; return 0; fi
  ip route show default 2>/dev/null | awk '{ for (i = 1; i < NF; i++) if ($i == "dev") { print $(i + 1); exit } }'
  return 0
}

# The firewall rules the radio needs (one per line, ufw syntax): mDNS discovery on 5353/udp and the hello on the
# fixed TCP data port, both bound to the LAN interface — never a bare `allow <port>`, never Tailscale's interface. The
# router's NAT keeps the internet out regardless; this keeps every other interface shut too. Nothing when the radio is
# off, the box runs no companion, or no LAN interface is known.
nearby_firewall_rules() {
  case "${COMPANION_NEARBY:-off}" in off|false|0|'') return 0 ;; esac
  role_names | grep -qx companion || return 0
  local iface; iface="$(lan_iface)"
  case "$iface" in ''|tailscale*|lo) return 0 ;; esac
  echo "allow in on $iface to any port 5353 proto udp"
  echo "allow in on $iface to any port $(nearby_port) proto tcp"
}

# REPOS="basis=git@github.com:Onderling/basis.git#live feedback=…#live"
repo_names() { for r in $REPOS; do echo "${r%%=*}"; done; }
# every lookup ends with `return 0`: callers run under set -e inside $(…), and a non-matching last
# iteration must not read as a failure
repo_url()   { for r in $REPOS; do [ "${r%%=*}" = "$1" ] && { local rest="${r#*=}"; echo "${rest%%#*}"; }; done; return 0; }
repo_branch(){ for r in $REPOS; do [ "${r%%=*}" = "$1" ] && { local rest="${r#*=}"; echo "${rest#*#}"; }; done; return 0; }
repo_dir()   { echo "$BOX_DIR/repos/$1"; }

# ROLES="caddy@basis relay@basis feedback-collect@feedback"
role_names() { for r in $ROLES; do echo "${r%%@*}"; done; }
role_repo()  { for r in $ROLES; do [ "${r%%@*}" = "$1" ] && echo "${r#*@}"; done; return 0; }
role_file()  { echo "$(repo_dir "$(role_repo "$1")")/deploy/roles/$1.$2"; }
roles_of_repo() { for r in $ROLES; do [ "${r#*@}" = "$1" ] && echo "${r%%@*}"; done; return 0; }

# The compose command for every enabled role: one project, one env file, N fragments.
compose_cmd() {
  local cmd=("$DOCKER" compose --project-name "$COMPOSE_PROJECT" --env-file "$BOX_DIR/.env")
  local role
  for role in $(role_names); do
    local f; f="$(role_file "$role" yml)"
    [ -f "$f" ] || die "role $role: $f missing (does $(role_repo "$role") honour the role contract?)"
    cmd+=(-f "$f")
  done
  # COMPANION_NEARBY (box.conf: browse · publish · publish:<duration> · off) turns on the companion's local-network
  # radio. mDNS is multicast, which docker's bridge network does not carry, so the companion then runs on the HOST's
  # network (roles/companion.nearby.yml). That takes it off the compose network: `relay:8787` and Caddy's
  # `companion:8790` stop resolving, so a box that runs the relay or Caddy (the platform box) refuses it.
  # A personal box (the household's tablet) dials the shared relay and has neither.
  case "${COMPANION_NEARBY:-off}" in
    off|false|0|'') ;;
    *)
      # load_conf has refused a box with the relay or Caddy, or a missing overlay; this only composes
      if role_names | grep -qx companion; then
        cmd=(env "COMPANION_NEARBY=$COMPANION_NEARBY" "COMPANION_NEARBY_PORT=$(nearby_port)" "${cmd[@]}" -f "$(role_file companion nearby.yml)")
      fi
      ;;
  esac
  printf '%q ' "${cmd[@]}"
}

# Render data/caddy/Caddyfile from the .caddy snippets of the enabled roles, ${VARS} from .env.
render_caddyfile() {
  local out="$BOX_DIR/data/caddy/Caddyfile"
  mkdir -p "$(dirname "$out")"
  {
    echo "# generated by deploy/box — edit the roles' .caddy snippets, not this file"
    echo "{"
    echo "	email \${ACME_EMAIL}"
    echo "}"
    local role
    for role in $(role_names); do
      local s; s="$(role_file "$role" caddy)"
      [ -f "$s" ] && { echo; echo "# --- $role"; cat "$s"; } || true
    done
  } > "$out.tpl"
  # substitute ${VAR} from .env (only the vars named there; unknown ones stay, so Caddy's own {$X} survive)
  local tpl; tpl="$(cat "$out.tpl")"
  while IFS='=' read -r k v; do
    case "$k" in ''|\#*) continue ;; esac
    v="${v%\"}"; v="${v#\"}"
    tpl="${tpl//\$\{$k\}/$v}"
  done < "$BOX_DIR/.env"
  printf '%s\n' "$tpl" > "$out.next"
  rm -f "$out.tpl"
  if [ -f "$out" ] && cmp -s "$out" "$out.next"; then rm -f "$out.next"; return 1; fi   # 1 = unchanged
  mv "$out.next" "$out"
  return 0                                                                              # 0 = changed
}

# Caddy holds the rendered Caddyfile as a BIND MOUNT, so `compose up -d` never notices a change to it —
# a re-rendered file (a role added, a hostname edited) would be ignored until something recreated the
# container. Seen on the real box 2026-09-07: caddy up 27 h across two releases. Reload it in place.
reload_caddy() {
  local cmd; cmd="$(compose_cmd)"
  case " $(role_names | tr '\n' ' ') " in *" caddy "*) ;; *) return 0 ;; esac
  eval "$cmd ps --status running --services" 2>/dev/null | grep -qx caddy || return 0
  if eval "$cmd exec -T caddy caddy reload --config /etc/caddy/Caddyfile" >>"$BOX_DIR/box.log" 2>&1; then
    log "caddy: reloaded the rendered Caddyfile"
  else
    log "caddy: reload REFUSED the new Caddyfile (it keeps serving the old one) — see box.log"
    return 1
  fi
}

# Which enabled roles a set of changed repo paths affects. A role declares its build paths in
# deploy/roles/<role>.paths (generated: scripts/box-role-paths.mjs). No file, or an empty line in it,
# means "always" — the safe default, so a repo that does not honour this part of the contract still works.
#   role_affected <role> <file-with-changed-paths>
role_affected() {
  local paths; paths="$(role_file "$1" paths)"
  [ -f "$paths" ] || return 0
  local prefix f
  while IFS= read -r prefix; do
    case "$prefix" in '#'*) continue ;; '') return 0 ;; esac
    while IFS= read -r f; do
      case "$f" in "$prefix"*) return 0 ;; esac
    done < "$2"
  done < "$paths"
  return 1
}

# state.json helpers (no jq dependency: the file is small and we own its shape)
state_sha() { [ -f "$BOX_DIR/state.json" ] && sed -n "s/.*\"$1\": *{[^}]*\"sha\": *\"\([0-9a-f]*\)\".*/\1/p" "$BOX_DIR/state.json" | head -1; return 0; }

# The last version that passed the health gate, and the one before it: one small file per repo, "sha tag at".
# A green gate moves the running version in (the one it replaces becomes previousGood); a red gate rolls back to it.
good_sha()     { [ -f "$BOX_DIR/.good-$1" ] && cut -d' ' -f1 "$BOX_DIR/.good-$1"; return 0; }
prevgood_sha() { [ -f "$BOX_DIR/.prevgood-$1" ] && cut -d' ' -f1 "$BOX_DIR/.prevgood-$1"; return 0; }
mark_good() {
  local name d sha tag
  for name in $(repo_names); do
    d="$(repo_dir "$name")"
    sha="$($GIT -C "$d" rev-parse HEAD 2>/dev/null)" || continue
    [ "$sha" = "$(good_sha "$name")" ] && continue
    [ -f "$BOX_DIR/.good-$name" ] && mv "$BOX_DIR/.good-$name" "$BOX_DIR/.prevgood-$name"
    tag="$($GIT -C "$d" describe --tags --exact-match 2>/dev/null || echo "")"
    echo "$sha ${tag:--} $(date -u +%FT%TZ)" > "$BOX_DIR/.good-$name"
  done
}
good_json() {   # good_json <.good|.prevgood> — {"repo": {"sha","tag","at"}, …} from the files that exist
  local kind="$1" first=1 name f sha tag at
  printf '{'
  for name in $(repo_names); do
    f="$BOX_DIR/$kind-$name"; [ -f "$f" ] || continue
    read -r sha tag at < "$f"
    [ "$tag" = "-" ] && tag=""
    [ $first = 1 ] || printf ', '
    first=0
    printf '"%s": {"sha": "%s", "tag": "%s", "at": "%s"}' "$name" "$sha" "$tag" "$at"
  done
  printf '}'
}

write_state() {   # write_state <rolledBack:true|false> [failedRole]
  local rolled="$1" failed="${2:-}"
  {
    echo "{"
    echo "  \"updatedAt\": \"$(date -u +%FT%TZ)\","
    echo "  \"roles\": \"$ROLES\","
    echo "  \"rolledBack\": $rolled,"
    [ -n "$failed" ] && echo "  \"failedRole\": \"$failed\"," || true
    echo "  \"lastGood\": $(good_json .good),"
    echo "  \"previousGood\": $(good_json .prevgood),"
    echo "  \"repos\": {"
    local first=1 name
    for name in $(repo_names); do
      local d; d="$(repo_dir "$name")"
      local sha tag
      sha="$($GIT -C "$d" rev-parse HEAD 2>/dev/null || echo unknown)"
      tag="$($GIT -C "$d" describe --tags --exact-match 2>/dev/null || echo "")"
      [ $first = 1 ] || echo ","
      first=0
      printf '    "%s": {"sha": "%s", "tag": "%s", "branch": "%s"}' "$name" "$sha" "$tag" "$(repo_branch "$name")"
    done
    echo
    echo "  }"
    echo "}"
  } > "$BOX_DIR/state.json.tmp" && mv "$BOX_DIR/state.json.tmp" "$BOX_DIR/state.json"
  write_status_page
}

# The box's HTML face, kept simple: a static page under data/www/ (served read-only by Caddy at /box/)
# showing state.json, whether HOLD is set, and the last 50 log lines. No server code, no login — it
# shows a sha and a tag, nothing secret. Rewritten on every state change.
write_status_page() {
  local www="$BOX_DIR/data/www"
  mkdir -p "$www"
  cp "$BOX_DIR/state.json" "$www/state.json"
  tail -n 50 "$BOX_DIR/box.log" 2>/dev/null > "$www/log.txt" || true
  local hold="no"; [ -f "$BOX_DIR/HOLD" ] && hold="YES — the updater is frozen"
  local esc; esc() { sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g'; }
  {
    echo '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>onderling box</title>'
    echo '<style>body{font:14px/1.5 system-ui,sans-serif;max-width:60em;margin:2em auto;padding:0 1em;color:#222}pre{background:#f4f4f2;padding:1em;overflow:auto}h1{font-size:1.3em}dt{font-weight:600}dd{margin:0 0 .5em}</style>'
    echo "<h1>onderling box · $(hostname | esc)</h1>"
    echo "<dl><dt>profile</dt><dd>${PROFILE:-?} · roles: $(echo "$ROLES" | esc)</dd>"
    echo "<dt>updater frozen (HOLD)</dt><dd>$hold</dd>"
    echo "<dt>last good version</dt><dd>$(good_json .good | esc) · before it: $(good_json .prevgood | esc)</dd>"
    echo "<dt>last update</dt><dd>$(sed -n 's/.*"updatedAt": *"\([^"]*\)".*/\1/p' "$BOX_DIR/state.json") · rolled back: $(sed -n 's/.*"rolledBack": *\([a-z]*\).*/\1/p' "$BOX_DIR/state.json")</dd></dl>"
    echo "<h2>running</h2><pre>$(esc < "$BOX_DIR/state.json")</pre>"
    echo "<h2>log (last 50)</h2><pre>$(esc < "$www/log.txt")</pre>"
    echo '<p><a href="state.json">state.json</a> · <a href="log.txt">log.txt</a></p>'
  } > "$www/index.html"
}

# One Telegram line when BOX_ALERT_TG_TOKEN + BOX_ALERT_TG_CHAT are set in .env; silent otherwise.
alert() {
  local token chat
  token="$(sed -n 's/^BOX_ALERT_TG_TOKEN=//p' "$BOX_DIR/.env" 2>/dev/null | tr -d '"')"
  chat="$(sed -n 's/^BOX_ALERT_TG_CHAT=//p' "$BOX_DIR/.env" 2>/dev/null | tr -d '"')"
  [ -n "$token" ] && [ -n "$chat" ] || return 0
  $CURL -sS -m 10 -o /dev/null "https://api.telegram.org/bot$token/sendMessage" \
    --data-urlencode "chat_id=$chat" --data-urlencode "text=[box $(hostname)] $*" || log "alert failed (telegram)"
}

# Run every enabled role's health script; print the first failing role, exit 1. Waits up to
# HEALTH_TIMEOUT seconds (default 60; tests set it low). REBUILT_ROLES (space-separated) names the roles
# this update rebuilt; each script gets that as ROLE_REBUILT=0|1.
health_gate() {
  local deadline=$(( $(date +%s) + ${HEALTH_TIMEOUT:-60} ))
  local role f
  for role in $(role_names); do
    f="$(role_file "$role" health)"
    [ -x "$f" ] || continue
    # ROLE_REBUILT tells a health script whether THIS update actually rebuilt its role, so an expensive
    # check (the relay's wire smoke) proves a NEW build rather than re-proving a process that never stopped.
    local rebuilt=0
    case " ${REBUILT_ROLES:-} " in *" $role "*) rebuilt=1 ;; esac
    until COMPOSE="$(compose_cmd)" BOX_DIR="$BOX_DIR" ROLE="$role" ROLE_REBUILT="$rebuilt" bash "$f" >>"$BOX_DIR/box.log" 2>&1; do
      if [ "$(date +%s)" -ge "$deadline" ]; then echo "$role"; return 1; fi
      sleep "${HEALTH_POLL:-3}"
    done
  done
  return 0
}
