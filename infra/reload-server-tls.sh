#!/usr/bin/env bash
set -euo pipefail
mode=${1:-reload}
if [[ $mode != reload && $mode != --check-only ]]; then
  echo 'Usage: reload-server-tls.sh [--check-only]' >&2
  exit 1
fi
: "${WORKOUT_DOMAIN:?Set the HTTPS hostname}"
if [[ ! $WORKOUT_DOMAIN =~ ^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$ ]]; then
  echo 'Invalid HTTPS hostname.' >&2
  exit 1
fi
tls_dir=${WORKOUT_TLS_DIR:-/opt/workout/tls}
certificate=$tls_dir/fullchain.pem
key=$tls_dir/privkey.pem
test -r "$certificate" && test -r "$key"
key_mode=$(stat -c '%a' "$key")
if (( (8#$key_mode & 077) != 0 )); then
  echo 'TLS private key must not be readable by group or other users.' >&2
  exit 1
fi
openssl x509 -in "$certificate" -noout -checkend 604800
hostname_check=$(openssl x509 -in "$certificate" -noout -checkhost "$WORKOUT_DOMAIN")
if [[ $hostname_check != "Hostname $WORKOUT_DOMAIN does match certificate" ]]; then
  echo 'TLS certificate hostname does not match.' >&2
  exit 1
fi
certificate_public=$(openssl x509 -in "$certificate" -pubkey -noout | openssl pkey -pubin -outform DER | sha256sum)
key_public=$(openssl pkey -in "$key" -pubout -outform DER | sha256sum)
test "$certificate_public" = "$key_public"
if [[ $mode == --check-only ]]; then
  echo 'TLS hostname, remaining validity, private key permissions and key match checked.'
  exit 0
fi
ids=$(docker ps -q --filter label=com.docker.compose.project=workout-prod --filter label=com.docker.compose.service=web)
if [[ $(printf '%s\n' "$ids" | grep -c .) != 1 ]]; then
  echo 'Expected exactly one running workout-prod web container.' >&2
  exit 1
fi
docker exec "$ids" nginx -t
docker exec "$ids" nginx -s reload
