use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;
use crate::db::{DbState, queries};
use std::time::Duration;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct VpsServer {
    pub name: String,
    pub host: String,
    pub user: String,
    pub port: u16,
    pub key_file: String,
    pub color: String,
    pub auto_refresh: bool,
    pub refresh_interval: u32,
    #[serde(default)]
    pub environment: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct VpsEnvironment {
    pub name: String,
    pub sort_order: u32,
}

fn get_computer_id() -> String {
    hostname::get()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string()
}

fn load_servers(conn: &rusqlite::Connection, computer_id: &str) -> Vec<VpsServer> {
    let raw = queries::get_setting(conn, computer_id, "vps_servers")
        .ok()
        .flatten()
        .unwrap_or_else(|| "[]".to_string());
    serde_json::from_str::<Vec<VpsServer>>(&raw).unwrap_or_default()
}

fn save_servers(conn: &rusqlite::Connection, computer_id: &str, servers: &[VpsServer]) -> Result<(), String> {
    let json = serde_json::to_string(servers).map_err(|e| e.to_string())?;
    queries::set_setting(conn, computer_id, "vps_servers", &json).map_err(|e| e.to_string())
}

fn load_environments(conn: &rusqlite::Connection, computer_id: &str) -> Vec<VpsEnvironment> {
    let raw = queries::get_setting(conn, computer_id, "vps_environments")
        .ok()
        .flatten()
        .unwrap_or_else(|| "[]".to_string());
    serde_json::from_str::<Vec<VpsEnvironment>>(&raw).unwrap_or_default()
}

fn save_environments(conn: &rusqlite::Connection, computer_id: &str, envs: &[VpsEnvironment]) -> Result<(), String> {
    let json = serde_json::to_string(envs).map_err(|e| e.to_string())?;
    queries::set_setting(conn, computer_id, "vps_environments", &json).map_err(|e| e.to_string())
}

/// Ensure a "Default" environment exists and assign orphan servers to it.
fn ensure_default_environment(conn: &rusqlite::Connection, computer_id: &str) -> Result<(), String> {
    let mut envs = load_environments(conn, computer_id);
    let has_default = envs.iter().any(|e| e.name == "Default");
    if !has_default {
        let max_order = envs.iter().map(|e| e.sort_order).max().unwrap_or(0);
        envs.push(VpsEnvironment { name: "Default".to_string(), sort_order: max_order + 1 });
        save_environments(conn, computer_id, &envs)?;
    }

    // Assign orphan servers (empty environment) to "Default"
    let mut servers = load_servers(conn, computer_id);
    let mut changed = false;
    for srv in &mut servers {
        if srv.environment.is_empty() {
            srv.environment = "Default".to_string();
            changed = true;
        }
    }
    if changed {
        save_servers(conn, computer_id, &servers)?;
    }
    Ok(())
}

fn expand_key_file(key_file: &str) -> String {
    if key_file.starts_with("~/") {
        dirs::home_dir()
            .map(|h| h.join(&key_file[2..]).to_string_lossy().to_string())
            .unwrap_or_else(|| key_file.to_string())
    } else {
        key_file.to_string()
    }
}

fn build_ssh_cmd(user: &str, host: &str, port: u16, key_file: &str, remote_cmd: &str) -> std::process::Command {
    let mut cmd = std::process::Command::new("ssh");
    // Suppress the console window on Windows — without CREATE_NO_WINDOW
    // every stats poll / test-connection flashes a black cmd window for
    // the duration of the SSH handshake. Same pattern as repo_search.rs.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.args(["-o", "ConnectTimeout=5"]);
    cmd.args(["-o", "StrictHostKeyChecking=no"]);
    cmd.args(["-o", "BatchMode=yes"]);
    if port != 22 {
        cmd.args(["-p", &port.to_string()]);
    }
    let expanded_key = expand_key_file(key_file);
    if !expanded_key.is_empty() {
        cmd.args(["-i", &expanded_key]);
    }
    cmd.arg(format!("{}@{}", user, host));
    cmd.arg(remote_cmd);
    cmd
}

// ── Environment Commands ────────────────────────────────────

#[tauri::command]
pub fn list_vps_environments(state: State<DbState>) -> Result<Vec<Value>, String> {
    let conn = state.lock_recover();
    let cid = get_computer_id();
    ensure_default_environment(&conn, &cid)?;
    let envs = load_environments(&conn, &cid);
    let values: Vec<Value> = envs.into_iter()
        .map(|e| serde_json::to_value(e).unwrap_or_default())
        .collect();
    Ok(values)
}

#[tauri::command]
pub fn add_vps_environment(state: State<DbState>, name: String) -> Result<(), String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Environment name cannot be empty".to_string());
    }
    let conn = state.lock_recover();
    let cid = get_computer_id();
    let mut envs = load_environments(&conn, &cid);
    if envs.iter().any(|e| e.name == name) {
        return Err(format!("Environment '{}' already exists", name));
    }
    let max_order = envs.iter().map(|e| e.sort_order).max().unwrap_or(0);
    envs.push(VpsEnvironment { name, sort_order: max_order + 1 });
    save_environments(&conn, &cid, &envs)
}

