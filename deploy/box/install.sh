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
FEEDBACK_REPO_URL="${FEEDBACK_REPO_URL:-https://github.com/Onderling/feedback.git}"
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
  platform)         ROLES="caddy@canopy-mono relay@canopy-mono pod@canopy-mono companion@canopy-mono backup@canopy-mono"; REPOS="canopy-mono=$BOX_REPO_URL#$BOX_BRANCH" ;;
  personal)         ROLES="companion@canopy-mono assistant@canopy-mono"; REPOS="canopy-mono=$BOX_REPO_URL#$BOX_BRANCH" ;;
  feedback-project) ROLES="caddy@canopy-mono relay@canopy-mono pod@canopy-mono backup@canopy-mono feedback-collect@feedback feedback-aggregate@feedback"; REPOS="canopy-mono=$BOX_REPO_URL#$BOX_BRANCH feedback=$FEEDBACK_REPO_URL#$BOX_BRANCH" ;;
  *) echo "profile '$PROFILE' is not built yet — only 'relay' is (plans/PLAN-vps-runner.md §6)"; exit 2 ;;
esac
if [ "$PROFILE" = personal ]; then
  ask COMPANION_RELAY_URL "The shared relay to dial (wss://relay.onderling.org)" "wss://relay.onderling.org"
  ask TG_BOT_TOKEN "Telegram bot token for your assistant"
  ask TG_ALLOWED_CHAT_IDS "Your Telegram chat id(s), comma-separated (empty = open door)" ""
  ask PRIVATEMODE_API_KEY "Privatemode API key (the assistant's confidential LLM route)"
  RELAY_DOMAIN=""; ACME_EMAIL=""
else
  ask RELAY_DOMAIN "Relay hostname (DNS A-record must point here)"
fi
COMPANION_RELAY_URL="${COMPANION_RELAY_URL:-}"; TG_BOT_TOKEN="${TG_BOT_TOKEN:-}"; TG_ALLOWED_CHAT_IDS="${TG_ALLOWED_CHAT_IDS:-}"
case "$PROFILE" in platform|feedback-project) ask POD_DOMAIN "Pod hostname (DNS A-record must point here)" ;; esac
case "$PROFILE" in feedback-project)
  ask ACTIVATE_HOST "Activation hostname (participants redeem their code here)"
  ask PORTAL_HOST "Portal hostname (the project leads' GUI)"
  ask PRIVATEMODE_API_KEY "Privatemode API key (the bots' confidential LLM route)" ;;
esac
POD_DOMAIN="${POD_DOMAIN:-}"; ACTIVATE_HOST="${ACTIVATE_HOST:-}"; PORTAL_HOST="${PORTAL_HOST:-}"; PRIVATEMODE_API_KEY="${PRIVATEMODE_API_KEY:-}"
[ "$PROFILE" = personal ] || ask ACME_EMAIL "E-mail for Let's Encrypt"
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
mkdir -p "$BOX_DIR/repos" "$BOX_DIR/data/caddy" "$BOX_DIR/data/www" "$BOX_DIR/data/backup-targets"
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
POD_DOMAIN=$POD_DOMAIN
ACME_EMAIL=$ACME_EMAIL
# pod: WAC (default) or ACP — decide before first boot (runbook B6): @css:config/file-acp.json
CSS_CONFIG=
# companion: the relay it dials (empty = this box's own relay) and your device's pubKey for the online /manage page (empty = off)
COMPANION_RELAY_URL=$COMPANION_RELAY_URL
COMPANION_MANAGE_OWNER_PUBKEY=
# personal: the assistant's Telegram bot + who may talk to it
TG_BOT_TOKEN=$TG_BOT_TOKEN
TG_ALLOWED_CHAT_IDS=$TG_ALLOWED_CHAT_IDS
# backups (role backup): interval in seconds; targets in data/backup-targets/*.env
BACKUP_INTERVAL=86400
# feedback-project: hostnames, the bots' Privatemode key, the chatId→pseudonym secret, the pod the bots write to
ACTIVATE_HOST=$ACTIVATE_HOST
PORTAL_HOST=$PORTAL_HOST
PRIVATEMODE_API_KEY=$PRIVATEMODE_API_KEY
FP_PSEUDONYM_SECRET=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
CSS_URL=http://pod:3000
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
[ -n "$RELAY_DOMAIN" ] && echo "relay: wss://$RELAY_DOMAIN   (media edge https://$RELAY_DOMAIN/blob-gate once R2_* is set)"
[ "$PROFILE" = personal ] && echo "personal: companion dialing $COMPANION_RELAY_URL · assistant on Telegram (chats: ${TG_ALLOWED_CHAT_IDS:-open})"
[ -n "$POD_DOMAIN" ] && echo "pod:   https://$POD_DOMAIN/"
[ -n "$RELAY_DOMAIN" ] && echo "status page: https://$RELAY_DOMAIN/box/"
[ -n "$PORTAL_HOST" ] && echo "portal: https://$PORTAL_HOST/   activation: https://$ACTIVATE_HOST/   new project: sudo -u $BOX_USER docker compose --project-name onderling exec feedback-bots node scripts/project.js new <id> --template or-feedback --css-url http://pod:3000"
echo "state: $BOX_DIR/state.json   log: $BOX_DIR/box.log   freeze: touch $BOX_DIR/HOLD"
