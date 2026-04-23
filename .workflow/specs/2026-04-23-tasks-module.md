# Tasks Module — спецификация и план реализации

**Статус:** утверждён (превью `.superpowers/brainstorm/2011292-*/content/tasks-layout.html` + `tasks-2col-zigzag.html`)

## Итоговые решения

| № | Решение |
|---|---------|
| Q1 | Категории и статусы — пользовательские списки из БД (seed при первом запуске) |
| Q2 | Фильтры — single-select dropdown. Drag карточки на dropdown → hover 300ms → раскрытие → drop на пункт меняет task.category/status, фильтр не меняется |
| Q3 | ⋮⋮ в левом верхнем углу карточки — drag-handle |
| Q4 | Ссылки: `url` + опциональный `label` (fallback на домен) |
| Q5 | Notes — Markdown с reuse `md-toolbar.js` + marked |
| Q6 | Вложенность чекбоксов: max 3 уровня |
| Q7 | Sort by `sort_order` ASC; pinned сверху. DnD карточек перезаписывает sort_order. Новая задача = max+1 |
| Q8 | Full sync integration (все 5 таблиц) |
| Q9 | Отдельное поле `tracker_url` на Task. В collapsed — компактная кнопка 🎫 |
| Q10 | Цвет фона карточки: палитра из 6 pastel-tones + Custom (HTML color-picker) |
| Q11 | Иконка таба: ✅, между Notes и SQL |
| Q12 | Seed defaults: Categories {Work, Home}; Statuses {Open, In progress, Blocked, Done} |
| Q13 | Manage-модалка через правый клик на dropdown (не на пункт) |
| Q14 | Delete category/status → задачи остаются с `category_id = NULL`; в dropdown появляется пункт None пока есть нераспределённые |
| Q15 | Layout toggle в правом углу filter-row: 1-col ↔ 2-col (row-major grid, zigzag); persist в settings как `tasks_layout_mode` |
| Q16 | Help-кнопка в заголовке таба (паттерн из SQL sub-tabs) |

## Схема БД

```sql
CREATE TABLE task_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#8b949e',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  uuid TEXT NOT NULL UNIQUE,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  user_id TEXT NOT NULL DEFAULT ''
);
CREATE TABLE task_statuses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#8b949e',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  uuid TEXT NOT NULL UNIQUE,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  user_id TEXT NOT NULL DEFAULT ''
);
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL DEFAULT '',
  category_id INTEGER REFERENCES task_categories(id) ON DELETE SET NULL,
  status_id   INTEGER REFERENCES task_statuses(id)   ON DELETE SET NULL,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  bg_color TEXT,                        -- hex OR null (default theme)
  tracker_url TEXT,
  notes_md TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  uuid TEXT NOT NULL UNIQUE,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  user_id TEXT NOT NULL DEFAULT ''
);
CREATE TABLE task_checkboxes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES task_checkboxes(id) ON DELETE CASCADE,
  text TEXT NOT NULL DEFAULT '',
  is_checked INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  uuid TEXT NOT NULL UNIQUE,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  user_id TEXT NOT NULL DEFAULT ''
);
CREATE TABLE task_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  label TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  uuid TEXT NOT NULL UNIQUE,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  user_id TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_tasks_sort           ON tasks(is_pinned DESC, sort_order ASC);
CREATE INDEX idx_tasks_category       ON tasks(category_id);
CREATE INDEX idx_tasks_status         ON tasks(status_id);
CREATE INDEX idx_checkboxes_task      ON task_checkboxes(task_id, parent_id, sort_order);
CREATE INDEX idx_links_task           ON task_links(task_id, sort_order);
```

