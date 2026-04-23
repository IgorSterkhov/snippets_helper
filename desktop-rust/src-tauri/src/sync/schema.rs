/// Tables that participate in sync with the remote API.
pub const SYNCED_TABLES: &[&str] = &[
    "shortcuts",
    "sql_table_analyzer_templates",
    "sql_macrosing_templates",
    "note_folders",
    "notes",
    "obfuscation_mappings",
    "snippet_tags",
    "task_categories",
    "task_statuses",
    "tasks",
    "task_checkboxes",
    "task_links",
];

/// Columns present on every synced table (uuid, updated_at, sync_status, user_id).
pub const SYNC_FIELDS: &[&str] = &["uuid", "updated_at", "sync_status", "user_id"];

/// Returns the data-only columns for a synced table (excluding sync fields and `id`).
/// These match the Python `sync_schema.SYNCED_TABLES[table]['data_fields']` minus `id`.
pub fn data_columns(table: &str) -> &'static [&'static str] {
    match table {
        "shortcuts" => &["name", "value", "description", "links", "obsidian_note"],
        "sql_table_analyzer_templates" => &["template_text"],
        "sql_macrosing_templates" => &[
            "template_name",
            "template_text",
            "placeholders_config",
            "combination_mode",
            "separator",
        ],
        "note_folders" => &["name", "sort_order", "parent_id"],
        "notes" => &["folder_id", "title", "content", "created_at", "is_pinned"],
        "obfuscation_mappings" => &[
            "session_name",
            "entity_type",
            "original_value",
            "obfuscated_value",
            "created_at",
        ],
        "snippet_tags" => &["name", "patterns", "color", "sort_order"],
        "task_categories" => &["name", "color", "sort_order", "created_at"],
        "task_statuses" => &["name", "color", "sort_order", "created_at"],
        "tasks" => &[
            "title",
            "category_id",
            "status_id",
            "is_pinned",
            "bg_color",
            "tracker_url",
            "notes_md",
            "sort_order",
            "created_at",
        ],
        "task_checkboxes" => &[
            "task_id",
            "parent_id",
            "text",
            "is_checked",
            "sort_order",
            "created_at",
        ],
        "task_links" => &["task_id", "url", "label", "sort_order", "created_at"],
        _ => &[],
    }
}

/// All columns stored in a synced table (data + sync fields), excluding `id`.
pub fn all_columns(table: &str) -> Vec<&'static str> {
    let mut cols: Vec<&str> = data_columns(table).to_vec();
    // sync fields except sync_status (which is managed locally)
    cols.extend_from_slice(&["uuid", "updated_at", "user_id"]);
    cols
}
