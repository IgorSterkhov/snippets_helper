# Implementation plan — Exec Command Groups redesign

Spec: `2026-04-27-exec-groups-redesign.md`. Order respects dependencies (backend → frontend foundations → DnD → run-all → visual polish → docs → verify → review → release).

## Phase 1 — Backend (DB + IPC)

### 1.1 Add `move_exec_command` query

**File**: `desktop-rust/src-tauri/src/db/queries.rs`
**Where**: после `update_exec_command` (~line 877) и перед `delete_exec_command`.

```rust
pub fn move_exec_command(
    conn: &Connection,
    id: i64,
    target_category_id: i64,
    sort_order: i32,
) -> Result<()> {
    let exists: i64 = conn.query_row(
        "SELECT COUNT(*) FROM exec_categories WHERE id = ?1",
        params![target_category_id],
        |r| r.get(0),
    )?;
    if exists == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }
    conn.execute(
        "UPDATE exec_commands SET category_id = ?1, sort_order = ?2 WHERE id = ?3",
        params![target_category_id, sort_order, id],
    )?;
    Ok(())
}

pub fn reorder_exec_commands(conn: &Connection, ids_in_order: &[i64]) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    for (idx, id) in ids_in_order.iter().enumerate() {
        tx.execute(
            "UPDATE exec_commands SET sort_order = ?1 WHERE id = ?2",
            params![idx as i64, id],
        )?;
    }
    tx.commit()?;
    Ok(())
}
```

### 1.2 Tauri commands

**File**: `desktop-rust/src-tauri/src/commands/exec.rs`

Добавить в конец:
```rust
#[tauri::command]
pub fn move_exec_command(
    db: State<DbState>,
    id: i64,
    target_category_id: i64,
    sort_order: Option<i32>,
) -> Result<(), String> {
    let conn = db.lock_recover();
    queries::move_exec_command(&conn, id, target_category_id, sort_order.unwrap_or(0))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reorder_exec_commands(
    db: State<DbState>,
    ids_in_order: Vec<i64>,
) -> Result<(), String> {
    let conn = db.lock_recover();
    queries::reorder_exec_commands(&conn, &ids_in_order).map_err(|e| e.to_string())
}
```

`db.lock_recover()` per CLAUDE.md §11.

### 1.3 Register in lib.rs

**File**: `desktop-rust/src-tauri/src/lib.rs`
Рядом с прочими `commands::exec::*` записями в `invoke_handler`:
```rust
commands::exec::move_exec_command,
commands::exec::reorder_exec_commands,
```

### 1.4 Unit tests

**File**: `desktop-rust/src-tauri/src/db/queries.rs` (внутри существующего `mod test_exec_*`)

```rust
#[test]
fn test_move_exec_command_changes_category() {
    let conn = init_test_db().unwrap();
    let cat_a = create_exec_category(&conn, "A", 0).unwrap();
    let cat_b = create_exec_category(&conn, "B", 0).unwrap();
    let cmd_id = create_exec_command(&conn, cat_a, "cmd1", "echo hi", "", 0, false, "host", None).unwrap();
    move_exec_command(&conn, cmd_id, cat_b, 5).unwrap();
    let in_b = list_exec_commands(&conn, cat_b).unwrap();
    assert_eq!(in_b.len(), 1);
    assert_eq!(in_b[0].sort_order, 5);
    let in_a = list_exec_commands(&conn, cat_a).unwrap();
    assert!(in_a.is_empty());
}

#[test]
fn test_move_exec_command_invalid_target_returns_err() {
    let conn = init_test_db().unwrap();
    let cat = create_exec_category(&conn, "A", 0).unwrap();
    let cmd_id = create_exec_command(&conn, cat, "cmd1", "x", "", 0, false, "host", None).unwrap();
    let r = move_exec_command(&conn, cmd_id, 9999, 0);
    assert!(r.is_err());
}

#[test]
fn test_reorder_exec_commands_updates_sort_order() {
    let conn = init_test_db().unwrap();
    let cat = create_exec_category(&conn, "A", 0).unwrap();
    let id1 = create_exec_command(&conn, cat, "c1", "x", "", 0, false, "host", None).unwrap();
    let id2 = create_exec_command(&conn, cat, "c2", "x", "", 1, false, "host", None).unwrap();
    let id3 = create_exec_command(&conn, cat, "c3", "x", "", 2, false, "host", None).unwrap();
    reorder_exec_commands(&conn, &[id3, id1, id2]).unwrap();
    let l = list_exec_commands(&conn, cat).unwrap();
    let order: Vec<_> = l.iter().map(|c| c.id.unwrap()).collect();
    assert_eq!(order, vec![id3, id1, id2]);
}
```

