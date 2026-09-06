#!/bin/sh
# Scheduler loop for the backup role — runs backup.sh every BACKUP_INTERVAL seconds (default daily).
# A failed run is logged and the loop continues (the next run retries).
set -u
INTERVAL="${BACKUP_INTERVAL:-86400}"
sleep "${BACKUP_START_DELAY:-30}"
while true; do
  echo "[backup] $(date -u +%FT%TZ) starting run"
  sh /backup/backup.sh backup || echo "[backup] run reported failures (continuing)"
  echo "[backup] sleeping ${INTERVAL}s"
  sleep "$INTERVAL"
done