#[tauri::command]
pub fn rename_vps_environment(state: State<DbState>, old_name: String, new_name: String) -> Result<(), String> {
    let new_name = new_name.trim().to_string();
    if new_name.is_empty() {
        return Err("Environment name cannot be empty".to_string());
    }
    let conn = state.lock_recover();
    let cid = get_computer_id();

    let mut envs = load_environments(&conn, &cid);
    if envs.iter().any(|e| e.name == new_name) {
        return Err(format!("Environment '{}' already exists", new_name));
    }
    let found = envs.iter_mut().find(|e| e.name == old_name);
    match found {
        Some(env) => env.name = new_name.clone(),
        None => return Err(format!("Environment '{}' not found", old_name)),
    }
    save_environments(&conn, &cid, &envs)?;

    // Update all servers that belong to the renamed environment
    let mut servers = load_servers(&conn, &cid);
    for srv in &mut servers {
        if srv.environment == old_name {
            srv.environment = new_name.clone();
        }
    }
    save_servers(&conn, &cid, &servers)
}

#[tauri::command]
pub fn remove_vps_environment(state: State<DbState>, name: String) -> Result<(), String> {
    let conn = state.lock_recover();
    let cid = get_computer_id();

    let mut envs = load_environments(&conn, &cid);
    let before_len = envs.len();
    envs.retain(|e| e.name != name);
    if envs.len() == before_len {
        return Err(format!("Environment '{}' not found", name));
    }

    // Ensure we always have at least "Default"
    if envs.is_empty() {
        envs.push(VpsEnvironment { name: "Default".to_string(), sort_order: 0 });
    }
    save_environments(&conn, &cid, &envs)?;

    // Move orphaned servers to "Default"
    let mut servers = load_servers(&conn, &cid);
    for srv in &mut servers {
        if srv.environment == name {
            srv.environment = "Default".to_string();
        }
    }
    save_servers(&conn, &cid, &servers)
}

#[tauri::command]
pub fn reorder_vps_environments(state: State<DbState>, names: Vec<String>) -> Result<(), String> {
    let conn = state.lock_recover();
    let cid = get_computer_id();
    let mut envs = load_environments(&conn, &cid);

    // Re-sort envs according to the names order
    let mut new_envs: Vec<VpsEnvironment> = Vec::new();
    for (i, name) in names.iter().enumerate() {
        if let Some(env) = envs.iter().find(|e| &e.name == name) {
            new_envs.push(VpsEnvironment { name: env.name.clone(), sort_order: i as u32 });
        }
    }
    // Keep any envs not in the list at the end
    for env in &envs {
        if !names.contains(&env.name) {
            let order = new_envs.len() as u32;
            new_envs.push(VpsEnvironment { name: env.name.clone(), sort_order: order });
        }
    }
    envs = new_envs;
    save_environments(&conn, &cid, &envs)
}

// ── Server Commands ─────────────────────────────────────────

#[tauri::command]
pub fn list_vps_servers(state: State<DbState>) -> Result<Vec<Value>, String> {
    let conn = state.lock_recover();
    let cid = get_computer_id();
    ensure_default_environment(&conn, &cid)?;
    let servers = load_servers(&conn, &cid);
    let values: Vec<Value> = servers.into_iter()
        .map(|s| serde_json::to_value(s).unwrap_or_default())
        .collect();
    Ok(values)
}