Verification: `cargo check` + `cargo test --lib test_move test_reorder`.

---

## Phase 2 — Frontend foundations: rename + Group dropdown

### 2.1 Rename UI labels

**File**: `desktop-rust/src/tabs/exec.js`

Заменить (строковые литералы):
| Было                          | Стало                       |
|-------------------------------|------------------------------|
| `'Categories'`                | `'Groups'`                  |
| `'Commands'`                  | `'Commands'` (без изменений) |
| `'Select a category'`         | `'Select a group'`          |
| `'Select a category first'`   | `'Select a group first'`    |
| `'New Category'`              | `'New group'`               |
| `'Edit Category'`             | `'Edit group'`              |
| `'Delete Category'`           | `'Delete group'`            |
| `'Category name'` (input ph.) | `'Group name'`              |
| `'Failed to load categories'` | `'Failed to load groups'`   |
| `'Category created'`          | `'Group created'`           |
| `'Category updated'`          | `'Group updated'`           |
| `'Category deleted'`          | `'Group deleted'`           |
| `'Delete category "..."'`     | `'Delete group "..."'`      |

DOM-классы (`.exec-cat-item`, `.exec-cat-list`) — НЕ переименовываем (внутреннее).

### 2.2 Group dropdown in edit modal

**File**: `desktop-rust/src/tabs/exec.js`

В `buildCommandForm(cmd)` добавить `<select id="cmd-group">` после `<input id="cmd-name">`:
```js
const allGroups = state?.categoriesCache || categories;  // populated at load
body.innerHTML = `
  <label>...</label>
  <input id="cmd-name" .../>
  <label style="display:block;margin-top:8px;margin-bottom:4px">Group</label>
  <select id="cmd-group" style="width:100%">
    ${allGroups.map(g => `<option value="${g.id}" ${cmd.category_id === g.id ? 'selected' : ''}>${escapeHtml(g.name)}</option>`).join('')}
  </select>
  ...
`;
```

В `readCommandForm()` добавить `groupId: parseInt(document.getElementById('cmd-group').value)`.

В `onEditCommand`:
```js
const vals = readCommandForm();
const movingGroup = vals.groupId !== cmd.category_id;
if (movingGroup) {
  await call('move_exec_command', { id: cmd.id, targetCategoryId: vals.groupId, sortOrder: 0 });
}
await call('update_exec_command', { /* existing payload */ });
```

В `onAddCommand` — Group dropdown по умолчанию = текущая выбранная категория (`selectedCategoryId`).

### 2.3 Verification

Open the app, edit a command, change group → expect command moves out of current group's list. Expected: confirmed via manual smoke or via mock test if exists.

---

## Phase 3 — DnD module

### 3.1 Create `exec-dnd.js`

**New file**: `desktop-rust/src/tabs/exec-dnd.js` (~250 lines).

Pattern: pointer-based DnD по образцу `tasks/dnd.js`. Single drag kind = `cmd`.

