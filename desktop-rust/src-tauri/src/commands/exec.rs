use std::sync::atomic::{AtomicBool, Ordering};
use tauri::State;
use crate::db::{DbState, queries, models::{ExecCategory, ExecCommand}};

/// Global flag to signal subprocess cancellation.
static STOP_FLAG: AtomicBool = AtomicBool::new(false);

// ── Exec Categories ────────────────────────────────────────

#[tauri::command]
pub fn list_exec_categories(state: State<DbState>) -> Result<Vec<ExecCategory>, String> {
    let conn = state.lock_recover();
    queries::list_exec_categories(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_exec_category(state: State<DbState>, name: String, sort_order: i32) -> Result<ExecCategory, String> {
    let conn = state.lock_recover();
    queries::create_exec_category(&conn, &name, sort_order).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_exec_category(state: State<DbState>, id: i64, name: String, sort_order: i32) -> Result<(), String> {
    let conn = state.lock_recover();
    queries::update_exec_category(&conn, id, &name, sort_order).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_exec_category(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.lock_recover();
    queries::delete_exec_category(&conn, id).map_err(|e| e.to_string())
}

// ── Exec Commands ──────────────────────────────────────────

#[tauri::command]
pub fn list_exec_commands(state: State<DbState>, category_id: i64) -> Result<Vec<ExecCommand>, String> {
    let conn = state.lock_recover();
    queries::list_exec_commands(&conn, category_id).map_err(|e| e.to_string())
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn create_exec_command(
    state: State<DbState>,
    category_id: i64,
    name: String,
    command: String,
    description: String,
    sort_order: i32,
    hide_after_run: bool,
    shell: Option<String>,
    wsl_distro: Option<String>,
) -> Result<ExecCommand, String> {
    let conn = state.lock_recover();
    let shell_str = shell.as_deref().unwrap_or("host");
    queries::create_exec_command(
        &conn, category_id, &name, &command, &description,
        sort_order, hide_after_run, shell_str, wsl_distro.as_deref(),
    ).map_err(|e| e.to_string())
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn update_exec_command(
    state: State<DbState>,
    id: i64,
    name: String,
    command: String,
    description: String,
    sort_order: i32,
    hide_after_run: bool,
    shell: Option<String>,
    wsl_distro: Option<String>,
) -> Result<(), String> {
    let conn = state.lock_recover();
    let shell_str = shell.as_deref().unwrap_or("host");
    queries::update_exec_command(
        &conn, id, &name, &command, &description,
        sort_order, hide_after_run, shell_str, wsl_distro.as_deref(),
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_exec_command(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.lock_recover();
    queries::delete_exec_command(&conn, id).map_err(|e| e.to_string())
}

// ── WSL distro discovery ───────────────────────────────────

/// List available WSL distributions.
///
/// On Windows: parses `wsl.exe -l -q` output. Note: WSL writes its list as
/// UTF-16 LE (even with `-q`), so we decode that manually. Returns empty
/// list on Mac/Linux or if WSL isn't installed.
#[tauri::command]
pub fn list_wsl_distros() -> Result<Vec<String>, String> {
    #[cfg(not(target_os = "windows"))]
    {
        return Ok(vec![]);
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let out = std::process::Command::new("wsl.exe")
            .args(["-l", "-q"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        let out = match out {
            Ok(o) => o,
            Err(_) => return Ok(vec![]), // WSL not installed
        };
        if !out.status.success() {
            return Ok(vec![]);
        }
        // UTF-16 LE. Skip BOM if present, then parse u16 pairs.
        let bytes = out.stdout;
        let start = if bytes.len() >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE { 2 } else { 0 };
        let mut u16s: Vec<u16> = Vec::with_capacity((bytes.len() - start) / 2);
        for chunk in bytes[start..].chunks_exact(2) {
            u16s.push(u16::from_le_bytes([chunk[0], chunk[1]]));
        }
        let text = String::from_utf16_lossy(&u16s);
        let distros = text
            .lines()
            .map(|s| s.trim().trim_end_matches('\0').to_string())
            .filter(|s| !s.is_empty())
            .collect();
        Ok(distros)
    }
}

// ── Run / Stop Command ─────────────────────────────────────

#[derive(Debug)]
enum RunDispatch<'a> {
    /// Host shell: cmd /c on Windows, sh -c elsewhere.
    Host { cmd: &'a str },
    /// WSL wrapper: wsl.exe [-d distro] -- bash -lc <cmd>.
    /// Windows-only — other platforms error out before reaching here.
    Wsl { cmd: &'a str, distro: Option<&'a str> },
}

/// Build the argv for `tokio::process::Command`. Returns (program, args).
///
/// Note on escaping: the user-supplied `cmd` is passed as a **single argv
/// element** to `bash -lc` (or `sh -c`), NOT embedded into a shell string.
/// Shells read the -c argument verbatim as source, so no quoting is
/// required on our end — bash sees exactly what the user typed. The
/// earlier `bash_single_quote_escape` broke any command containing `'`
/// because we were mangling it into `'\''` as if we were interpolating
/// into `bash -lc '<cmd>'`, which is NOT what Rust's Command::args does.
fn build_argv<'a>(dispatch: &'a RunDispatch<'a>) -> (&'a str, Vec<String>) {
    match dispatch {
        RunDispatch::Host { cmd } => {
            if cfg!(target_os = "windows") {
                ("cmd", vec!["/c".into(), (*cmd).to_string()])
            } else {
                ("sh", vec!["-c".into(), (*cmd).to_string()])
            }
        }
        RunDispatch::Wsl { cmd, distro } => {
            let mut args: Vec<String> = Vec::new();
            if let Some(d) = distro {
                args.push("-d".into());
                args.push((*d).to_string());
            }
            args.push("--".into());
            args.push("bash".into());
            args.push("-lc".into());
            args.push((*cmd).to_string());
            ("wsl.exe", args)
        }
    }
}

#[tauri::command]
pub async fn run_command(
    command: String,
    shell: Option<String>,
    wsl_distro: Option<String>,
) -> Result<String, String> {
    STOP_FLAG.store(false, Ordering::SeqCst);

    let shell_kind = shell.as_deref().unwrap_or("host");
    let dispatch = match shell_kind {
        "host" => RunDispatch::Host { cmd: &command },
        "wsl" => {
            if !cfg!(target_os = "windows") {
                return Err("WSL execution is Windows-only".into());
            }
            RunDispatch::Wsl { cmd: &command, distro: wsl_distro.as_deref() }
        }
        other => return Err(format!("unknown shell: {other}")),
    };

    let (program, args) = build_argv(&dispatch);

    let mut builder = tokio::process::Command::new(program);
    builder.args(&args);
    builder.stdout(std::process::Stdio::piped());
    builder.stderr(std::process::Stdio::piped());

    // No flashing cmd windows when running host commands on Windows
    // (same fix as repo_search.rs:22 and whisper-server spawn).
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        builder.creation_flags(CREATE_NO_WINDOW);
    }

    let child = builder.spawn().map_err(|e| format!("Failed to spawn {program}: {e}"))?;

    let output = child
        .wait_with_output()
        .await
        .map_err(|e| format!("Process error: {e}"))?;

    if STOP_FLAG.load(Ordering::SeqCst) {
        return Err("Command stopped by user".to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let code = output.status.code().unwrap_or(-1);

    let mut result = String::new();
    if !stdout.is_empty() {
        result.push_str(&stdout);
    }
    if !stderr.is_empty() {
        if !result.is_empty() {
            result.push('\n');
        }
        result.push_str("[stderr]\n");
        result.push_str(&stderr);
    }
    result.push_str(&format!("\n\n--- exit code: {code} ---"));

    // Still return output even on non-zero exit — users want to see errors.
    Ok(result)
}

#[tauri::command]
pub fn stop_command() -> Result<(), String> {
    STOP_FLAG.store(true, Ordering::SeqCst);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_argv_is_platform_specific() {
        let (prog, args) = build_argv(&RunDispatch::Host { cmd: "echo 1" });
        if cfg!(target_os = "windows") {
            assert_eq!(prog, "cmd");
            assert_eq!(args, vec!["/c".to_string(), "echo 1".to_string()]);
        } else {
            assert_eq!(prog, "sh");
            assert_eq!(args, vec!["-c".to_string(), "echo 1".to_string()]);
        }
    }

    #[test]
    fn wsl_argv_without_distro() {
        let (prog, args) = build_argv(&RunDispatch::Wsl { cmd: "echo hi", distro: None });
        assert_eq!(prog, "wsl.exe");
        assert_eq!(args, vec!["--".to_string(), "bash".into(), "-lc".into(), "echo hi".into()]);
    }

    #[test]
    fn wsl_argv_with_distro() {
        let (prog, args) = build_argv(&RunDispatch::Wsl {
            cmd: "echo hi", distro: Some("Ubuntu-22.04"),
        });
        assert_eq!(prog, "wsl.exe");
        assert_eq!(args, vec![
            "-d".to_string(), "Ubuntu-22.04".into(),
            "--".into(), "bash".into(), "-lc".into(), "echo hi".into(),
        ]);
    }

    #[test]
    fn wsl_argv_passes_user_command_verbatim() {
        // Command is passed as a single argv element to `bash -lc`, so
        // bash reads it as -c source. Quotes, spaces, UTF-8 all fine —
        // no pre-processing. This test guards against regressions of the
        // v1.3.20 `bash_single_quote_escape` bug that mangled commands
        // containing `'` into `'\''` and broke rsync / ssh one-liners.
        let raw = "rsync -av 'some file' user@host:/dest";
        let (_, args) = build_argv(&RunDispatch::Wsl { cmd: raw, distro: None });
        assert_eq!(args.last().unwrap(), raw);
    }
}
