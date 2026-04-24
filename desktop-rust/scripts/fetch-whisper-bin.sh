#!/usr/bin/env bash
# Fetch the whisper-server binary for local development (matching
# WHISPER_CPP_VERSION). Mirrors what CI does.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$HERE/../.." && pwd)
VERSION=$(cat "$REPO_ROOT/desktop-rust/WHISPER_CPP_VERSION")
OUT="$REPO_ROOT/desktop-rust/src-tauri/binaries"
mkdir -p "$OUT"

# Note: in whisper.cpp v1.7.x the CMake target is `server` (see
# examples/server/CMakeLists.txt which sets TARGET = server). We rename on
# copy to match Tauri's externalBin triple convention.
build_from_source() {
    local target_triple="$1"
    local cmake_flags="$2"
    local out_name="$3"

    local tmp
    tmp=$(mktemp -d)
    trap 'rm -rf "$tmp"' RETURN
    git clone --depth 1 --branch "${VERSION}" https://github.com/ggml-org/whisper.cpp "$tmp/wcpp"
    cd "$tmp/wcpp"
    # BUILD_SHARED_LIBS=OFF → one static exe (no companion .dll/.dylib).
    eval "cmake -B build -DWHISPER_BUILD_SERVER=ON -DWHISPER_SDL2=OFF -DBUILD_SHARED_LIBS=OFF $cmake_flags"
    cmake --build build -j --target server
    cp "build/bin/server" "$OUT/$out_name"
    chmod +x "$OUT/$out_name"
    echo "Installed $OUT/$out_name"
}

case "$(uname -s)" in
    Darwin)
        TARGET=aarch64-apple-darwin
        build_from_source "$TARGET" "-DGGML_METAL=ON" "whisper-server-$TARGET"
        ;;
    Linux)
        TARGET=x86_64-unknown-linux-gnu
        build_from_source "$TARGET" "" "whisper-server-$TARGET"
        ;;
    *)
        echo "unsupported OS: $(uname -s)" >&2
        exit 1
        ;;
esac
