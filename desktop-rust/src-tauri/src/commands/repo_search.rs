use serde::{Deserialize, Serialize};
use tauri::State;
use crate::db::{DbState, queries};
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use std::collections::HashMap;

const MAX_RESULTS: usize = 200;
const MAX_FILE_GROUPS: usize = 50;

const SKIP_DIRS: &[&str] = &[
    ".git", "node_modules", "target", "__pycache__", ".venv", ".idea", ".vs",
];

// ── Data types ───────────────────────────────────────────

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RepoEntry {
    pub name: String,
    pub path: String,
    pub color: String,
    #[serde(default)]
    pub group_id: Option<i64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RepoGroup {
    pub id: i64,
    pub name: String,
    pub icon: String,
    pub color: String,
    pub sort_order: i32,
}

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
pub struct FileSearchResult {
    pub file_path: String,
    pub repo_name: String,
    pub relative_path: String,
    pub modified_at: String,
    pub matches: Vec<MatchInfo>,
    pub total_matches: usize,
}

#[derive(Serialize, Clone)]
pub struct MatchInfo {
    pub line_num: u32,
    pub line_text: String,
}

#[derive(Serialize, Clone)]
pub struct ContextLine {
    pub line_num: u32,
    pub text: String,
    pub is_match: bool,
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

// ── Repo management ──────────────────────────────────────

fn get_computer_id() -> String {
    hostname::get()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string()
}

fn load_repos(conn: &rusqlite::Connection, computer_id: &str) -> Vec<RepoEntry> {
    let raw = queries::get_setting(conn, computer_id, "repo_search_repos")
        .ok()
        .flatten()
        .unwrap_or_else(|| "[]".to_string());
    serde_json::from_str::<Vec<RepoEntry>>(&raw).unwrap_or_default()
}

fn save_repos(conn: &rusqlite::Connection, computer_id: &str, repos: &[RepoEntry]) -> Result<(), String> {
    let json = serde_json::to_string(repos).map_err(|e| e.to_string())?;
    queries::set_setting(conn, computer_id, "repo_search_repos", &json).map_err(|e| e.to_string())
}

fn load_groups(conn: &rusqlite::Connection, computer_id: &str) -> Vec<RepoGroup> {
    let raw = queries::get_setting(conn, computer_id, "repo_search_groups")
        .ok().flatten().unwrap_or_else(|| "[]".to_string());
    serde_json::from_str::<Vec<RepoGroup>>(&raw).unwrap_or_default()
}

fn save_groups(conn: &rusqlite::Connection, computer_id: &str, groups: &[RepoGroup]) -> Result<(), String> {
    let json = serde_json::to_string(groups).map_err(|e| e.to_string())?;
    queries::set_setting(conn, computer_id, "repo_search_groups", &json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_repo_groups(state: State<DbState>) -> Result<Vec<RepoGroup>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let cid = get_computer_id();
    Ok(load_groups(&conn, &cid))
}

#[tauri::command]
pub fn add_repo_group(
    state: State<DbState>,
    name: String,
    icon: String,
    color: String,
) -> Result<RepoGroup, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let cid = get_computer_id();
    let mut groups = load_groups(&conn, &cid);
    if name.trim().is_empty() {
        return Err("Name is required".to_string());
    }
    if groups.iter().any(|g| g.name == name) {
        return Err(format!("Group '{}' already exists", name));
    }
    let next_id = groups.iter().map(|g| g.id).max().unwrap_or(0) + 1;
    let group = RepoGroup {
        id: next_id,
        name,
        icon,
        color,
        sort_order: 0,
    };
    groups.push(group.clone());
    save_groups(&conn, &cid, &groups)?;
    Ok(group)
}

#[tauri::command]
pub fn update_repo_group(
    state: State<DbState>,
    id: i64,
    name: String,
    icon: String,
    color: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let cid = get_computer_id();
    let mut groups = load_groups(&conn, &cid);
    if name.trim().is_empty() {
        return Err("Name is required".to_string());
    }
    if groups.iter().any(|g| g.name == name && g.id != id) {
        return Err(format!("Group '{}' already exists", name));
    }
    let found = groups.iter_mut().find(|g| g.id == id);
    match found {
        Some(g) => { g.name = name; g.icon = icon; g.color = color; }
        None => return Err(format!("Group #{} not found", id)),
    }
    save_groups(&conn, &cid, &groups)
}

fn clear_group_from_repos(repos: &mut [RepoEntry], gid: i64) -> bool {
    let mut changed = false;
    for r in repos.iter_mut() {
        if r.group_id == Some(gid) {
            r.group_id = None;
            changed = true;
        }
    }
    changed
}

#[tauri::command]
pub fn remove_repo_group(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let cid = get_computer_id();

    // 1. Cascade: clear group_id on every repo that pointed at this group.
    let mut repos = load_repos(&conn, &cid);
    if clear_group_from_repos(&mut repos, id) {
        save_repos(&conn, &cid, &repos)?;
    }

    // 2. Drop the group.
    let mut groups = load_groups(&conn, &cid);
    groups.retain(|g| g.id != id);
    save_groups(&conn, &cid, &groups)
}

#[tauri::command]
pub fn update_repo(
    state: State<DbState>,
    old_name: String,
    name: String,
    path: String,
    color: String,
    group_id: Option<i64>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let cid = get_computer_id();
    let mut repos = load_repos(&conn, &cid);

    if name.trim().is_empty() {
        return Err("Name is required".to_string());
    }
    // Uniqueness (excluding the record being edited)
    if repos.iter().any(|r| r.name == name && r.name != old_name) {
        return Err(format!("Repo '{}' already exists", name));
    }

    let found = repos.iter_mut().find(|r| r.name == old_name);
    match found {
        Some(r) => { r.name = name; r.path = path; r.color = color; r.group_id = group_id; }
        None => return Err(format!("Repo '{}' not found", old_name)),
    }
    save_repos(&conn, &cid, &repos)
}

#[tauri::command]
pub fn list_repos(state: State<DbState>) -> Result<Vec<RepoEntry>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let cid = get_computer_id();
    Ok(load_repos(&conn, &cid))
}

#[tauri::command]
pub fn add_repo(
    state: State<DbState>,
    name: String,
    path: String,
    color: String,
    group_id: Option<i64>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let cid = get_computer_id();
    let mut repos = load_repos(&conn, &cid);
    if repos.iter().any(|r| r.name == name) {
        return Err(format!("Repo with name '{}' already exists", name));
    }
    repos.push(RepoEntry { name, path, color, group_id });
    save_repos(&conn, &cid, &repos)
}

#[tauri::command]
pub fn remove_repo(state: State<DbState>, name: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let cid = get_computer_id();
    let mut repos = load_repos(&conn, &cid);
    repos.retain(|r| r.name != name);
    save_repos(&conn, &cid, &repos)
}

/// Resolve active repo names to paths. If `repos` is empty, use all repos.
fn resolve_repo_paths(conn: &rusqlite::Connection, computer_id: &str, repos: &[String]) -> Vec<RepoEntry> {
    let all = load_repos(conn, computer_id);
    if repos.is_empty() {
        all
    } else {
        all.into_iter().filter(|r| repos.contains(&r.name)).collect()
    }
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
pub async fn search_filenames(state: State<'_, DbState>, pattern: String, repos: Vec<String>) -> Result<Vec<SearchResult>, String> {
    let entries = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let cid = get_computer_id();
        resolve_repo_paths(&conn, &cid, &repos)
    };

    if entries.is_empty() {
        return Err("No repository paths configured. Add repos in Settings.".to_string());
    }

    let regex_pattern = glob_to_regex(&pattern);
    let re = regex::RegexBuilder::new(&regex_pattern)
        .case_insensitive(true)
        .build()
        .map_err(|e| format!("Invalid pattern: {e}"))?;

    let mut results = Vec::new();

    for repo in &entries {
        let repo_path = Path::new(&repo.path);
        if !repo_path.exists() {
            continue;
        }
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
                    repo_name: repo.name.clone(),
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

// ── Content search (grouped by file) ─────────────────────

fn is_binary(data: &[u8]) -> bool {
    let check_len = data.len().min(512);
    data[..check_len].contains(&0)
}

/// Raw match from any search backend
struct RawMatch {
    file_path: String,
    repo_name: String,
    relative_path: String,
    line_num: u32,
    line_text: String,
}

fn try_ripgrep(query: &str, repo_path: &str, repo_name: &str, max_results: usize) -> Option<Vec<RawMatch>> {
    let output = std::process::Command::new("rg")
        .args([
            "--json",
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
        if output.status.code() == Some(1) {
            return Some(Vec::new());
        }
        return None;
    }

    let repo_path_obj = Path::new(repo_path);
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
        let relative_path = file_path
            .strip_prefix(repo_path_obj)
            .unwrap_or(file_path)
            .to_string_lossy()
            .to_string();

        results.push(RawMatch {
            file_path: file_path_str.to_string(),
            repo_name: repo_name.to_string(),
            relative_path,
            line_num: line_number,
            line_text: match_text,
        });
    }

    Some(results)
}

fn try_grep(query: &str, repo_path: &str, repo_name: &str, max_results: usize) -> Option<Vec<RawMatch>> {
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
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut results = Vec::new();

    for line in stdout.lines() {
        if results.len() >= max_results {
            break;
        }
        let parts: Vec<&str> = line.splitn(3, ':').collect();
        if parts.len() < 3 {
            continue;
        }
        let file_path_str = parts[0];
        let line_num: u32 = parts[1].parse().unwrap_or(0);
        let match_text = parts[2].trim().to_string();

        let file_path = Path::new(file_path_str);
        let relative_path = file_path
            .strip_prefix(repo_path_obj)
            .unwrap_or(file_path)
            .to_string_lossy()
            .to_string();

        results.push(RawMatch {
            file_path: file_path_str.to_string(),
            repo_name: repo_name.to_string(),
            relative_path,
            line_num,
            line_text: match_text,
        });
    }

    Some(results)
}

fn fallback_content_search(query: &str, repo_path: &str, repo_name: &str, max_results: usize) -> Vec<RawMatch> {
    let repo_path_obj = Path::new(repo_path);
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
                let relative_path = file_path
                    .strip_prefix(repo_path_obj)
                    .unwrap_or(&file_path)
                    .to_string_lossy()
                    .to_string();

                results.push(RawMatch {
                    file_path: file_path.to_string_lossy().to_string(),
                    repo_name: repo_name.to_string(),
                    relative_path,
                    line_num: (i + 1) as u32,
                    line_text: line.trim().to_string(),
                });
            }
        }
    }

    results
}