**API**:
```js
export function installExecDnd(rootEl, {
  onMoveCommit,        // (cmdId, targetGroupId) => Promise<void>
  onReorderCommit,     // (idsInOrder) => Promise<void>
  onMoveContextMenu,   // (cmdId, anchorEl) => void  // grip click without drag
}) { ... }
```

**State машина** (private to module):
- `pointerdown` on `[data-drag-kind="cmd"]` → arm: store start coords, record cmdId.
- `pointermove` — если |dx|+|dy| > 3px → стартует drag (clone source as ghost, mark source dimmed).
- `pointermove` во время drag — позиционирует ghost, ищет drop-target под cursor:
  - Hit `.exec-cat-item` → mode='move', highlight группу dashed-accent outline.
  - Hit `.exec-cmd-card` (≠ source) → mode='reorder', insertion-line above/below карточки.
  - Иначе → mode=null, nothing highlighted.
- `pointerup`:
  - Если drag не начался (|dx|+|dy| ≤ 3px) → click → `onMoveContextMenu(cmdId, gripEl)`.
  - mode='move' → `onMoveCommit(cmdId, targetGroupId)`.
  - mode='reorder' → собрать из DOM новый порядок id'шников → `onReorderCommit(ids)`.
  - cleanup: убрать ghost, восстановить opacity source, снять выделения.

**CSS требуется добавить в exec.js (`css()`)**:
- `.exec-cmd-grip` — `cursor:grab`, opacity 0.45 → 1 on `.exec-cmd-card:hover`.
- `.exec-dnd-drag-clone` — `position:fixed; pointer-events:none; opacity:0.7; z-index:9000`.
- `.exec-dnd-source-dimmed` — `opacity: 0.4`.
- `.exec-dnd-drop-target-group` — `outline: 2px dashed var(--accent)`.
- `.exec-dnd-target-pulse` — keyframe animation 1.5s, `outline-color` accent flash.
- `.exec-dnd-insertion-line` — `height:2px; background:var(--accent); margin: 2px 0;`.

### 3.2 Wire to exec.js

**Изменения в `exec.js`**:

1. Импорт: `import { installExecDnd } from './exec-dnd.js';`
2. В `init(container)` после `loadCategories()`:
   ```js
   installExecDnd(root, {
     onMoveCommit: async (cmdId, groupId) => {
       await call('move_exec_command', { id: cmdId, targetCategoryId: groupId, sortOrder: 0 });
       const groupName = (categories.find(c => c.id === groupId) || {}).name || '';
       showToast(`Moved to ${groupName}`, 'success');
       pulseGroup(groupId);
       await loadCommands();
     },
     onReorderCommit: async (ids) => {
       await call('reorder_exec_commands', { idsInOrder: ids });
       await loadCommands();
     },
     onMoveContextMenu: (cmdId, anchorEl) => openMoveToPopover(cmdId, anchorEl),
   });
   ```
3. В `renderCommands()` добавить grip как первый child карточки:
   ```js
   const grip = el('span', { class: 'exec-cmd-grip', text: '⋮⋮', title: 'Drag to move / click for menu' });
   grip.dataset.dragKind = 'cmd';
   grip.dataset.cmdId = String(cmd.id);
   card.insertBefore(grip, card.firstChild);
   ```
4. `pulseGroup(groupId)` — добавить class `exec-dnd-target-pulse` на 1500ms.
5. `openMoveToPopover(cmdId, anchorEl)` — простой `<div>` поверх с position:absolute, список групп, click → `onMoveCommit`.

### 3.3 Verification

Manual smoke:
- Drag команду из правой → drop на другую группу слева → toast + pulse + команда исчезает из текущего списка.
- Drag команду на другую карточку в той же группе → reorder, после reload порядок сохранён.
- Click (без drag) на grip → popover «Move to → ...».
- Drag на ту же группу (где команда уже находится) → ничего не происходит / no-op.

---

## Phase 4 — Run-all

### 4.1 Run-all button

