#!/bin/bash
# Run `cargo tauri dev` inside a Docker container with X11 forwarding.
# Usage:
#   ./dev-docker.sh          # tauri dev (hot reload)
#   ./dev-docker.sh build    # production appimage build
#   ./dev-docker.sh shell    # interactive shell
#   ./dev-docker.sh test     # cargo check + test in an isolated source copy

set -e

cd "$(dirname "$0")"

IMAGE=keyboard-helper-dev
CONTAINER=keyboard-helper-dev-run

MODE="${1:-dev}"

if [ "$MODE" = "test" ]; then
  echo "→ Refreshing Docker test image ($IMAGE)."
  docker build -f Dockerfile.dev -t "$IMAGE" .
  echo "→ Running cargo check + test with a read-only source mount."
  exec docker run \
    --rm \
    -v "$(pwd):/source:ro" \
    -v keyboard-helper-cargo:/usr/local/cargo/registry \
    -v keyboard-helper-test-target:/work/target-docker \
    -e CARGO_TARGET_DIR=/work/target-docker \
    "$IMAGE" \
    bash -c '
      set -euo pipefail
      mkdir -p /work/source-copy
      tar -C /source \
        --exclude="./src-tauri/target*" \
        --exclude="./target-docker" \
        --exclude="./node_modules" \
        --exclude="./src-tauri/gen" \
        --exclude="./src-tauri/binaries" \
        --exclude="./screen.png" \
        -cf - . | tar -C /work/source-copy -xf -
      mkdir -p /work/source-copy/src-tauri/binaries
      install -m 755 /dev/null /work/source-copy/src-tauri/binaries/whisper-server-x86_64-unknown-linux-gnu
      install -m 755 /dev/null /work/source-copy/src-tauri/binaries/llama-server-x86_64-unknown-linux-gnu
      pkg-config --exists alsa
      command -v patchelf
      cd /work/source-copy/src-tauri
      cargo check --locked
      cargo test --locked
    '
fi

if [ "$MODE" != "rebuild" ] && ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "→ Building Docker image ($IMAGE). This takes ~5 min on first run."
  docker build -f Dockerfile.dev -t "$IMAGE" .
fi

if [ "$MODE" = "dev" ] || [ "$MODE" = "shell" ]; then
  echo "→ Enabling X11 forwarding for Docker (requires xhost)."
  if command -v xhost >/dev/null 2>&1; then
    xhost +local:docker >/dev/null 2>&1 || true
  else
    echo "⚠ xhost not found — GUI window may not appear. Install x11-xserver-utils."
  fi
fi

COMMON_ARGS=(
  --rm
  --name "$CONTAINER"
  -v "$(pwd):/work"
  -v keyboard-helper-cargo:/usr/local/cargo/registry
  -v keyboard-helper-target:/work/target-docker
  -e DISPLAY="${DISPLAY:-:0}"
  -e XDG_RUNTIME_DIR=/tmp/runtime
  -v /tmp/.X11-unix:/tmp/.X11-unix
  --device /dev/dri:/dev/dri
  --ipc host
  --network host
)

case "$MODE" in
  dev)
    echo "→ Starting cargo tauri dev (Ctrl+C to stop)"
    exec docker run "${COMMON_ARGS[@]}" -it "$IMAGE" cargo tauri dev
    ;;
  build)
    echo "→ Building AppImage (takes 5-10 min)"
    exec docker run "${COMMON_ARGS[@]}" "$IMAGE" cargo tauri build --bundles appimage
    ;;
  shell)
    exec docker run "${COMMON_ARGS[@]}" -it "$IMAGE" bash
    ;;
  rebuild)
    docker rmi "$IMAGE" 2>/dev/null || true
    docker build -f Dockerfile.dev -t "$IMAGE" .
    ;;
  *)
    echo "Usage: $0 [dev|build|shell|test|rebuild]"
    exit 1
    ;;
esac