#[tauri::command]
pub fn add_vps_server(state: State<DbState>, server: Value) -> Result<(), String> {
    let mut new_server: VpsServer = serde_json::from_value(server)
        .map_err(|e| format!("Invalid server data: {}", e))?;
    let conn = state.lock_recover();
    let cid = get_computer_id();

    // Default environment if not specified
    if new_server.environment.is_empty() {
        new_server.environment = "Default".to_string();
    }

    let mut servers = load_servers(&conn, &cid);
    if servers.iter().any(|s| s.name == new_server.name) {
        return Err(format!("Server with name '{}' already exists", new_server.name));
    }
    servers.push(new_server);
    save_servers(&conn, &cid, &servers)
}

#[tauri::command]
pub fn update_vps_server(state: State<DbState>, index: usize, server: Value) -> Result<(), String> {
    let updated: VpsServer = serde_json::from_value(server)
        .map_err(|e| format!("Invalid server data: {}", e))?;
    let conn = state.lock_recover();
    let cid = get_computer_id();
    let mut servers = load_servers(&conn, &cid);
    if index >= servers.len() {
        return Err(format!("Index {} out of range (have {} servers)", index, servers.len()));
    }
    servers[index] = updated;
    save_servers(&conn, &cid, &servers)
}

#[tauri::command]
pub fn remove_vps_server(state: State<DbState>, index: usize) -> Result<(), String> {
    let conn = state.lock_recover();
    let cid = get_computer_id();
    let mut servers = load_servers(&conn, &cid);
    if index >= servers.len() {
        return Err(format!("Index {} out of range (have {} servers)", index, servers.len()));
    }
    servers.remove(index);
    save_servers(&conn, &cid, &servers)
}

#[tauri::command]
pub fn move_vps_server(state: State<DbState>, index: usize, target_env: String) -> Result<(), String> {
    let conn = state.lock_recover();
    let cid = get_computer_id();
    let mut servers = load_servers(&conn, &cid);
    if index >= servers.len() {
        return Err(format!("Index {} out of range (have {} servers)", index, servers.len()));
    }

    // Verify target environment exists
    let envs = load_environments(&conn, &cid);
    if !envs.iter().any(|e| e.name == target_env) {
        return Err(format!("Environment '{}' not found", target_env));
    }

    servers[index].environment = target_env;
    save_servers(&conn, &cid, &servers)
}

#[tauri::command]
pub async fn vps_test_connection(host: String, user: String, port: u16, key_file: String) -> Result<String, String> {
    let mut cmd = build_ssh_cmd(&user, &host, port, &key_file, "echo ok && hostname");
    let output = tokio::task::spawn_blocking(move || {
        cmd.stdout(std::process::Stdio::piped())
           .stderr(std::process::Stdio::piped());
        let child = cmd.spawn().map_err(|e| format!("Failed to spawn ssh: {}", e))?;
        let output = wait_with_timeout(child, Duration::from_secs(10))?;
        Ok::<std::process::Output, String>(output)
    })
    .await
    .map_err(|e| format!("Task error: {}", e))??;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        // stdout should be "ok\nhostname"
        let lines: Vec<&str> = stdout.lines().collect();
        if lines.len() >= 2 {
            Ok(lines[1].to_string())
        } else if !stdout.is_empty() {
            Ok(stdout)
        } else {
            Ok("Connected".to_string())
        }
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if stderr.is_empty() {
            "SSH connection failed".to_string()
        } else {
            stderr
        })
    }
}

#[tauri::command]
pub async fn vps_get_stats(host: String, user: String, port: u16, key_file: String) -> Result<Value, String> {
    let remote_cmd = "top -bn1 | head -5; echo '===FREE==='; free -h; echo '===DF==='; df -h /; echo '===UPTIME==='; uptime; echo '===HOSTNAME==='; hostname";
    let mut cmd = build_ssh_cmd(&user, &host, port, &key_file, remote_cmd);

    let output = tokio::task::spawn_blocking(move || {
        cmd.stdout(std::process::Stdio::piped())
           .stderr(std::process::Stdio::piped());
        let child = cmd.spawn().map_err(|e| format!("Failed to spawn ssh: {}", e))?;
        let output = wait_with_timeout(child, Duration::from_secs(10))?;
        Ok::<std::process::Output, String>(output)
    })
    .await
    .map_err(|e| format!("Task error: {}", e))??;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "SSH command failed".to_string()
        } else {
            stderr
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    parse_stats(&stdout)
}

