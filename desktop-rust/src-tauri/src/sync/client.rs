use reqwest::Client;
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Mutex;

use crate::db::queries;
use super::schema::SYNCED_TABLES;

pub struct SyncClient {
    client: Client,
    api_url: String,
    api_key: String,
}

impl SyncClient {
    /// Build a new SyncClient.
    ///
    /// * If `ca_cert` points to an existing file its contents are used as a
    ///   custom root certificate.
    /// * Otherwise, when the URL is HTTPS, invalid (self-signed) certs are
    ///   accepted -- matching the Python client behaviour.
    pub fn new(api_url: &str, api_key: &str, ca_cert: Option<&str>) -> Result<Self, String> {
        let mut builder = Client::builder().timeout(std::time::Duration::from_secs(30));

        let mut used_ca = false;
        if let Some(path) = ca_cert {
            if Path::new(path).is_file() {
                let pem = std::fs::read(path).map_err(|e| format!("read CA cert: {e}"))?;
                let cert = reqwest::Certificate::from_pem(&pem)
                    .map_err(|e| format!("parse CA cert: {e}"))?;
                builder = builder.add_root_certificate(cert);
                used_ca = true;
            }
        }

        if !used_ca && api_url.starts_with("https://") {
            builder = builder.danger_accept_invalid_certs(true);
        }

        let client = builder.build().map_err(|e| format!("build http client: {e}"))?;

        Ok(Self {
            client,
            api_url: api_url.trim_end_matches('/').to_string(),
            api_key: api_key.to_string(),
        })
    }

    // ── Push ────────────────────────────────────────────────────

    pub async fn push(
        &self,
        db: &Mutex<rusqlite::Connection>,
        _computer_id: &str,
    ) -> Result<Value, String> {
        // Phase 1: collect pending rows (lock held briefly)
        let (changes, deleted_uuids, pending_names) = {
            let conn = db.lock().unwrap_or_else(|e| e.into_inner());
            self.collect_pending(&conn)?
        };

        if changes.is_empty() {
            return Ok(json!({ "pushed": {}, "total": 0 }));
        }

        // Phase 2: HTTP push (no lock held)
        let body = json!({ "changes": changes });

        let resp = self
            .client
            .post(format!("{}/v1/sync/push", self.api_url))
            .bearer_auth(&self.api_key)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("push request: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!("push failed: HTTP {}", resp.status()));
        }

        let result: Value = resp.json().await.map_err(|e| format!("push json: {e}"))?;

        // Phase 3: post-process (lock held briefly)
        {
            let conn = db.lock().unwrap_or_else(|e| e.into_inner());
            self.process_push_response(&conn, &changes, &deleted_uuids, &result)?;
        }

        // Build detailed result
        let total: usize = pending_names.values().map(|v| v.len()).sum();
        let pushed: Map<String, Value> = pending_names
            .into_iter()
            .map(|(table, names)| {
                (table, Value::Array(names.into_iter().map(Value::String).collect()))
            })
            .collect();

        Ok(json!({ "pushed": pushed, "total": total }))
    }

    fn collect_pending(
        &self,
        conn: &rusqlite::Connection,
    ) -> Result<(Map<String, Value>, HashMap<String, Vec<String>>, HashMap<String, Vec<String>>), String> {
        let mut changes: Map<String, Value> = Map::new();
        let mut deleted_uuids: HashMap<String, Vec<String>> = HashMap::new();
        let mut pending_names: HashMap<String, Vec<String>> = HashMap::new();

        for &table in SYNCED_TABLES {
            let pending = queries::get_pending_rows(conn, table)
                .map_err(|e| format!("get_pending_rows({table}): {e}"))?;
            if pending.is_empty() {
                continue;
            }

            let mut rows_to_push: Vec<Value> = Vec::new();
            let mut table_deleted: Vec<String> = Vec::new();
            let mut table_names: Vec<String> = Vec::new();

            for row in pending {
                let mut row_data = row.clone();
                let obj = row_data
                    .as_object_mut()
                    .ok_or("row is not an object")?;

                // Extract display name for the log
                let display_name = Self::extract_display_name(table, obj);
                table_names.push(display_name);

                let is_deleted = obj
                    .get("sync_status")
                    .and_then(|v| v.as_str())
                    .map(|s| s == "deleted")
                    .unwrap_or(false);

                // Remove sync_status -- server doesn't need it
                obj.remove("sync_status");

                obj.insert("is_deleted".to_string(), Value::Bool(is_deleted));

                if is_deleted {
                    if let Some(uuid) = obj.get("uuid").and_then(|v| v.as_str()) {
                        table_deleted.push(uuid.to_string());
                    }
                }

                // Resolve folder_id -> folder_uuid for notes
                if table == "notes" {
                    if let Some(fid) = obj.get("folder_id").and_then(|v| v.as_i64()) {
                        let folder_uuid = queries::get_folder_uuid_by_id(conn, fid)
                            .map_err(|e| format!("get_folder_uuid_by_id: {e}"))?;
                        obj.insert(
                            "folder_uuid".to_string(),
                            folder_uuid
                                .map(Value::String)
                                .unwrap_or(Value::Null),
                        );
                    }
                }

                rows_to_push.push(row_data);
            }

            if !rows_to_push.is_empty() {
                changes.insert(table.to_string(), Value::Array(rows_to_push));
                if !table_deleted.is_empty() {
                    deleted_uuids.insert(table.to_string(), table_deleted);
                }
                if !table_names.is_empty() {
                    pending_names.insert(table.to_string(), table_names);
                }
            }
        }

        Ok((changes, deleted_uuids, pending_names))
    }