В `buildLayout` правой панели, рядом с `+` для add-command:
```js
const runAllBtn = el('button', { class: 'btn-secondary btn-small', id: 'run-all-btn', text: '▶ Run all' });
runAllBtn.style.display = 'none';   // показывается когда есть выбранная группа с >0 команд
runAllBtn.addEventListener('click', onRunAll);
rightHeader.insertBefore(runAllBtn, addCmdBtn);
```

В `renderCommands()` обновлять видимость: `runAllBtn.style.display = commands.length > 0 ? '' : 'none'`.

### 4.2 Console plumbing

Console сейчас — `<pre id="exec-console">`. Для collapsible-секций нужно поменять на `<div>` с дочерними `<details>` элементами.

```html
<div id="exec-console" class="exec-console">
  <!-- per-run: header lines + section blocks -->
</div>
```

CSS оставляем `pre`-вид (`white-space:pre-wrap; font-family:monospace`).

Вспомогательные функции:
```js
function appendConsoleLine(text, kind = 'plain') { /* div with class */ }
function appendConsoleHeader(text) { /* '════' line */ }
function appendConsoleSection(cmdName, idx, total) {
  // <details open><summary>▶ idx/total: cmdName (shell)</summary><pre class="output"></pre></details>
  return { detailsEl, outputEl, markOk(ms), markFail(err, ms), autoCollapse() };
}
function clearConsole() { /* reset for new run */ }
function setProgressBar(idx, total, label) { /* bar at top of console */ }
function clearProgressBar() {}
```

### 4.3 Run-all loop

```js
let runAll = { running: false, aborted: false };

async function onRunAll() {
  if (runAll.running) return;
  if (commands.length === 0) { showToast('No commands in group', 'info'); return; }
  runAll = { running: true, aborted: false };
  setRunAllUI(true);
  clearConsole();
  appendConsoleHeader(`══════ Run all started — ${commands.length} commands ══════`);
  const groupStartT = performance.now();
  let allOk = true;

  for (let i = 0; i < commands.length; i++) {
    if (runAll.aborted) break;
    const cmd = commands[i];
    setProgressBar(i, commands.length, cmd.name);
    highlightCard(cmd.id);
    const sec = appendConsoleSection(cmd.name, i + 1, commands.length, cmd.shell);
    const t0 = performance.now();
    try {
      const output = await call('run_command', {
        command: cmd.command,
        shell: cmd.shell || 'host',
        wslDistro: cmd.wsl_distro || null,
      });
      const ms = performance.now() - t0;
      sec.outputEl.textContent = output;
      sec.markOk(ms);
      sec.autoCollapse();          // 800ms timeout to <details>.removeAttribute('open')
    } catch (e) {
      const ms = performance.now() - t0;
      sec.outputEl.textContent = String(e);
      sec.markFail(String(e), ms);
      appendConsoleHeader(`══════ Sequence stopped at ${i+1}/${commands.length} ══════`);
      allOk = false;
      break;     // RA1=a fail-fast
    }
  }

  unhighlightCard();
  clearProgressBar();
  runAll.running = false;
  setRunAllUI(false);
  if (allOk && !runAll.aborted) {
    const totalMs = performance.now() - groupStartT;
    appendConsoleHeader(`✓ All ${commands.length} commands done in ${(totalMs/1000).toFixed(1)}s`);
  } else if (runAll.aborted) {
    appendConsoleHeader(`⊘ Stopped by user`);
  }
}

async function onStopAll() {
  runAll.aborted = true;
  try { await call('stop_command'); } catch (_) {}
  showToast('Run-all stopped', 'info');
}
```

### 4.4 setRunAllUI

```js
function setRunAllUI(running) {
  const btn = root.querySelector('#run-all-btn');
  const stop = root.querySelector('#exec-stop-btn');
  if (running) {
    btn.textContent = '⏹ Stop all';
    btn.onclick = onStopAll;
    stop.style.display = 'none';   // single Run-all controls everything
  } else {
    btn.textContent = '▶ Run all';
    btn.onclick = onRunAll;
  }
}
```