fn wait_with_timeout(child: std::process::Child, timeout: Duration) -> Result<std::process::Output, String> {
    use std::thread;
    use std::sync::mpsc;

    let (tx, rx) = mpsc::channel();

    thread::spawn(move || {
        let result = child.wait_with_output();
        let _ = tx.send(result);
    });

    match rx.recv_timeout(timeout) {
        Ok(result) => result.map_err(|e| format!("SSH process error: {}", e)),
        Err(_) => Err("SSH command timed out".to_string()),
    }
}

fn parse_stats(output: &str) -> Result<Value, String> {
    let sections: Vec<&str> = output.split("===FREE===").collect();
    let top_section = sections.first().unwrap_or(&"");
    let rest = sections.get(1).unwrap_or(&"");

    let sections2: Vec<&str> = rest.split("===DF===").collect();
    let free_section = sections2.first().unwrap_or(&"");
    let rest2 = sections2.get(1).unwrap_or(&"");

    let sections3: Vec<&str> = rest2.split("===UPTIME===").collect();
    let df_section = sections3.first().unwrap_or(&"");
    let rest3 = sections3.get(1).unwrap_or(&"");

    let sections4: Vec<&str> = rest3.split("===HOSTNAME===").collect();
    let uptime_section = sections4.first().unwrap_or(&"");
    let hostname_section = sections4.get(1).unwrap_or(&"");

    // Parse CPU from top output
    let cpu_usage = parse_cpu(top_section);

    // Parse RAM from free -h
    let (ram_total, ram_used, ram_free, ram_pct) = parse_free(free_section);

    // Parse Disk from df -h /
    let (disk_total, disk_used, disk_free, disk_pct) = parse_df(df_section);

    // Uptime and hostname
    let uptime = uptime_section.trim().to_string();
    let hostname = hostname_section.trim().to_string();

    Ok(serde_json::json!({
        "hostname": hostname,
        "uptime": uptime,
        "cpu_usage_pct": cpu_usage,
        "ram_total": ram_total,
        "ram_used": ram_used,
        "ram_free": ram_free,
        "ram_pct": ram_pct,
        "disk_total": disk_total,
        "disk_used": disk_used,
        "disk_free": disk_free,
        "disk_pct": disk_pct,
    }))
}

fn parse_cpu(top_output: &str) -> f64 {
    // Look for: %Cpu(s):  X.Y us,  Z.W sy, ...
    // CPU usage = us + sy
    for line in top_output.lines() {
        let line = line.trim();
        if line.contains("Cpu") {
            // Try to extract us and sy values
            let mut us = 0.0_f64;
            let mut sy = 0.0_f64;

            // Split by comma+space to avoid breaking decimal commas like "3,2"
            // Use regex-like split: split on ", " (comma followed by at least one space)
            let parts_str = line.split("  ").flat_map(|s| s.split(", ")).collect::<Vec<_>>();
            for part in parts_str {
                let part = part.trim();
                if part.contains("us") {
                    // Extract number before "us"
                    if let Some(val) = extract_float_before(part, "us") {
                        us = val;
                    }
                } else if part.contains("sy") {
                    if let Some(val) = extract_float_before(part, "sy") {
                        sy = val;
                    }
                }
            }

            return (us + sy).min(100.0);
        }
    }
    0.0
}

fn extract_float_before(s: &str, suffix: &str) -> Option<f64> {
    let s = s.trim();
    if let Some(pos) = s.find(suffix) {
        let before = s[..pos].trim();
        // Get the last token which should be the number
        let num_str = before.split_whitespace().last().unwrap_or(before);
        // Handle both dot and comma as decimal separator
        let num_str = num_str.replace(',', ".");
        num_str.parse::<f64>().ok()
    } else {
        None
    }
}

