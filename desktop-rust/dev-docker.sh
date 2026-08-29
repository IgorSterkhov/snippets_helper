#!/bin/bash
# Run `cargo tauri dev` inside a Docker container with X11 forwarding.
# Usage:
#   ./dev-docker.sh          # tauri dev (hot reload)
#   ./dev-docker.sh build    # production appimage build
#   ./dev-docker.sh shell    # interactive shell
#   ./dev-docker.sh test     # cargo check + test in an isolated source copy

set -e
set -o pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
cd -- "$SCRIPT_DIR"

IMAGE=keyboard-helper-dev
CONTAINER=keyboard-helper-dev-run

MODE="${1:-dev}"

if [ "$MODE" = "test" ]; then
  REPO_ROOT_RAW=$(git rev-parse --show-toplevel)
  REPO_ROOT=$(realpath -e -- "$REPO_ROOT_RAW")
  EXPECTED_SCRIPT_DIR=$(realpath -e -- "$REPO_ROOT/desktop-rust")
  if [ ! -d "$REPO_ROOT" ] || [ -L "$REPO_ROOT" ] || [ "$SCRIPT_DIR" != "$EXPECTED_SCRIPT_DIR" ]; then
    echo "Refusing unexpected repository root: $REPO_ROOT" >&2
    exit 1
  fi

  MANIFEST_DIR=$(realpath -e -- /tmp)
  if [ "$MANIFEST_DIR" != "/tmp" ] || [ ! -d "$MANIFEST_DIR" ] || [ -L "$MANIFEST_DIR" ]; then
    echo "Refusing unexpected manifest directory: $MANIFEST_DIR" >&2
    exit 1
  fi

  MANIFEST_PREFIX="$MANIFEST_DIR/keyboard-helper-docker-test-manifest."
  SOURCE_MANIFEST=$(mktemp "${MANIFEST_PREFIX}XXXXXX")

  manifest_path_is_safe() {
    [ -n "${SOURCE_MANIFEST:-}" ] || return 1
    case "$SOURCE_MANIFEST" in
      "$MANIFEST_PREFIX"??????) ;;
      *) return 1 ;;
    esac
    [ "$(realpath -e -- "$(dirname -- "$SOURCE_MANIFEST")")" = "$MANIFEST_DIR" ] || return 1
    [ -f "$SOURCE_MANIFEST" ] && [ ! -L "$SOURCE_MANIFEST" ]
  }

  cleanup_source_manifest() {
    [ -n "${SOURCE_MANIFEST:-}" ] || return 0
    if ! manifest_path_is_safe; then
      echo "Refusing to remove unexpected manifest path: $SOURCE_MANIFEST" >&2
      return 1
    fi
    if ! rm -- "$SOURCE_MANIFEST"; then
      echo "Failed to remove source manifest: $SOURCE_MANIFEST" >&2
      return 1
    fi
    SOURCE_MANIFEST=
  }

  if ! manifest_path_is_safe; then
    echo "Refusing invalid manifest path: $SOURCE_MANIFEST" >&2
    exit 1
  fi
  trap cleanup_source_manifest EXIT

  if ! git -C "$REPO_ROOT" ls-files -z --cached --others --exclude-standard -- desktop-rust | \
    while IFS= read -r -d '' REPO_PATH; do
      case "$REPO_PATH" in
        desktop-rust/*) ;;
        *) echo "Refusing unexpected manifest entry: $REPO_PATH" >&2; exit 1 ;;
      esac

      RELATIVE_PATH=${REPO_PATH#desktop-rust/}
      case "$RELATIVE_PATH" in
        ""|/*|../*|*/../*|*/..)
          echo "Refusing unsafe manifest entry: $REPO_PATH" >&2
          exit 1
          ;;
        src-tauri/binaries|src-tauri/binaries/*)
          continue
          ;;
      esac

      SOURCE_PATH="$REPO_ROOT/$REPO_PATH"
      if [ -e "$SOURCE_PATH" ] || [ -L "$SOURCE_PATH" ]; then
        printf '%s\0' "$RELATIVE_PATH"
      fi
    done > "$SOURCE_MANIFEST"
  then
    echo "Failed to build Docker source manifest." >&2
    exit 1
  fi

  echo "→ Refreshing Docker test image ($IMAGE)."
  docker build -f Dockerfile.dev -t "$IMAGE" .
  echo "→ Running cargo check + test with a read-only source mount."
  DOCKER_STATUS=0
  docker run \
    --rm \
    --mount "type=bind,src=$REPO_ROOT,dst=/source,readonly" \
    --mount "type=bind,src=$SOURCE_MANIFEST,dst=/source-manifest,readonly" \
    -v keyboard-helper-cargo:/usr/local/cargo/registry \
    -v keyboard-helper-test-target:/work/target-docker \
    -e CARGO_TARGET_DIR=/work/target-docker \
    "$IMAGE" \
    bash -c '
      set -euo pipefail
      mkdir -p /work/source-copy
      tar -C /source/desktop-rust \
        --null \
        --no-recursion \
        --exclude="src-tauri/binaries/*" \
        --exclude="src-tauri/binaries" \
        --files-from=/source-manifest \
        -cf - | tar -C /work/source-copy -xf -
      mkdir -p /work/source-copy/src-tauri/binaries
      install -m 755 /dev/null /work/source-copy/src-tauri/binaries/whisper-server-x86_64-unknown-linux-gnu
      install -m 755 /dev/null /work/source-copy/src-tauri/binaries/llama-server-x86_64-unknown-linux-gnu
      pkg-config --exists alsa
      command -v patchelf
      cd /work/source-copy/src-tauri
      cargo check --locked
      cargo test --locked
    ' || DOCKER_STATUS=$?

  CLEANUP_STATUS=0
  cleanup_source_manifest || CLEANUP_STATUS=$?
  trap - EXIT
  if [ "$DOCKER_STATUS" -ne 0 ]; then
    exit "$DOCKER_STATUS"
  fi
  exit "$CLEANUP_STATUS"
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
