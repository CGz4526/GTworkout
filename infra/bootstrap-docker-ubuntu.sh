#!/usr/bin/env bash
# Execute only after explicit approval to install Docker on this host.
set -euo pipefail

if [[ $(id -u) != 0 ]]; then
  echo 'Root access is required.' >&2
  exit 1
fi
. /etc/os-release
if [[ ${ID:-} != ubuntu || ${VERSION_ID:-} != 24.04 || $(dpkg --print-architecture) != amd64 ]]; then
  echo 'This reviewed bootstrap supports Ubuntu 24.04 amd64 only.' >&2
  exit 1
fi

if command -v docker >/dev/null 2>&1; then
  echo 'Docker already exists; leaving installed packages and configuration unchanged.'
  systemctl is-active docker
  docker --version
  docker compose version
  exit 0
fi

for package in docker.io docker-compose docker-compose-v2 docker-doc podman-docker containerd runc; do
  status=$(dpkg-query -W -f='${db:Status-Status}' "$package" 2>/dev/null || true)
  if [[ $status == installed ]]; then
    echo "Conflicting package found: $package. No automatic removal is permitted." >&2
    exit 1
  fi
done

key_file=/etc/apt/keyrings/docker.asc
source_file=/etc/apt/sources.list.d/docker.sources
expected_source='Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Architectures: amd64
Signed-By: /etc/apt/keyrings/docker.asc'

if [[ -e /etc/apt/sources.list.d/docker.list ]]; then
  echo 'Existing docker.list requires review; refusing to replace it.' >&2
  exit 1
fi
if [[ -e $source_file && $(cat "$source_file") != "$expected_source" ]]; then
  echo 'Existing Docker source differs from the reviewed source; refusing to replace it.' >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt_options=(-o Acquire::Retries=2 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30)
apt-get "${apt_options[@]}" update --error-on=any
apt-get "${apt_options[@]}" install -y ca-certificates curl gpg

if [[ ! -e $key_file ]]; then
  install -m 0755 -d /etc/apt/keyrings
  # Write the key only after a complete, successful HTTPS download.
  key_contents=$(curl -fsSL --retry 2 --connect-timeout 15 --max-time 120 https://download.docker.com/linux/ubuntu/gpg)
  if [[ $key_contents != *'-----BEGIN PGP PUBLIC KEY BLOCK-----'* || $key_contents != *'-----END PGP PUBLIC KEY BLOCK-----'* ]]; then
    echo 'The downloaded Docker signing key is not an armored public key.' >&2
    exit 1
  fi
  printf '%s\n' "$key_contents" > "$key_file"
  chmod 0644 "$key_file"
fi

key_check_dir=$(mktemp -d /run/workout-docker-gpg.XXXXXX)
fingerprint=$(gpg --batch --no-options --homedir "$key_check_dir" --no-keyring --show-keys --with-colons "$key_file" | awk -F: '$1 == "fpr" { print $10; exit }')
if [[ $fingerprint != 9DC858229FC7DD38854AE2D88D81803C0EBFCD88 ]]; then
  echo 'Docker signing key fingerprint does not match the reviewed official key.' >&2
  exit 1
fi

if [[ ! -e $source_file ]]; then
  printf '%s\n' "$expected_source" > "$source_file"
fi
apt-get "${apt_options[@]}" update --error-on=any
apt-get "${apt_options[@]}" install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
systemctl is-active docker
docker --version
docker compose version
docker info --format 'Docker server version: {{.ServerVersion}}; containers: {{.Containers}}'
