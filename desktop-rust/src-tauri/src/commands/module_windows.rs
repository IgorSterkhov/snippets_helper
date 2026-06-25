use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde::Serialize;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

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
        "finance" => Some(ModuleWindowSpec {
            id: "finance",
            label: "module_finance",
            title: "Finance - Keyboard Helper",
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
        "clickhouse-docs" => Some(ModuleWindowSpec {
            id: "clickhouse-docs",
            label: "module_clickhouse_docs",
            title: "ClickHouse - Keyboard Helper",
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
        "ai" => Some(ModuleWindowSpec {
            id: "ai",
            label: "module_ai",
            title: "AI - Keyboard Helper",
        }),
        _ => None,
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleObjectPayload {
    pub module_id: String,
    pub object_type: String,
    pub object_id: Option<i64>,
    pub object_uuid: Option<String>,
    pub title: Option<String>,
    pub detail: serde_json::Value,
}

fn encode_query_value(value: &str) -> String {
    utf8_percent_encode(value, NON_ALPHANUMERIC).to_string()
}

pub fn module_object_window_url(
    spec: ModuleWindowSpec,
    payload: &ModuleObjectPayload,
) -> String {
    let mut parts = vec![
        "standalone=1".to_string(),
        format!("module={}", encode_query_value(spec.id)),
        format!("objectType={}", encode_query_value(&payload.object_type)),
    ];
    if let Some(object_id) = payload.object_id {
        parts.push(format!("objectId={object_id}"));
    }
    if let Some(object_uuid) = payload.object_uuid.as_deref() {
        parts.push(format!("objectUuid={}", encode_query_value(object_uuid)));
    }
    if let Some(title) = payload.title.as_deref() {
        parts.push(format!("title={}", encode_query_value(title)));
    }
    if let Some(detail_tab) = payload.detail.get("detailTab").and_then(|v| v.as_str()) {
        parts.push(format!("detailTab={}", encode_query_value(detail_tab)));
    }
    format!("khapp://localhost/index.html?{}", parts.join("&"))
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

#[tauri::command]
pub async fn open_module_object_window(
    app: tauri::AppHandle,
    module_id: String,
    object_type: String,
    object_id: Option<i64>,
    object_uuid: Option<String>,
    title: Option<String>,
    detail_tab: Option<String>,
) -> Result<(), String> {
    let spec = module_window_spec(&module_id)
        .ok_or_else(|| format!("Unsupported module: {module_id}"))?;
    let mut detail = serde_json::Map::new();
    if let Some(detail_tab) = detail_tab.filter(|s| !s.is_empty()) {
        detail.insert("detailTab".to_string(), serde_json::Value::String(detail_tab));
    }
    let payload = ModuleObjectPayload {
        module_id: spec.id.to_string(),
        object_type,
        object_id,
        object_uuid,
        title,
        detail: serde_json::Value::Object(detail),
    };

    if let Some(window) = app.get_webview_window(spec.label) {
        window.show().map_err(|e| e.to_string())?;
        window.unminimize().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        app.emit_to(spec.label, "standalone:open-object", payload)
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    let url = module_object_window_url(spec, &payload);
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
    use super::{module_object_window_url, module_window_spec, ModuleObjectPayload};

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
    fn accepts_new_launchpad_target_modules() {
        let finance = module_window_spec("finance").expect("finance module");
        assert_eq!(finance.label, "module_finance");
        assert_eq!(finance.title, "Finance - Keyboard Helper");

        let clickhouse = module_window_spec("clickhouse-docs").expect("clickhouse module");
        assert_eq!(clickhouse.label, "module_clickhouse_docs");
        assert_eq!(clickhouse.title, "ClickHouse - Keyboard Helper");

        let ai = module_window_spec("ai").expect("ai module");
        assert_eq!(ai.label, "module_ai");
        assert_eq!(ai.title, "AI - Keyboard Helper");
    }

    #[test]
    fn builds_encoded_object_window_url() {
        let spec = module_window_spec("tasks").expect("tasks module");
        let payload = ModuleObjectPayload {
            module_id: "tasks".to_string(),
            object_type: "task".to_string(),
            object_id: Some(42),
            object_uuid: Some("uuid with spaces/and/slash".to_string()),
            title: Some("Аптека & лекарства".to_string()),
            detail: serde_json::json!({ "detailTab": "checklist" }),
        };

        let url = module_object_window_url(spec, &payload);

        assert!(url.starts_with("khapp://localhost/index.html?standalone=1&module=tasks"));
        assert!(url.contains("objectType=task"));
        assert!(url.contains("objectId=42"));
        assert!(url.contains("objectUuid=uuid%20with%20spaces%2Fand%2Fslash"));
        assert!(url.contains("title=%D0%90%D0%BF%D1%82%D0%B5%D0%BA%D0%B0%20%26%20%D0%BB%D0%B5%D0%BA%D0%B0%D1%80%D1%81%D1%82%D0%B2%D0%B0"));
        assert!(url.contains("detailTab=checklist"));
    }

    #[test]
    fn rejects_settings_help_and_unknown_modules() {
        assert!(module_window_spec("settings").is_none());
        assert!(module_window_spec("help").is_none());
        assert!(module_window_spec("../tasks").is_none());
        assert!(module_window_spec("unknown").is_none());
    }
}