    fn process_push_response(
        &self,
        conn: &rusqlite::Connection,
        changes: &Map<String, Value>,
        deleted_uuids: &std::collections::HashMap<String, Vec<String>>,
        result: &Value,
    ) -> Result<(), String> {
        // Collect conflict UUIDs
        let conflict_uuids: HashSet<String> = result
            .get("conflicts")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|c| c.get("uuid").and_then(|u| u.as_str()).map(String::from))
                    .collect()
            })
            .unwrap_or_default();

        // Mark synced and purge deleted
        for (table, rows) in changes {
            let rows_arr = match rows.as_array() {
                Some(a) => a,
                None => continue,
            };

            // Collect (uuid, updated_at) for non-deleted, non-conflicted rows
            let synced: Vec<(String, String)> = rows_arr
                .iter()
                .filter(|r| {
                    let uuid = r.get("uuid").and_then(|v| v.as_str()).unwrap_or("");
                    let is_del = r.get("is_deleted").and_then(|v| v.as_bool()).unwrap_or(false);
                    !is_del && !conflict_uuids.contains(uuid)
                })
                .filter_map(|r| {
                    let uuid = r.get("uuid").and_then(|v| v.as_str())?.to_string();
                    let updated = r.get("updated_at").and_then(|v| v.as_str())?.to_string();
                    Some((uuid, updated))
                })
                .collect();

            if !synced.is_empty() {
                queries::mark_as_synced(conn, table, &synced)
                    .map_err(|e| format!("mark_as_synced({table}): {e}"))?;
            }

            // Purge confirmed deleted rows
            if let Some(del) = deleted_uuids.get(table.as_str()) {
                let confirmed: Vec<String> = del
                    .iter()
                    .filter(|u| !conflict_uuids.contains(u.as_str()))
                    .cloned()
                    .collect();
                if !confirmed.is_empty() {
                    queries::purge_deleted(conn, table, &confirmed)
                        .map_err(|e| format!("purge_deleted({table}): {e}"))?;
                }
            }
        }

        Ok(())
    }

    // ── Pull ────────────────────────────────────────────────────

    pub async fn pull(
        &self,
        db: &Mutex<rusqlite::Connection>,
        computer_id: &str,
    ) -> Result<Value, String> {
        // Phase 1: read last_sync_at (lock held briefly)
        let last_sync = {
            let conn = db.lock().unwrap_or_else(|e| e.into_inner());
            queries::get_setting(&conn, computer_id, "last_sync_at")
                .map_err(|e| format!("get last_sync_at: {e}"))?
        };

        // Phase 2: HTTP pull (no lock held)
        // Treat empty string as null (server expects null or valid timestamp)
        let last_sync_value = match &last_sync {
            Some(s) if s.is_empty() => Value::Null,
            Some(s) => Value::String(s.clone()),
            None => Value::Null,
        };
        let body = json!({ "last_sync_at": last_sync_value });

        let resp = self
            .client
            .post(format!("{}/v1/sync/pull", self.api_url))
            .bearer_auth(&self.api_key)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("pull request: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!("pull failed: HTTP {}", resp.status()));
        }

        let result: Value = resp.json().await.map_err(|e| format!("pull json: {e}"))?;

        // Phase 3: apply changes and collect pulled names (lock held briefly)
        let pulled_names = {
            let conn = db.lock().unwrap_or_else(|e| e.into_inner());
            self.apply_pull(&conn, computer_id, &result)?
        };

        // Build detailed result
        let total: usize = pulled_names.values().map(|v| v.len()).sum();
        let pulled: Map<String, Value> = pulled_names
            .into_iter()
            .map(|(table, names)| {
                (table, Value::Array(names.into_iter().map(Value::String).collect()))
            })
            .collect();

        Ok(json!({ "pulled": pulled, "total": total }))
    }

    fn apply_pull(
        &self,
        conn: &rusqlite::Connection,
        computer_id: &str,
        result: &Value,
    ) -> Result<HashMap<String, Vec<String>>, String> {
        let mut pulled_names: HashMap<String, Vec<String>> = HashMap::new();

        if let Some(changes) = result.get("changes").and_then(|v| v.as_object()) {
            for (table, rows_val) in changes {
                if !SYNCED_TABLES.contains(&table.as_str()) {
                    continue;
                }
                let rows = match rows_val.as_array() {
                    Some(arr) if !arr.is_empty() => arr,
                    _ => continue,
                };

                let mut rows_owned: Vec<Value> = rows.clone();

                // Collect display names from pulled rows
                let mut table_names: Vec<String> = Vec::new();
                for row in &rows_owned {
                    if let Some(obj) = row.as_object() {
                        table_names.push(Self::extract_display_name(table, obj));
                    }
                }
                if !table_names.is_empty() {
                    pulled_names.insert(table.clone(), table_names);
                }

                // Ensure user_id is set on every row (server may not include it)
                // Read user_id from auth settings
                let user_id = queries::get_setting(conn, computer_id, "sync_user_id")
                    .ok().flatten().unwrap_or_default();
                for row in &mut rows_owned {
                    if let Some(obj) = row.as_object_mut() {
                        if !obj.contains_key("user_id") || obj.get("user_id").map(|v| v.is_null()).unwrap_or(false) {
                            obj.insert("user_id".to_string(), Value::String(user_id.clone()));
                        }
                    }
                }

                // Resolve folder_uuid -> folder_id for notes
                if table == "notes" {
                    for row in &mut rows_owned {
                        if let Some(obj) = row.as_object_mut() {
                            if let Some(fuuid) =
                                obj.get("folder_uuid").and_then(|v| v.as_str()).map(String::from)
                            {
                                let folder_id =
                                    queries::get_folder_id_by_uuid(conn, &fuuid)
                                        .map_err(|e| format!("get_folder_id_by_uuid: {e}"))?;
                                obj.insert(
                                    "folder_id".to_string(),
                                    folder_id
                                        .map(|id| Value::Number(id.into()))
                                        .unwrap_or(Value::Null),
                                );
                            } else if !obj.contains_key("folder_id") {
                                obj.insert("folder_id".to_string(), Value::Null);
                            }
                        }
                    }
                }

                queries::upsert_from_server(conn, table, &rows_owned)
                    .map_err(|e| format!("upsert_from_server({table}): {e}"))?;
            }
        }

        // Save server_time as last_sync_at
        if let Some(server_time) = result.get("server_time").and_then(|v| v.as_str()) {
            queries::set_setting(conn, computer_id, "last_sync_at", server_time)
                .map_err(|e| format!("save last_sync_at: {e}"))?;
        }

        Ok(pulled_names)
    }

    /// Extract a human-readable display name from a row for sync logging.
    fn extract_display_name(table: &str, obj: &Map<String, Value>) -> String {
        let name_field = match table {
            "shortcuts" | "note_folders" | "snippet_tags" => "name",
            "notes" => "title",
            "sql_macrosing_templates" => "template_name",
            "obfuscation_mappings" => "session_name",
            _ => "",
        };

        if !name_field.is_empty() {
            if let Some(val) = obj.get(name_field).and_then(|v| v.as_str()) {
                if !val.is_empty() {
                    // Truncate by CHARS, not bytes — otherwise a multibyte
                    // UTF-8 (e.g. Cyrillic) name slices mid-char and panics.
                    let truncated = if val.chars().count() > 40 {
                        let head: String = val.chars().take(37).collect();
                        format!("{}...", head)
                    } else {
                        val.to_string()
                    };
                    return truncated;
                }
            }
        }

        // sql_table_analyzer_templates: use truncated template_text
        if table == "sql_table_analyzer_templates" {
            if let Some(val) = obj.get("template_text").and_then(|v| v.as_str()) {
                if !val.is_empty() {
                    // Char-based truncation (see above) — template_text may
                    // contain Cyrillic comments etc.
                    let truncated = if val.chars().count() > 40 {
                        let head: String = val.chars().take(37).collect();
                        format!("{}...", head)
                    } else {
                        val.to_string()
                    };
                    return truncated;
                }
            }
        }

        // Fallback: truncated uuid
        if let Some(uuid) = obj.get("uuid").and_then(|v| v.as_str()) {
            return uuid[..8.min(uuid.len())].to_string();
        }

        "unknown".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extract_display_name_truncates_cyrillic_without_panic() {
        // Cyrillic chars are 2 bytes each, so byte-based slicing at 37
        // would land mid-char. This must NOT panic.
        let title = "Голосовой ввод задач и списков для будущих доработок";
        let obj = json!({ "title": title }).as_object().unwrap().clone();
        let got = SyncClient::extract_display_name("notes", &obj);
        assert!(got.ends_with("..."));
        assert!(got.chars().count() <= 40); // 37 chars + "..."
    }

    #[test]
    fn extract_display_name_passes_short_names_through() {
        let obj = json!({ "name": "short" }).as_object().unwrap().clone();
        assert_eq!(SyncClient::extract_display_name("shortcuts", &obj), "short");
    }

    #[test]
    fn extract_display_name_falls_back_to_uuid() {
        let obj = json!({ "uuid": "abcdef0123456789" }).as_object().unwrap().clone();
        assert_eq!(SyncClient::extract_display_name("tasks", &obj), "abcdef01");
    }
}
