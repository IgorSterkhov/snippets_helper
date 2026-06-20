# macOS Frontend Cache Clear Spec

## Goal

After applying a frontend OTA update, the desktop app should load the new
frontend bundle on macOS without requiring a full application restart while
preserving user-facing WebView state such as `localStorage`.

## Current Behavior

`apply_frontend_update` writes the new frontend pointer, marks the boot as
tentative, and calls `reload_frontend_windows`. On macOS, WebKit may still serve
old JS/CSS/assets from browsing cache after a WebView reload, so the user can
see the previous frontend until restarting the app. A full WebView browsing-data
clear is too broad for automatic OTA because it can remove `localStorage`.

## Required Behavior

- Serve `khapp://` frontend assets with no-store/no-cache headers so WebView
  reloads fetch the newly pointed frontend bundle instead of stale cached files.
- Add a manual Settings > Update action: `Clear frontend cache & reload`.
- The manual action should warn that it clears WebView browsing data, then clear
  browsing data for the same frontend windows and reload them.
- Add smoke coverage for `khapp://` no-cache headers, command registration, the
  manual button, and the button invoking the manual command.

## Release

This changes the native Tauri command surface, so it must ship as a full native
minor release: `v1.15.0`.
