#!/usr/bin/env bash
# deploy/box/install.sh — one shot on a fresh Debian/Ubuntu VPS: Docker, the box user, the repos at
# their release branch, the firewall (80 + 443 only), the systemd timer, and the profile questions.
# Every step here is a step of deploy/DEPLOY-RUNBOOK.md Path B; the runbook stays the explanation.
#
#   curl -fsSL https://raw.githubusercontent.com/Onderling/basis/live/deploy/box/install.sh | sudo bash
#   # or, from a checkout:  sudo deploy/box/install.sh
#
# Non-interactive: set PROFILE, RELAY_DOMAIN, ACME_EMAIL (and BOX_REPO_URL for a private repo) in the
# environment and the questions are skipped. Idempotent: re-running keeps box.conf/.env and refreshes
# the rest.

set -euo pipefail
BOX_DIR="${BOX_DIR:-/opt/onderling}"
BOX_USER="${BOX_USER:-onderling}"
BOX_REPO_URL="${BOX_REPO_URL:-https://github.com/Onderling/basis.git}"
BOX_BRANCH="${BOX_BRANCH:-live}"
SKIP_SYSTEM="${SKIP_SYSTEM:-0}"     # 1 = no apt/docker/user/firewall (tests, or a box you prepared yourself)

ask() {   # ask VAR "question" [default]
  local var="$1" q="$2" def="${3:-}"
  if [ -n "${!var:-}" ]; then return; fi
  if [ ! -t 0 ] && [ -z "$def" ]; then echo "set $var (no terminal to ask)"; exit 2; fi
  read -r -p "$q${def:+ [$def]}: " ans </dev/tty || ans=""
  printf -v "$var" '%s' "${ans:-$def}"
}

# ── 1. profile questions (before anything is installed, so a typo costs nothing) ──
ask PROFILE "Profile (relay | platform | feedback-project | personal)" relay
case "$PROFILE" in
  relay)            ROLES="caddy@canopy-mono relay@canopy-mono"; REPOS="canopy-mono=$BOX_REPO_URL#$BOX_BRANCH" ;;
  *) echo "profile '$PROFILE' is not built yet — only 'relay' is (plans/PLAN-vps-runner.md §6)"; exit 2 ;;
esac
ask RELAY_DOMAIN "Relay hostname (DNS A-record must point here)"
ask ACME_EMAIL "E-mail for Let's Encrypt"
BOX_ALERT_TG_TOKEN="${BOX_ALERT_TG_TOKEN:-}"; BOX_ALERT_TG_CHAT="${BOX_ALERT_TG_CHAT:-}"

# ── 2. system: docker, user, firewall ──
if [ "$SKIP_SYSTEM" != 1 ]; then
  [ "$(id -u)" = 0 ] || { echo "run as root (sudo)"; exit 2; }
  if ! command -v docker >/dev/null; then
    apt-get update -q
    apt-get install -y -q ca-certificates curl git
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/$(. /etc/os-release && echo "$ID")/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$(. /etc/os-release && echo "$ID") $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
    apt-get update -q
    apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi
  id "$BOX_USER" >/dev/null 2>&1 || useradd -r -m -d "$BOX_DIR" -s /bin/bash -G docker "$BOX_USER"
  if command -v ufw >/dev/null; then
    ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443 >/dev/null
    ufw --force enable >/dev/null
  fi
fi

# ── 3. the box directory, conf, env ──
mkdir -p "$BOX_DIR/repos" "$BOX_DIR/data/caddy"
if [ ! -f "$BOX_DIR/box.conf" ]; then
  cat > "$BOX_DIR/box.conf" <<EOF
# the box profile — which repos (name=url#release-branch) and which roles (role@repo)
PROFILE=$PROFILE
REPOS="$REPOS"
ROLES="$ROLES"
EOF
fi
if [ ! -f "$BOX_DIR/.env" ]; then
  cat > "$BOX_DIR/.env" <<EOF
# secrets + hostnames for docker compose. update.sh never writes this file.
BOX_DIR=$BOX_DIR
RELAY_DOMAIN=$RELAY_DOMAIN
ACME_EMAIL=$ACME_EMAIL
# one Telegram line on a failed update / rollback (optional)
BOX_ALERT_TG_TOKEN=$BOX_ALERT_TG_TOKEN
BOX_ALERT_TG_CHAT=$BOX_ALERT_TG_CHAT
# relay extras (optional): media edge + push — see deploy/relay/.env.example
R2_ENDPOINT=
R2_BUCKET=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
BLOB_GATE_UPLOADERS=
PUSH_PROVIDER=
EXPO_ACCESS_TOKEN=
EOF
  chmod 600 "$BOX_DIR/.env"
fi

# ── 4. repos at the release branch ──
# shellcheck disable=SC1090
. "$BOX_DIR/box.conf"
for r in $REPOS; do
  name="${r%%=*}"; rest="${r#*=}"; url="${rest%%#*}"; br="${rest#*#}"
  d="$BOX_DIR/repos/$name"
  if [ ! -d "$d/.git" ]; then git clone -q --branch "$br" "$url" "$d"; fi
  git -C "$d" fetch -q origin "$br" --tags
  git -C "$d" checkout -q -f "origin/$br"
done
[ "$SKIP_SYSTEM" != 1 ] && chown -R "$BOX_USER:$BOX_USER" "$BOX_DIR"

# ── 5. the timer ──
RUNNER="$BOX_DIR/repos/canopy-mono/deploy/box"
if [ "$SKIP_SYSTEM" != 1 ]; then
  sed "s#@BOX_DIR@#$BOX_DIR#g; s#@BOX_USER@#$BOX_USER#g; s#@RUNNER@#$RUNNER#g" "$RUNNER/systemd/onderling-box.service" > /etc/systemd/system/onderling-box.service
  cp "$RUNNER/systemd/onderling-box.timer" /etc/systemd/system/onderling-box.timer
  systemctl daemon-reload
  systemctl enable --now onderling-box.timer
fi

# ── 6. first bring-up + health ──
echo "bringing the stack up (first build takes a few minutes)…"
if [ "$SKIP_SYSTEM" != 1 ]; then
  sudo -u "$BOX_USER" env BOX_DIR="$BOX_DIR" FORCE=1 bash "$RUNNER/update.sh"
else
  BOX_DIR="$BOX_DIR" FORCE=1 bash "$RUNNER/update.sh"
fi
echo
echo "box: $BOX_DIR  profile: $PROFILE"
echo "relay: wss://$RELAY_DOMAIN   (media edge https://$RELAY_DOMAIN/blob-gate once R2_* is set)"
echo "state: $BOX_DIR/state.json   log: $BOX_DIR/box.log   freeze: touch $BOX_DIR/HOLD"