fn parse_free(free_output: &str) -> (String, String, String, f64) {
    // free -h output:
    //               total        used        free      shared  buff/cache   available
    // Mem:          7.7Gi       2.1Gi       3.2Gi       ...
    for line in free_output.lines() {
        let line = line.trim();
        if line.starts_with("Mem:") {
            let parts: Vec<&str> = line.split_whitespace().collect();
            let total = parts.get(1).unwrap_or(&"?").to_string();
            let used = parts.get(2).unwrap_or(&"?").to_string();
            let free = parts.get(3).unwrap_or(&"?").to_string();

            // Calculate percentage from raw numbers
            let pct = parse_size_to_bytes(&total)
                .and_then(|t| parse_size_to_bytes(&used).map(|u| u as f64 / t as f64 * 100.0))
                .unwrap_or(0.0);

            return (total, used, free, (pct * 10.0).round() / 10.0);
        }
    }
    ("?".into(), "?".into(), "?".into(), 0.0)
}

fn parse_size_to_bytes(s: &str) -> Option<u64> {
    let s = s.trim();
    if s.is_empty() || s == "?" {
        return None;
    }

    // Handle suffixes: Ki, Mi, Gi, Ti, K, M, G, T, B
    let (num_part, multiplier) = if s.ends_with("Ti") {
        (&s[..s.len()-2], 1024u64 * 1024 * 1024 * 1024)
    } else if s.ends_with("Gi") {
        (&s[..s.len()-2], 1024u64 * 1024 * 1024)
    } else if s.ends_with("Mi") {
        (&s[..s.len()-2], 1024u64 * 1024)
    } else if s.ends_with("Ki") {
        (&s[..s.len()-2], 1024u64)
    } else if s.ends_with('T') {
        (&s[..s.len()-1], 1000u64 * 1000 * 1000 * 1000)
    } else if s.ends_with('G') {
        (&s[..s.len()-1], 1000u64 * 1000 * 1000)
    } else if s.ends_with('M') {
        (&s[..s.len()-1], 1000u64 * 1000)
    } else if s.ends_with('K') {
        (&s[..s.len()-1], 1000u64)
    } else if s.ends_with('B') {
        (&s[..s.len()-1], 1u64)
    } else {
        (s, 1u64)
    };

    let num: f64 = num_part.replace(',', ".").parse().ok()?;
    Some((num * multiplier as f64) as u64)
}

