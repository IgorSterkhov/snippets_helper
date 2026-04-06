use serde::Serialize;
use tauri::State;
use crate::db::{DbState, queries};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

const MAX_RESULTS: usize = 200;

const SKIP_DIRS: &[&str] = &[
    ".git", "node_modules", "target", "__pycache__", ".venv", ".idea", ".vs",
];

#[derive(Serialize, Clone)]
pub struct SearchResult {
    pub file_path: String,
    pub repo_name: String,
    pub relative_path: String,
    pub modified_at: String,
    pub size: u64,
    pub match_line: Option<String>,
    pub match_line_num: Option<u32>,
}

#[derive(Serialize, Clone)]
pub struct GitSearchResult {
    pub repo_name: String,
    pub commit_hash: String,
    pub commit_date: String,
    pub author: String,
    pub message: String,
    pub files_changed: Vec<String>,
}

// ── Repo path management ──────────────────────────────────

fn get_computer_id() -> String {
    hostname::get()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string()
}

fn load_repo_paths(conn: &rusqlite::Connection, computer_id: &str) -> Vec<String> {
    let raw = queries::get_setting(conn, computer_id, "repo_search_paths")
        .ok()
        .flatten()
        .unwrap_or_else(|| "[]".to_string());
    serde_json::from_str::<Vec<String>>(&raw).unwrap_or_default()
}

fn save_repo_paths(conn: &rusqlite::Connection, computer_id: &str, paths: &[String]) -> Result<(), String> {
    let json = serde_json::to_string(paths).map_err(|e| e.to_string())?;
    queries::set_setting(conn, computer_id, "repo_search_paths", &json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_repo_paths(state: State<DbState>) -> Result<Vec<String>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let cid = get_computer_id();
    Ok(load_repo_paths(&conn, &cid))
}

#[tauri::command]
pub fn add_repo_path(state: State<DbState>, path: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let cid = get_computer_id();
    let mut paths = load_repo_paths(&conn, &cid);
    if !paths.contains(&path) {
        paths.push(path);
    }
    save_repo_paths(&conn, &cid, &paths)
}

#[tauri::command]
pub fn remove_repo_path(state: State<DbState>, path: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let cid = get_computer_id();
    let mut paths = load_repo_paths(&conn, &cid);
    paths.retain(|p| p != &path);
    save_repo_paths(&conn, &cid, &paths)
}

// ── Filename search ───────────────────────────────────────

fn should_skip_dir(name: &str) -> bool {
    SKIP_DIRS.iter().any(|d| *d == name)
}

fn format_system_time(t: SystemTime) -> String {
    let duration = t.duration_since(SystemTime::UNIX_EPOCH).unwrap_or_default();
    let secs = duration.as_secs() as i64;
    let dt = chrono::DateTime::from_timestamp(secs, 0)
        .unwrap_or_else(|| chrono::DateTime::from_timestamp(0, 0).unwrap());
    dt.format("%Y-%m-%dT%H:%M:%S").to_string()
}

fn walk_repo(repo_path: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    walk_dir_recursive(repo_path, &mut files);
    files
}

fn walk_dir_recursive(dir: &Path, files: &mut Vec<PathBuf>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if should_skip_dir(name) {
                    continue;
                }
            }
            walk_dir_recursive(&path, files);
        } else {
            files.push(path);
        }
    }
}

fn repo_name_from_path(repo_path: &Path) -> String {
    repo_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string()
}

fn glob_to_regex(pattern: &str) -> String {
    let mut regex = String::new();
    for ch in pattern.chars() {
        match ch {
            '*' => regex.push_str(".*"),
            '?' => regex.push('.'),
            '.' | '+' | '(' | ')' | '[' | ']' | '{' | '}' | '^' | '$' | '|' | '\\' => {
                regex.push('\\');
                regex.push(ch);
            }
            _ => regex.push(ch),
        }
    }
    regex
}

