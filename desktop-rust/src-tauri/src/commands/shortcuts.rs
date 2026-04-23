use tauri::State;
use crate::db::{DbState, queries, models::{Shortcut, SnippetTag}};
use serde_json;

#[tauri::command]
pub fn list_shortcuts(state: State<DbState>) -> Result<Vec<Shortcut>, String> {
    let conn = state.lock_recover();
    queries::list_shortcuts(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn search_shortcuts(state: State<DbState>, query: String) -> Result<Vec<Shortcut>, String> {
    let conn = state.lock_recover();
    queries::search_shortcuts(&conn, &query).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_shortcut(state: State<DbState>, name: String, value: String, description: String, links: String, obsidian_note: Option<String>) -> Result<Shortcut, String> {
    let conn = state.lock_recover();
    let note = obsidian_note.unwrap_or_default();
    queries::create_shortcut(&conn, &name, &value, &description, &links, &note).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_shortcut(state: State<DbState>, id: i64, name: String, value: String, description: String, links: String, obsidian_note: Option<String>) -> Result<(), String> {
    let conn = state.lock_recover();
    let note = obsidian_note.unwrap_or_default();
    queries::update_shortcut(&conn, id, &name, &value, &description, &links, &note).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_link_window(app: tauri::AppHandle, url: String, title: String) -> Result<(), String> {
    use tauri::{Manager, WebviewWindowBuilder, WebviewUrl};

    // Generate unique window label
    let label = format!("link_{}", url.len() % 1000);

    // If window with this label exists, focus it
    if let Some(window) = app.get_webview_window(&label) {
        window.set_focus().map_err(|e| format!("{e}"))?;
        return Ok(());
    }

    let parsed_url: tauri::Url = url.parse().map_err(|e| format!("{e}"))?;

    WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(parsed_url))
        .title(&title)
        .inner_size(1024.0, 768.0)
        .build()
        .map_err(|e| format!("{e}"))?;

    Ok(())
}

#[tauri::command]
pub fn delete_shortcut(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.lock_recover();
    queries::delete_shortcut(&conn, id).map_err(|e| e.to_string())
}

// ── Snippet Tags ────────────────────────────────────────────

#[tauri::command]
pub fn list_snippet_tags(state: State<DbState>) -> Result<Vec<SnippetTag>, String> {
    let conn = state.lock_recover();
    queries::list_snippet_tags(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_snippet_tag(
    state: State<DbState>,
    name: String,
    patterns: String,
    color: String,
    sort_order: i32,
) -> Result<SnippetTag, String> {
    let conn = state.lock_recover();
    queries::create_snippet_tag(&conn, &name, &patterns, &color, sort_order)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_snippet_tag(
    state: State<DbState>,
    id: i64,
    name: String,
    patterns: String,
    color: String,
    sort_order: i32,
) -> Result<(), String> {
    let conn = state.lock_recover();
    queries::update_snippet_tag(&conn, id, &name, &patterns, &color, sort_order)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_snippet_tag(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.lock_recover();
    queries::delete_snippet_tag(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn filter_shortcuts(
    state: State<DbState>,
    patterns: Vec<String>,
    query: String,
) -> Result<Vec<Shortcut>, String> {
    let conn = state.lock_recover();
    queries::filter_shortcuts_by_patterns(&conn, &patterns, &query)
        .map_err(|e| e.to_string())
}

// ── Obsidian Integration ───────────────────────────────────

/// List vault directories from the configured Obsidian path
#[tauri::command]
pub fn list_obsidian_vaults(state: State<DbState>) -> Result<Vec<String>, String> {
    let conn = state.lock_recover();
    let computer_id = hostname::get().unwrap_or_default().to_string_lossy().to_string();
    let path = queries::get_setting(&conn, &computer_id, "obsidian_vaults_path")
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    if path.is_empty() { return Ok(vec![]); }

    let entries = std::fs::read_dir(&path).map_err(|e| e.to_string())?;
    let mut vaults = Vec::new();
    for entry in entries.flatten() {
        if entry.path().is_dir() {
            if entry.path().join(".obsidian").exists() {
                vaults.push(entry.file_name().to_string_lossy().to_string());
            }
        }
    }
    Ok(vaults)
}

/// List folders inside a vault
#[tauri::command]
pub fn list_obsidian_folders(state: State<DbState>, vault: String) -> Result<Vec<String>, String> {
    let conn = state.lock_recover();
    let computer_id = hostname::get().unwrap_or_default().to_string_lossy().to_string();
    let base = queries::get_setting(&conn, &computer_id, "obsidian_vaults_path")
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    if base.is_empty() { return Err("Obsidian path not configured".into()); }

    let vault_path = std::path::Path::new(&base).join(&vault);
    let mut folders = vec!["(root)".to_string()];
    fn walk(dir: &std::path::Path, prefix: &str, result: &mut Vec<String>) {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if entry.path().is_dir() && !name.starts_with('.') {
                    let full = if prefix.is_empty() { name.clone() } else { format!("{}/{}", prefix, name) };
                    result.push(full.clone());
                    walk(&entry.path(), &full, result);
                }
            }
        }
    }
    walk(&vault_path, "", &mut folders);
    Ok(folders)
}

/// List markdown files inside a vault (recursive)
#[tauri::command]
pub fn list_obsidian_files(state: State<DbState>, vault: String) -> Result<Vec<String>, String> {
    let conn = state.lock_recover();
    let computer_id = hostname::get().unwrap_or_default().to_string_lossy().to_string();
    let base = queries::get_setting(&conn, &computer_id, "obsidian_vaults_path")
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    if base.is_empty() { return Err("Obsidian path not configured".into()); }

    let vault_path = std::path::Path::new(&base).join(&vault);
    let mut files = Vec::new();
    fn walk_files(dir: &std::path::Path, prefix: &str, result: &mut Vec<String>) {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with('.') { continue; }
                let full = if prefix.is_empty() { name.clone() } else { format!("{}/{}", prefix, name) };
                if entry.path().is_dir() {
                    walk_files(&entry.path(), &full, result);
                } else if name.ends_with(".md") {
                    result.push(full);
                }
            }
        }
    }
    walk_files(&vault_path, "", &mut files);
    files.sort();
    Ok(files)
}

/// Create an Obsidian note from a snippet
#[tauri::command]
pub fn create_obsidian_note(
    state: State<DbState>,
    snippet_id: i64,
    vault: String,
    folder: String,
    filename: String,
) -> Result<String, String> {
    let conn = state.lock_recover();
    let computer_id = hostname::get().unwrap_or_default().to_string_lossy().to_string();
    let base = queries::get_setting(&conn, &computer_id, "obsidian_vaults_path")
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    if base.is_empty() { return Err("Obsidian path not configured".into()); }

    // Get snippet data
    let shortcuts = queries::list_shortcuts(&conn).map_err(|e| e.to_string())?;
    let snippet = shortcuts.iter().find(|s| s.id == Some(snippet_id))
        .ok_or("Snippet not found")?;

    // Build note content
    let mut content = format!("# {}\n\n{}\n", snippet.name, snippet.value);
    if !snippet.description.is_empty() {
        content.push_str(&format!("\n---\n\n## Description\n\n{}\n", snippet.description));
    }
    // Add links
    let links: Vec<serde_json::Value> = serde_json::from_str(&snippet.links).unwrap_or_default();
    if !links.is_empty() {
        content.push_str("\n## Links\n\n");
        for link in &links {
            let title = link.get("title").and_then(|v| v.as_str()).unwrap_or("Link");
            let url = link.get("url").and_then(|v| v.as_str()).unwrap_or("");
            content.push_str(&format!("- [{}]({})\n", title, url));
        }
    }

    // Write file
    let vault_path = std::path::Path::new(&base).join(&vault);
    let folder_clean = if folder == "(root)" { "" } else { &folder };
    let dir = if folder_clean.is_empty() { vault_path.clone() } else { vault_path.join(folder_clean) };
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let safe_name = filename.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_");
    let file_path = dir.join(format!("{}.md", safe_name));
    std::fs::write(&file_path, &content).map_err(|e| e.to_string())?;

    // Build relative path for obsidian_note field: "vault/folder/filename.md"
    let rel = if folder_clean.is_empty() {
        format!("{}/{}.md", vault, safe_name)
    } else {
        format!("{}/{}/{}.md", vault, folder_clean, safe_name)
    };

    // Update snippet's obsidian_note field
    queries::update_shortcut_obsidian_note(&conn, snippet_id, &rel)
        .map_err(|e| e.to_string())?;

    Ok(rel)
}

/// Read an Obsidian note content (markdown)
#[tauri::command]
pub fn read_obsidian_note(state: State<DbState>, note_path: String) -> Result<String, String> {
    let conn = state.lock_recover();
    let computer_id = hostname::get().unwrap_or_default().to_string_lossy().to_string();
    let base = queries::get_setting(&conn, &computer_id, "obsidian_vaults_path")
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    if base.is_empty() { return Err("Obsidian path not configured".into()); }

    let full_path = std::path::Path::new(&base).join(&note_path);
    std::fs::read_to_string(&full_path).map_err(|e| format!("Cannot read note: {}", e))
}

/// Link an existing note to a snippet (set obsidian_note field)
#[tauri::command]
pub fn link_obsidian_note(state: State<DbState>, snippet_id: i64, note_path: String) -> Result<(), String> {
    let conn = state.lock_recover();
    queries::update_shortcut_obsidian_note(&conn, snippet_id, &note_path)
        .map_err(|e| e.to_string())
}
