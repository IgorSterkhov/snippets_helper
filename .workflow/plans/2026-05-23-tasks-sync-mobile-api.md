# Tasks Sync + Mobile Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server, desktop sync, and Android mobile support so Tasks synchronize correctly across devices.

**Architecture:** The server sync contract stores canonical relationships as UUID fields. Desktop keeps its existing integer-ID Tasks UI and maps IDs to UUIDs during push and UUIDs back to IDs during pull, following the existing Notes pattern. Mobile stores UUID relationships directly and joins/display-filters through those UUID fields.

**Tech Stack:** FastAPI + SQLAlchemy + Alembic + PostgreSQL, Tauri/Rust + rusqlite + reqwest, React Native + SQLite + Jest.

---

## Scope Check

This is one integrated plan because API, desktop sync, and mobile sync all depend on the same Tasks table contract. The work is split into independently testable phases: API schema, desktop mapping, mobile storage/sync, mobile UI, then end-to-end verification.

## File Map

- Modify `api/models.py`: add Tasks ORM models and register them in `TABLE_MODELS`.
- Create `api/alembic/versions/006_add_tasks_sync_tables.py`: PostgreSQL migration for Tasks tables and indexes.
- Read/check `desktop-rust/src-tauri/src/sync/schema.rs`: keep local integer relationship fields for desktop storage; inject UUID relationship fields only in the JSON sync payload.
- Modify `desktop-rust/src-tauri/src/db/queries.rs`: add Tasks UUID lookup helpers and tests.
- Modify `desktop-rust/src-tauri/src/sync/client.rs`: add push/pull mapping for Tasks relationships and readable display names.
- Modify `mobile/src/db/database.js`: create Tasks SQLite tables and migrations.
- Create `mobile/src/db/taskRepo.js`: mobile Tasks CRUD, sync builders, modified-row queries.
- Modify `mobile/src/sync/syncService.js`: include Tasks tables in pull, push, and pending counts.
- Create `mobile/src/screens/Tasks/TaskListScreen.js`: mobile list, filters, create entry point.
- Create `mobile/src/screens/Tasks/TaskEditorScreen.js`: mobile full task editor.
- Create `mobile/src/screens/Tasks/TaskManageScreen.js`: mobile category/status management.
- Modify `mobile/src/navigation/AppNavigator.js`: add Tasks tab and stack.
- Add/modify Jest tests under `mobile/__tests__/db/` and `mobile/__tests__/sync/`.
- Modify release/help files only during release execution, not during the implementation phases unless user requests release.

---

## Task 1: API Tasks Models and Migration

**Files:**
- Modify: `api/models.py`
- Create: `api/alembic/versions/006_add_tasks_sync_tables.py`

- [ ] **Step 1: Add failing API schema smoke test through migration inspection**

Run this command before editing and confirm it does not find Tasks models:

```bash
grep -n "class Task" api/models.py
```

Expected before implementation: no `TaskCategory`, `TaskStatus`, `Task`, `TaskCheckbox`, or `TaskLink` classes.

- [ ] **Step 2: Add SQLAlchemy models**

In `api/models.py`, add five ORM classes after `SnippetTag`:

```python
class TaskCategory(Base):
    __tablename__ = "task_categories"

    uuid: Mapped[uuid_mod.UUID] = mapped_column(Uuid, primary_key=True, default=uuid_mod.uuid4)
    user_id: Mapped[uuid_mod.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    id: Mapped[int | None] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String, nullable=False)
    color: Mapped[str] = mapped_column(String, nullable=False, default="#8b949e")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)

    __table_args__ = (Index("idx_task_categories_user_updated", "user_id", "updated_at"),)


class TaskStatus(Base):
    __tablename__ = "task_statuses"

    uuid: Mapped[uuid_mod.UUID] = mapped_column(Uuid, primary_key=True, default=uuid_mod.uuid4)
    user_id: Mapped[uuid_mod.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    id: Mapped[int | None] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String, nullable=False)
    color: Mapped[str] = mapped_column(String, nullable=False, default="#8b949e")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)

    __table_args__ = (Index("idx_task_statuses_user_updated", "user_id", "updated_at"),)


class Task(Base):
    __tablename__ = "tasks"

    uuid: Mapped[uuid_mod.UUID] = mapped_column(Uuid, primary_key=True, default=uuid_mod.uuid4)
    user_id: Mapped[uuid_mod.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    id: Mapped[int | None] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String, nullable=False)
    category_id: Mapped[int | None] = mapped_column(Integer)
    category_uuid: Mapped[uuid_mod.UUID | None] = mapped_column(Uuid)
    status_id: Mapped[int | None] = mapped_column(Integer)
    status_uuid: Mapped[uuid_mod.UUID | None] = mapped_column(Uuid)
    is_pinned: Mapped[int] = mapped_column(Integer, default=0)
    bg_color: Mapped[str | None] = mapped_column(String)
    tracker_url: Mapped[str | None] = mapped_column(Text)
    notes_md: Mapped[str] = mapped_column(Text, default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)

    __table_args__ = (Index("idx_tasks_user_updated", "user_id", "updated_at"),)


class TaskCheckbox(Base):
    __tablename__ = "task_checkboxes"

    uuid: Mapped[uuid_mod.UUID] = mapped_column(Uuid, primary_key=True, default=uuid_mod.uuid4)
    user_id: Mapped[uuid_mod.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    id: Mapped[int | None] = mapped_column(Integer)
    task_id: Mapped[int | None] = mapped_column(Integer)
    task_uuid: Mapped[uuid_mod.UUID | None] = mapped_column(Uuid)
    parent_id: Mapped[int | None] = mapped_column(Integer)
    parent_uuid: Mapped[uuid_mod.UUID | None] = mapped_column(Uuid)
    text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    is_checked: Mapped[int] = mapped_column(Integer, default=0)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)

    __table_args__ = (Index("idx_task_checkboxes_user_updated", "user_id", "updated_at"),)


class TaskLink(Base):
    __tablename__ = "task_links"

    uuid: Mapped[uuid_mod.UUID] = mapped_column(Uuid, primary_key=True, default=uuid_mod.uuid4)
    user_id: Mapped[uuid_mod.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    id: Mapped[int | None] = mapped_column(Integer)
    task_id: Mapped[int | None] = mapped_column(Integer)
    task_uuid: Mapped[uuid_mod.UUID | None] = mapped_column(Uuid)
    url: Mapped[str] = mapped_column(Text, nullable=False, default="")
    label: Mapped[str | None] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)

    __table_args__ = (Index("idx_task_links_user_updated", "user_id", "updated_at"),)
```

Update `TABLE_MODELS`:

```python
    "task_categories": TaskCategory,
    "task_statuses": TaskStatus,
    "tasks": Task,
    "task_checkboxes": TaskCheckbox,
    "task_links": TaskLink,
```

- [ ] **Step 3: Add Alembic migration**

Create `api/alembic/versions/006_add_tasks_sync_tables.py` with revision `006`, down_revision `005`, and `op.create_table` calls matching the model fields above. Use index names:

```text
idx_task_categories_user_updated
idx_task_statuses_user_updated
idx_tasks_user_updated
idx_task_checkboxes_user_updated
idx_task_links_user_updated
```

Use `sa.Uuid()` for UUID columns, `sa.DateTime()` for timestamps, `sa.Text()` for long text, and `sa.String()` for names/colors.

- [ ] **Step 4: Verify Python syntax**

Run:

```bash
python3 -m py_compile api/models.py api/alembic/versions/006_add_tasks_sync_tables.py
```

Expected: command exits 0 with no output.

- [ ] **Step 5: Verify table registration**

Run:

```bash
python3 - <<'PY'
from api.models import TABLE_MODELS
for name in ["task_categories", "task_statuses", "tasks", "task_checkboxes", "task_links"]:
    assert name in TABLE_MODELS, name
print("tasks models registered")
PY
```

Expected: `tasks models registered`.

---

## Task 2: Desktop Sync Contract Check and UUID Lookup Helpers

**Files:**
- Read/check: `desktop-rust/src-tauri/src/sync/schema.rs`
- Modify: `desktop-rust/src-tauri/src/db/queries.rs`

- [ ] **Step 1: Verify desktop sync schema stays local-ID based**

Read `desktop-rust/src-tauri/src/sync/schema.rs` and keep Tasks data columns local-ID based:

```rust
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
```

Do not add `category_uuid`, `status_uuid`, `task_uuid`, or `parent_uuid` to this file unless the desktop SQLite schema is also changed. The intended pattern is the existing Notes approach: `folder_uuid` is injected into the push payload and consumed on pull without being a local desktop column.

- [ ] **Step 2: Add lookup helper tests first**

Append tests in the existing `#[cfg(test)] mod tests` in `desktop-rust/src-tauri/src/db/queries.rs`:

```rust
#[test]
fn test_task_uuid_lookup_helpers() {
    let conn = init_test_db();
    let cat = create_task_category(&conn, "Sync Cat", "#388bfd").unwrap();
    let status = create_task_status(&conn, "Sync Status", "#3fb950").unwrap();
    let task = create_task(&conn, "Sync Task", cat.id, status.id).unwrap();
    let cb = create_task_checkbox(&conn, task.id.unwrap(), None, "Check me").unwrap();

    assert_eq!(get_task_category_uuid_by_id(&conn, cat.id.unwrap()).unwrap(), Some(cat.uuid.clone()));
    assert_eq!(get_task_status_uuid_by_id(&conn, status.id.unwrap()).unwrap(), Some(status.uuid.clone()));
    assert_eq!(get_task_uuid_by_id(&conn, task.id.unwrap()).unwrap(), Some(task.uuid.clone()));
    assert_eq!(get_task_checkbox_uuid_by_id(&conn, cb.id.unwrap()).unwrap(), Some(cb.uuid.clone()));

    assert_eq!(get_task_category_id_by_uuid(&conn, &cat.uuid).unwrap(), cat.id);
    assert_eq!(get_task_status_id_by_uuid(&conn, &status.uuid).unwrap(), status.id);
    assert_eq!(get_task_id_by_uuid(&conn, &task.uuid).unwrap(), task.id);
    assert_eq!(get_task_checkbox_id_by_uuid(&conn, &cb.uuid).unwrap(), cb.id);
}
```

- [ ] **Step 3: Run helper test and confirm failure**

Run:

```bash
cd desktop-rust/src-tauri && cargo test db::queries::tests::test_task_uuid_lookup_helpers
```

Expected before implementation: compile failure for missing helper functions.

- [ ] **Step 4: Implement helper functions**

Add helper functions near the existing folder UUID helpers in `desktop-rust/src-tauri/src/db/queries.rs`:

```rust
fn get_uuid_by_id(conn: &Connection, table: &str, id: i64) -> Result<Option<String>> {
    validate_table(table)?;
    let sql = format!("SELECT uuid FROM {table} WHERE id = ?1");
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query_map(params![id], |row| row.get(0))?;
    match rows.next() {
        Some(val) => Ok(Some(val?)),
        None => Ok(None),
    }
}

fn get_id_by_uuid(conn: &Connection, table: &str, uuid: &str) -> Result<Option<i64>> {
    validate_table(table)?;
    let sql = format!("SELECT id FROM {table} WHERE uuid = ?1");
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query_map(params![uuid], |row| row.get(0))?;
    match rows.next() {
        Some(val) => Ok(Some(val?)),
        None => Ok(None),
    }
}

pub fn get_task_category_uuid_by_id(conn: &Connection, id: i64) -> Result<Option<String>> {
    get_uuid_by_id(conn, "task_categories", id)
}

pub fn get_task_status_uuid_by_id(conn: &Connection, id: i64) -> Result<Option<String>> {
    get_uuid_by_id(conn, "task_statuses", id)
}

pub fn get_task_uuid_by_id(conn: &Connection, id: i64) -> Result<Option<String>> {
    get_uuid_by_id(conn, "tasks", id)
}

pub fn get_task_checkbox_uuid_by_id(conn: &Connection, id: i64) -> Result<Option<String>> {
    get_uuid_by_id(conn, "task_checkboxes", id)
}

pub fn get_task_category_id_by_uuid(conn: &Connection, uuid: &str) -> Result<Option<i64>> {
    get_id_by_uuid(conn, "task_categories", uuid)
}

pub fn get_task_status_id_by_uuid(conn: &Connection, uuid: &str) -> Result<Option<i64>> {
    get_id_by_uuid(conn, "task_statuses", uuid)
}

pub fn get_task_id_by_uuid(conn: &Connection, uuid: &str) -> Result<Option<i64>> {
    get_id_by_uuid(conn, "tasks", uuid)
}

pub fn get_task_checkbox_id_by_uuid(conn: &Connection, uuid: &str) -> Result<Option<i64>> {
    get_id_by_uuid(conn, "task_checkboxes", uuid)
}
```

- [ ] **Step 5: Run helper test**

Run:

```bash
cd desktop-rust/src-tauri && cargo test db::queries::tests::test_task_uuid_lookup_helpers
```

Expected: test passes.

---

## Task 3: Desktop Push/Pull Relationship Mapping

**Files:**
- Modify: `desktop-rust/src-tauri/src/sync/client.rs`
- Test: `desktop-rust/src-tauri/src/sync/client.rs`

- [ ] **Step 1: Add display-name tests first**

In `desktop-rust/src-tauri/src/sync/client.rs`, extend the existing test module:

```rust
#[test]
fn extract_display_name_handles_task_tables_with_utf8() {
    let task = json!({ "title": "Задача синхронизации чеклистов между устройствами" })
        .as_object().unwrap().clone();
    let got = SyncClient::extract_display_name("tasks", &task);
    assert!(got.ends_with("..."));
    assert!(got.chars().count() <= 40);

    let checkbox = json!({ "text": "Проверить вложенный чекбокс ✅✅✅✅✅✅✅✅✅✅" })
        .as_object().unwrap().clone();
    let got = SyncClient::extract_display_name("task_checkboxes", &checkbox);
    assert!(got.ends_with("..."));
    assert!(got.chars().count() <= 40);

    let link = json!({ "label": "Трекер", "url": "https://example.test/TASK-1" })
        .as_object().unwrap().clone();
    assert_eq!(SyncClient::extract_display_name("task_links", &link), "Трекер");
}
```

- [ ] **Step 2: Run display-name test and confirm failure**

Run:

```bash
cd desktop-rust/src-tauri && cargo test sync::client::tests::extract_display_name_handles_task_tables_with_utf8
```

Expected before implementation: failure or fallback output for Tasks tables.

- [ ] **Step 3: Implement push mapping**

In `collect_pending`, after the existing `if table == "notes"` mapping block, add:

```rust
if table == "tasks" {
    if let Some(category_id) = obj.get("category_id").and_then(|v| v.as_i64()) {
        let category_uuid = queries::get_task_category_uuid_by_id(conn, category_id)
            .map_err(|e| format!("get_task_category_uuid_by_id: {e}"))?;
        obj.insert("category_uuid".to_string(), category_uuid.map(Value::String).unwrap_or(Value::Null));
    }
    if let Some(status_id) = obj.get("status_id").and_then(|v| v.as_i64()) {
        let status_uuid = queries::get_task_status_uuid_by_id(conn, status_id)
            .map_err(|e| format!("get_task_status_uuid_by_id: {e}"))?;
        obj.insert("status_uuid".to_string(), status_uuid.map(Value::String).unwrap_or(Value::Null));
    }
}

if table == "task_checkboxes" {
    if let Some(task_id) = obj.get("task_id").and_then(|v| v.as_i64()) {
        let task_uuid = queries::get_task_uuid_by_id(conn, task_id)
            .map_err(|e| format!("get_task_uuid_by_id: {e}"))?;
        obj.insert("task_uuid".to_string(), task_uuid.map(Value::String).unwrap_or(Value::Null));
    }
    if let Some(parent_id) = obj.get("parent_id").and_then(|v| v.as_i64()) {
        let parent_uuid = queries::get_task_checkbox_uuid_by_id(conn, parent_id)
            .map_err(|e| format!("get_task_checkbox_uuid_by_id: {e}"))?;
        obj.insert("parent_uuid".to_string(), parent_uuid.map(Value::String).unwrap_or(Value::Null));
    }
}

if table == "task_links" {
    if let Some(task_id) = obj.get("task_id").and_then(|v| v.as_i64()) {
        let task_uuid = queries::get_task_uuid_by_id(conn, task_id)
            .map_err(|e| format!("get_task_uuid_by_id: {e}"))?;
        obj.insert("task_uuid".to_string(), task_uuid.map(Value::String).unwrap_or(Value::Null));
    }
}
```

These fields are added to the row JSON object after `get_pending_rows` reads the local integer columns. They are not stored in desktop SQLite.

- [ ] **Step 4: Implement pull mapping**

In `apply_pull`, after the existing Notes `folder_uuid -> folder_id` block and before `upsert_from_server`, add mapping for Tasks:

