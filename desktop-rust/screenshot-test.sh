#!/bin/bash
# Screenshot test: force window visible, launch app, capture display.
set -e
cd /work

echo "=== Temporarily setting visible=true in tauri.conf.json ==="
cp src-tauri/tauri.conf.json src-tauri/tauri.conf.json.bak
sed -i 's/"visible": false/"visible": true/' src-tauri/tauri.conf.json
grep '"visible"' src-tauri/tauri.conf.json

echo "=== Rebuilding app ==="
cd src-tauri
cargo build --message-format=short 2>&1 | tail -3
cd ..

# Restore config
mv src-tauri/tauri.conf.json.bak src-tauri/tauri.conf.json

BIN=/work/target-docker/debug/keyboard-helper

echo "=== Installing screenshot tools ==="
apt-get install -y --no-install-recommends x11-apps imagemagick >/dev/null 2>&1

echo "=== Starting Xvfb ==="
Xvfb :99 -screen 0 1280x900x24 -nolisten tcp -nolisten unix &
XVFB_PID=$!
sleep 1
export DISPLAY=:99
export XDG_RUNTIME_DIR=/tmp/runtime-root
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
eval "$(dbus-launch --sh-syntax)" || true

echo "=== Launching app in background ==="
"$BIN" > /tmp/app.out 2> /tmp/app.err &
APP_PID=$!
# Give the app time to initialize and render the webview
sleep 10

echo "=== Listing X windows ==="
xwininfo -root -tree 2>&1 | head -20 || echo "xwininfo failed"

echo "=== Taking screenshot ==="
import -display :99 -window root /tmp/screen.png
ls -la /tmp/screen.png

echo "=== Analyzing screenshot ==="
python3 <<'PY'
from PIL import Image
img = Image.open("/tmp/screen.png")
w, h = img.size
pixels = list(img.getdata())
total = len(pixels)
# Count pixels that are NOT near-black
nonblack = sum(1 for p in pixels if sum(p[:3]) > 30)
print(f"Size: {w}x{h}, {total} pixels total")
print(f"Non-near-black pixels: {nonblack} ({nonblack * 100 // total}%)")
# Check for signs of UI: count unique colors (real UI has many)
colors = set((p[0] // 16, p[1] // 16, p[2] // 16) for p in pixels[::100])
print(f"Unique color buckets (sampled): {len(colors)}")
if nonblack > total * 0.05:
    print("✓ Display has substantial non-black content — UI likely rendered")
else:
    print("✗ Display is mostly black — window may not have rendered")
PY

echo "=== Cleanup ==="
kill $APP_PID 2>/dev/null || true
kill $XVFB_PID 2>/dev/null || true
echo "=== Screenshot saved at /tmp/screen.png ==="
echo "=== stderr tail ==="
tail -10 /tmp/app.err
