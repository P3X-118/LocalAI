#!/bin/bash
# Build the l4t-backend sidecar image locally and push it to git.sgc.ai's
# container registry. Run on hal (aarch64). The bundle source is the
# deployed fork-built backend (LLAMA_VERSION pin) — rebuild that first via
# the fork's backend build when bumping the pin, then re-run this.
set -euo pipefail
PIN=${PIN:-58190cc8}
REG=dock.sgc.ai/p3x-118/localai/l4t-backend
BUNDLE=${BUNDLE:-/home/oneill/localai/backends/nvidia-l4t-arm64-llama-cpp}
BUILD=$(mktemp -d)
trap 'rm -rf "$BUILD"' EXIT
cp -a "$BUNDLE" "$BUILD/backend-bundle"
cp "$(dirname "$(realpath "$0")")/Dockerfile" "$BUILD/"
docker build -t "$REG:$PIN" -t "$REG:latest" "$BUILD"
docker push "$REG:$PIN"
docker push "$REG:latest"
echo "pushed $REG:{$PIN,latest}"