```rust
if table == "tasks" {
    for row in &mut rows_owned {
        if let Some(obj) = row.as_object_mut() {
            if let Some(uuid) = obj.get("category_uuid").and_then(|v| v.as_str()).map(String::from) {
                let id = queries::get_task_category_id_by_uuid(conn, &uuid)
                    .map_err(|e| format!("get_task_category_id_by_uuid: {e}"))?;
                obj.insert("category_id".to_string(), id.map(|v| Value::Number(v.into())).unwrap_or(Value::Null));
            }
            if let Some(uuid) = obj.get("status_uuid").and_then(|v| v.as_str()).map(String::from) {
                let id = queries::get_task_status_id_by_uuid(conn, &uuid)
                    .map_err(|e| format!("get_task_status_id_by_uuid: {e}"))?;
                obj.insert("status_id".to_string(), id.map(|v| Value::Number(v.into())).unwrap_or(Value::Null));
            }
        }
    }
}

if table == "task_checkboxes" {
    rows_owned.retain_mut(|row| {
        let Some(obj) = row.as_object_mut() else { return false; };
        let Some(task_uuid) = obj.get("task_uuid").and_then(|v| v.as_str()).map(String::from) else { return false; };
        let task_id = queries::get_task_id_by_uuid(conn, &task_uuid).ok().flatten();
        let Some(task_id) = task_id else { return false; };
        obj.insert("task_id".to_string(), Value::Number(task_id.into()));
        if let Some(parent_uuid) = obj.get("parent_uuid").and_then(|v| v.as_str()).map(String::from) {
            let parent_id = queries::get_task_checkbox_id_by_uuid(conn, &parent_uuid).ok().flatten();
            obj.insert("parent_id".to_string(), parent_id.map(|v| Value::Number(v.into())).unwrap_or(Value::Null));
        }
        true
    });
}

if table == "task_links" {
    rows_owned.retain_mut(|row| {
        let Some(obj) = row.as_object_mut() else { return false; };
        let Some(task_uuid) = obj.get("task_uuid").and_then(|v| v.as_str()).map(String::from) else { return false; };
        let task_id = queries::get_task_id_by_uuid(conn, &task_uuid).ok().flatten();
        let Some(task_id) = task_id else { return false; };
        obj.insert("task_id".to_string(), Value::Number(task_id.into()));
        true
    });
}
```

`upsert_from_server` will ignore the incoming UUID relationship fields because `sync/schema.rs` keeps only local integer relationship columns for desktop storage.

If skipped-row counts are added to the sync result, keep them as local counters in `apply_pull` and include them in the returned JSON from `pull`.

- [ ] **Step 5: Update display name extraction**

In `extract_display_name`, add:

```rust
"tasks" => "title",
"task_categories" | "task_statuses" => "name",
"task_checkboxes" => "text",
```

Then add `task_links` fallback before UUID fallback:

```rust
if table == "task_links" {
    if let Some(label) = obj.get("label").and_then(|v| v.as_str()).filter(|s| !s.is_empty()) {
        return Self::truncate_display_name(label);
    }
    if let Some(url) = obj.get("url").and_then(|v| v.as_str()).filter(|s| !s.is_empty()) {
        return Self::truncate_display_name(url);
    }
}
```

Extract the repeated char-safe truncation into:

```rust
fn truncate_display_name(val: &str) -> String {
    if val.chars().count() > 40 {
        let head: String = val.chars().take(37).collect();
        format!("{}...", head)
    } else {
        val.to_string()
    }
}
```

- [ ] **Step 6: Run Rust tests**

Run:

```bash
cd desktop-rust/src-tauri && cargo test db::queries::tests::test_task_uuid_lookup_helpers
cd desktop-rust/src-tauri && cargo test sync::client::tests::extract_display_name_handles_task_tables_with_utf8
```

Expected: both commands pass.

---

## Task 4: Mobile Tasks SQLite and Repository

**Files:**
- Modify: `mobile/src/db/database.js`
- Create: `mobile/src/db/taskRepo.js`
- Create: `mobile/__tests__/db/taskRepo.test.js`
- Modify: `mobile/__tests__/db/database.test.js`

- [ ] **Step 1: Add database test expectations**

In `mobile/__tests__/db/database.test.js`, capture SQL strings from the mocked `executeSql` calls and assert all Tasks tables are created:

```javascript
const calls = SQLite.openDatabase.mock.results[0].value.executeSql.mock.calls;
const sql = calls.map((c) => c[0]).join('\n');
expect(sql).toContain('CREATE TABLE IF NOT EXISTS task_categories');
expect(sql).toContain('CREATE TABLE IF NOT EXISTS task_statuses');
expect(sql).toContain('CREATE TABLE IF NOT EXISTS tasks');
expect(sql).toContain('CREATE TABLE IF NOT EXISTS task_checkboxes');
expect(sql).toContain('CREATE TABLE IF NOT EXISTS task_links');
```

- [ ] **Step 2: Run database test and confirm failure**

Run:

```bash
cd mobile && npm test -- __tests__/db/database.test.js
```

Expected before implementation: failure for missing Tasks table SQL.

- [ ] **Step 3: Add Tasks tables to mobile database**

In `mobile/src/db/database.js`, add `CREATE TABLE IF NOT EXISTS` statements inside `initDB()`:

```sql
CREATE TABLE IF NOT EXISTS task_categories (
  uuid TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#8b949e',
  sort_order INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT NOT NULL,
  is_deleted INTEGER DEFAULT 0
)
```