### 4.5 Verification

Manual smoke:
- 3 successful commands → progress bar moves 0→1→2→3, успешные секции свернулись через 800ms, header «✓ All 3 done».
- 2nd command exit-1 → fail-fast, sequence header «Stopped at 2/N», 3rd never runs.
- Click Stop all mid-run → текущая команда убита, последовательность не идёт дальше, header «⊘ Stopped by user».

---

## Phase 5 — Visual redesign via `frontend-design` skill

Этот шаг отдельный и интерактивный. После завершения phases 1-4 (функциональность готова) — invoke skill.

### 5.1 Подготовка контекста

Brief для skill:
- **Цель**: распухший Exec-таб → плотный, продуктивный layout, аналогичный Tasks (плотные карточки, цветные бейджи, drag-handle).
- **Контекст**: Tasks — текущий стилевой ориентир. Цвета: `--bg=#0d1117`, `--bg-secondary=#161b22`, `--bg-tertiary=#1f242c`, `--accent=#388bfd`, `--green=#3fb950`.
- **Inputs**: текущий exec.js (после phases 1-4) + спека §2.2-§2.6 + auto-letter иконка (decision: D).
- **Outputs**: 2-3 mockup-варианта в визуальном companion'e.

### 5.2 Iteration loop

1. Skill генерит вариант 1 → push HTML в `screen_dir` → пользователь смотрит на http://localhost:8765.
2. Feedback в чате → adjust → push v2.
3. Когда пользователь утверждает → applyChosen — переписать CSS-секцию `css()` в `exec.js` под выбранный стиль.
4. Реализовать auto-letter-icon как helper-функцию:
   ```js
   function buildAutoLetterIcon(name) {
     const hue = nameToHue(name);  // FNV-style hash → 0..360
     const div = el('div', { class: 'exec-group-icon' });
     div.style.background = `hsl(${hue},50%,45%)`;
     div.textContent = (name.match(/\p{L}|\p{N}/u) || ['?'])[0].toUpperCase();
     return div;
   }
   ```
   `nameToHue` — простой 32-bit FNV для детерминизма.

### 5.3 Verification

Visual diff с предыдущим скриншотом (можно ручной); запуск приложения через `cargo run` — таб открывается без JS-ошибок.

---

## Phase 6 — Help / CHANGELOG / version bump

### 6.1 `desktop-rust/src/tabs/help.js`

Обновить `i18n.en` и `i18n.ru`, ключ `exec_desc` — добавить:
- (en) «Drag the ⋮⋮ grip on a command to another group, or click it for a "Move to…" popover. Use ▶ Run all on a group header to execute all commands sequentially.»
- (ru) аналогично.

Также `exec_name` оставляем как есть (`Exec` / `Выполнение`).

### 6.2 `desktop-rust/CHANGELOG.md`

Новая секция сверху:
```markdown
## v1.3.25 (2026-04-XX)

**Exec → Command Groups: redesign + DnD + Run-all.**

- **Rename UI** «Categories» → «Groups». DB-таблицы и колонки не тронуты.
- **DnD**: drag the ⋮⋮ grip on a command card to move it between
  groups (drop on the left panel) or reorder within the same group
  (drop on another card). Click the grip without dragging opens a
  "Move to…" popover for accessibility.
- **Run-all**: new ▶ Run all button on the group header. Runs every
  command in the group sequentially, fail-fast on first error, with a
  progress bar + per-command collapsible sections in the bottom
  console. Stop button aborts the whole sequence.
- **Edit modal**: new «Group» dropdown lets you change a command's
  group from the form (alternative to DnD).
- **Visual**: Slack-style auto-letter icon on each group (deterministic
  colour from name). Full UI redesign generated through the
  frontend-design skill.
```

