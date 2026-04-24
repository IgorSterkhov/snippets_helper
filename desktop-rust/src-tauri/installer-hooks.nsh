; Pre-install hook: kill any still-running app processes so the installer
; can overwrite their .exe files without "file in use" errors.
;
; Tauri v2 NSIS defines empty `NSIS_HOOK_PREINSTALL` / `NSIS_HOOK_POSTINSTALL`
; macros; defining them here overrides the defaults.
;
; The whisper-server sidecar is spawned by the main app via tauri-plugin-shell
; and is NOT in the main exe's process group on Windows — so closing the app
; doesn't close the sidecar. v1.3.10 added a RunEvent::Exit handler that kills
; it on graceful shutdown, but a crash/hard-kill of the main app can still
; leave whisper-server.exe alive. `taskkill /F /T` here is the belt-and-braces
; safety net.

!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Stopping running Keyboard Helper processes..."
  ; /F = force, /T = kill tree, /IM = by image name. Redirect output + ignore
  ; exit codes — the image may not be running (exit code 128), which is fine.
  nsExec::Exec 'taskkill /F /T /IM whisper-server.exe'
  Pop $0
  nsExec::Exec 'taskkill /F /T /IM llama-server.exe'
  Pop $0
  nsExec::Exec 'taskkill /F /T /IM keyboard-helper.exe'
  Pop $0
  ; Give Windows a moment to release file locks.
  Sleep 500
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Stopping running Keyboard Helper processes..."
  nsExec::Exec 'taskkill /F /T /IM whisper-server.exe'
  Pop $0
  nsExec::Exec 'taskkill /F /T /IM llama-server.exe'
  Pop $0
  nsExec::Exec 'taskkill /F /T /IM keyboard-helper.exe'
  Pop $0
  Sleep 500
!macroend