fn parse_df(df_output: &str) -> (String, String, String, f64) {
    // df -h / output:
    // Filesystem      Size  Used Avail Use% Mounted on
    // /dev/sda1        50G   20G   28G  42% /
    for line in df_output.lines() {
        let line = line.trim();
        if line.starts_with("Filesystem") || line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 5 {
            let total = parts.get(1).unwrap_or(&"?").to_string();
            let used = parts.get(2).unwrap_or(&"?").to_string();
            let free = parts.get(3).unwrap_or(&"?").to_string();
            let pct_str = parts.get(4).unwrap_or(&"0%").to_string();
            let pct: f64 = pct_str.trim_end_matches('%').parse().unwrap_or(0.0);
            return (total, used, free, pct);
        }
    }
    ("?".into(), "?".into(), "?".into(), 0.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_expand_key_file_tilde() {
        let expanded = expand_key_file("~/.ssh/id_ed25519");
        assert!(!expanded.starts_with("~/"));
        assert!(expanded.contains(".ssh/id_ed25519"));
    }

    #[test]
    fn test_expand_key_file_absolute() {
        let expanded = expand_key_file("/home/user/.ssh/id_rsa");
        assert_eq!(expanded, "/home/user/.ssh/id_rsa");
    }

    #[test]
    fn test_parse_cpu() {
        let top = "%Cpu(s):  3.2 us,  1.1 sy,  0.0 ni, 95.7 id,  0.0 wa,  0.0 hi,  0.0 si,  0.0 st";
        let cpu = parse_cpu(top);
        assert!((cpu - 4.3).abs() < 0.1);
    }

    #[test]
    fn test_parse_cpu_comma_decimal() {
        let top = "%Cpu(s):  3,2 us,  1,1 sy,  0,0 ni, 95,7 id";
        let cpu = parse_cpu(top);
        assert!((cpu - 4.3).abs() < 0.1);
    }

    #[test]
    fn test_parse_free() {
        let free = "              total        used        free      shared  buff/cache   available\nMem:          7.7Gi       2.1Gi       3.2Gi       256Mi       2.4Gi       5.0Gi\nSwap:         2.0Gi          0B       2.0Gi";
        let (total, used, free_val, pct) = parse_free(free);
        assert_eq!(total, "7.7Gi");
        assert_eq!(used, "2.1Gi");
        assert_eq!(free_val, "3.2Gi");
        assert!(pct > 20.0 && pct < 35.0);
    }

    #[test]
    fn test_parse_df() {
        let df = "Filesystem      Size  Used Avail Use% Mounted on\n/dev/sda1        50G   20G   28G  42% /";
        let (total, used, free, pct) = parse_df(df);
        assert_eq!(total, "50G");
        assert_eq!(used, "20G");
        assert_eq!(free, "28G");
        assert!((pct - 42.0).abs() < 0.1);
    }

    #[test]
    fn test_parse_size_to_bytes() {
        // Use approximate comparison for floating point conversion
        let v = parse_size_to_bytes("7.7Gi").unwrap();
        assert!((v as f64 - 7.7 * 1024.0 * 1024.0 * 1024.0).abs() < 1024.0, "7.7Gi: got {v}");
        let v = parse_size_to_bytes("2.1Gi").unwrap();
        assert!((v as f64 - 2.1 * 1024.0 * 1024.0 * 1024.0).abs() < 1024.0, "2.1Gi: got {v}");
        assert_eq!(parse_size_to_bytes("50G"), Some(50000000000));
        assert_eq!(parse_size_to_bytes("256Mi"), Some(268435456));
        assert_eq!(parse_size_to_bytes("?"), None);
    }

    #[test]
    fn test_extract_float_before() {
        assert_eq!(extract_float_before("3.2 us", "us"), Some(3.2));
        assert_eq!(extract_float_before("  1.1 sy", "sy"), Some(1.1));
        assert_eq!(extract_float_before("3,2 us", "us"), Some(3.2));
    }

    #[test]
    fn test_parse_stats_full() {
        let output = "%Cpu(s):  5.0 us,  2.0 sy,  0.0 ni, 93.0 id\n\n===FREE===\n              total        used        free\nMem:          8.0Gi       4.0Gi       4.0Gi\n===DF===\nFilesystem      Size  Used Avail Use% Mounted on\n/dev/sda1       100G   60G   38G  61% /\n===UPTIME===\n 12:00:00 up 10 days,  3:00,  1 user,  load average: 0.10, 0.15, 0.20\n===HOSTNAME===\nmy-server\n";
        let stats = parse_stats(output).unwrap();
        assert_eq!(stats["hostname"], "my-server");
        assert!((stats["cpu_usage_pct"].as_f64().unwrap() - 7.0).abs() < 0.1);
        assert_eq!(stats["ram_total"], "8.0Gi");
        assert_eq!(stats["disk_total"], "100G");
        assert_eq!(stats["disk_pct"], 61.0);
    }

    #[test]
    fn test_vps_server_serialization() {
        let server = VpsServer {
            name: "Test".to_string(),
            host: "1.2.3.4".to_string(),
            user: "root".to_string(),
            port: 22,
            key_file: "~/.ssh/id_rsa".to_string(),
            color: "#f0883e".to_string(),
            auto_refresh: true,
            refresh_interval: 30,
            environment: "Default".to_string(),
        };
        let json = serde_json::to_string(&server).unwrap();
        let parsed: VpsServer = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.name, "Test");
        assert_eq!(parsed.host, "1.2.3.4");
        assert!(parsed.auto_refresh);
        assert_eq!(parsed.refresh_interval, 30);
        assert_eq!(parsed.environment, "Default");
    }

    #[test]
    fn test_vps_server_deserialization_without_environment() {
        // Old format without environment field should still work
        let json = r##"{"name":"Test","host":"1.2.3.4","user":"root","port":22,"key_file":"~/.ssh/id_rsa","color":"#f0883e","auto_refresh":true,"refresh_interval":30}"##;
        let server: VpsServer = serde_json::from_str(json).unwrap();
        assert_eq!(server.name, "Test");
        assert_eq!(server.environment, ""); // default empty
    }

    #[test]
    fn test_vps_environment_serialization() {
        let env = VpsEnvironment {
            name: "Production".to_string(),
            sort_order: 0,
        };
        let json = serde_json::to_string(&env).unwrap();
        let parsed: VpsEnvironment = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.name, "Production");
        assert_eq!(parsed.sort_order, 0);
    }
}