Дата подставляется реальная при коммите.

### 6.3 Version bump

- `desktop-rust/src-tauri/Cargo.toml`: `version = "1.3.25"`
- `desktop-rust/src-tauri/tauri.conf.json`: `"version": "1.3.25"`
- `desktop-rust/src-tauri/Cargo.lock`: refresh через `cargo check`.

---

## Phase 7 — Verify

1. `cargo check` (clean build expected).
2. `cargo test --lib test_move test_reorder` (3 new tests pass).
3. `node --check` на всех изменённых JS:
   - `desktop-rust/src/tabs/exec.js`
   - `desktop-rust/src/tabs/exec-dnd.js`
   - `desktop-rust/src/tabs/help.js`
4. `cd desktop-rust/src && python3 dev-test.py` → 14/14 PASS (per RELEASES.md §2.1).

If any step fails — fix before proceeding.

---

## Phase 8 — Rigorous review on opus (CLAUDE.md §13)

Dispatch `superpowers:code-reviewer` with `model: opus`, max-effort. Focus per spec §7:

1. DnD threshold (click vs drag race), drop-target detection on scrollbar/resize, abort on pointercancel.
2. Run-all: race между stop_command и переходом к следующей команде, window-close cleanup, UI flag consistency.
3. `move_exec_command` FK-check correctness, lock_recover usage.
4. UTF-8 в auto-letter (имена групп с кириллицей/эмодзи) — `chars().next()`, не bytes.
5. CLAUDE.md §10 (UTF-8), §11 (lock_recover), §12 (v-* tag).

Reviewer возвращает blocking issues с `file:line`. Фиксим, повторяем. После approval — phase 9.

---

## Phase 9 — Commit + release v1.3.25 (per CLAUDE.md §15)

### 9.1 Commits

Два коммита:

1. **Implementation** — все код-изменения + version bump:
   ```
   git add desktop-rust/CHANGELOG.md desktop-rust/src-tauri/Cargo.lock \
           desktop-rust/src-tauri/Cargo.toml desktop-rust/src-tauri/src/commands/exec.rs \
           desktop-rust/src-tauri/src/db/queries.rs desktop-rust/src-tauri/src/lib.rs \
           desktop-rust/src-tauri/tauri.conf.json desktop-rust/src/tabs/exec.js \
           desktop-rust/src/tabs/exec-dnd.js desktop-rust/src/tabs/help.js
   git commit -m "exec: command groups + dnd + run-all + redesign (v1.3.25)"
   ```

2. **Spec + plan** — design docs:
   ```
   git add .workflow/specs/2026-04-27-exec-groups-redesign.md \
           .workflow/specs/2026-04-27-exec-groups-redesign-plan.md
   git commit -m "specs: exec command groups — design + impl plan"
   ```

### 9.2 Push + tag + watch

```bash
git push
git tag v1.3.25 <impl-commit-sha>
git push origin v1.3.25
gh run watch <run_id> -R IgorSterkhov/snippets_helper --exit-status
```

`gh run watch` в фоне (`run_in_background:true`). По завершении — smoke-curl `frontend-version.json` per RELEASES.md §2.4.

---

## Risks / Open questions

1. **`frontend-design` skill output quality** — генерация может не попасть в стилистический ориентир с первого раза. Iteration в phase 5.2 это покрывает.
2. **DnD на маленьком экране / в split-view** — drop-target detection через `document.elementFromPoint`. Tasks DnD это уже делает, поэтому ожидается работоспособность.
3. **Run-all и app-quit во время выполнения** — текущий child получит SIGTERM. Следующие команды не запустятся (из-за того что фронт умер). Не блокер — stale state в БД нет, run-all не атомарный.
4. **Существующие команды без `category_id` после миграций** — невозможно (FK constraint), пропускаю.
5. **Множественный drag (ctrl-click несколько карточек)** — out of scope (одна карточка за раз).