#[tauri::command]
pub async fn search_filenames(state: State<'_, DbState>, pattern: String) -> Result<Vec<SearchResult>, String> {
    let paths = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let cid = get_computer_id();
        load_repo_paths(&conn, &cid)
    };

    if paths.is_empty() {
        return Err("No repository paths configured. Add paths in Settings.".to_string());
    }

    let regex_pattern = glob_to_regex(&pattern);
    let re = regex::RegexBuilder::new(&regex_pattern)
        .case_insensitive(true)
        .build()
        .map_err(|e| format!("Invalid pattern: {e}"))?;

    let mut results = Vec::new();

    for repo_path_str in &paths {
        let repo_path = Path::new(repo_path_str);
        if !repo_path.exists() {
            continue;
        }
        let repo_name = repo_name_from_path(repo_path);
        let files = walk_repo(repo_path);

        for file_path in files {
            if results.len() >= MAX_RESULTS {
                break;
            }
            let file_name = match file_path.file_name().and_then(|n| n.to_str()) {
                Some(n) => n,
                None => continue,
            };
            if re.is_match(file_name) {
                let metadata = std::fs::metadata(&file_path).ok();
                let modified_at = metadata
                    .as_ref()
                    .and_then(|m| m.modified().ok())
                    .map(format_system_time)
                    .unwrap_or_default();
                let size = metadata.map(|m| m.len()).unwrap_or(0);
                let relative_path = file_path
                    .strip_prefix(repo_path)
                    .unwrap_or(&file_path)
                    .to_string_lossy()
                    .to_string();

                results.push(SearchResult {
                    file_path: file_path.to_string_lossy().to_string(),
                    repo_name: repo_name.clone(),
                    relative_path,
                    modified_at,
                    size,
                    match_line: None,
                    match_line_num: None,
                });
            }
        }
        if results.len() >= MAX_RESULTS {
            break;
        }
    }

    Ok(results)
}

// ── Content search ────────────────────────────────────────

fn is_binary(data: &[u8]) -> bool {
    let check_len = data.len().min(512);
    data[..check_len].contains(&0)
}

fn try_ripgrep(query: &str, repo_path: &str, max_results: usize) -> Option<Vec<SearchResult>> {
    let output = std::process::Command::new("rg")
        .args([
            "--json",
            "--max-count", "3",
            "--glob", "!.git",
            "--glob", "!node_modules",
            "--glob", "!target",
            "--glob", "!__pycache__",
            "--glob", "!.venv",
            "--glob", "!.idea",
            "--glob", "!.vs",
            "-i",
            query,
            repo_path,
        ])
        .output()
        .ok()?;

    if !output.status.success() && output.stdout.is_empty() {
        // rg returns exit code 1 when no matches found
        if output.status.code() == Some(1) {
            return Some(Vec::new());
        }
        return None;
    }

    let repo_path_obj = Path::new(repo_path);
    let repo_name = repo_name_from_path(repo_path_obj);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut results = Vec::new();

    for line in stdout.lines() {
        if results.len() >= max_results {
            break;
        }
        let val: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if val["type"].as_str() != Some("match") {
            continue;
        }
        let data = &val["data"];
        let file_path_str = data["path"]["text"].as_str().unwrap_or_default();
        let line_number = data["line_number"].as_u64().unwrap_or(0) as u32;
        let match_text = data["lines"]["text"].as_str().unwrap_or_default().trim().to_string();

        let file_path = Path::new(file_path_str);
        let metadata = std::fs::metadata(file_path).ok();
        let modified_at = metadata
            .as_ref()
            .and_then(|m| m.modified().ok())
            .map(format_system_time)
            .unwrap_or_default();
        let size = metadata.map(|m| m.len()).unwrap_or(0);
        let relative_path = file_path
            .strip_prefix(repo_path_obj)
            .unwrap_or(file_path)
            .to_string_lossy()
            .to_string();

        results.push(SearchResult {
            file_path: file_path_str.to_string(),
            repo_name: repo_name.clone(),
            relative_path,
            modified_at,
            size,
            match_line: Some(match_text),
            match_line_num: Some(line_number),
        });
    }

    Some(results)
}