Repeat for `task_statuses`, `tasks`, `task_checkboxes`, and `task_links` using the exact UUID relationship fields from the spec:

```text
tasks: category_uuid, status_uuid
task_checkboxes: task_uuid, parent_uuid
task_links: task_uuid
```

- [ ] **Step 4: Create repository tests**

Create `mobile/__tests__/db/taskRepo.test.js` with tests for:

```javascript
import {
  buildUpsertTask,
  buildUpsertTaskCategory,
  buildUpsertTaskStatus,
  buildUpsertTaskCheckbox,
  buildUpsertTaskLink,
} from '../../src/db/taskRepo';

test('buildUpsertTask writes UUID relationships', () => {
  const { sql, params } = buildUpsertTask({
    uuid: 'task-1',
    title: 'Task',
    category_uuid: 'cat-1',
    status_uuid: 'status-1',
    updated_at: '2026-05-23T10:00:00',
    is_deleted: false,
  });
  expect(sql).toContain('category_uuid');
  expect(sql).toContain('status_uuid');
  expect(params).toContain('cat-1');
  expect(params).toContain('status-1');
});

test('buildUpsertTaskCheckbox writes task and parent UUIDs', () => {
  const { sql, params } = buildUpsertTaskCheckbox({
    uuid: 'cb-1',
    task_uuid: 'task-1',
    parent_uuid: 'cb-parent',
    text: 'Check',
    updated_at: '2026-05-23T10:00:00',
  });
  expect(sql).toContain('task_uuid');
  expect(sql).toContain('parent_uuid');
  expect(params).toContain('task-1');
  expect(params).toContain('cb-parent');
});
```

- [ ] **Step 5: Implement `taskRepo.js`**

Create `mobile/src/db/taskRepo.js` following `snippetRepo.js` and `noteRepo.js`. Export:

```javascript
getAllTaskCategories
getAllTaskStatuses
getAllTasks
getTasksByFilters
getTaskCheckboxes
getTaskLinks
buildUpsertTaskCategory
buildUpsertTaskStatus
buildUpsertTask
buildUpsertTaskCheckbox
buildUpsertTaskLink
upsertTaskCategory
upsertTaskStatus
upsertTask
upsertTaskCheckbox
upsertTaskLink
deleteTaskCategory
deleteTaskStatus
deleteTask
deleteTaskCheckbox
deleteTaskLink
getModifiedTaskCategoriesSince
getModifiedTaskStatusesSince
getModifiedTasksSince
getModifiedTaskCheckboxesSince
getModifiedTaskLinksSince
getNextTaskSortOrder
```

Use the existing query helper pattern and soft-delete by setting `is_deleted = 1, updated_at = ?`.

- [ ] **Step 6: Run mobile DB tests**

Run:

```bash
cd mobile && npm test -- __tests__/db/database.test.js __tests__/db/taskRepo.test.js
```

Expected: tests pass.

---

## Task 5: Mobile Sync Service Integration

**Files:**
- Modify: `mobile/src/sync/syncService.js`
- Modify: `mobile/__tests__/sync/syncService.test.js`

- [ ] **Step 1: Extend sync tests first**

In `mobile/__tests__/sync/syncService.test.js`, mock `../../src/db/taskRepo` and add a test:

```javascript
jest.mock('../../src/db/taskRepo');
import * as taskRepo from '../../src/db/taskRepo';

test('sync includes task tables in pull and push', async () => {
  syncMeta.getLastSyncAt.mockResolvedValue('2026-05-23T09:00:00');
  endpoints.syncPull.mockResolvedValue({
    changes: {
      task_categories: [{ uuid: 'cat-1', name: 'Work', updated_at: '2026-05-23T10:00:00', is_deleted: false }],
      task_statuses: [],
      tasks: [{ uuid: 'task-1', title: 'Task', updated_at: '2026-05-23T10:00:00', is_deleted: false }],
      task_checkboxes: [],
      task_links: [],
    },
    server_time: '2026-05-23T10:00:00',
  });
  snippetRepo.getModifiedSnippetsSince.mockResolvedValue([]);
  snippetRepo.getModifiedTagsSince.mockResolvedValue([]);
  noteRepo.getModifiedNotesSince.mockResolvedValue([]);
  noteRepo.getModifiedFoldersSince.mockResolvedValue([]);
  taskRepo.getModifiedTaskCategoriesSince.mockResolvedValue([]);
  taskRepo.getModifiedTaskStatusesSince.mockResolvedValue([]);
  taskRepo.getModifiedTasksSince.mockResolvedValue([{ uuid: 'task-local', title: 'Local', updated_at: '2026-05-23T09:30:00' }]);
  taskRepo.getModifiedTaskCheckboxesSince.mockResolvedValue([]);
  taskRepo.getModifiedTaskLinksSince.mockResolvedValue([]);
  endpoints.syncPush.mockResolvedValue({ status: 'ok', accepted: 1, conflicts: [] });

  await performSync();

  expect(taskRepo.upsertTaskCategory).toHaveBeenCalledWith(expect.objectContaining({ uuid: 'cat-1' }));
  expect(taskRepo.upsertTask).toHaveBeenCalledWith(expect.objectContaining({ uuid: 'task-1' }));
  expect(endpoints.syncPush).toHaveBeenCalledWith(expect.objectContaining({
    tasks: expect.arrayContaining([expect.objectContaining({ uuid: 'task-local' })]),
  }));
});
```

