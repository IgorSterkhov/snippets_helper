use crate::db::DbState;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

const DEFAULT_LIMIT: usize = 50;
const UPDATE_PROGRESS_EVENT: &str = "clickhouse-doc-update-progress";
const CLICKHOUSE_DOCS_RU_CURRENT_PREFIX: &str = "i18n/ru/docusaurus-plugin-content-docs/current/";
const CLICKHOUSE_DOCS_FUNCTIONS_PATH: &str =
    "i18n/ru/docusaurus-plugin-content-docs/current/sql-reference/functions";
const CLICKHOUSE_DOCS_CONTENTS_API_ROOT: &str =
    "https://api.github.com/repos/ClickHouse/clickhouse-docs/contents";
const CLICKHOUSE_DOCS_REF: &str = "main";

#[derive(Clone, Debug)]
struct DocSource {
    category: &'static str,
    title: &'static str,
    source_url: &'static str,
    public_url: &'static str,
}

const DOC_SOURCES: &[DocSource] = &[
    DocSource {
        category: "Functions / Arrays",
        title: "Array Functions",
        source_url: "https://raw.githubusercontent.com/ClickHouse/clickhouse-docs/main/i18n/ru/docusaurus-plugin-content-docs/current/sql-reference/functions/array-functions.md",
        public_url: "https://clickhouse.com/docs/ru/sql-reference/functions/array-functions",
    },
    DocSource {
        category: "Functions / Dictionaries",
        title: "Dictionary Functions",
        source_url: "https://raw.githubusercontent.com/ClickHouse/clickhouse-docs/main/i18n/ru/docusaurus-plugin-content-docs/current/sql-reference/functions/ext-dict-functions.md",
        public_url: "https://clickhouse.com/docs/ru/sql-reference/functions/ext-dict-functions",
    },
    DocSource {
        category: "Functions / Encoding",
        title: "Encoding Functions",
        source_url: "https://raw.githubusercontent.com/ClickHouse/clickhouse-docs/main/i18n/ru/docusaurus-plugin-content-docs/current/sql-reference/functions/encoding-functions.md",
        public_url: "https://clickhouse.com/docs/ru/sql-reference/functions/encoding-functions",
    },
    DocSource {
        category: "Functions / Strings",
        title: "String Functions",
        source_url: "https://raw.githubusercontent.com/ClickHouse/clickhouse-docs/main/i18n/ru/docusaurus-plugin-content-docs/current/sql-reference/functions/string-functions.md",
        public_url: "https://clickhouse.com/docs/ru/sql-reference/functions/string-functions",
    },
    DocSource {
        category: "Functions / Dates",
        title: "Date and Time Functions",
        source_url: "https://raw.githubusercontent.com/ClickHouse/clickhouse-docs/main/i18n/ru/docusaurus-plugin-content-docs/current/sql-reference/functions/date-time-functions.md",
        public_url: "https://clickhouse.com/docs/ru/sql-reference/functions/date-time-functions",
    },
    DocSource {
        category: "Functions / JSON",
        title: "JSON Functions",
        source_url: "https://raw.githubusercontent.com/ClickHouse/clickhouse-docs/main/i18n/ru/docusaurus-plugin-content-docs/current/sql-reference/functions/json-functions.md",
        public_url: "https://clickhouse.com/docs/ru/sql-reference/functions/json-functions",
    },
    DocSource {
        category: "Reference / Data types",
        title: "Data Types",
        source_url: "https://raw.githubusercontent.com/ClickHouse/clickhouse-docs/main/i18n/ru/docusaurus-plugin-content-docs/current/sql-reference/data-types/index.md",
        public_url: "https://clickhouse.com/docs/ru/sql-reference/data-types",
    },
    DocSource {
        category: "Reference / Statements",
        title: "SELECT",
        source_url: "https://raw.githubusercontent.com/ClickHouse/clickhouse-docs/main/i18n/ru/docusaurus-plugin-content-docs/current/sql-reference/statements/select/index.md",
        public_url: "https://clickhouse.com/docs/ru/sql-reference/statements/select",
    },
    DocSource {
        category: "Reference / Statements",
        title: "CREATE TABLE",
        source_url: "https://raw.githubusercontent.com/ClickHouse/clickhouse-docs/main/i18n/ru/docusaurus-plugin-content-docs/current/sql-reference/statements/create/table.md",
        public_url: "https://clickhouse.com/docs/ru/sql-reference/statements/create/table",
    },
    DocSource {
        category: "Reference / Statements",
        title: "INSERT INTO",
        source_url: "https://raw.githubusercontent.com/ClickHouse/clickhouse-docs/main/i18n/ru/docusaurus-plugin-content-docs/current/sql-reference/statements/insert-into.md",
        public_url: "https://clickhouse.com/docs/ru/sql-reference/statements/insert-into",
    },
    DocSource {
        category: "Engines / MergeTree",
        title: "MergeTree",
        source_url: "https://raw.githubusercontent.com/ClickHouse/clickhouse-docs/main/i18n/ru/docusaurus-plugin-content-docs/current/engines/table-engines/mergetree-family/mergetree.md",
        public_url: "https://clickhouse.com/docs/ru/engines/table-engines/mergetree-family/mergetree",
    },
];

#[derive(Clone, Debug, PartialEq, Eq)]
struct RuntimeDocSource {
    category: String,
    title: String,
    source_url: String,
    public_url: String,
}

impl RuntimeDocSource {
    fn from_builtin(source: &DocSource) -> Self {
        Self {
            category: source.category.to_string(),
            title: source.title.to_string(),
            source_url: source.source_url.to_string(),
            public_url: source.public_url.to_string(),
        }
    }
}

#[derive(Deserialize, Debug)]
struct GitHubContentEntry {
    name: String,
    path: String,
    #[serde(rename = "type")]
    entry_type: String,
    download_url: Option<String>,
}

const SEED_ARRAY_FUNCTIONS: &str = r#"# Array Functions

## array \{#array\}

Creates an array from the function arguments.

**Syntax**

```sql
array(x1 [, x2, ..., xN])
```

## arrayCompact \{#arrayCompact\}

Removes consecutive duplicate elements from an array, including null values.

**Syntax**

```sql
arrayCompact(arr)
```

## arrayConcat \{#arrayConcat\}

Combines arrays passed as arguments.

**Syntax**

```sql
arrayConcat(arr1 [, arr2, ... , arrN])
```
"#;

const SEED_SELECT: &str = r#"# SELECT

## SELECT query

SELECT retrieves data from one or more tables.