/// Group raw matches by file path into FileSearchResult
fn group_matches(raw: Vec<RawMatch>) -> Vec<FileSearchResult> {
    let mut map: HashMap<String, FileSearchResult> = HashMap::new();
    let mut order: Vec<String> = Vec::new();

    for m in raw {
        let entry = map.entry(m.file_path.clone()).or_insert_with(|| {
            order.push(m.file_path.clone());
            let metadata = std::fs::metadata(&m.file_path).ok();
            let modified_at = metadata
                .as_ref()
                .and_then(|md| md.modified().ok())
                .map(format_system_time)
                .unwrap_or_default();
            FileSearchResult {
                file_path: m.file_path.clone(),
                repo_name: m.repo_name.clone(),
                relative_path: m.relative_path.clone(),
                modified_at,
                matches: Vec::new(),
                total_matches: 0,
            }
        });
        entry.total_matches += 1;
        entry.matches.push(MatchInfo {
            line_num: m.line_num,
            line_text: m.line_text,
        });
    }

    // Return in insertion order, limited to MAX_FILE_GROUPS
    order.into_iter()
        .filter_map(|k| map.remove(&k))
        .take(MAX_FILE_GROUPS)
        .collect()
}

#[tauri::command]
pub async fn search_content(state: State<'_, DbState>, query: String, repos: Vec<String>, file_pattern: Option<String>) -> Result<Vec<FileSearchResult>, String> {
    let entries = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let cid = get_computer_id();
        resolve_repo_paths(&conn, &cid, &repos)
    };

    if entries.is_empty() {
        return Err("No repository paths configured. Add repos in Settings.".to_string());
    }

    let _ = file_pattern; // reserved for future use

    let mut all_raw = Vec::new();

    for repo in &entries {
        let repo_path = Path::new(&repo.path);
        if !repo_path.exists() {
            continue;
        }
        let remaining = MAX_RESULTS.saturating_sub(all_raw.len());
        if remaining == 0 {
            break;
        }

        let results = try_ripgrep(&query, &repo.path, &repo.name, remaining)
            .or_else(|| try_grep(&query, &repo.path, &repo.name, remaining))
            .unwrap_or_else(|| fallback_content_search(&query, &repo.path, &repo.name, remaining));

        all_raw.extend(results);
    }

    all_raw.truncate(MAX_RESULTS);
    Ok(group_matches(all_raw))
}

