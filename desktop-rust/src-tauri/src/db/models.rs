use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};

// ── Sync tables ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Shortcut {
    pub id: Option<i64>,
    pub name: String,
    pub value: String,
    pub description: String,
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