fn try_grep(query: &str, repo_path: &str, max_results: usize) -> Option<Vec<SearchResult>> {
    let output = std::process::Command::new("grep")
        .args([
            "-rn",
            "-i",
            "--include=*",
            "--exclude-dir=.git",
            "--exclude-dir=node_modules",
            "--exclude-dir=target",
            "--exclude-dir=__pycache__",
            "--exclude-dir=.venv",
            "--exclude-dir=.idea",
            "--exclude-dir=.vs",
            query,
            repo_path,
        ])
        .output()
        .ok()?;

    if !output.status.success() && output.stdout.is_empty() {
        if output.status.code() == Some(1) {
            return Some(Vec::new());
        }
        return None;
    }

    let repo_path_obj = Path::new(repo_path);
    let repo_name = repo_name_from_path(repo_path_obj);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut results = Vec::new();

    for line in stdout.lines() {
        if results.len() >= max_results {
            break;
        }
        // Format: filepath:linenum:matched_text
        let parts: Vec<&str> = line.splitn(3, ':').collect();
        if parts.len() < 3 {
            continue;
        }
        let file_path_str = parts[0];
        let line_num: u32 = parts[1].parse().unwrap_or(0);
        let match_text = parts[2].trim().to_string();

        let file_path = Path::new(file_path_str);
        let metadata = std::fs::metadata(file_path).ok();
        let modified_at = metadata
            .as_ref()
            .and_then(|m| m.modified().ok())
            .map(format_system_time)
            .unwrap_or_default();
        let size = metadata.map(|m| m.len()).unwrap_or(0);
        let relative_path = file_path
            .strip_prefix(repo_path_obj)
            .unwrap_or(file_path)
            .to_string_lossy()
            .to_string();

        results.push(SearchResult {
            file_path: file_path_str.to_string(),
            repo_name: repo_name.clone(),
            relative_path,
            modified_at,
            size,
            match_line: Some(match_text),
            match_line_num: Some(line_num),
        });
    }

    Some(results)
}

fn fallback_content_search(query: &str, repo_path: &str, max_results: usize) -> Vec<SearchResult> {
    let repo_path_obj = Path::new(repo_path);
    let repo_name = repo_name_from_path(repo_path_obj);
    let query_lower = query.to_lowercase();
    let files = walk_repo(repo_path_obj);
    let mut results = Vec::new();

    for file_path in files {
        if results.len() >= max_results {
            break;
        }
        let data = match std::fs::read(&file_path) {
            Ok(d) => d,
            Err(_) => continue,
        };
        if is_binary(&data) {
            continue;
        }
        let content = match String::from_utf8(data) {
            Ok(s) => s,
            Err(_) => continue,
        };
        for (i, line) in content.lines().enumerate() {
            if results.len() >= max_results {
                break;
            }
            if line.to_lowercase().contains(&query_lower) {
                let metadata = std::fs::metadata(&file_path).ok();
                let modified_at = metadata
                    .as_ref()
                    .and_then(|m| m.modified().ok())
                    .map(format_system_time)
                    .unwrap_or_default();
                let size = metadata.map(|m| m.len()).unwrap_or(0);
                let relative_path = file_path
                    .strip_prefix(repo_path_obj)
                    .unwrap_or(&file_path)
                    .to_string_lossy()
                    .to_string();

                results.push(SearchResult {
                    file_path: file_path.to_string_lossy().to_string(),
                    repo_name: repo_name.clone(),
                    relative_path,
                    modified_at,
                    size,
                    match_line: Some(line.trim().to_string()),
                    match_line_num: Some((i + 1) as u32),
                });
            }
        }
    }

    results
}

#[tauri::command]
pub async fn search_content(state: State<'_, DbState>, query: String, file_pattern: Option<String>) -> Result<Vec<SearchResult>, String> {
    let paths = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let cid = get_computer_id();
        load_repo_paths(&conn, &cid)
    };

    if paths.is_empty() {
        return Err("No repository paths configured. Add paths in Settings.".to_string());
    }

    let _ = file_pattern; // reserved for future use

    let mut all_results = Vec::new();

    for repo_path_str in &paths {
        let repo_path = Path::new(repo_path_str);
        if !repo_path.exists() {
            continue;
        }
        let remaining = MAX_RESULTS.saturating_sub(all_results.len());
        if remaining == 0 {
            break;
        }

        // Try ripgrep first, then grep, then fallback
        let results = try_ripgrep(&query, repo_path_str, remaining)
            .or_else(|| try_grep(&query, repo_path_str, remaining))
            .unwrap_or_else(|| fallback_content_search(&query, repo_path_str, remaining));

        all_results.extend(results);
    }

    all_results.truncate(MAX_RESULTS);
    Ok(all_results)
}

// ── Git history search ────────────────────────────────────