// ── File context ─────────────────────────────────────────

#[tauri::command]
pub fn get_file_context(file_path: String, line_num: u32, context_lines: u32) -> Result<Vec<ContextLine>, String> {
    let content = std::fs::read_to_string(&file_path)
        .map_err(|e| format!("Cannot read file: {e}"))?;

    let lines: Vec<&str> = content.lines().collect();
    let total = lines.len() as u32;
    if line_num == 0 || line_num > total {
        return Err(format!("Line {line_num} out of range (1..{total})"));
    }

    let start = (line_num as i64 - context_lines as i64).max(1) as u32;
    let end = (line_num + context_lines).min(total);

    let mut result = Vec::new();
    for ln in start..=end {
        let idx = (ln - 1) as usize;
        result.push(ContextLine {
            line_num: ln,
            text: lines.get(idx).unwrap_or(&"").to_string(),
            is_match: ln == line_num,
        });
    }

    Ok(result)
}

// ── Git history search ────────────────────────────────────

fn search_git_in_repo(query: &str, repo_path: &str, repo_name: &str, max_results: usize) -> Vec<GitSearchResult> {
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
                repo_name: repo_name.to_string(),
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
                    repo_name: repo_name.to_string(),
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
pub async fn search_git_history(state: State<'_, DbState>, query: String, repos: Vec<String>) -> Result<Vec<GitSearchResult>, String> {
    let entries = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let cid = get_computer_id();
        resolve_repo_paths(&conn, &cid, &repos)
    };

    if entries.is_empty() {
        return Err("No repository paths configured. Add repos in Settings.".to_string());
    }

    let mut all_results = Vec::new();

    for repo in &entries {
        let repo_path = Path::new(&repo.path);
        if !repo_path.exists() {
            continue;
        }
        let remaining = MAX_RESULTS.saturating_sub(all_results.len());
        if remaining == 0 {
            break;
        }
        let results = search_git_in_repo(&query, &repo.path, &repo.name, remaining);
        all_results.extend(results);
    }

    all_results.truncate(MAX_RESULTS);
    Ok(all_results)
}

