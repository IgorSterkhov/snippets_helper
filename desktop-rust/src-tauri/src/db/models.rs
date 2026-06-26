use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};

// ── Sync tables ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Shortcut {
    pub id: Option<i64>,
    pub name: String,
    pub value: String,
    pub description: String,
    pub links: String,
    pub obsidian_note: String,
    pub is_pinned: bool,
    pub pinned_sort_order: i32,
    pub uuid: String,
    pub updated_at: NaiveDateTime,
    pub sync_status: String,
    pub user_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteFolder {
    pub id: Option<i64>,
    pub name: String,
    pub sort_order: i32,
    pub parent_id: Option<i64>,
    pub uuid: String,
    pub updated_at: NaiveDateTime,
    pub sync_status: String,
    pub user_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
    pub id: Option<i64>,
    pub folder_id: i64,
    pub title: String,
    pub content: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub is_pinned: bool,
    pub pinned_sort_order: i32,
    pub uuid: String,
    pub sync_status: String,
    pub user_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SqlTableAnalyzerTemplate {
    pub id: Option<i64>,
    pub template_text: String,
    pub uuid: String,
    pub updated_at: NaiveDateTime,
    pub sync_status: String,
    pub user_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SqlMacrosingTemplate {
    pub id: Option<i64>,
    pub template_name: String,
    pub template_text: String,
    pub placeholders_config: String,
    pub combination_mode: String,
    pub separator: String,
    pub uuid: String,
    pub updated_at: NaiveDateTime,
    pub sync_status: String,
    pub user_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnippetTag {
    pub id: Option<i64>,
    pub name: String,
    pub patterns: String, // JSON array: ["af_*", "airflow_*"]
    pub color: String,    // hex: "#f0883e"
    pub sort_order: i32,
    pub uuid: String,
    pub updated_at: NaiveDateTime,
    pub sync_status: String,
    pub user_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObfuscationMapping {
    pub id: Option<i64>,
    pub session_name: String,
    pub entity_type: String,
    pub original_value: String,
    pub obfuscated_value: String,
    pub created_at: NaiveDateTime,
    pub uuid: String,
    pub updated_at: NaiveDateTime,
    pub sync_status: String,
    pub user_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskCategory {
    pub id: Option<i64>,
    pub name: String,
    pub color: String,
    pub sort_order: i32,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub uuid: String,
    pub sync_status: String,
    pub user_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskStatus {
    pub id: Option<i64>,
    pub name: String,
    pub color: String,
    pub sort_order: i32,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub uuid: String,
    pub sync_status: String,
    pub user_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: Option<i64>,
    pub title: String,
    pub category_id: Option<i64>,
    pub status_id: Option<i64>,
    pub is_pinned: bool,
    pub bg_color: Option<String>,
    pub tracker_url: Option<String>,
    pub notes_md: String,
    pub sort_order: i32,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub uuid: String,
    pub sync_status: String,
    pub user_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskCheckbox {
    pub id: Option<i64>,
    pub task_id: i64,
    pub parent_id: Option<i64>,
    pub text: String,
    pub is_checked: bool,
    pub sort_order: i32,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub uuid: String,
    pub sync_status: String,
    pub user_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskLink {
    pub id: Option<i64>,
    pub task_id: i64,
    pub url: String,
    pub label: Option<String>,
    pub sort_order: i32,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub uuid: String,
    pub sync_status: String,
    pub user_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FinancePlan {
    pub id: Option<i64>,
    pub name: String,
    pub currency: String,
    pub kind: String,
    pub sort_order: i32,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub uuid: String,
    pub sync_status: String,
    pub user_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FinanceItem {
    pub id: Option<i64>,
    pub plan_id: i64,
    pub parent_id: Option<i64>,
    pub name: String,
    pub amount_cents: i64,
    pub due_day: Option<i32>,
    pub due_date: Option<String>,
    pub note: String,
    pub sort_order: i32,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub uuid: String,
    pub sync_status: String,
    pub user_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FinancePayment {
    pub id: Option<i64>,
    pub plan_id: i64,
    pub item_id: i64,
    pub month_key: String,
    pub is_paid: bool,
    pub paid_amount_cents: i64,
    pub note: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub uuid: String,
    pub sync_status: String,
    pub user_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FinanceImportBatch {
    pub id: Option<i64>,
    pub source: String,
    pub file_name: String,
    pub total_rows: i64,
    pub imported_rows: i64,
    pub duplicate_rows: i64,
    pub error_rows: i64,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub expense_total_cents: i64,
    pub income_total_cents: i64,
    pub currency: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub uuid: String,
    pub sync_status: String,
    pub user_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FinanceTransaction {
    pub id: Option<i64>,
    pub source: String,
    pub source_fingerprint: String,
    pub import_batch_id: Option<i64>,
    pub operation_at: String,
    pub payment_date: String,
    pub card_mask: String,
    pub status: String,
    pub amount_cents: i64,
    pub currency: String,
    pub operation_amount_cents: i64,
    pub operation_currency: String,
    pub payment_amount_cents: i64,
    pub payment_currency: String,
    pub cashback_cents: Option<i64>,
    pub bank_category: String,
    pub mcc: String,
    pub description: String,
    pub bonuses_cents: Option<i64>,
    pub invest_rounding_cents: Option<i64>,
    pub rounded_amount_cents: Option<i64>,
    pub raw_json: String,
    pub rules_locked: bool,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub uuid: String,
    pub sync_status: String,
    pub user_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FinanceTransactionAllocation {
    pub id: Option<i64>,
    pub transaction_id: i64,
    pub plan_id: i64,
    pub item_id: Option<i64>,
    pub assigned_by: String,
    pub rule_id: Option<i64>,
    pub is_active: bool,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub uuid: String,
    pub sync_status: String,
    pub user_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FinanceMappingRule {
    pub id: Option<i64>,
    pub name: String,
    pub is_enabled: bool,
    pub priority: i32,
    pub match_mode: String,
    pub conditions_json: String,
    pub target_plan_id: i64,
    pub target_item_id: Option<i64>,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub uuid: String,
    pub sync_status: String,
    pub user_id: String,
}

// ── Local tables ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSetting {
    pub computer_id: String,
    pub setting_key: String,
    pub setting_value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupersetSetting {
    pub computer_id: String,
    pub setting_key: String,
    pub setting_value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitTag {
    pub id: Option<i64>,
    pub computer_id: String,
    pub tag_name: String,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitHistory {
    pub id: Option<i64>,
    pub computer_id: String,
    pub created_at: NaiveDateTime,
    pub task_link: String,
    pub task_id: String,
    pub commit_type: String,
    pub object_category: String,
    pub object_value: String,
    pub message: String,
    pub selected_tags: String,
    pub mr_link: String,
    pub test_report: String,
    pub prod_report: String,
    pub transfer_connect: String,
    pub test_dag: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecCategory {
    pub id: Option<i64>,
    pub name: String,
    pub sort_order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecCommand {
    pub id: Option<i64>,
    pub category_id: i64,
    pub name: String,
    pub command: String,
    pub description: String,
    pub sort_order: i32,
    pub hide_after_run: bool,
    #[serde(default = "default_shell")]
    pub shell: String, // "host" | "wsl"
    #[serde(default)]
    pub wsl_distro: Option<String>, // None => use WSL default distro
}

fn default_shell() -> String {
    "host".into()
}

// ── Tests ────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    #[test]
    fn test_shortcut_serialization_roundtrip() {
        let shortcut = Shortcut {
            id: Some(1),
            name: "test".into(),
            value: "value".into(),
            description: "desc".into(),
            links: "[]".into(),
            obsidian_note: "".into(),
            is_pinned: false,
            pinned_sort_order: 0,
            uuid: "abc-123".into(),
            updated_at: Utc::now().naive_utc(),
            sync_status: "pending".into(),
            user_id: "user1".into(),
        };

        let json = serde_json::to_string(&shortcut).unwrap();
        let deserialized: Shortcut = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.name, "test");
        assert_eq!(deserialized.id, Some(1));
    }

    #[test]
    fn test_note_serialization_roundtrip() {
        let note = Note {
            id: Some(1),
            folder_id: 10,
            title: "My Note".into(),
            content: "Content here".into(),
            created_at: Utc::now().naive_utc(),
            updated_at: Utc::now().naive_utc(),
            is_pinned: true,
            pinned_sort_order: 3,
            uuid: "note-uuid".into(),
            sync_status: "synced".into(),
            user_id: "user1".into(),
        };

        let json = serde_json::to_string(&note).unwrap();
        let deserialized: Note = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.title, "My Note");
        assert!(deserialized.is_pinned);
        assert_eq!(deserialized.folder_id, 10);
    }

    #[test]
    fn test_exec_command_serialization_roundtrip() {
        let cmd = ExecCommand {
            id: None,
            category_id: 5,
            name: "Deploy".into(),
            command: "make deploy".into(),
            description: "Deploy to prod".into(),
            sort_order: 1,
            hide_after_run: true,
            shell: "host".into(),
            wsl_distro: None,
        };

        let json = serde_json::to_string(&cmd).unwrap();
        let deserialized: ExecCommand = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.name, "Deploy");
        assert!(deserialized.hide_after_run);
        assert_eq!(deserialized.id, None);
    }

    #[test]
    fn test_app_setting_serialization_roundtrip() {
        let setting = AppSetting {
            computer_id: "pc-1".into(),
            setting_key: "theme".into(),
            setting_value: "dark".into(),
        };

        let json = serde_json::to_string(&setting).unwrap();
        let deserialized: AppSetting = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.setting_key, "theme");
        assert_eq!(deserialized.setting_value, "dark");
    }
}