fn search_git_in_repo(query: &str, repo_path: &str, max_results: usize) -> Vec<GitSearchResult> {
    let repo_path_obj = Path::new(repo_path);
    let repo_name = repo_name_from_path(repo_path_obj);
    let mut results = Vec::new();
    let mut seen_hashes = std::collections::HashSet::new();

    // Search by commit message
    if let Ok(output) = std::process::Command::new("git")
        .args([
            "-C", repo_path,
            "log", "--all", "--oneline",
            &format!("--grep={query}"),
            "--format=%H|%aI|%an|%s",
            "-i",
            &format!("-{}", max_results),
        ])
        .output()
    {
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            if results.len() >= max_results {
                break;
            }
            let parts: Vec<&str> = line.splitn(4, '|').collect();
            if parts.len() < 4 {
                continue;
            }
            let hash = parts[0].to_string();
            if seen_hashes.contains(&hash) {
                continue;
            }
            seen_hashes.insert(hash.clone());

            let files_changed = get_commit_files(repo_path, &hash);

            results.push(GitSearchResult {
                repo_name: repo_name.clone(),
                commit_hash: hash,
                commit_date: parts[1].to_string(),
                author: parts[2].to_string(),
                message: parts[3].to_string(),
                files_changed,
            });
        }
    }

    // Search by code changes (pickaxe)
    if results.len() < max_results {
        let remaining = max_results - results.len();
        if let Ok(output) = std::process::Command::new("git")
            .args([
                "-C", repo_path,
                "log", "--all",
                &format!("-S{query}"),
                "--format=%H|%aI|%an|%s",
                &format!("-{}", remaining),
            ])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                if results.len() >= max_results {
                    break;
                }
                let parts: Vec<&str> = line.splitn(4, '|').collect();
                if parts.len() < 4 {
                    continue;
                }
                let hash = parts[0].to_string();
                if seen_hashes.contains(&hash) {
                    continue;
                }
                seen_hashes.insert(hash.clone());

                let files_changed = get_commit_files(repo_path, &hash);

                results.push(GitSearchResult {
                    repo_name: repo_name.clone(),
                    commit_hash: hash,
                    commit_date: parts[1].to_string(),
                    author: parts[2].to_string(),
                    message: parts[3].to_string(),
                    files_changed,
                });
            }
        }
    }

    results
}

fn get_commit_files(repo_path: &str, hash: &str) -> Vec<String> {
    if let Ok(output) = std::process::Command::new("git")
        .args(["-C", repo_path, "diff-tree", "--no-commit-id", "-r", "--name-only", hash])
        .output()
    {
        let stdout = String::from_utf8_lossy(&output.stdout);
        stdout.lines().map(|l| l.to_string()).filter(|l| !l.is_empty()).collect()
    } else {
        Vec::new()
    }
}

#[tauri::command]
pub async fn search_git_history(state: State<'_, DbState>, query: String, repo_path: Option<String>) -> Result<Vec<GitSearchResult>, String> {
    let paths = if let Some(ref single) = repo_path {
        vec![single.clone()]
    } else {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let cid = get_computer_id();
        load_repo_paths(&conn, &cid)
    };

    if paths.is_empty() {
        return Err("No repository paths configured. Add paths in Settings.".to_string());
    }

    let mut all_results = Vec::new();

    for repo_path_str in &paths {
        let repo_path_obj = Path::new(repo_path_str);
        if !repo_path_obj.exists() {
            continue;
        }
        let remaining = MAX_RESULTS.saturating_sub(all_results.len());
        if remaining == 0 {
            break;
        }
        let results = search_git_in_repo(&query, repo_path_str, remaining);
        all_results.extend(results);
    }

    all_results.truncate(MAX_RESULTS);
    Ok(all_results)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_glob_to_regex() {
        assert_eq!(glob_to_regex("*.rs"), ".*\\.rs");
        assert_eq!(glob_to_regex("test?"), "test.");
        assert_eq!(glob_to_regex("hello"), "hello");
    }

    #[test]
    fn test_should_skip_dir() {
        assert!(should_skip_dir(".git"));
        assert!(should_skip_dir("node_modules"));
        assert!(should_skip_dir("target"));
        assert!(!should_skip_dir("src"));
        assert!(!should_skip_dir("lib"));
    }

    #[test]
    fn test_is_binary() {
        assert!(!is_binary(b"hello world"));
        assert!(is_binary(b"hello\x00world"));
        assert!(!is_binary(b""));
    }

    #[test]
    fn test_repo_name_from_path() {
        assert_eq!(repo_name_from_path(Path::new("/home/user/projects/my-repo")), "my-repo");
        assert_eq!(repo_name_from_path(Path::new("/tmp")), "tmp");
    }
}