- [ ] **Step 2: Run sync test and confirm failure**

Run:

```bash
cd mobile && npm test -- __tests__/sync/syncService.test.js
```

Expected before implementation: failure because Tasks repo is not wired.

- [ ] **Step 3: Wire task builders and modified queries**

In `mobile/src/sync/syncService.js`, import Task repo functions and extend:

```javascript
const BUILDERS = {
  shortcuts: buildUpsertSnippet,
  snippet_tags: buildUpsertTag,
  notes: buildUpsertNote,
  note_folders: buildUpsertFolder,
  task_categories: buildUpsertTaskCategory,
  task_statuses: buildUpsertTaskStatus,
  tasks: buildUpsertTask,
  task_checkboxes: buildUpsertTaskCheckbox,
  task_links: buildUpsertTaskLink,
};
```

In `countPendingChanges`, include all five Tasks modified queries.

In `performSync`, add local changes in dependency order:

```javascript
if (localTaskCategories.length) changes.task_categories = localTaskCategories;
if (localTaskStatuses.length) changes.task_statuses = localTaskStatuses;
if (localTasks.length) changes.tasks = localTasks;
if (localTaskCheckboxes.length) changes.task_checkboxes = localTaskCheckboxes;
if (localTaskLinks.length) changes.task_links = localTaskLinks;
```

- [ ] **Step 4: Run mobile sync tests**

Run:

```bash
cd mobile && npm test -- __tests__/sync/syncService.test.js
```

Expected: tests pass.

---

## Task 6: Mobile Tasks UI and Navigation

**Files:**
- Create: `mobile/src/screens/Tasks/TaskListScreen.js`
- Create: `mobile/src/screens/Tasks/TaskEditorScreen.js`
- Create: `mobile/src/screens/Tasks/TaskManageScreen.js`
- Modify: `mobile/src/navigation/AppNavigator.js`

- [ ] **Step 1: Create Tasks stack in navigation**

In `AppNavigator.js`, import the three Tasks screens, create `TasksStack`, and add:

```javascript
function TasksNavigator() {
  const { colors } = useTheme();
  return (
    <TasksStack.Navigator screenOptions={{ headerStyle: { backgroundColor: colors.bgSecondary }, headerTintColor: colors.text }}>
      <TasksStack.Screen name="TaskList" component={TaskListScreen} options={{ headerShown: false }} />
      <TasksStack.Screen name="TaskEditor" component={TaskEditorScreen} options={{ title: 'Задача' }} />
      <TasksStack.Screen name="TaskManage" component={TaskManageScreen} options={{ title: 'Списки задач' }} />
    </TasksStack.Navigator>
  );
}
```

Add bottom tab:

```jsx
<Tab.Screen name="Tasks" component={TasksNavigator} />
```

- [ ] **Step 2: Implement `TaskListScreen`**

Use existing Notes/Snippets patterns:

- `SyncStatusBar` at top.
- Horizontal category/status filters.
- `SearchBar` for title/notes text.
- `FlatList` cards with title, status/category chips, pin marker, checkbox progress.
- FAB opens `TaskEditor` with a new UUID task.
- Pull-to-refresh calls `performSync()` then reloads categories/statuses/tasks.

Minimum state:

```javascript
const [categories, setCategories] = useState([]);
const [statuses, setStatuses] = useState([]);
const [tasks, setTasks] = useState([]);
const [selectedCategory, setSelectedCategory] = useState(null);
const [selectedStatus, setSelectedStatus] = useState(null);
const [query, setQuery] = useState('');
```

- [ ] **Step 3: Implement `TaskEditorScreen`**

Support:

- title input;
- category/status pickers;
- pin toggle;
- tracker URL input;
- notes multiline input;
- checkbox list with add/edit/delete/toggle;
- links list with add/edit/delete;
- save button calls repo upserts and `notifyLocalChange()`;
- delete button soft-deletes task and related local children.