Seed (in migration after CREATE):
```sql
INSERT INTO task_categories (name, color, sort_order, ...) VALUES
  ('Work', '#388bfd', 0, ...),
  ('Home', '#3fb950', 1, ...);
INSERT INTO task_statuses (name, color, sort_order, ...) VALUES
  ('Open',        '#8b949e', 0, ...),
  ('In progress', '#d29922', 1, ...),
  ('Blocked',     '#f85149', 2, ...),
  ('Done',        '#3fb950', 3, ...);
```

## Настройки

- `tasks_layout_mode` — `'one-col'` (default) / `'two-col'`
- `tasks_card_max_checkboxes` — default 10 (≈260px высота scroll-окна)

## Tauri-команды (Rust → JS)

**Categories / Statuses** (симметричные):
- `list_task_categories()` → `Vec<Category>` (ordered by sort_order)
- `create_task_category(name, color)` → Category
- `update_task_category(id, name, color)` → ()
- `delete_task_category(id)` → () (ON DELETE SET NULL для tasks)
- `reorder_task_categories(ids: Vec<i64>)` — массив в новом порядке
- Аналогично для statuses

**Tasks**:
- `list_tasks(category_filter: Option<i64 | "none">, status_filter: Option<i64 | "none">)` → `Vec<Task>`
- `list_pinned_tasks()` → `Vec<Task>` (для chip strip)
- `create_task(title, categoryId, statusId)` → Task
- `update_task(id, title, categoryId, statusId, isPinned, bgColor, trackerUrl, notesMd)` → ()
- `reorder_tasks(ids: Vec<i64>)` — перезаписывает sort_order
- `delete_task(id)` → ()

**Checkboxes**:
- `list_task_checkboxes(task_id)` → `Vec<Checkbox>` (flat, с parent_id)
- `create_task_checkbox(task_id, parent_id, text, after_id)` → Checkbox
- `update_task_checkbox(id, text, is_checked)` → ()
- `reorder_task_checkboxes(task_id, items: Vec<{id, parent_id, sort_order}>)` — массовое обновление
- `delete_task_checkbox(id)` → ()

**Links**:
- `list_task_links(task_id)` → `Vec<Link>`
- `create_task_link(task_id, url, label)` → Link
- `update_task_link(id, url, label)` → ()
- `reorder_task_links(task_id, ids: Vec<i64>)` → ()
- `delete_task_link(id)` → ()

## Sync-интеграция

Все 5 таблиц в `sync::schema::SYNC_FIELDS`/`SYNC_TABLES` и в sync-флоу. Миграция бамп до версии N+1.

## Frontend — файлы

```
desktop-rust/src/tabs/tasks/
  index.js            — init(container), layout skeleton, state, loaders
  card.js             — renderCard(task, {collapsed|expanded}), checkbox list, +Add, handlers
  editor.js           — expanded editor: title/links/notes/color/delete/save
  checkbox-list.js    — interactive checkbox rendering + Tab/Enter/Shift+Tab logic
  dropdown.js         — filter dropdown widget (single-select + right-click Manage)
  manage-modal.js     — Manage categories / statuses modal
  dnd.js              — pointer-based drag-and-drop (card→dropdown, card reorder, checkbox reorder)
  help-content.js     — HELP_HTML string
  tasks-css.js        — returns scoped CSS
```

## Разбиение на задачи для subagent-driven-development

### T1: Rust schema + migrations + seed
- Добавить 5 таблиц в `db/mod.rs` с миграцией (bump `SCHEMA_VERSION`)
- Seed defaults после create
- Модели в `db/models.rs`: `TaskCategory`, `TaskStatus`, `Task`, `TaskCheckbox`, `TaskLink`
- Тесты: `cargo test db::queries::task` — insert → list → seed-present

### T2: Rust queries + commands — categories & statuses
- `db/queries.rs` — CRUD + reorder
- `commands/tasks.rs` — обёртки
- Регистрация в `lib.rs`
- Тесты: delete with dependent tasks → category_id=NULL

### T3: Rust queries + commands — tasks, checkboxes, links
- Аналогично T2
- Hierarchical checkbox queries + depth validation (refuse depth > 3)
- Тесты: cascade delete, reorder stability

