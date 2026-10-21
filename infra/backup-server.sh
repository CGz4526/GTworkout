#!/usr/bin/env bash
# Manual, read-only logical export; no retention deletion or restore is performed.
set -euo pipefail
umask 077
project=workout-prod
ids=$(docker ps -q --filter "label=com.docker.compose.project=$project" --filter label=com.docker.compose.service=db)
if [[ $(printf '%s\n' "$ids" | grep -c .) != 1 ]]; then
  echo 'Expected exactly one running workout-prod database container.' >&2
  exit 1
fi
environment=$(docker inspect --format '{{ index .Config.Labels "io.github.cgz4526.workout.environment" }}' "$ids")
if [[ $environment != production ]]; then
  echo 'Database ownership label does not match.' >&2
  exit 1
fi
root=${WORKOUT_BACKUP_DIR:-/opt/workout/backups}
if [[ $root != /* ]]; then
  echo 'Backup directory must be an absolute protected path.' >&2
  exit 1
fi
mkdir -p -- "$root"
directory=$(mktemp -d "$root/$(date -u +%Y%m%dT%H%M%SZ)-XXXXXXXX")
archive=$directory/workout.dump
if ! docker exec "$ids" pg_dump -U workout -d workout --format=custom --no-owner --no-privileges > "$archive"; then
  echo "Backup failed; partial evidence retained at $directory" >&2
  exit 1
fi
docker exec -i "$ids" pg_restore --list < "$archive" > "$directory/archive-list.txt"
(cd "$directory" && sha256sum workout.dump > SHA256SUMS)
printf 'Logical archive created and listed: %s\n' "$directory"
echo 'An isolated restore and off-server copy are still required.'
