use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ModuleWindowSpec {
    pub id: &'static str,
    pub label: &'static str,
    pub title: &'static str,
}

pub fn module_window_spec(module_id: &str) -> Option<ModuleWindowSpec> {
    match module_id {
        "shortcuts" => Some(ModuleWindowSpec {
            id: "shortcuts",
            label: "module_shortcuts",
            title: "Snippets - Keyboard Helper",
        }),
        "notes" => Some(ModuleWindowSpec {
            id: "notes",
            label: "module_notes",
            title: "Notes - Keyboard Helper",
        }),
        "tasks" => Some(ModuleWindowSpec {
            id: "tasks",
            label: "module_tasks",
            title: "Tasks - Keyboard Helper",
        }),
        "sql" => Some(ModuleWindowSpec {
            id: "sql",
            label: "module_sql",
            title: "SQL - Keyboard Helper",
        }),
        "superset" => Some(ModuleWindowSpec {
            id: "superset",
            label: "module_superset",
            title: "Superset - Keyboard Helper",
        }),
        "commits" => Some(ModuleWindowSpec {
            id: "commits",
            label: "module_commits",
            title: "Commits - Keyboard Helper",
        }),
        "exec" => Some(ModuleWindowSpec {
            id: "exec",
            label: "module_exec",
            title: "Exec - Keyboard Helper",
        }),
        "repo-search" => Some(ModuleWindowSpec {
            id: "repo-search",
            label: "module_repo_search",
            title: "Search - Keyboard Helper",
        }),
        "vps" => Some(ModuleWindowSpec {
            id: "vps",
            label: "module_vps",
            title: "VPS - Keyboard Helper",
        }),
        "whisper" => Some(ModuleWindowSpec {
            id: "whisper",
            label: "module_whisper",
            title: "Whisper - Keyboard Helper",
        }),
        _ => None,
    }
}

#[tauri::command]
pub async fn open_module_window(app: tauri::AppHandle, module_id: String) -> Result<(), String> {
    let spec = module_window_spec(&module_id)
        .ok_or_else(|| format!("Unsupported module: {module_id}"))?;

    if let Some(window) = app.get_webview_window(spec.label) {
        window.show().map_err(|e| e.to_string())?;
        window.unminimize().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let url = format!(
        "khapp://localhost/index.html?standalone=1&module={}",
        spec.id
    );
    let parsed_url = url.parse::<tauri::Url>().map_err(|e| e.to_string())?;
    WebviewWindowBuilder::new(&app, spec.label, WebviewUrl::CustomProtocol(parsed_url))
        .title(spec.title)
        .inner_size(1100.0, 760.0)
        .min_inner_size(760.0, 480.0)
        .resizable(true)
        .decorations(true)
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::module_window_spec;

    #[test]
    fn accepts_known_main_modules() {
        let snippets = module_window_spec("shortcuts").expect("shortcuts module");
        assert_eq!(snippets.label, "module_shortcuts");
        assert_eq!(snippets.title, "Snippets - Keyboard Helper");

        let tasks = module_window_spec("tasks").expect("tasks module");
        assert_eq!(tasks.label, "module_tasks");
        assert_eq!(tasks.title, "Tasks - Keyboard Helper");
    }

    #[test]
    fn rejects_settings_help_and_unknown_modules() {
        assert!(module_window_spec("settings").is_none());
        assert!(module_window_spec("help").is_none());
        assert!(module_window_spec("../tasks").is_none());
        assert!(module_window_spec("unknown").is_none());
    }
}
