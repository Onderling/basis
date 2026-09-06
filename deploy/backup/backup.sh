#!/usr/bin/env sh
# Multi-target restic backup for a box: everything under BACKUP_DATA (one directory per volume, mounted
# read-only by roles/backup.yml) to EVERY configured target, each encrypted independently.
#
# TARGETS: one env file per target in BACKUP_TARGETS_DIR (RESTIC_REPOSITORY, RESTIC_PASSWORD, provider
# credentials — see targets.env.example). With no targets dir, the ambient RESTIC_* environment.
#
#   backup.sh                 # = backup: snapshot every target, prune, verify
#   backup.sh check           # restic check on every target
#   backup.sh snapshots       # list snapshots per target
#   backup.sh restore <target> <snapshot|latest> <dest>
set -u
DATA="${BACKUP_DATA:-/backup/data}"
TARGETS_DIR="${BACKUP_TARGETS_DIR:-/backup/targets}"
TAG="${BACKUP_TAG:-onderling-box}"
KEEP="--keep-daily 7 --keep-weekly 4 --keep-monthly 6"

name_of() { basename "$1" .env; }
targets() {
  if [ -d "$TARGETS_DIR" ] && ls "$TARGETS_DIR"/*.env >/dev/null 2>&1; then ls "$TARGETS_DIR"/*.env
  elif [ -n "${RESTIC_REPOSITORY:-}" ]; then echo "__ambient__"; fi
}
with_target() {
  tf="$1"; shift
  if [ "$tf" = "__ambient__" ]; then restic "$@"
  else ( set -a; . "$tf"; set +a; restic "$@" ); fi
}
do_backup() {
  tf="$1"
  with_target "$tf" snapshots >/dev/null 2>&1 || with_target "$tf" init || return 1
  with_target "$tf" backup --tag "$TAG" "$DATA" || return 1
  # shellcheck disable=SC2086
  with_target "$tf" forget --tag "$TAG" --prune $KEEP || return 1
  with_target "$tf" check || return 1
}

cmd="${1:-backup}"; [ $# -gt 0 ] && shift
TARGET_LIST="$(targets)"
if [ -z "$TARGET_LIST" ]; then
  echo "[backup] no targets configured — add *.env to $TARGETS_DIR (or set RESTIC_REPOSITORY); nothing backed up" >&2
  exit 0
fi
rc=0
case "$cmd" in
  backup)    for tf in $TARGET_LIST; do echo "==> backup → $(name_of "$tf")"; do_backup "$tf" || { echo "[backup] FAILED: $(name_of "$tf")" >&2; rc=1; }; done ;;
  check)     for tf in $TARGET_LIST; do echo "==> check → $(name_of "$tf")"; with_target "$tf" check || rc=1; done ;;
  snapshots) for tf in $TARGET_LIST; do echo "==> $(name_of "$tf")"; with_target "$tf" snapshots --tag "$TAG" || rc=1; done ;;
  restore)
    tname="${1:?usage: backup.sh restore <target> <snapshot|latest> <dest>}"; snap="${2:-latest}"; dest="${3:?dest}"
    tf="$TARGETS_DIR/$tname.env"; [ -f "$tf" ] || tf="__ambient__"
    echo "==> restore $snap from $tname → $dest"; with_target "$tf" restore "$snap" --target "$dest" || rc=1 ;;
  *) echo "usage: backup.sh [backup|check|snapshots|restore <target> <snapshot> <dest>]" >&2; exit 2 ;;
esac
exit $rc
