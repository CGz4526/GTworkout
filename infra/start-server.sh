#!/usr/bin/env bash
# Starts only an explicitly approved database/application deployment.
set -euo pipefail
umask 077
cd -- "$(dirname -- "$0")"

database_approved=false
publish=false
for argument in "$@"; do
  case "$argument" in
    --database-approved) database_approved=true ;;
    --publish) publish=true ;;
    *) echo "Unknown argument: $argument" >&2; exit 1 ;;
  esac
done
if [[ $database_approved != true ]]; then
  echo 'Database initialization/migration needs separate approval. Nothing started.' >&2
  exit 1
fi
if [[ ! -f release-images.sh ]]; then
  echo 'Use a reviewed release package containing release-images.sh.' >&2
  exit 1
fi
. ./release-images.sh
: "${WORKOUT_DB_PASSWORD:?Inject the database password without writing a .env file}"
: "${WORKOUT_DOMAIN:?Set the approved HTTPS hostname}"
export WORKOUT_TLS_DIR=${WORKOUT_TLS_DIR:-/opt/workout/tls}
export WORKOUT_TRAINING_WRITE_ENABLED=${WORKOUT_TRAINING_WRITE_ENABLED:-false}
export WORKOUT_REGISTRATION_ENABLED=${WORKOUT_REGISTRATION_ENABLED:-false}
if [[ $WORKOUT_TRAINING_WRITE_ENABLED != false && ${WORKOUT_TRAINING_SCHEMA_APPROVED:-} != yes ]]; then
  echo 'Training writes require a separately reviewed and applied training schema.' >&2
  exit 1
fi
if [[ $publish == true ]]; then
  if [[ $WORKOUT_REGISTRATION_ENABLED != false ]]; then
    echo 'Public deployment requires registration to be disabled.' >&2
    exit 1
  fi
  export WORKOUT_BIND_ADDRESS=0.0.0.0 WORKOUT_HTTP_PORT=80 WORKOUT_HTTPS_PORT=443
else
  export WORKOUT_BIND_ADDRESS=127.0.0.1 WORKOUT_HTTP_PORT=8088 WORKOUT_HTTPS_PORT=8443
fi
bash ./reload-server-tls.sh --check-only
docker compose --env-file /dev/null -p workout-prod -f compose.server.yaml config --quiet
docker compose --env-file /dev/null -p workout-prod -f compose.server.yaml up -d --pull never --wait --wait-timeout 180
