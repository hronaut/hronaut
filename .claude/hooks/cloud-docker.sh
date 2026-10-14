#!/bin/bash
# Makes the Docker test gates usable in Claude Code cloud sessions: starts the
# daemon and rebuilds the pinned Playwright base image locally so it trusts the
# egress proxy's CA. Dockerfile.test then builds from this local tag unchanged.
# Safe to run repeatedly; concurrent runs wait for each other.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ] || ! command -v docker >/dev/null; then
  exit 0
fi

cd "$(dirname "$0")/../.."
exec 9>/tmp/hronaut-cloud-docker.lock
flock 9

if ! docker info >/dev/null 2>&1; then
  # Close the lock descriptor so the long-lived daemon does not inherit it.
  nohup dockerd > /tmp/dockerd.log 2>&1 9>&- &
  for _ in $(seq 1 30); do
    docker info >/dev/null 2>&1 && break
    sleep 1
  done
  docker info >/dev/null
fi

ca_file="${NODE_EXTRA_CA_CERTS:-${SSL_CERT_FILE:-/root/.ccr/ca-bundle.crt}}"
if [ ! -f "$ca_file" ]; then
  echo "No proxy CA bundle found; Docker is running but image builds may fail TLS checks."
  exit 0
fi

base_image="$(sed -n 's/^FROM \(mcr\.microsoft\.com\/playwright:[^ ]*\).*/\1/p' Dockerfile.test | head -n 1)"
if docker image inspect --format '{{index .Config.Labels "dev.hronaut.cloud-ca"}}' "$base_image" 2>/dev/null | grep -qx true; then
  echo "Docker ready: $base_image already trusts the proxy CA."
  exit 0
fi

build_dir="$(mktemp -d)"
trap 'rm -rf "$build_dir"' EXIT
cp "$ca_file" "$build_dir/cloud-proxy-ca.crt"
cat > "$build_dir/Dockerfile" <<DOCKERFILE
FROM $base_image
COPY cloud-proxy-ca.crt /usr/local/share/ca-certificates/cloud-proxy-ca.crt
RUN update-ca-certificates >/dev/null
ENV NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/cloud-proxy-ca.crt \\
    NODE_USE_ENV_PROXY=1
LABEL dev.hronaut.cloud-ca=true
DOCKERFILE
docker pull --quiet "$base_image" >/dev/null
docker build --quiet --tag "$base_image" "$build_dir" >/dev/null
echo "Docker ready: $base_image rebuilt to trust the proxy CA."