Use `uuidv4()` for new task, checkbox, and link UUIDs. New child rows use the parent task UUID.

- [ ] **Step 4: Implement `TaskManageScreen`**

Support category/status CRUD:

- two sections: Categories and Statuses;
- add row with default color `#8b949e`;
- edit name/color;
- soft-delete;
- append ordering with `max(sort_order) + 1`;
- call `notifyLocalChange()` after writes.

- [ ] **Step 5: Run mobile lint and non-JSX syntax checks**

Run:

```bash
node --check mobile/src/db/taskRepo.js
node --check mobile/src/sync/syncService.js
cd mobile && npm run lint -- src/screens/Tasks src/navigation/AppNavigator.js
```

Expected: all commands exit 0.

- [ ] **Step 6: Run mobile tests**

Run:

```bash
cd mobile && npm test -- __tests__/db/taskRepo.test.js __tests__/sync/syncService.test.js
```

Expected: tests pass.

---

## Task 7: Cross-Layer Verification

**Files:**
- Read/check: all files changed in Tasks 1-6.

- [ ] **Step 1: API syntax verification**

Run:

```bash
python3 -m py_compile api/models.py api/alembic/versions/006_add_tasks_sync_tables.py
```

Expected: exits 0.

- [ ] **Step 2: Desktop Rust targeted tests**

Run:

```bash
cd desktop-rust/src-tauri && cargo test db::queries::tests::test_task_uuid_lookup_helpers
cd desktop-rust/src-tauri && cargo test sync::client::tests::extract_display_name_handles_task_tables_with_utf8
```

Expected: both targeted tests pass.

- [ ] **Step 3: Desktop Rust compile**

Run:

```bash
cd desktop-rust/src-tauri && cargo check
```

Expected: exits 0.

- [ ] **Step 4: Mobile tests**

Run:

```bash
cd mobile && npm test -- __tests__/db/database.test.js __tests__/db/taskRepo.test.js __tests__/sync/syncService.test.js
```

Expected: tests pass.

- [ ] **Step 5: Mobile lint and non-JSX syntax checks**

Run:

```bash
node --check mobile/src/db/taskRepo.js
node --check mobile/src/sync/syncService.js
cd mobile && npm run lint -- src/screens/Tasks src/navigation/AppNavigator.js
```

Expected: all commands exit 0.

- [ ] **Step 6: Desktop frontend smoke if desktop JS changed**

If implementation changes `desktop-rust/src/**/*.js`, run:

```bash
cd desktop-rust/src && python3 dev-test.py
```

Expected: all smoke tests pass. If no desktop JS changed, record that this check is not applicable.

- [ ] **Step 7: Manual end-to-end checklist**

Against a local or staging API:

```text
1. Create category/status/task on desktop.
2. Trigger desktop sync.
3. Trigger mobile sync.
4. Confirm mobile shows the task with correct category/status.
5. Add checkbox and link on mobile.
6. Trigger mobile sync.
7. Trigger desktop sync.
8. Confirm desktop shows checkbox/link under the same task.
9. Delete the task on mobile.
10. Sync both clients and confirm the task is hidden on both.
```

---

## Task 8: Release Prep Decision

**Files:**
- Read: `desktop-rust/RELEASES.md`
- Read: `mobile/RELEASES.md`
- Modify only if release is approved: desktop version/changelog/help/release history, mobile version if OTA is cut.

- [ ] **Step 1: Classify desktop release**

Because Rust sync code changes, desktop release type is `v*`. Current version is `1.3.27`; next patch candidate is `1.3.28` unless a newer version appears before release.

- [ ] **Step 2: Classify mobile release**

If only `mobile/src/**` changed, mobile release type is OTA. Current `mobile/package.json` version is `1.0.5`; next OTA candidate is `1.0.6` unless a newer version appears before release.

- [ ] **Step 3: Ask before tagging/deploying**

Do not push tags or deploy mobile OTA until the user confirms release execution. The implementation can be committed separately from release packaging if requested.

---

## Final Verification Before Completion

Run and record:

```bash
git status --short
python3 -m py_compile api/models.py api/alembic/versions/006_add_tasks_sync_tables.py
cd desktop-rust/src-tauri && cargo check
cd /home/aster/Dev/snippets_helper/mobile && npm test -- __tests__/db/database.test.js __tests__/db/taskRepo.test.js __tests__/sync/syncService.test.js
```

If any command fails, fix the failure before claiming the feature is complete.