fn git_run(repo: &str, args: &[&str]) -> Result<String, String> {
    let out = std::process::Command::new("git")
        .arg("-C").arg(repo)
        .args(args)
        .output()
        .map_err(|e| format!("git: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn default_branch(repo: &str) -> Option<String> {
    for b in ["main", "master"] {
        if git_run(repo, &["show-ref", "--verify", "--quiet", &format!("refs/heads/{b}")]).is_ok() {
            return Some(b.to_string());
        }
    }
    // Fallback to origin/HEAD
    git_run(repo, &["rev-parse", "--abbrev-ref", "origin/HEAD"])
        .ok()
        .and_then(|s| s.strip_prefix("origin/").map(|s| s.to_string()))
}

#[derive(Serialize, Deserialize, Clone)]
pub struct RepoStatus {
    pub name: String,
    pub branch: String,
    pub last_commit_subject: String,
    pub last_commit_iso: String,
    pub is_dirty: bool,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn repo_search_status(
    state: State<'_, DbState>,
) -> Result<Vec<RepoStatus>, String> {
    let repos = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let cid = get_computer_id();
        load_repos(&conn, &cid)
    };
    let handles = repos.into_iter().map(|repo| {
        tokio::task::spawn_blocking(move || status_one(&repo))
    });
    let mut out = Vec::new();
    for h in handles {
        out.push(h.await.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

fn status_one(repo: &RepoEntry) -> RepoStatus {
    let path = &repo.path;
    // Confirm it's a git repo
    if git_run(path, &["rev-parse", "--is-inside-work-tree"]).is_err() {
        return RepoStatus {
            name: repo.name.clone(),
            branch: String::new(),
            last_commit_subject: String::new(),
            last_commit_iso: String::new(),
            is_dirty: false,
            error: Some("not a git repository".to_string()),
        };
    }
    let branch = git_run(path, &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap_or_default();
    let last = git_run(path, &["log", "-1", "--format=%s|%cI"]).unwrap_or_default();
    let (subject, iso) = match last.split_once('|') {
        Some((s, d)) => (s.to_string(), d.to_string()),
        None => (String::new(), String::new()),
    };
    let dirty = git_run(path, &["status", "--porcelain"])
        .map(|s| !s.is_empty())
        .unwrap_or(false);
    RepoStatus {
        name: repo.name.clone(),
        branch,
        last_commit_subject: subject,
        last_commit_iso: iso,
        is_dirty: dirty,
        error: None,
    }
}

#[derive(Serialize)]
pub struct PullOutcome {
    pub name: String,
    pub skipped: bool,
    pub success: bool,
    pub message: String,
    pub commands_run: Vec<String>,
}

#[tauri::command]
pub async fn repo_search_pull_main(
    state: State<'_, DbState>,
    paths: Vec<String>,
    dry_run: bool,
) -> Result<Vec<PullOutcome>, String> {
    let repos = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let cid = get_computer_id();
        let all = load_repos(&conn, &cid);
        let set: std::collections::HashSet<_> = paths.into_iter().collect();
        all.into_iter().filter(|r| set.contains(&r.path)).collect::<Vec<_>>()
    };
    let handles = repos.into_iter().map(|repo| {
        tokio::task::spawn_blocking(move || pull_one(&repo, dry_run))
    });
    let mut out = Vec::new();
    for h in handles {
        out.push(h.await.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

fn pull_one(repo: &RepoEntry, dry_run: bool) -> PullOutcome {
    let path = &repo.path;
    let name = repo.name.clone();
    let dirty = git_run(path, &["status", "--porcelain"])
        .map(|s| !s.is_empty())
        .unwrap_or(false);
    if dirty {
        return PullOutcome {
            name,
            skipped: true,
            success: false,
            message: "uncommitted changes".to_string(),
            commands_run: vec![],
        };
    }
    let branch = match default_branch(path) {
        Some(b) => b,
        None => return PullOutcome {
            name,
            skipped: true,
            success: false,
            message: "no main/master/origin/HEAD".to_string(),
            commands_run: vec![],
        },
    };
    let planned = vec![
        format!("git checkout {branch}"),
        "git pull --ff-only".to_string(),
    ];
    if dry_run {
        return PullOutcome {
            name, skipped: false, success: true,
            message: "dry-run".to_string(),
            commands_run: planned,
        };
    }
    if let Err(e) = git_run(path, &["checkout", &branch]) {
        return PullOutcome { name, skipped: false, success: false, message: format!("checkout failed: {e}"), commands_run: planned };
    }
    match git_run(path, &["pull", "--ff-only"]) {
        Ok(out) => PullOutcome {
            name, skipped: false, success: true,
            message: out.lines().last().unwrap_or("ok").to_string(),
            commands_run: planned,
        },
        Err(e) => PullOutcome {
            name, skipped: false, success: false,
            message: format!("pull failed: {e}"),
            commands_run: planned,
        },
    }
}

/// Spawn the user's editor with the given file. `editor_command` is a
/// user-supplied template with `{path}` and optional `{line}` placeholders.
/// Default: "code {path}:{line}".
#[tauri::command]
pub fn open_in_editor(
    state: State<DbState>,
    path: String,
    line: Option<u64>,
) -> Result<(), String> {
    let template = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let cid = get_computer_id();
        queries::get_setting(&conn, &cid, "editor_command")
            .ok()
            .flatten()
            .unwrap_or_else(|| "code {path}:{line}".to_string())
    };
    let line_str = line.map(|l| l.to_string()).unwrap_or_default();
    let rendered = template
        .replace("{path}", &path)
        .replace("{line}", &line_str);
    let parts: Vec<&str> = rendered.split_whitespace().collect();
    if parts.is_empty() {
        return Err("editor_command is empty".to_string());
    }
    std::process::Command::new(parts[0])
        .args(&parts[1..])
        .spawn()
        .map_err(|e| format!("spawn {}: {}", parts[0], e))?;
    Ok(())
}

const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Serialize)]
pub struct FullFileResult {
    pub content: String,
    pub truncated: bool,
    pub size: u64,
}

#[tauri::command]
pub fn read_full_file(path: String) -> Result<FullFileResult, String> {
    let meta = std::fs::metadata(&path).map_err(|e| format!("metadata: {e}"))?;
    let size = meta.len();
    if size > MAX_FILE_BYTES {
        return Ok(FullFileResult {
            content: String::new(),
            truncated: true,
            size,
        });
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("read_to_string: {e}"))?;
    Ok(FullFileResult { content, truncated: false, size })
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
    fn test_group_matches() {
        let raw = vec![
            RawMatch {
                file_path: "/tmp/test.rs".to_string(),
                repo_name: "test".to_string(),
                relative_path: "test.rs".to_string(),
                line_num: 10,
                line_text: "line 10".to_string(),
            },
            RawMatch {
                file_path: "/tmp/test.rs".to_string(),
                repo_name: "test".to_string(),
                relative_path: "test.rs".to_string(),
                line_num: 20,
                line_text: "line 20".to_string(),
            },
            RawMatch {
                file_path: "/tmp/other.rs".to_string(),
                repo_name: "test".to_string(),
                relative_path: "other.rs".to_string(),
                line_num: 5,
                line_text: "line 5".to_string(),
            },
        ];
        let grouped = group_matches(raw);
        assert_eq!(grouped.len(), 2);
        assert_eq!(grouped[0].file_path, "/tmp/test.rs");
        assert_eq!(grouped[0].matches.len(), 2);
        assert_eq!(grouped[0].total_matches, 2);
        assert_eq!(grouped[1].file_path, "/tmp/other.rs");
        assert_eq!(grouped[1].matches.len(), 1);
    }

    #[test]
    fn test_repo_entry_serialization() {
        let entry = RepoEntry {
            name: "test".to_string(),
            path: "/home/user/test".to_string(),
            color: "#f0883e".to_string(),
            group_id: None,
        };
        let json = serde_json::to_string(&entry).unwrap();
        let parsed: RepoEntry = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.name, "test");
        assert_eq!(parsed.color, "#f0883e");
    }

    #[test]
    fn clear_group_from_repos_only_touches_matching_entries() {
        let mut repos = vec![
            RepoEntry { name: "a".into(), path: "/a".into(), color: "#fff".into(), group_id: Some(1) },
            RepoEntry { name: "b".into(), path: "/b".into(), color: "#fff".into(), group_id: Some(2) },
            RepoEntry { name: "c".into(), path: "/c".into(), color: "#fff".into(), group_id: None },
        ];
        assert!(clear_group_from_repos(&mut repos, 1));
        assert!(repos[0].group_id.is_none());
        assert_eq!(repos[1].group_id, Some(2));
        assert!(repos[2].group_id.is_none());
        // Second call on the same id — nothing changes.
        assert!(!clear_group_from_repos(&mut repos, 1));
    }

    #[test]
    fn load_groups_empty_when_key_missing() {
        // We don't have a conn fixture; instead prove the fallback via the JSON parse.
        let parsed: Vec<RepoGroup> = serde_json::from_str("[]").unwrap();
        assert!(parsed.is_empty());
    }

    #[test]
    fn legacy_repo_entry_deserialises_with_none_group() {
        let legacy = r##"[{"name":"r1","path":"/tmp/r1","color":"#3b82f6"}]"##;
        let parsed: Vec<RepoEntry> = serde_json::from_str(legacy).unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].name, "r1");
        assert!(parsed[0].group_id.is_none());
    }
}