```sql
SELECT expr_list
FROM table
WHERE condition
GROUP BY expr
ORDER BY expr
LIMIT n
```
"#;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ClickHouseDocPageSummary {
    pub id: i64,
    pub category: String,
    pub title: String,
    pub source_url: String,
    pub public_url: String,
    pub updated_at: String,
    pub section_count: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ClickHouseDocTree {
    pub pages: Vec<ClickHouseDocPageSummary>,
    pub page_count: i64,
    pub section_count: i64,
    pub last_update_at: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ClickHouseDocPage {
    pub id: i64,
    pub category: String,
    pub title: String,
    pub source_url: String,
    pub public_url: String,
    pub markdown: String,
    pub updated_at: String,
    pub sections: Vec<ClickHouseDocSection>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ClickHouseDocSection {
    pub id: i64,
    pub page_id: i64,
    pub category: String,
    pub page_title: String,
    pub title: String,
    pub slug: String,
    pub section_path: String,
    pub level: i64,
    pub excerpt: String,
    pub body: String,
    pub normalized_search_text: String,
    pub content_hash: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ClickHouseDocSearchResult {
    pub section_id: i64,
    pub page_id: i64,
    pub category: String,
    pub page_title: String,
    pub section_title: String,
    pub slug: String,
    pub section_path: String,
    pub excerpt: String,
    pub score: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ClickHouseDocUpdateRun {
    pub id: i64,
    pub started_at: String,
    pub finished_at: String,
    pub status: String,
    pub pages_checked: i64,
    pub pages_updated: i64,
    pub sections_added: i64,
    pub sections_changed: i64,
    pub sections_removed: i64,
    pub failed_urls: i64,
    pub summary: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ClickHouseDocUpdateProgress {
    pub running: bool,
    pub phase: String,
    pub message: String,
    pub current: i64,
    pub total: i64,
    pub remaining: i64,
    pub percent: f64,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub started_at_ms: Option<i64>,
    pub finished_at_ms: Option<i64>,
    pub elapsed_ms: i64,
    pub pages_checked: i64,
    pub pages_updated: i64,
    pub sections_added: i64,
    pub sections_changed: i64,
    pub sections_removed: i64,
    pub failed_urls: i64,
    pub summary: String,
    pub error: Option<String>,
}

impl Default for ClickHouseDocUpdateProgress {
    fn default() -> Self {
        Self {
            running: false,
            phase: "idle".to_string(),
            message: "ClickHouse docs update has not run in this session.".to_string(),
            current: 0,
            total: 0,
            remaining: 0,
            percent: 0.0,
            started_at: None,
            finished_at: None,
            started_at_ms: None,
            finished_at_ms: None,
            elapsed_ms: 0,
            pages_checked: 0,
            pages_updated: 0,
            sections_added: 0,
            sections_changed: 0,
            sections_removed: 0,
            failed_urls: 0,
            summary: String::new(),
            error: None,
        }
    }
}

pub struct ClickHouseDocUpdateProgressState(pub Mutex<ClickHouseDocUpdateProgress>);

impl Default for ClickHouseDocUpdateProgressState {
    fn default() -> Self {
        Self(Mutex::new(ClickHouseDocUpdateProgress::default()))
    }
}

impl ClickHouseDocUpdateProgressState {
    fn snapshot(&self) -> ClickHouseDocUpdateProgress {
        let mut progress = self
            .0
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .clone();
        refresh_elapsed(&mut progress);
        progress
    }

    fn set(&self, progress: ClickHouseDocUpdateProgress) -> ClickHouseDocUpdateProgress {
        let mut guard = self.0.lock().unwrap_or_else(|poison| poison.into_inner());
        *guard = progress;
        guard.clone()
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ClickHouseDocChange {
    pub id: i64,
    pub run_id: i64,
    pub change_type: String,
    pub item_type: String,
    pub title: String,
    pub source_url: String,
    pub details: String,
}

#[derive(Clone, Debug)]
struct ParsedDocPage {
    source_url: String,
    public_url: String,
    category: String,
    title: String,
    markdown: String,
    content_hash: String,
    sections: Vec<ClickHouseDocSection>,
}

#[derive(Clone, Debug)]
struct FailedDocSource {
    source_url: String,
    title: String,
    error: String,
}

#[derive(Clone, Debug)]
struct SectionChange {
    change_type: String,
    title: String,
    details: String,
}

#[tauri::command]
pub async fn list_clickhouse_doc_tree(state: State<'_, DbState>) -> Result<Value, String> {
    let conn = state.lock_recover();
    ensure_seed_docs(&conn)?;
    serde_json::to_value(load_tree(&conn)?).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_clickhouse_doc_page(
    state: State<'_, DbState>,
    page_id: i64,
) -> Result<Value, String> {
    let conn = state.lock_recover();
    ensure_seed_docs(&conn)?;
    serde_json::to_value(load_page(&conn, page_id)?).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_clickhouse_doc_section(
    state: State<'_, DbState>,
    page_id: i64,
    section_path: String,
) -> Result<Value, String> {
    let conn = state.lock_recover();
    ensure_seed_docs(&conn)?;
    serde_json::to_value(load_section_by_path(&conn, page_id, &section_path)?)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_clickhouse_docs(
    state: State<'_, DbState>,
    query: String,
    limit: Option<usize>,
) -> Result<Value, String> {
    let conn = state.lock_recover();
    ensure_seed_docs(&conn)?;
    let sections = load_all_sections(&conn)?;
    let results = search_sections_in_memory(&sections, &query, limit.unwrap_or(DEFAULT_LIMIT));
    serde_json::to_value(results).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_clickhouse_doc_update_runs(state: State<'_, DbState>) -> Result<Value, String> {
    let conn = state.lock_recover();
    let runs = load_update_runs(&conn)?;
    serde_json::to_value(runs).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_clickhouse_doc_changes(
    state: State<'_, DbState>,
    run_id: i64,
) -> Result<Value, String> {
    let conn = state.lock_recover();
    let changes = load_changes(&conn, run_id)?;
    serde_json::to_value(changes).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_clickhouse_doc_update_progress(
    progress_state: State<'_, ClickHouseDocUpdateProgressState>,
) -> Result<Value, String> {
    serde_json::to_value(progress_state.snapshot()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_clickhouse_docs(
    app: AppHandle,
    state: State<'_, DbState>,
    progress_state: State<'_, ClickHouseDocUpdateProgressState>,
) -> Result<Value, String> {
    if progress_state.snapshot().running {
        return Err("ClickHouse docs update is already running".to_string());
    }

    let started = Utc::now();
    let started_at = started.to_rfc3339();
    let started_at_ms = started.timestamp_millis();
    emit_update_progress(
        &app,
        &progress_state,
        progress_snapshot(
            true,
            "fetching",
            "Starting ClickHouse docs update",
            0,
            0,
            Some(started_at.clone()),
            Some(started_at_ms),
            None,
            None,
            None,
            None,
        ),
    );

    let fetched_pages = fetch_doc_sources(&app, &progress_state, &started_at, started_at_ms).await;
    let total_pages = fetched_pages.len() as i64;
    emit_update_progress(
        &app,
        &progress_state,
        progress_snapshot(
            true,
            "applying",
            "Applying parsed ClickHouse docs to the local cache",
            total_pages,
            total_pages,
            Some(started_at.clone()),
            Some(started_at_ms),
            None,
            None,
            None,
            None,
        ),
    );

    let run_result = {
        let mut conn = state.lock_recover();
        apply_doc_update(&mut conn, &started_at, fetched_pages)
    };

    match run_result {
        Ok(run) => {
            let finished = Utc::now();
            emit_update_progress(
                &app,
                &progress_state,
                progress_snapshot(
                    false,
                    "done",
                    "Complete",
                    run.pages_checked,
                    run.pages_checked,
                    Some(started_at),
                    Some(started_at_ms),
                    Some(finished.to_rfc3339()),
                    Some(finished.timestamp_millis()),
                    Some(&run),
                    None,
                ),
            );
            serde_json::to_value(run).map_err(|e| e.to_string())
        }
        Err(error) => {
            let finished = Utc::now();
            emit_update_progress(
                &app,
                &progress_state,
                progress_snapshot(
                    false,
                    "error",
                    "ClickHouse docs update failed",
                    total_pages,
                    total_pages,
                    Some(started_at),
                    Some(started_at_ms),
                    Some(finished.to_rfc3339()),
                    Some(finished.timestamp_millis()),
                    None,
                    Some(error.clone()),
                ),
            );
            Err(error)
        }
    }
}

async fn fetch_doc_sources(
    app: &AppHandle,
    progress_state: &ClickHouseDocUpdateProgressState,
    started_at: &str,
    started_at_ms: i64,
) -> Vec<Result<ParsedDocPage, FailedDocSource>> {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(25))
        .user_agent("snippets-helper-clickhouse-docs/1.0")
        .build()
    {
        Ok(client) => client,
        Err(e) => {
            return fallback_doc_sources()
                .iter()
                .map(|source| {
                    Err(FailedDocSource {
                        source_url: source.source_url.clone(),
                        title: source.title.clone(),
                        error: format!("create HTTP client: {}", e),
                    })
                })
                .collect()
        }
    };
    let (sources, discovery_error) = collect_doc_sources(&client).await;
    if let Some(error) = discovery_error {
        emit_update_progress(
            app,
            progress_state,
            progress_snapshot(
                true,
                "fetching",
                &format!(
                    "ClickHouse docs discovery failed; using fallback list: {}",
                    error
                ),
                0,
                sources.len() as i64,
                Some(started_at.to_string()),
                Some(started_at_ms),
                None,
                None,
                None,
                None,
            ),
        );
    } else {
        emit_update_progress(
            app,
            progress_state,
            progress_snapshot(
                true,
                "fetching",
                &format!("Discovered {} ClickHouse doc source(s)", sources.len()),
                0,
                sources.len() as i64,
                Some(started_at.to_string()),
                Some(started_at_ms),
                None,
                None,
                None,
                None,
            ),
        );
    }

    let mut results = Vec::new();
    for (index, source) in sources.iter().enumerate() {
        emit_update_progress(
            app,
            progress_state,
            progress_snapshot(
                true,
                "fetching",
                &format!("Fetching {}", source.title),
                index as i64,
                sources.len() as i64,
                Some(started_at.to_string()),
                Some(started_at_ms),
                None,
                None,
                None,
                None,
            ),
        );
        let result = async {
            let raw_markdown = client
                .get(&source.source_url)
                .send()
                .await
                .map_err(|e| format!("fetch {}: {}", source.source_url, e))?
                .error_for_status()
                .map_err(|e| format!("fetch {}: {}", source.source_url, e))?
                .text()
                .await
                .map_err(|e| format!("read {}: {}", source.source_url, e))?;
            let markdown = normalize_clickhouse_markdown(&raw_markdown);
            if markdown.trim().is_empty() {
                return Err(format!(
                    "empty markdown after normalization: {}",
                    source.source_url
                ));
            }
            let page_title = first_markdown_h1(&markdown).unwrap_or_else(|| source.title.clone());
            Ok::<ParsedDocPage, String>(build_parsed_page(
                &source.category,
                &page_title,
                &source.source_url,
                &source.public_url,
                &markdown,
            ))
        }
        .await
        .map_err(|error| FailedDocSource {
            source_url: source.source_url.clone(),
            title: source.title.clone(),
            error,
        });
        let message = match &result {
            Ok(page) => format!("Parsed {} ({} sections)", page.title, page.sections.len()),
            Err(failed) => format!("Failed {}: {}", failed.title, failed.error),
        };
        emit_update_progress(
            app,
            progress_state,
            progress_snapshot(
                true,
                "fetching",
                &message,
                index as i64 + 1,
                sources.len() as i64,
                Some(started_at.to_string()),
                Some(started_at_ms),
                None,
                None,
                None,
                None,
            ),
        );
        results.push(result);
    }
    results
}

fn fallback_doc_sources() -> Vec<RuntimeDocSource> {
    DOC_SOURCES
        .iter()
        .map(RuntimeDocSource::from_builtin)
        .collect()
}

async fn collect_doc_sources(client: &reqwest::Client) -> (Vec<RuntimeDocSource>, Option<String>) {
    let mut sources = fallback_doc_sources();
    let mut seen = sources
        .iter()
        .map(|source| source.source_url.clone())
        .collect::<HashSet<_>>();
    match discover_function_doc_sources(client).await {
        Ok(discovered) => {
            for source in discovered {
                if seen.insert(source.source_url.clone()) {
                    sources.push(source);
                }
            }
            sources.sort_by(|a, b| {
                a.category
                    .cmp(&b.category)
                    .then_with(|| a.title.cmp(&b.title))
                    .then_with(|| a.source_url.cmp(&b.source_url))
            });
            (sources, None)
        }
        Err(error) => (sources, Some(error)),
    }
}

async fn discover_function_doc_sources(
    client: &reqwest::Client,
) -> Result<Vec<RuntimeDocSource>, String> {
    let mut queue = VecDeque::from([clickhouse_contents_api_url(CLICKHOUSE_DOCS_FUNCTIONS_PATH)]);
    let mut visited = HashSet::new();
    let mut sources = Vec::new();
    while let Some(url) = queue.pop_front() {
        if !visited.insert(url.clone()) {
            continue;
        }
        let raw = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("fetch source directory {}: {}", url, e))?
            .error_for_status()
            .map_err(|e| format!("fetch source directory {}: {}", url, e))?
            .text()
            .await
            .map_err(|e| format!("read source directory {}: {}", url, e))?;
        let entries = parse_github_contents_entries(&raw)?;
        sources.extend(entries.iter().filter_map(doc_source_from_github_content));
        for entry in entries {
            if entry.entry_type == "dir" {
                queue.push_back(clickhouse_contents_api_url(&entry.path));
            }
        }
    }
    sources.sort_by(|a, b| {
        a.category
            .cmp(&b.category)
            .then_with(|| a.title.cmp(&b.title))
            .then_with(|| a.source_url.cmp(&b.source_url))
    });
    Ok(sources)
}

fn clickhouse_contents_api_url(path: &str) -> String {
    format!(
        "{}/{}?ref={}",
        CLICKHOUSE_DOCS_CONTENTS_API_ROOT, path, CLICKHOUSE_DOCS_REF
    )
}

#[cfg(test)]
fn parse_github_contents_sources(raw: &str) -> Result<Vec<RuntimeDocSource>, String> {
    let mut sources = parse_github_contents_entries(raw)?
        .iter()
        .filter_map(doc_source_from_github_content)
        .collect::<Vec<_>>();
    sources.sort_by(|a, b| {
        a.category
            .cmp(&b.category)
            .then_with(|| a.title.cmp(&b.title))
            .then_with(|| a.source_url.cmp(&b.source_url))
    });
    Ok(sources)
}

fn parse_github_contents_entries(raw: &str) -> Result<Vec<GitHubContentEntry>, String> {
    serde_json::from_str(raw).map_err(|e| format!("parse GitHub contents: {}", e))
}

fn doc_source_from_github_content(entry: &GitHubContentEntry) -> Option<RuntimeDocSource> {
    if entry.entry_type != "file" || !entry.name.ends_with(".md") {
        return None;
    }
    let source_url = entry.download_url.clone()?;
    let relative_path = entry.path.strip_prefix(CLICKHOUSE_DOCS_RU_CURRENT_PREFIX)?;
    if !relative_path.starts_with("sql-reference/functions/") {
        return None;
    }
    let public_path = relative_path
        .strip_suffix(".md")
        .unwrap_or(relative_path)
        .strip_suffix("/index")
        .unwrap_or_else(|| relative_path.strip_suffix(".md").unwrap_or(relative_path));
    let title = humanize_clickhouse_doc_name(&entry.name);
    let category = clickhouse_function_category(relative_path);
    Some(RuntimeDocSource {
        category,
        title,
        source_url,
        public_url: format!("https://clickhouse.com/docs/ru/{}", public_path),
    })
}

fn clickhouse_function_category(relative_path: &str) -> String {
    let rest = relative_path
        .strip_prefix("sql-reference/functions/")
        .unwrap_or(relative_path);
    if let Some((dir, _)) = rest.split_once('/') {
        return format!(
            "Functions / {}",
            humanize_clickhouse_doc_stem(dir)
                .replace("Functions", "")
                .trim()
        )
        .trim()
        .to_string();
    }
    format!("Functions / {}", humanize_clickhouse_doc_name(rest))
}

fn humanize_clickhouse_doc_name(name: &str) -> String {
    let stem = name.strip_suffix(".md").unwrap_or(name);
    humanize_clickhouse_doc_stem(stem)
}

fn humanize_clickhouse_doc_stem(stem: &str) -> String {
    let mut words = Vec::new();
    for part in stem.replace('_', "-").split('-') {
        if part.is_empty() || part == "index" {
            continue;
        }
        let word = match part {
            "ai" => "AI".to_string(),
            "ip" => "IP".to_string(),
            "json" => "JSON".to_string(),
            "nlp" => "NLP".to_string(),
            "udf" => "UDF".to_string(),
            "ulid" => "ULID".to_string(),
            "url" => "URL".to_string(),
            "uuid" => "UUID".to_string(),
            "wasm" => "WebAssembly".to_string(),
            "dict" => "Dictionaries".to_string(),
            "ext" => "External".to_string(),
            "geo" => "Geometry".to_string(),
            other => {
                let mut chars = other.chars();
                match chars.next() {
                    Some(first) => format!(
                        "{}{}",
                        first.to_uppercase().collect::<String>(),
                        chars.collect::<String>()
                    ),
                    None => String::new(),
                }
            }
        };
        if !word.is_empty() {
            words.push(word);
        }
    }
    if words.is_empty() {
        "Documentation".to_string()
    } else {
        words.join(" ")
    }
}

fn emit_update_progress(
    app: &AppHandle,
    progress_state: &ClickHouseDocUpdateProgressState,
    mut progress: ClickHouseDocUpdateProgress,
) {
    refresh_elapsed(&mut progress);
    let snapshot = progress_state.set(progress);
    let _ = app.emit(UPDATE_PROGRESS_EVENT, snapshot);
}

#[allow(clippy::too_many_arguments)]
fn progress_snapshot(
    running: bool,
    phase: &str,
    message: &str,
    current: i64,
    total: i64,
    started_at: Option<String>,
    started_at_ms: Option<i64>,
    finished_at: Option<String>,
    finished_at_ms: Option<i64>,
    run: Option<&ClickHouseDocUpdateRun>,
    error: Option<String>,
) -> ClickHouseDocUpdateProgress {
    let current = current.clamp(0, total.max(0));
    let remaining = (total - current).max(0);
    let percent = if total > 0 {
        ((current as f64 / total as f64) * 100.0).clamp(0.0, 100.0)
    } else if !running {
        100.0
    } else {
        0.0
    };
    let mut progress = ClickHouseDocUpdateProgress {
        running,
        phase: phase.to_string(),
        message: message.to_string(),
        current,
        total,
        remaining,
        percent,
        started_at,
        finished_at,
        started_at_ms,
        finished_at_ms,
        elapsed_ms: 0,
        pages_checked: run.map(|r| r.pages_checked).unwrap_or(0),
        pages_updated: run.map(|r| r.pages_updated).unwrap_or(0),
        sections_added: run.map(|r| r.sections_added).unwrap_or(0),
        sections_changed: run.map(|r| r.sections_changed).unwrap_or(0),
        sections_removed: run.map(|r| r.sections_removed).unwrap_or(0),
        failed_urls: run.map(|r| r.failed_urls).unwrap_or(0),
        summary: run.map(|r| r.summary.clone()).unwrap_or_default(),
        error,
    };
    refresh_elapsed(&mut progress);
    progress
}

fn refresh_elapsed(progress: &mut ClickHouseDocUpdateProgress) {
    let Some(started_at_ms) = progress.started_at_ms else {
        progress.elapsed_ms = 0;
        return;
    };
    let end_ms = progress
        .finished_at_ms
        .unwrap_or_else(|| Utc::now().timestamp_millis());
    progress.elapsed_ms = (end_ms - started_at_ms).max(0);
}

fn build_parsed_page(
    category: &str,
    title: &str,
    source_url: &str,
    public_url: &str,
    markdown: &str,
) -> ParsedDocPage {
    let mut sections = split_markdown_sections(0, category, title, markdown);
    for section in &mut sections {
        section.content_hash = hash_text(&format!("{}\n{}", section.title, section.body));
        section.normalized_search_text = normalize_for_search(&format!(
            "{} {} {} {}",
            section.title, section.page_title, section.category, section.body
        ));
    }
    ParsedDocPage {
        source_url: source_url.to_string(),
        public_url: public_url.to_string(),
        category: category.to_string(),
        title: title.to_string(),
        markdown: markdown.to_string(),
        content_hash: hash_text(markdown),
        sections,
    }
}

fn ensure_seed_docs(conn: &Connection) -> Result<(), String> {
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM clickhouse_doc_pages", [], |row| {
            row.get(0)
        })
        .map_err(|e| e.to_string())?;
    if count > 0 {
        return Ok(());
    }
    let pages = vec![
        build_parsed_page(
            "Functions / Arrays",
            "Array Functions",
            "seed://clickhouse/functions/array-functions",
            "https://clickhouse.com/docs/ru/sql-reference/functions/array-functions",
            SEED_ARRAY_FUNCTIONS,
        ),
        build_parsed_page(
            "Reference / Statements",
            "SELECT",
            "seed://clickhouse/statements/select",
            "https://clickhouse.com/docs/ru/sql-reference/statements/select",
            SEED_SELECT,
        ),
    ];
    let now = Utc::now().to_rfc3339();
    for page in pages {
        upsert_page(conn, &page, &now)?;
    }
    Ok(())
}

fn apply_doc_update(
    conn: &mut Connection,
    started_at: &str,
    fetched_pages: Vec<Result<ParsedDocPage, FailedDocSource>>,
) -> Result<ClickHouseDocUpdateRun, String> {
    let finished_at = Utc::now().to_rfc3339();
    let pages_checked = fetched_pages.len() as i64;
    let mut pages_updated = 0i64;
    let mut failed_urls = 0i64;
    let mut all_changes = Vec::new();
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    for result in fetched_pages {
        match result {
            Ok(page) => {
                let old_sections = load_sections_for_source(&tx, &page.source_url)?;
                let old_hash = load_page_hash(&tx, &page.source_url)?.unwrap_or_default();
                let changes = diff_sections(&old_sections, &page.sections);
                if !changes.is_empty() || old_sections.is_empty() || page.content_hash != old_hash {
                    pages_updated += 1;
                    upsert_page(&tx, &page, &finished_at)?;
                }
                for change in changes {
                    all_changes.push(ClickHouseDocChange {
                        id: 0,
                        run_id: 0,
                        change_type: change.change_type,
                        item_type: "section".to_string(),
                        title: change.title,
                        source_url: page.source_url.clone(),
                        details: change.details,
                    });
                }
            }
            Err(failed) => {
                failed_urls += 1;
                all_changes.push(ClickHouseDocChange {
                    id: 0,
                    run_id: 0,
                    change_type: "failed".to_string(),
                    item_type: "source".to_string(),
                    title: failed.title,
                    source_url: failed.source_url,
                    details: failed.error,
                });
            }
        }
    }

    let sections_added = all_changes
        .iter()
        .filter(|c| c.change_type == "added")
        .count() as i64;
    let sections_changed = all_changes
        .iter()
        .filter(|c| c.change_type == "changed")
        .count() as i64;
    let sections_removed = all_changes
        .iter()
        .filter(|c| c.change_type == "removed")
        .count() as i64;
    let status = if failed_urls == pages_checked {
        "failed"
    } else if failed_urls > 0 {
        "partial"
    } else {
        "success"
    };
    let summary = format!(
        "{} page(s) checked, {} updated, {} added, {} changed, {} removed, {} failed",
        pages_checked,
        pages_updated,
        sections_added,
        sections_changed,
        sections_removed,
        failed_urls
    );

    tx.execute(
        "INSERT INTO clickhouse_doc_update_runs
         (started_at, finished_at, status, pages_checked, pages_updated, sections_added,
          sections_changed, sections_removed, failed_urls, summary)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            started_at,
            finished_at,
            status,
            pages_checked,
            pages_updated,
            sections_added,
            sections_changed,
            sections_removed,
            failed_urls,
            summary
        ],
    )
    .map_err(|e| e.to_string())?;
    let run_id = tx.last_insert_rowid();
    for change in &all_changes {
        tx.execute(
            "INSERT INTO clickhouse_doc_changes
             (run_id, change_type, item_type, title, source_url, details)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                run_id,
                change.change_type,
                change.item_type,
                change.title,
                change.source_url,
                change.details
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;

    Ok(ClickHouseDocUpdateRun {
        id: run_id,
        started_at: started_at.to_string(),
        finished_at,
        status: status.to_string(),
        pages_checked,
        pages_updated,
        sections_added,
        sections_changed,
        sections_removed,
        failed_urls,
        summary,
    })
}

fn upsert_page(conn: &Connection, page: &ParsedDocPage, updated_at: &str) -> Result<i64, String> {
    conn.execute(
        "INSERT INTO clickhouse_doc_pages (source_url, public_url, category, title, markdown, content_hash, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(source_url) DO UPDATE SET
           public_url=excluded.public_url,
           category=excluded.category,
           title=excluded.title,
           markdown=excluded.markdown,
           content_hash=excluded.content_hash,
           updated_at=excluded.updated_at",
        params![
            page.source_url,
            page.public_url,
            page.category,
            page.title,
            page.markdown,
            page.content_hash,
            updated_at
        ],
    )
    .map_err(|e| e.to_string())?;
    let page_id = conn
        .query_row(
            "SELECT id FROM clickhouse_doc_pages WHERE source_url = ?1",
            params![page.source_url],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM clickhouse_doc_sections WHERE page_id = ?1",
        params![page_id],
    )
    .map_err(|e| e.to_string())?;
    for (idx, section) in page.sections.iter().enumerate() {
        conn.execute(
            "INSERT INTO clickhouse_doc_sections
             (page_id, category, page_title, title, slug, section_path, level, body,
              normalized_search_text, content_hash, sort_order)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                page_id,
                page.category,
                page.title,
                section.title,
                section.slug,
                section.section_path,
                section.level,
                section.body,
                section.normalized_search_text,
                section.content_hash,
                idx as i64
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(page_id)
}

fn load_tree(conn: &Connection) -> Result<ClickHouseDocTree, String> {
    let mut stmt = conn
        .prepare(
            "SELECT p.id, p.category, p.title, p.source_url, p.public_url, p.updated_at, COUNT(s.id) AS section_count
             FROM clickhouse_doc_pages p
             LEFT JOIN clickhouse_doc_sections s ON s.page_id = p.id
             GROUP BY p.id
             ORDER BY p.category, p.title",
        )
        .map_err(|e| e.to_string())?;
    let pages = stmt
        .query_map([], |row| {
            Ok(ClickHouseDocPageSummary {
                id: row.get(0)?,
                category: row.get(1)?,
                title: row.get(2)?,
                source_url: row.get(3)?,
                public_url: row.get(4)?,
                updated_at: row.get(5)?,
                section_count: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let page_count = pages.len() as i64;
    let section_count = pages.iter().map(|p| p.section_count).sum();
    let last_update_at = conn
        .query_row(
            "SELECT MAX(updated_at) FROM clickhouse_doc_pages",
            [],
            |row| row.get::<_, Option<String>>(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(ClickHouseDocTree {
        pages,
        page_count,
        section_count,
        last_update_at,
    })
}

fn load_page(conn: &Connection, page_id: i64) -> Result<ClickHouseDocPage, String> {
    let (id, category, title, source_url, public_url, updated_at) = conn
        .query_row(
            "SELECT id, category, title, source_url, public_url, updated_at
             FROM clickhouse_doc_pages WHERE id = ?1",
            params![page_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?;
    let sections = load_section_summaries_for_page(conn, page_id)?;
    Ok(ClickHouseDocPage {
        id,
        category,
        title,
        source_url,
        public_url,
        markdown: String::new(),
        updated_at,
        sections,
    })
}

fn load_sections_for_page(
    conn: &Connection,
    page_id: i64,
) -> Result<Vec<ClickHouseDocSection>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, page_id, category, page_title, title, slug, section_path, level, body,
                    normalized_search_text, content_hash
             FROM clickhouse_doc_sections WHERE page_id = ?1 ORDER BY sort_order, id",
        )
        .map_err(|e| e.to_string())?;
    load_sections_from_stmt(&mut stmt, params![page_id])
}

fn load_section_summaries_for_page(
    conn: &Connection,
    page_id: i64,
) -> Result<Vec<ClickHouseDocSection>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, page_id, category, page_title, title, slug, section_path, level,
                    substr(body, 1, 700) AS excerpt_source, content_hash
             FROM clickhouse_doc_sections WHERE page_id = ?1 ORDER BY sort_order, id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![page_id], |row| {
            let excerpt_source = row.get::<_, String>(8)?;
            Ok(ClickHouseDocSection {
                id: row.get(0)?,
                page_id: row.get(1)?,
                category: row.get(2)?,
                page_title: row.get(3)?,
                title: row.get(4)?,
                slug: row.get(5)?,
                section_path: row.get(6)?,
                level: row.get(7)?,
                excerpt: make_excerpt(&excerpt_source),
                body: String::new(),
                normalized_search_text: String::new(),
                content_hash: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

fn load_section_by_path(
    conn: &Connection,
    page_id: i64,
    section_path: &str,
) -> Result<ClickHouseDocSection, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, page_id, category, page_title, title, slug, section_path, level, body,
                    normalized_search_text, content_hash
             FROM clickhouse_doc_sections WHERE page_id = ?1 AND section_path = ?2 LIMIT 1",
        )
        .map_err(|e| e.to_string())?;
    let mut sections = load_sections_from_stmt(&mut stmt, params![page_id, section_path])?;
    sections
        .pop()
        .ok_or_else(|| format!("ClickHouse section not found: {section_path}"))
}

fn load_sections_for_source(
    conn: &Connection,
    source_url: &str,
) -> Result<Vec<ClickHouseDocSection>, String> {
    let page_id = conn
        .query_row(
            "SELECT id FROM clickhouse_doc_pages WHERE source_url = ?1",
            params![source_url],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    match page_id {
        Some(id) => load_sections_for_page(conn, id),
        None => Ok(Vec::new()),
    }
}

fn load_all_sections(conn: &Connection) -> Result<Vec<ClickHouseDocSection>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, page_id, category, page_title, title, slug, section_path, level, body,
                    normalized_search_text, content_hash
             FROM clickhouse_doc_sections ORDER BY category, page_title, sort_order, id",
        )
        .map_err(|e| e.to_string())?;
    load_sections_from_stmt(&mut stmt, [])
}

fn load_sections_from_stmt<P: rusqlite::Params>(
    stmt: &mut rusqlite::Statement<'_>,
    params: P,
) -> Result<Vec<ClickHouseDocSection>, String> {
    stmt.query_map(params, |row| {
        let body = row.get::<_, String>(8)?;
        Ok(ClickHouseDocSection {
            id: row.get(0)?,
            page_id: row.get(1)?,
            category: row.get(2)?,
            page_title: row.get(3)?,
            title: row.get(4)?,
            slug: row.get(5)?,
            section_path: row.get(6)?,
            level: row.get(7)?,
            excerpt: make_excerpt(&body),
            body,
            normalized_search_text: row.get(9)?,
            content_hash: row.get(10)?,
        })
    })
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())
}

fn make_excerpt(text: &str) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(220)
        .collect()
}

fn load_page_hash(conn: &Connection, source_url: &str) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT content_hash FROM clickhouse_doc_pages WHERE source_url = ?1",
        params![source_url],
        |row| row.get::<_, String>(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

fn load_update_runs(conn: &Connection) -> Result<Vec<ClickHouseDocUpdateRun>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, started_at, finished_at, status, pages_checked, pages_updated,
                    sections_added, sections_changed, sections_removed, failed_urls, summary
             FROM clickhouse_doc_update_runs ORDER BY id DESC LIMIT 20",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(ClickHouseDocUpdateRun {
                id: row.get(0)?,
                started_at: row.get(1)?,
                finished_at: row.get(2)?,
                status: row.get(3)?,
                pages_checked: row.get(4)?,
                pages_updated: row.get(5)?,
                sections_added: row.get(6)?,
                sections_changed: row.get(7)?,
                sections_removed: row.get(8)?,
                failed_urls: row.get(9)?,
                summary: row.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

fn load_changes(conn: &Connection, run_id: i64) -> Result<Vec<ClickHouseDocChange>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, run_id, change_type, item_type, title, source_url, details
             FROM clickhouse_doc_changes WHERE run_id = ?1 ORDER BY id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![run_id], |row| {
            Ok(ClickHouseDocChange {
                id: row.get(0)?,
                run_id: row.get(1)?,
                change_type: row.get(2)?,
                item_type: row.get(3)?,
                title: row.get(4)?,
                source_url: row.get(5)?,
                details: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

fn split_markdown_sections(
    page_id: i64,
    category: &str,
    page_title: &str,
    markdown: &str,
) -> Vec<ClickHouseDocSection> {
    let mut sections = Vec::new();
    let mut current_title = String::new();
    let mut current_body = Vec::new();
    let mut in_code_fence = false;
    let mut path_counts: HashMap<String, i64> = HashMap::new();

    for line in markdown.lines() {
        let trimmed = line.trim_start();
        let is_fence = trimmed.starts_with("```") || trimmed.starts_with("~~~");
        if is_fence {
            in_code_fence = !in_code_fence;
            if !current_title.is_empty() {
                current_body.push(line.to_string());
            }
            continue;
        }

        if !in_code_fence && markdown_heading_level(trimmed) == Some(2) {
            push_current_section(
                &mut sections,
                &mut path_counts,
                page_id,
                category,
                page_title,
                &mut current_title,
                &mut current_body,
            );
            current_title = clean_heading_title(trimmed, 2);
            continue;
        }

        if !current_title.is_empty() {
            current_body.push(line.to_string());
        }
    }
    push_current_section(
        &mut sections,
        &mut path_counts,
        page_id,
        category,
        page_title,
        &mut current_title,
        &mut current_body,
    );

    if sections.is_empty() {
        let body = markdown.trim().to_string();
        let normalized_search_text =
            normalize_for_search(&format!("{} {} {}", page_title, category, body));
        sections.push(ClickHouseDocSection {
            id: 0,
            page_id,
            category: category.to_string(),
            page_title: page_title.to_string(),
            title: page_title.to_string(),
            slug: slugify(page_title),
            section_path: slugify(page_title),
            level: 1,
            excerpt: make_excerpt(&body),
            body: body.clone(),
            normalized_search_text,
            content_hash: hash_text(&body),
        });
    }
    sections
}

#[allow(clippy::too_many_arguments)]
fn push_current_section(
    sections: &mut Vec<ClickHouseDocSection>,
    path_counts: &mut HashMap<String, i64>,
    page_id: i64,
    category: &str,
    page_title: &str,
    title: &mut String,
    body: &mut Vec<String>,
) {
    if title.trim().is_empty() {
        body.clear();
        return;
    }
    let joined = body.join("\n").trim().to_string();
    let slug = slugify(title);
    let base_path = if slug.is_empty() {
        "section".to_string()
    } else {
        slug.clone()
    };
    let count = path_counts.entry(base_path.clone()).or_insert(0);
    *count += 1;
    let section_path = if *count == 1 {
        base_path
    } else {
        format!("{}-{}", base_path, count)
    };
    let normalized_search_text =
        normalize_for_search(&format!("{} {} {} {}", title, page_title, category, joined));
    sections.push(ClickHouseDocSection {
        id: 0,
        page_id,
        category: category.to_string(),
        page_title: page_title.to_string(),
        title: title.trim().to_string(),
        slug,
        section_path,
        level: 2,
        excerpt: make_excerpt(&joined),
        body: joined.clone(),
        normalized_search_text,
        content_hash: hash_text(&format!("{}\n{}", title, joined)),
    });
    title.clear();
    body.clear();
}

fn markdown_heading_level(line: &str) -> Option<usize> {
    let hashes = line.chars().take_while(|c| *c == '#').count();
    if hashes == 0 || hashes > 6 {
        return None;
    }
    if line.chars().nth(hashes) == Some(' ') {
        Some(hashes)
    } else {
        None
    }
}

fn clean_heading_title(line: &str, level: usize) -> String {
    let without_prefix = line.chars().skip(level).collect::<String>();
    let without_hash_suffix = without_prefix.trim().trim_matches('#').trim().to_string();
    let anchor_re = regex::Regex::new(r"\\?\{#[^}]+\}").unwrap();
    anchor_re
        .replace_all(&without_hash_suffix, "")
        .trim()
        .to_string()
}

fn first_markdown_h1(markdown: &str) -> Option<String> {
    markdown
        .lines()
        .map(str::trim_start)
        .find(|line| markdown_heading_level(line) == Some(1))
        .map(|line| clean_heading_title(line, 1))
        .filter(|title| !title.trim().is_empty())
}

fn search_sections_in_memory(
    sections: &[ClickHouseDocSection],
    query: &str,
    limit: usize,
) -> Vec<ClickHouseDocSearchResult> {
    let tokens = query_tokens(query);
    if tokens.is_empty() {
        return Vec::new();
    }
    let normalized_query = normalize_for_search(query);
    let query_compact = normalized_query.replace(' ', "");
    let mut results = Vec::new();
    for section in sections {
        let title_norm = normalize_for_search(&section.title);
        let page_norm = normalize_for_search(&section.page_title);
        let body_norm = normalize_for_search(&section.body);
        let haystack = if section.normalized_search_text.trim().is_empty() {
            format!(
                "{} {} {} {}",
                title_norm,
                page_norm,
                normalize_for_search(&section.category),
                body_norm
            )
        } else {
            section.normalized_search_text.clone()
        };
        if !tokens.iter().all(|token| haystack.contains(token)) {
            continue;
        }
        let title_compact = title_norm.replace(' ', "");
        let mut score = 0i64;
        if !query_compact.is_empty() && title_compact == query_compact {
            score += 220;
        } else if !normalized_query.is_empty() && title_norm == normalized_query {
            score += 200;
        } else if title_norm.starts_with(&normalized_query)
            || title_compact.starts_with(&query_compact)
        {
            score += 130;
        }
        for token in &tokens {
            if title_norm.split_whitespace().any(|part| part == token) {
                score += 80;
            } else if title_norm.contains(token) {
                score += 50;
            }
            if page_norm.contains(token) {
                score += 20;
            }
            if body_norm.contains(token) {
                score += 8;
            }
        }
        results.push(ClickHouseDocSearchResult {
            section_id: section.id,
            page_id: section.page_id,
            category: section.category.clone(),
            page_title: section.page_title.clone(),
            section_title: section.title.clone(),
            slug: section.slug.clone(),
            section_path: section.section_path.clone(),
            excerpt: excerpt_for_tokens(&section.body, &tokens),
            score,
        });
    }
    results.sort_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then_with(|| a.section_title.cmp(&b.section_title))
    });
    results.truncate(limit);
    results
}

fn query_tokens(query: &str) -> Vec<String> {
    normalize_for_search(query)
        .split_whitespace()
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

fn excerpt_for_tokens(body: &str, tokens: &[String]) -> String {
    if body.trim().is_empty() {
        return String::new();
    }
    let body_lc = body.to_lowercase();
    let byte_pos = tokens
        .iter()
        .filter_map(|token| body_lc.find(token))
        .min()
        .unwrap_or(0);
    let char_pos = byte_to_char_index(&body_lc, byte_pos);
    let chars = body.chars().collect::<Vec<_>>();
    let start = char_pos.saturating_sub(80);
    let end = chars.len().min(char_pos + 220);
    chars[start..end]
        .iter()
        .collect::<String>()
        .trim()
        .replace('\n', " ")
}

fn byte_to_char_index(text: &str, byte_idx: usize) -> usize {
    text.char_indices()
        .take_while(|(idx, _)| *idx < byte_idx)
        .count()
}

fn diff_sections(old: &[ClickHouseDocSection], new: &[ClickHouseDocSection]) -> Vec<SectionChange> {
    let old_map = old
        .iter()
        .map(|s| (section_key(s), s))
        .collect::<HashMap<_, _>>();
    let new_map = new
        .iter()
        .map(|s| (section_key(s), s))
        .collect::<HashMap<_, _>>();
    let mut changes = Vec::new();
    for (key, section) in &new_map {
        match old_map.get(key) {
            None => changes.push(SectionChange {
                change_type: "added".to_string(),
                title: section.title.clone(),
                details: format!("Added section '{}'", section.title),
            }),
            Some(old_section) if old_section.content_hash != section.content_hash => {
                changes.push(SectionChange {
                    change_type: "changed".to_string(),
                    title: section.title.clone(),
                    details: format!("Changed section '{}'", section.title),
                });
            }
            _ => {}
        }
    }
    for (key, section) in old_map {
        if !new_map.contains_key(&key) {
            changes.push(SectionChange {
                change_type: "removed".to_string(),
                title: section.title.clone(),
                details: format!("Removed section '{}'", section.title),
            });
        }
    }
    changes
}

fn section_key(section: &ClickHouseDocSection) -> String {
    format!(
        "{}::{}",
        normalize_for_search(&section.page_title),
        section.section_path
    )
}

fn slugify(text: &str) -> String {
    let mut slug = String::new();
    let mut last_dash = false;
    for ch in text.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
            last_dash = false;
        } else if !last_dash {
            slug.push('-');
            last_dash = true;
        }
    }
    slug.trim_matches('-').to_string()
}

fn normalize_for_search(text: &str) -> String {
    let mut out = String::new();
    let mut prev_lower_or_digit = false;
    let mut last_space = true;
    for ch in text.chars() {
        if ch.is_alphanumeric() {
            if prev_lower_or_digit && ch.is_uppercase() && !last_space {
                out.push(' ');
            }
            for lower in ch.to_lowercase() {
                out.push(lower);
            }
            prev_lower_or_digit = ch.is_lowercase() || ch.is_numeric();
            last_space = false;
        } else {
            if !last_space {
                out.push(' ');
                last_space = true;
            }
            prev_lower_or_digit = false;
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn normalize_clickhouse_markdown(raw: &str) -> String {
    let mut lines = raw.lines().collect::<Vec<_>>();
    if lines.first().map(|line| line.trim()) == Some("---") {
        if let Some(end_idx) = lines.iter().enumerate().skip(1).find_map(|(idx, line)| {
            if line.trim() == "---" {
                Some(idx)
            } else {
                None
            }
        }) {
            lines.drain(0..=end_idx);
        }
    }
    let without_imports = lines
        .into_iter()
        .filter(|line| {
            let trimmed = line.trim_start();
            !(trimmed.starts_with("import ") && trimmed.contains(" from "))
        })
        .collect::<Vec<_>>()
        .join("\n");
    let comment_re = regex::Regex::new(r"(?s)\{/\*.*?\*/\}").unwrap();
    comment_re
        .replace_all(&without_imports, "")
        .trim()
        .to_string()
}

fn hash_text(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    hex::encode(hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clickhouse_docs_split_sections_returns_function_blocks() {
        let markdown = r#"# Array Functions

## array \{#array\}

Creates an array.

Syntax

    array(x1 [, x2])

## arrayCompact \{#arrayCompact\}

Removes consecutive duplicate elements.

Syntax

    arrayCompact(arr)
"#;
        let sections =
            split_markdown_sections(7, "Functions / Arrays", "Array Functions", markdown);
        assert_eq!(sections.len(), 2);
        assert_eq!(sections[0].title, "array");
        assert_eq!(sections[0].section_path, "array");
        assert!(sections[0].body.contains("Creates an array"));
        assert!(!sections[0].body.contains("arrayCompact(arr)"));
        assert_eq!(sections[1].title, "arrayCompact");
        assert!(sections[1].body.contains("arrayCompact(arr)"));
    }

    #[test]
    fn clickhouse_docs_nested_headings_and_code_stay_inside_function_block() {
        let markdown = r#"# Array Functions

## arrayCompact \{#arrayCompact\}

### Syntax

```sql
-- this line is not a heading:
## notASection
arrayCompact(arr)
```

### Arguments

The input array.

## arrayConcat \{#arrayConcat\}

Concat arrays.
"#;
        let sections =
            split_markdown_sections(1, "Functions / Arrays", "Array Functions", markdown);
        assert_eq!(sections.len(), 2);
        assert_eq!(sections[0].title, "arrayCompact");
        assert!(sections[0].body.contains("### Syntax"));
        assert!(sections[0].body.contains("## notASection"));
        assert!(sections[0].body.contains("### Arguments"));
        assert_eq!(sections[1].title, "arrayConcat");
    }

    #[test]
    fn clickhouse_docs_search_prefers_exact_section_title() {
        let sections = vec![
            section_with_hash_and_body("array", "Creates an array. See also arrayCompact.", "a"),
            section_with_hash_and_body(
                "arrayCompact",
                "Removes consecutive duplicate elements from an array.",
                "b",
            ),
        ];

        let results = search_sections_in_memory(&sections, "arrayCompact", 10);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].section_title, "arrayCompact");
        assert!(results[0].excerpt.contains("Removes consecutive duplicate"));

        let compact_results = search_sections_in_memory(&sections, "array compact", 10);
        assert_eq!(compact_results[0].section_title, "arrayCompact");

        let exact_results = search_sections_in_memory(&sections, "array", 10);
        assert_eq!(exact_results[0].section_title, "array");
    }

    #[test]
    fn clickhouse_docs_make_excerpt_is_utf8_safe() {
        let text = "Пример 😀 ".repeat(80);
        let excerpt = make_excerpt(&text);
        assert!(excerpt.chars().count() <= 220);
        assert!(excerpt.starts_with("Пример 😀"));
    }

    #[test]
    fn clickhouse_docs_diff_sections_detects_added_changed_removed() {
        let old = vec![
            section_with_hash("array", "h1"),
            section_with_hash("arrayCompact", "h2"),
        ];
        let new = vec![
            section_with_hash("array", "h1"),
            section_with_hash("arrayCompact", "h3"),
            section_with_hash("arrayConcat", "h4"),
        ];

        let changes = diff_sections(&old, &new);
        assert!(changes
            .iter()
            .any(|c| c.change_type == "changed" && c.title == "arrayCompact"));
        assert!(changes
            .iter()
            .any(|c| c.change_type == "added" && c.title == "arrayConcat"));
        assert!(!changes.iter().any(|c| c.change_type == "removed"));

        let removed = diff_sections(&new, &old);
        assert!(removed
            .iter()
            .any(|c| c.change_type == "removed" && c.title == "arrayConcat"));
    }

    #[test]
    fn clickhouse_docs_search_excerpt_is_utf8_safe() {
        let body = "Кириллица и эмодзи 🙂 перед функцией arrayCompact(arr), потом текст.";
        let excerpt = excerpt_for_tokens(body, &["array".to_string(), "compact".to_string()]);
        assert!(excerpt.contains("arrayCompact"));
    }

    #[test]
    fn clickhouse_docs_fallback_sources_include_dictionary_and_encoding_functions() {
        let urls = DOC_SOURCES
            .iter()
            .map(|source| source.source_url)
            .collect::<Vec<_>>();

        assert!(urls
            .iter()
            .any(|url| url.ends_with("/ext-dict-functions.md")));
        assert!(urls
            .iter()
            .any(|url| url.ends_with("/encoding-functions.md")));
    }

    #[test]
    fn clickhouse_docs_github_contents_discovers_function_sources() {
        let raw = r#"[
          {
            "name": "ext-dict-functions.md",
            "path": "i18n/ru/docusaurus-plugin-content-docs/current/sql-reference/functions/ext-dict-functions.md",
            "type": "file",
            "download_url": "https://raw.githubusercontent.com/ClickHouse/clickhouse-docs/main/i18n/ru/docusaurus-plugin-content-docs/current/sql-reference/functions/ext-dict-functions.md"
          },
          {
            "name": "geo",
            "path": "i18n/ru/docusaurus-plugin-content-docs/current/sql-reference/functions/geo",
            "type": "dir",
            "download_url": null
          },
          {
            "name": "encoding-functions.md",
            "path": "i18n/ru/docusaurus-plugin-content-docs/current/sql-reference/functions/encoding-functions.md",
            "type": "file",
            "download_url": "https://raw.githubusercontent.com/ClickHouse/clickhouse-docs/main/i18n/ru/docusaurus-plugin-content-docs/current/sql-reference/functions/encoding-functions.md"
          }
        ]"#;

        let sources = parse_github_contents_sources(raw).expect("parse contents");
        let urls = sources
            .iter()
            .map(|source| source.source_url.as_str())
            .collect::<Vec<_>>();

        assert!(urls
            .iter()
            .any(|url| url.ends_with("/ext-dict-functions.md")));
        assert!(urls
            .iter()
            .any(|url| url.ends_with("/encoding-functions.md")));
        assert!(sources.iter().any(|source| source
            .public_url
            .ends_with("/sql-reference/functions/encoding-functions")));
    }

    fn section_with_hash(title: &str, hash: &str) -> ClickHouseDocSection {
        section_with_hash_and_body(title, title, hash)
    }

    fn section_with_hash_and_body(title: &str, body: &str, hash: &str) -> ClickHouseDocSection {
        let normalized_search_text = normalize_for_search(&format!(
            "{} {} {} {}",
            title, "Array Functions", "Functions / Arrays", body
        ));
        ClickHouseDocSection {
            id: 0,
            page_id: 1,
            category: "Functions / Arrays".to_string(),
            page_title: "Array Functions".to_string(),
            title: title.to_string(),
            slug: slugify(title),
            section_path: slugify(title),
            level: 2,
            excerpt: make_excerpt(body),
            body: body.to_string(),
            normalized_search_text,
            content_hash: hash.to_string(),
        }
    }
}