### T4: Sync schema integration
- `sync/schema.rs` — 5 новых таблиц + поля
- Тесты: `cargo test sync::schema`

### T5: Tab skeleton + data loading (frontend)
- `src/main.js` — регистрация таба
- `tasks/index.js` — layout (pinned chips row + filter row + toggle + cards scroll area)
- Загрузка categories, statuses, tasks, pinned
- Пустое состояние «No tasks yet — [+ New]»

### T6: Card collapsed view (frontend)
- `card.js` — render collapsed: drag-handle, title, badges, tracker-btn, expand
- `checkbox-list.js` — non-editable render для collapsed mode
- click checkbox → toggle + persist (update_task_checkbox)
- click tracker-btn → open URL

### T7: Expanded editor (frontend)
- `editor.js` — все поля: title, category/status dropdowns, tracker_url, links section (add/remove/reorder), color picker, notes MD textarea с `md-toolbar`, Save/Cancel/Delete
- Sync state обратно в базу при Save

### T8: Checkbox editing (Enter/Tab/Shift+Tab/+Add/depth limit)
- Inline editable checkbox rows (contenteditable или input)
- Enter = новый пункт на том же уровне
- Tab = nest под verхний (если < 3 уровня)
- Shift+Tab = outdent
- `+ Add item…` = новый пустой пункт (уровень 0)

### T9: Filter dropdowns + right-click Manage modal
- `dropdown.js` — single-select, auto-close, "All" + values + "None" (lazy, if any orphan tasks)
- right-click → contextmenu "Manage…" → открывает `manage-modal.js`
- Modal: list categories/statuses, rename inline, color picker (palette + custom), delete, + Add, drag-drop reorder

### T10: Drag-and-drop (pointer-based)
- `dnd.js` — общий движок pointerdown/move/up + hit-test
- Сценарии:
  1. Карточка ⋮⋮ → на dropdown (hover 300ms → раскрытие → drop на пункт = set category/status)
  2. Карточка ⋮⋮ → на другую карточку (reorder, update sort_order)
  3. Чекбокс ⋮⋮ → reorder в пределах своей задачи (update parent_id + sort_order, with depth≤3 check)
- Ghost-превью во время drag (как `.ghost-card` в мокапе)

### T11: Layout toggle (1-col / 2-col zigzag) + settings persist
- Кнопка 30×30 с SVG-иконкой в filter-row справа
- click → toggle CSS class `.cards-scroll.two-col` / `.one-col`
- Persist через `set_setting('tasks_layout_mode', ...)`
- Чтение при init таба

### T12: Help button + CHANGELOG + help.js update + release
- `help-content.js` с TASK_HELP_HTML (паттерн `sql-help.js`)
- `?` кнопка в header таба → модалка
- `help.js` sidebar: добавить секцию Tasks в `features` i18n (en/ru)
- `CHANGELOG.md` → v1.3.0 секция
- Bump `Cargo.toml` / `tauri.conf.json` → 1.3.0
- Commit, tag v1.3.0, push

## Критерии приёма

- Create/edit/delete задач/чекбоксов/ссылок работает
- Filter dropdowns single-select, None появляется только когда нужно
- DnD карточка→dropdown меняет category/status
- DnD чекбоксов reorder и вложенность, max depth = 3 enforced
- Tab/Shift+Tab/Enter работают в inline-редактировании чекбоксов
- Pin-чипы обновляются при изменении pin
- Layout toggle переключает grid и persist-ится
- Manage-модалка: CRUD категорий/статусов с цветами
- Удаление категории → задачи с NULL, в dropdown появляется None
- Sync работает через существующий механизм
- Help-модалка доступна, CHANGELOG обновлён, иконка ✅ в сайдбаре
- v1.3.0 собран CI, опубликован со всеми ассетами
