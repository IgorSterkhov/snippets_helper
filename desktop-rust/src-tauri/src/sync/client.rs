use reqwest::Client;
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Mutex;

use super::schema::SYNCED_TABLES;
use crate::db::queries;

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

        let client = builder
            .build()
            .map_err(|e| format!("build http client: {e}"))?;

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
                (
                    table,
                    Value::Array(names.into_iter().map(Value::String).collect()),
                )
            })
            .collect();

        Ok(json!({ "pushed": pushed, "total": total }))
    }

    fn collect_pending(
        &self,
        conn: &rusqlite::Connection,
    ) -> Result<
        (
            Map<String, Value>,
            HashMap<String, Vec<String>>,
            HashMap<String, Vec<String>>,
        ),
        String,
    > {
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
                let obj = row_data.as_object_mut().ok_or("row is not an object")?;

                let display_name = Self::extract_display_name(table, obj);

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
                            folder_uuid.map(Value::String).unwrap_or(Value::Null),
                        );
                    }
                }

                if table == "tasks" {
                    if let Some(category_id) = obj.get("category_id").and_then(|v| v.as_i64()) {
                        let category_uuid =
                            queries::get_task_category_uuid_by_id(conn, category_id)
                                .map_err(|e| format!("get_task_category_uuid_by_id: {e}"))?;
                        obj.insert(
                            "category_uuid".to_string(),
                            category_uuid.map(Value::String).unwrap_or(Value::Null),
                        );
                    }
                    if let Some(status_id) = obj.get("status_id").and_then(|v| v.as_i64()) {
                        let status_uuid = queries::get_task_status_uuid_by_id(conn, status_id)
                            .map_err(|e| format!("get_task_status_uuid_by_id: {e}"))?;
                        obj.insert(
                            "status_uuid".to_string(),
                            status_uuid.map(Value::String).unwrap_or(Value::Null),
                        );
                    }
                }

                if table == "task_checkboxes" {
                    if let Some(task_id) = obj.get("task_id").and_then(|v| v.as_i64()) {
                        let task_uuid = queries::get_task_uuid_by_id(conn, task_id)
                            .map_err(|e| format!("get_task_uuid_by_id: {e}"))?;
                        obj.insert(
                            "task_uuid".to_string(),
                            task_uuid.map(Value::String).unwrap_or(Value::Null),
                        );
                    }
                    if let Some(parent_id) = obj.get("parent_id").and_then(|v| v.as_i64()) {
                        let parent_uuid = queries::get_task_checkbox_uuid_by_id(conn, parent_id)
                            .map_err(|e| format!("get_task_checkbox_uuid_by_id: {e}"))?;
                        obj.insert(
                            "parent_uuid".to_string(),
                            parent_uuid.map(Value::String).unwrap_or(Value::Null),
                        );
                    }
                }

                if table == "task_links" {
                    if let Some(task_id) = obj.get("task_id").and_then(|v| v.as_i64()) {
                        let task_uuid = queries::get_task_uuid_by_id(conn, task_id)
                            .map_err(|e| format!("get_task_uuid_by_id: {e}"))?;
                        obj.insert(
                            "task_uuid".to_string(),
                            task_uuid.map(Value::String).unwrap_or(Value::Null),
                        );
                    }
                }

                if table == "finance_items" {
                    let Some(plan_id) = obj.get("plan_id").and_then(|v| v.as_i64()) else {
                        continue;
                    };
                    let plan_uuid = queries::get_finance_plan_uuid_by_id(conn, plan_id)
                        .map_err(|e| format!("get_finance_plan_uuid_by_id: {e}"))?;
                    let Some(plan_uuid) = plan_uuid else {
                        continue;
                    };
                    obj.insert("plan_uuid".to_string(), Value::String(plan_uuid));

                    if let Some(parent_id) = obj.get("parent_id").and_then(|v| v.as_i64()) {
                        let parent_uuid = queries::get_finance_item_uuid_by_id(conn, parent_id)
                            .map_err(|e| format!("get_finance_item_uuid_by_id: {e}"))?;
                        obj.insert(
                            "parent_uuid".to_string(),
                            parent_uuid.map(Value::String).unwrap_or(Value::Null),
                        );
                    } else {
                        obj.insert("parent_uuid".to_string(), Value::Null);
                    }
                }

                if table == "finance_payments" {
                    let Some(plan_id) = obj.get("plan_id").and_then(|v| v.as_i64()) else {
                        continue;
                    };
                    let Some(item_id) = obj.get("item_id").and_then(|v| v.as_i64()) else {
                        continue;
                    };
                    let plan_uuid = queries::get_finance_plan_uuid_by_id(conn, plan_id)
                        .map_err(|e| format!("get_finance_plan_uuid_by_id: {e}"))?;
                    let item_uuid = queries::get_finance_item_uuid_by_id(conn, item_id)
                        .map_err(|e| format!("get_finance_item_uuid_by_id: {e}"))?;
                    let (Some(plan_uuid), Some(item_uuid)) = (plan_uuid, item_uuid) else {
                        continue;
                    };
                    obj.insert("plan_uuid".to_string(), Value::String(plan_uuid));
                    obj.insert("item_uuid".to_string(), Value::String(item_uuid));
                }

                table_names.push(display_name);
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
        let accepted_by_table = result.get("accepted_uuids").and_then(|v| v.as_object());

        // Mark synced and purge deleted
        for (table, rows) in changes {
            let rows_arr = match rows.as_array() {
                Some(a) => a,
                None => continue,
            };
            let accepted_for_table: Option<HashSet<String>> = accepted_by_table
                .and_then(|by_table| by_table.get(table))
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                });
            let requires_explicit_acceptance =
                table == "finance_plans" || table == "finance_items" || table == "finance_payments";
            let is_accepted = |uuid: &str| -> bool {
                if let Some(accepted) = &accepted_for_table {
                    accepted.contains(uuid)
                } else {
                    !requires_explicit_acceptance
                }
            };

            // Collect (uuid, updated_at) for non-deleted, non-conflicted rows
            let synced: Vec<(String, String)> = rows_arr
                .iter()
                .filter(|r| {
                    let uuid = r.get("uuid").and_then(|v| v.as_str()).unwrap_or("");
                    let is_del = r
                        .get("is_deleted")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);
                    !is_del && !conflict_uuids.contains(uuid) && is_accepted(uuid)
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
                    .filter(|u| !conflict_uuids.contains(u.as_str()) && is_accepted(u.as_str()))
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
        let (pulled_names, skipped_counts) = {
            let conn = db.lock().unwrap_or_else(|e| e.into_inner());
            self.apply_pull(&conn, computer_id, &result)?
        };

        // Build detailed result
        let total: usize = pulled_names.values().map(|v| v.len()).sum();
        let pulled: Map<String, Value> = pulled_names
            .into_iter()
            .map(|(table, names)| {
                (
                    table,
                    Value::Array(names.into_iter().map(Value::String).collect()),
                )
            })
            .collect();

        let skipped: Map<String, Value> = skipped_counts
            .into_iter()
            .map(|(table, count)| (table, Value::Number(count.into())))
            .collect();

        Ok(json!({ "pulled": pulled, "total": total, "skipped": skipped }))
    }

    fn apply_pull(
        &self,
        conn: &rusqlite::Connection,
        computer_id: &str,
        result: &Value,
    ) -> Result<(HashMap<String, Vec<String>>, HashMap<String, usize>), String> {
        let mut pulled_names: HashMap<String, Vec<String>> = HashMap::new();
        let mut skipped_counts: HashMap<String, usize> = HashMap::new();

        if let Some(changes) = result.get("changes").and_then(|v| v.as_object()) {
            for &table in SYNCED_TABLES {
                let Some(rows_val) = changes.get(table) else {
                    continue;
                };
                let rows = match rows_val.as_array() {
                    Some(arr) if !arr.is_empty() => arr,
                    _ => continue,
                };

                let mut rows_owned: Vec<Value> = rows.clone();
                let mut deferred_checkbox_parent_updates: Vec<(String, String, String)> =
                    Vec::new();
                let mut deferred_finance_parent_updates: Vec<(String, String, String)> =
                    Vec::new();

                // Collect display names from pulled rows
                let mut table_names: Vec<String> = Vec::new();
                for row in &rows_owned {
                    if let Some(obj) = row.as_object() {
                        table_names.push(Self::extract_display_name(table, obj));
                    }
                }
                if !table_names.is_empty() {
                    pulled_names.insert(table.to_string(), table_names);
                }

                // Ensure user_id is set on every row (server may not include it)
                // Read user_id from auth settings
                let user_id = queries::get_setting(conn, computer_id, "sync_user_id")
                    .ok()
                    .flatten()
                    .unwrap_or_default();
                for row in &mut rows_owned {
                    if let Some(obj) = row.as_object_mut() {
                        if !obj.contains_key("user_id")
                            || obj.get("user_id").map(|v| v.is_null()).unwrap_or(false)
                        {
                            obj.insert("user_id".to_string(), Value::String(user_id.clone()));
                        }
                    }
                }

                // Resolve folder_uuid -> folder_id for notes
                if table == "notes" {
                    for row in &mut rows_owned {
                        if let Some(obj) = row.as_object_mut() {
                            if let Some(fuuid) = obj
                                .get("folder_uuid")
                                .and_then(|v| v.as_str())
                                .map(String::from)
                            {
                                let folder_id = queries::get_folder_id_by_uuid(conn, &fuuid)
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

                if table == "tasks" {
                    for row in &mut rows_owned {
                        if let Some(obj) = row.as_object_mut() {
                            if let Some(uuid) = obj
                                .get("category_uuid")
                                .and_then(|v| v.as_str())
                                .map(String::from)
                            {
                                let id = queries::get_task_category_id_by_uuid(conn, &uuid)
                                    .map_err(|e| format!("get_task_category_id_by_uuid: {e}"))?;
                                obj.insert(
                                    "category_id".to_string(),
                                    id.map(|v| Value::Number(v.into())).unwrap_or(Value::Null),
                                );
                            }
                            if let Some(uuid) = obj
                                .get("status_uuid")
                                .and_then(|v| v.as_str())
                                .map(String::from)
                            {
                                let id = queries::get_task_status_id_by_uuid(conn, &uuid)
                                    .map_err(|e| format!("get_task_status_id_by_uuid: {e}"))?;
                                obj.insert(
                                    "status_id".to_string(),
                                    id.map(|v| Value::Number(v.into())).unwrap_or(Value::Null),
                                );
                            }
                        }
                    }
                }

                if table == "task_checkboxes" {
                    let before = rows_owned.len();
                    rows_owned.retain_mut(|row| {
                        let Some(obj) = row.as_object_mut() else {
                            return false;
                        };
                        let Some(task_uuid) = obj
                            .get("task_uuid")
                            .and_then(|v| v.as_str())
                            .map(String::from)
                        else {
                            return false;
                        };
                        let task_id = queries::get_task_id_by_uuid(conn, &task_uuid)
                            .ok()
                            .flatten();
                        let Some(task_id) = task_id else {
                            return false;
                        };
                        obj.insert("task_id".to_string(), Value::Number(task_id.into()));
                        if let Some(parent_uuid) = obj
                            .get("parent_uuid")
                            .and_then(|v| v.as_str())
                            .map(String::from)
                        {
                            if let (Some(uuid), Some(updated_at)) = (
                                obj.get("uuid").and_then(|v| v.as_str()),
                                obj.get("updated_at").and_then(|v| v.as_str()),
                            ) {
                                deferred_checkbox_parent_updates.push((
                                    uuid.to_string(),
                                    parent_uuid.clone(),
                                    updated_at.to_string(),
                                ));
                            }
                            let parent_id =
                                queries::get_task_checkbox_id_by_uuid(conn, &parent_uuid)
                                    .ok()
                                    .flatten();
                            obj.insert(
                                "parent_id".to_string(),
                                parent_id
                                    .map(|v| Value::Number(v.into()))
                                    .unwrap_or(Value::Null),
                            );
                        }
                        true
                    });
                    let skipped = before.saturating_sub(rows_owned.len());
                    if skipped > 0 {
                        skipped_counts.insert(table.to_string(), skipped);
                    }
                }

                if table == "task_links" {
                    let before = rows_owned.len();
                    rows_owned.retain_mut(|row| {
                        let Some(obj) = row.as_object_mut() else {
                            return false;
                        };
                        let Some(task_uuid) = obj
                            .get("task_uuid")
                            .and_then(|v| v.as_str())
                            .map(String::from)
                        else {
                            return false;
                        };
                        let task_id = queries::get_task_id_by_uuid(conn, &task_uuid)
                            .ok()
                            .flatten();
                        let Some(task_id) = task_id else {
                            return false;
                        };
                        obj.insert("task_id".to_string(), Value::Number(task_id.into()));
                        true
                    });
                    let skipped = before.saturating_sub(rows_owned.len());
                    if skipped > 0 {
                        skipped_counts.insert(table.to_string(), skipped);
                    }
                }

                if table == "finance_items" {
                    let before = rows_owned.len();
                    rows_owned.retain_mut(|row| {
                        let Some(obj) = row.as_object_mut() else {
                            return false;
                        };
                        let Some(plan_uuid) = obj
                            .get("plan_uuid")
                            .and_then(|v| v.as_str())
                            .map(String::from)
                        else {
                            return false;
                        };
                        let plan_id = queries::get_finance_plan_id_by_uuid(conn, &plan_uuid)
                            .ok()
                            .flatten();
                        let Some(plan_id) = plan_id else {
                            return false;
                        };
                        obj.insert("plan_id".to_string(), Value::Number(plan_id.into()));

                        if let Some(parent_uuid) = obj
                            .get("parent_uuid")
                            .and_then(|v| v.as_str())
                            .map(String::from)
                        {
                            if let (Some(uuid), Some(updated_at)) = (
                                obj.get("uuid").and_then(|v| v.as_str()),
                                obj.get("updated_at").and_then(|v| v.as_str()),
                            ) {
                                deferred_finance_parent_updates.push((
                                    uuid.to_string(),
                                    parent_uuid.clone(),
                                    updated_at.to_string(),
                                ));
                            }
                            let parent_id = queries::get_finance_item_id_by_uuid(conn, &parent_uuid)
                                .ok()
                                .flatten()
                                .filter(|parent_id| {
                                    queries::get_finance_item_plan_id_by_id(conn, *parent_id)
                                        .ok()
                                        .flatten()
                                        == Some(plan_id)
                                });
                            obj.insert(
                                "parent_id".to_string(),
                                parent_id
                                    .map(|v| Value::Number(v.into()))
                                    .unwrap_or(Value::Null),
                            );
                        } else {
                            obj.insert("parent_id".to_string(), Value::Null);
                        }
                        true
                    });
                    let skipped = before.saturating_sub(rows_owned.len());
                    if skipped > 0 {
                        skipped_counts.insert(table.to_string(), skipped);
                    }
                }

                if table == "finance_payments" {
                    let before = rows_owned.len();
                    rows_owned.retain_mut(|row| {
                        let Some(obj) = row.as_object_mut() else {
                            return false;
                        };
                        let Some(plan_uuid) = obj
                            .get("plan_uuid")
                            .and_then(|v| v.as_str())
                            .map(String::from)
                        else {
                            return false;
                        };
                        let Some(item_uuid) = obj
                            .get("item_uuid")
                            .and_then(|v| v.as_str())
                            .map(String::from)
                        else {
                            return false;
                        };
                        let plan_id = queries::get_finance_plan_id_by_uuid(conn, &plan_uuid)
                            .ok()
                            .flatten();
                        let item_id = queries::get_finance_item_id_by_uuid(conn, &item_uuid)
                            .ok()
                            .flatten();
                        let (Some(plan_id), Some(item_id)) = (plan_id, item_id) else {
                            return false;
                        };
                        let item_plan_id = queries::get_finance_item_plan_id_by_id(conn, item_id)
                            .ok()
                            .flatten();
                        if item_plan_id != Some(plan_id) {
                            return false;
                        }
                        obj.insert("plan_id".to_string(), Value::Number(plan_id.into()));
                        obj.insert("item_id".to_string(), Value::Number(item_id.into()));
                        true
                    });
                    let skipped = before.saturating_sub(rows_owned.len());
                    if skipped > 0 {
                        skipped_counts.insert(table.to_string(), skipped);
                    }
                }

                queries::upsert_from_server(conn, table, &rows_owned)
                    .map_err(|e| format!("upsert_from_server({table}): {e}"))?;

                if table == "task_checkboxes" {
                    for (uuid, parent_uuid, updated_at) in &deferred_checkbox_parent_updates {
                        let parent_id = queries::get_task_checkbox_id_by_uuid(conn, parent_uuid)
                            .map_err(|e| format!("get_task_checkbox_id_by_uuid: {e}"))?;
                        if let Some(parent_id) = parent_id {
                            queries::set_task_checkbox_parent_if_not_newer(
                                conn, uuid, parent_id, updated_at,
                            )
                            .map_err(|e| format!("set_task_checkbox_parent_if_not_newer: {e}"))?;
                        }
                    }
                }

                if table == "finance_items" {
                    for (uuid, parent_uuid, updated_at) in &deferred_finance_parent_updates {
                        let parent_id = queries::get_finance_item_id_by_uuid(conn, parent_uuid)
                            .map_err(|e| format!("get_finance_item_id_by_uuid: {e}"))?;
                        let child_id = queries::get_finance_item_id_by_uuid(conn, uuid)
                            .map_err(|e| format!("get_finance_item_id_by_uuid: {e}"))?;
                        if let (Some(parent_id), Some(child_id)) = (parent_id, child_id) {
                            let parent_plan_id =
                                queries::get_finance_item_plan_id_by_id(conn, parent_id)
                                    .map_err(|e| format!("get_finance_item_plan_id_by_id: {e}"))?;
                            let child_plan_id =
                                queries::get_finance_item_plan_id_by_id(conn, child_id)
                                    .map_err(|e| format!("get_finance_item_plan_id_by_id: {e}"))?;
                            if parent_plan_id.is_some() && parent_plan_id == child_plan_id {
                                queries::set_finance_item_parent_if_not_newer(
                                    conn, uuid, parent_id, updated_at,
                                )
                                .map_err(|e| {
                                    format!("set_finance_item_parent_if_not_newer: {e}")
                                })?;
                            }
                        }
                    }
                }
            }
        }

        // Save server_time as last_sync_at
        if let Some(server_time) = result.get("server_time").and_then(|v| v.as_str()) {
            queries::set_setting(conn, computer_id, "last_sync_at", server_time)
                .map_err(|e| format!("save last_sync_at: {e}"))?;
        }

        Ok((pulled_names, skipped_counts))
    }

    fn truncate_display_name(val: &str) -> String {
        if val.chars().count() > 40 {
            let head: String = val.chars().take(37).collect();
            format!("{}...", head)
        } else {
            val.to_string()
        }
    }

    /// Extract a human-readable display name from a row for sync logging.
    fn extract_display_name(table: &str, obj: &Map<String, Value>) -> String {
        let name_field = match table {
            "shortcuts"
            | "note_folders"
            | "snippet_tags"
            | "task_categories"
            | "task_statuses"
            | "finance_plans"
            | "finance_items" => "name",
            "finance_payments" => "month_key",
            "notes" | "tasks" => "title",
            "task_checkboxes" => "text",
            "sql_macrosing_templates" => "template_name",
            "obfuscation_mappings" => "session_name",
            _ => "",
        };

        if !name_field.is_empty() {
            if let Some(val) = obj.get(name_field).and_then(|v| v.as_str()) {
                if !val.is_empty() {
                    // Truncate by CHARS, not bytes — otherwise a multibyte
                    // UTF-8 (e.g. Cyrillic) name slices mid-char and panics.
                    return Self::truncate_display_name(val);
                }
            }
        }

        // sql_table_analyzer_templates: use truncated template_text
        if table == "sql_table_analyzer_templates" {
            if let Some(val) = obj.get("template_text").and_then(|v| v.as_str()) {
                if !val.is_empty() {
                    // Char-based truncation (see above) — template_text may
                    // contain Cyrillic comments etc.
                    return Self::truncate_display_name(val);
                }
            }
        }

        if table == "task_links" {
            if let Some(label) = obj
                .get("label")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
            {
                return Self::truncate_display_name(label);
            }
            if let Some(url) = obj
                .get("url")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
            {
                return Self::truncate_display_name(url);
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
    use crate::db::run_migrations;
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
        let obj = json!({ "uuid": "abcdef0123456789" })
            .as_object()
            .unwrap()
            .clone();
        assert_eq!(SyncClient::extract_display_name("tasks", &obj), "abcdef01");
    }

    #[test]
    fn extract_display_name_handles_task_tables_with_utf8() {
        let task = json!({ "title": "Задача синхронизации чеклистов между устройствами" })
            .as_object()
            .unwrap()
            .clone();
        let got = SyncClient::extract_display_name("tasks", &task);
        assert!(got.ends_with("..."));
        assert!(got.chars().count() <= 40);

        let checkbox =
            json!({ "text": "Проверить вложенный чекбокс синхронизации ✅✅✅✅✅✅✅✅✅✅" })
                .as_object()
                .unwrap()
                .clone();
        let got = SyncClient::extract_display_name("task_checkboxes", &checkbox);
        assert!(got.ends_with("..."));
        assert!(got.chars().count() <= 40);

        let link = json!({ "label": "Трекер", "url": "https://example.test/TASK-1" })
            .as_object()
            .unwrap()
            .clone();
        assert_eq!(
            SyncClient::extract_display_name("task_links", &link),
            "Трекер"
        );
    }

    #[test]
    fn apply_pull_uses_sync_order_for_task_relationships() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();

        let client = SyncClient::new("http://localhost", "test-key", None).unwrap();
        let result = json!({
            "changes": {
                "task_checkboxes": [
                    {
                        "uuid": "11111111-1111-4111-8111-111111111111",
                        "task_uuid": "33333333-3333-4333-8333-333333333333",
                        "parent_uuid": null,
                        "text": "parent",
                        "is_checked": 0,
                        "sort_order": 1,
                        "created_at": "2026-05-23T00:00:03",
                        "updated_at": "2026-05-23T00:00:03",
                        "is_deleted": false
                    },
                    {
                        "uuid": "22222222-2222-4222-8222-222222222222",
                        "task_uuid": "33333333-3333-4333-8333-333333333333",
                        "parent_uuid": "11111111-1111-4111-8111-111111111111",
                        "text": "child",
                        "is_checked": 0,
                        "sort_order": 2,
                        "created_at": "2026-05-23T00:00:04",
                        "updated_at": "2026-05-23T00:00:04",
                        "is_deleted": false
                    }
                ],
                "task_links": [
                    {
                        "uuid": "44444444-4444-4444-8444-444444444444",
                        "task_uuid": "33333333-3333-4333-8333-333333333333",
                        "url": "https://example.test/task",
                        "label": "Task",
                        "sort_order": 1,
                        "created_at": "2026-05-23T00:00:05",
                        "updated_at": "2026-05-23T00:00:05",
                        "is_deleted": false
                    }
                ],
                "tasks": [
                    {
                        "uuid": "33333333-3333-4333-8333-333333333333",
                        "title": "Synced task",
                        "category_uuid": "55555555-5555-4555-8555-555555555555",
                        "status_uuid": "66666666-6666-4666-8666-666666666666",
                        "is_pinned": 0,
                        "bg_color": null,
                        "tracker_url": null,
                        "notes_md": "",
                        "sort_order": 1,
                        "created_at": "2026-05-23T00:00:02",
                        "updated_at": "2026-05-23T00:00:02",
                        "is_deleted": false
                    }
                ],
                "task_categories": [
                    {
                        "uuid": "55555555-5555-4555-8555-555555555555",
                        "name": "Work",
                        "color": "#388bfd",
                        "sort_order": 1,
                        "created_at": "2026-05-23T00:00:01",
                        "updated_at": "2026-05-23T00:00:01",
                        "is_deleted": false
                    }
                ],
                "task_statuses": [
                    {
                        "uuid": "66666666-6666-4666-8666-666666666666",
                        "name": "Next",
                        "color": "#3fb950",
                        "sort_order": 1,
                        "created_at": "2026-05-23T00:00:01",
                        "updated_at": "2026-05-23T00:00:01",
                        "is_deleted": false
                    }
                ]
            },
            "server_time": "2026-05-23T00:00:10"
        });

        let (_pulled, skipped) = client.apply_pull(&conn, "pc-test", &result).unwrap();
        assert!(skipped.is_empty());

        let task_id = queries::get_task_id_by_uuid(&conn, "33333333-3333-4333-8333-333333333333")
            .unwrap()
            .unwrap();
        let link_task_id: i64 = conn
            .query_row(
                "SELECT task_id FROM task_links WHERE uuid = ?1",
                ["44444444-4444-4444-8444-444444444444"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(link_task_id, task_id);

        let parent_id =
            queries::get_task_checkbox_id_by_uuid(&conn, "11111111-1111-4111-8111-111111111111")
                .unwrap()
                .unwrap();
        let child_parent_id: Option<i64> = conn
            .query_row(
                "SELECT parent_id FROM task_checkboxes WHERE uuid = ?1",
                ["22222222-2222-4222-8222-222222222222"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(child_parent_id, Some(parent_id));
    }

    #[test]
    fn apply_pull_maps_finance_uuid_relationships() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();

        let client = SyncClient::new("http://localhost", "test-key", None).unwrap();
        let result = json!({
            "changes": {
                "finance_items": [
                    {
                        "uuid": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                        "plan_uuid": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                        "parent_uuid": null,
                        "name": "Housing",
                        "amount_cents": 10000,
                        "due_day": 3,
                        "due_date": null,
                        "note": "",
                        "sort_order": 0,
                        "created_at": "2026-06-11T00:00:02",
                        "updated_at": "2026-06-11T00:00:02",
                        "is_deleted": false
                    },
                    {
                        "uuid": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                        "plan_uuid": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                        "parent_uuid": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                        "name": "Internet",
                        "amount_cents": 50000,
                        "due_day": 21,
                        "due_date": null,
                        "note": "",
                        "sort_order": 0,
                        "created_at": "2026-06-11T00:00:03",
                        "updated_at": "2026-06-11T00:00:03",
                        "is_deleted": false
                    }
                ],
                "finance_plans": [
                    {
                        "uuid": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                        "name": "Regular payments",
                        "currency": "RUB",
                        "kind": "monthly",
                        "sort_order": 0,
                        "created_at": "2026-06-11T00:00:01",
                        "updated_at": "2026-06-11T00:00:01",
                        "is_deleted": false
                    }
                ],
                "finance_payments": [
                    {
                        "uuid": "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                        "plan_uuid": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                        "item_uuid": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                        "month_key": "2026-06",
                        "is_paid": true,
                        "paid_amount_cents": 45000,
                        "note": "paid",
                        "created_at": "2026-06-11T00:00:04",
                        "updated_at": "2026-06-11T00:00:04",
                        "is_deleted": false
                    }
                ]
            },
            "server_time": "2026-06-11T00:00:10"
        });

        let (_pulled, skipped) = client.apply_pull(&conn, "pc-test", &result).unwrap();
        assert!(skipped.is_empty());

        let plan_id = queries::get_finance_plan_id_by_uuid(
            &conn,
            "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        )
        .unwrap()
        .unwrap();
        let parent_id = queries::get_finance_item_id_by_uuid(
            &conn,
            "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        )
        .unwrap()
        .unwrap();
        let child: (i64, Option<i64>) = conn
            .query_row(
                "SELECT plan_id, parent_id FROM finance_items WHERE uuid = ?1",
                ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(child.0, plan_id);
        assert_eq!(child.1, Some(parent_id));

        let child_id =
            queries::get_finance_item_id_by_uuid(&conn, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
                .unwrap()
                .unwrap();
        let payment: (i64, i64, String, i64, i64) = conn
            .query_row(
                "SELECT plan_id, item_id, month_key, is_paid, paid_amount_cents
                 FROM finance_payments WHERE uuid = ?1",
                ["dddddddd-dddd-4ddd-8ddd-dddddddddddd"],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(
            payment,
            (plan_id, child_id, "2026-06".to_string(), 1, 45000)
        );
    }
}
