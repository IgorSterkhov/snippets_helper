# Exec → Command Groups: redesign + DnD + Run-all

**Date**: 2026-04-27
**Release target**: `v1.3.25` (новый IPC + поведение Run-all + редизайн UI; per CLAUDE.md §12 + §15 — обязательно `v-*`)
**Files affected (backend)**: `desktop-rust/src-tauri/src/db/queries.rs`, `commands/exec.rs`, `lib.rs`
**Files affected (frontend)**: `desktop-rust/src/tabs/exec.js` (полный пересмотр), новый `desktop-rust/src/tabs/exec-dnd.js`, `desktop-rust/src/tabs/help.js`, `desktop-rust/CHANGELOG.md`, версии в `Cargo.toml` + `tauri.conf.json`
**Подход к UI**: после согласования спеки и плана — invoke `frontend-design` skill (S2=a, S3=b — свободный полёт, 2-3 варианта на выбор пользователя)

---

## 0. Общий план

Четыре подзадачи в одной спеке, в одном релизе:

1. **Перемещение команды между группами** — DnD на левую панель + dropdown «Группа» в edit-модалке + grip click → context menu «Move to» (accessibility).
2. **Run-all для группы** — последовательное выполнение команд группы с прогрессом в консоли, fail-fast.
3. **Rename UI**: «Category / Categories» → «Group / Groups» (только лейблы, DB остаётся `exec_categories` / `category_id`).
4. **UI-редизайн** через `frontend-design` skill — свободный полёт, варианты на выбор. Auto-letter иконка (Slack-style, цвет из hash имени) + grip `⋮⋮` + Tasks-style DnD-визуал.

---

## 1. Backend

### 1.1 Перемещение команды между группами + reorder

Текущий `update_exec_command` (db/queries.rs:858) **не** меняет `category_id`. Добавим:

```rust
pub fn move_exec_command(
    conn: &Connection,
    id: i64,
    target_category_id: i64,
    sort_order: i32,
) -> Result<()> {
    // Проверяем что target существует — иначе FK-нарушение даст невнятный
    // SQLite-error.
    let exists: i64 = conn.query_row(
        "SELECT COUNT(*) FROM exec_categories WHERE id = ?1",
        params![target_category_id], |r| r.get(0))?;
    if exists == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }
    conn.execute(
        "UPDATE exec_commands SET category_id = ?1, sort_order = ?2 WHERE id = ?3",
        params![target_category_id, sort_order, id],
    )?;
    Ok(())
}
```

Reorder в рамках группы — отдельная функция (DnD'ом таскаем карточки внутри списка):

```rust
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

Tauri-команды (`commands/exec.rs`):

```rust
#[tauri::command]
pub fn move_exec_command(
    db: State<DbState>,
    id: i64,
    target_category_id: i64,
    sort_order: Option<i32>,
) -> Result<(), String> {
    let conn = db.lock_recover();   // §11
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

Регистрируем в `lib.rs` invoke-handler.

### 1.2 Run-all — frontend-orchestrated

Backend изменений **не требуется** для Run-all. Существующие `run_command` (sync await) + `stop_command` (kill running child) достаточны:

- Фронт получает список команд группы → последовательно вызывает `run_command` для каждой.
- На `await` блокирует UI на одной команде → как только она завершилась → следующая.
- Stop-кнопка во время Run-all → ставит `state.runAllAborted = true` + вызывает `stop_command` (убивает текущий child); цикл проверяет флаг между командами и не запускает следующую.
- Fail-fast: на первый rejected `await` — выходим из цикла, помечаем красным.

Этот подход проще, чем backend-orchestration: не нужен новый stateful tauri-сервис, не нужны новые события.

Risk: если пользователь закроет окно во время run-all — текущий child получит SIGTERM (это уже происходит на app-exit), а следующие просто не запустятся. Приемлемо.

### 1.3 БД-схема

Без изменений. `exec_categories` и `exec_commands` остаются как есть. Старое имя «category» в БД — ОК, изменения только в UI-лейблах.

---

## 2. Frontend — структура

`exec.js` сейчас 639 строк, после редизайна логика DnD выносится в отдельный модуль `exec-dnd.js` (по образцу `tasks/dnd.js`). Структура:

```
desktop-rust/src/tabs/
├── exec.js          (рендер, бизнес-логика, run-all)
└── exec-dnd.js      (pointer-based DnD: grip → ghost → drop on group/card)
```

### 2.1 Lean impact на состояние

Новые поля в state:

```js
let state = {
  // … existing
  runAll: {
    running: false,
    aborted: false,
    currentIdx: 0,           // index in commands[]
    total: 0,
    results: [],             // { id, name, ok, output, ms }
  },
  expandedSection: new Set(),  // collapsible sections в консоли (RA3=c)
};
```

### 2.2 Левая панель: группы

После переименования и редизайна:

```
┌────────────────────────┐
│ Groups            [+]  │
├────────────────────────┤
│ [D] Deploy & rollout 12 │  ← active: border-left + bg-tertiary
│ [G] Git daily        7  │
│ [M] Migrations       3  │
│ [A] Airflow ops      9  │
│ ...                    │
└────────────────────────┘
```

- Auto-letter иконка слева — 22×22, rounded-corners 5px, цвет = `hsl(hash(name) % 360, 50%, 45%)`, белая буква 11px bold.
  - Хеш — простой 32-bit FNV-style, чтобы тот же name всегда давал тот же цвет.
- Имя группы — `flex:1`, ellipsis на overflow.
- Счётчик команд справа — small muted, 11px, tabular-nums.
- Hover — `bg-secondary`. Active — `border-left: 3px solid accent`, `bg-tertiary`.
- Run-all кнопка появляется в группе при hover OR на active группе всегда (см. §3).
- Drop-target: при DnD команды — на hover группа подсвечивается `outline: 2px dashed accent`.

### 2.3 Правая панель: команды

Карточка команды раскладывается так (5-колонка `flex-row gap=8`):

```
[grip ⋮⋮] [run-octagon] [body: name + WSL + desc + code] [delete]
   16×32       32×32           flex:1                       icon
```

- **Grip**: 16×32, `cursor:grab`, символ `⋮⋮` (font-size 14, `--text-muted`). На hover карточки — opacity 1; в idle — 0.45.
- **Run-octagon**: оставляем как в v1.3.24 (зелёный ▶ в octagon clip-path, 32×32).
- **Body**: name (clickable, открывает edit), WSL-бейдж, описание, code.
- **Delete (✕)**: справа, как в v1.3.24.

CSS-уточнения через `frontend-design` skill (свободный полёт). Вышеперечисленное — каркас.

### 2.4 Run-all на хедере группы

В шапке Commands-панели (правая) — кнопка **▶ Run all** (видна когда выбрана группа с >0 команд):

```
Commands  [▶ Run all]            [+]
```

- Disabled во время run-all + hover-tooltip «Already running».
- Во время run-all сменяется на «⏹ Stop all».
- Под Add (+) кнопкой — справа.

### 2.5 Прогресс Run-all (RA4=c)

Двойная индикация:

1. **Подсветка текущей карточки** — class `.exec-cmd-running` с `outline: 2px solid var(--accent)` + lightweight pulse-animation. Скролится в видимую область.
2. **Прогресс-полоска в консоли** — над содержимым, во всю ширину `.exec-bottom`:
   ```
   [████████░░░░░░░] Running 2/5: <name>  · 3.2s elapsed
   ```
   - Fill = `currentIdx / total * 100`.
   - Текст = `Running ${idx+1}/${total}: ${cmd.name}` + elapsed-таймер.
   - На fail-fast: меняется на `❌ Failed at 3/5: <name> — sequence stopped`.
   - На complete: `✓ All 5 commands done in 12.4s`.

### 2.6 Output в консоли (RA3=c)

Аккумулируется с разделителями + collapsible секции для успешных:

```
══════ Run all started — 5 commands ══════

▶ 1/5: deploy-staging  (host)
[output...]
✓ Done in 2.1s   [collapse]

▶ 2/5: smoke-tests  (host)
[output...]
✓ Done in 0.8s   [collapse]

▶ 3/5: migrate-db  (wsl · ubuntu)
[output...]
✗ Failed in 1.5s — exit code 1
══════ Sequence stopped at 3/5 ══════
```

- Каждая секция — `<details>`/`<summary>` (нативный collapsible), успешные авто-collapse'ятся через 800ms после завершения, упавшая остаётся раскрытой.
- Header «══════» — moncospace-шрифт, `--text-muted`.

### 2.7 Edit-модалка: Group dropdown

В `buildCommandForm` после поля Name добавляется `<select>` со списком всех групп (`list_exec_categories` уже зовётся при загрузке таба → используем кеш). При сохранении:

- Если `group_id` поменялся → вызвать `move_exec_command(id, group_id)` + после этого `update_exec_command` с остальными полями. Или один комбинированный update — но тогда нужен новый IPC. Проще: два await'а. Race-условий нет (один пользователь, один edit).

### 2.8 Grip context menu (Q5=b)

Клик (без drag) на grip — открывается popover «Move to»:

```
┌───────────────────────┐
│ Move to:              │
├───────────────────────┤
│ [D] Deploy & rollout  │  ← current group greyed
│ [G] Git daily         │
│ [M] Migrations        │
│ ...                   │
└───────────────────────┘
```

- Position: справа от grip, `position:absolute`.
- Item click → `move_exec_command(id, group_id, 0)` → toast + reload.
- Esc / outside-click → закрыть.

Различение click vs drag — стандартное: pointermove с `>3px` смещения = drag, иначе = click.

---

## 3. DnD реализация

По образцу `tasks/dnd.js`. Reuse кода — нет (Tasks DnD завязан на `task-card` / `tcb-item` / dropdown-меню), но идиомы те же.

### 3.1 Pointer-based, не HTML5

Те же причины, что в Tasks (комментарий в `tasks/dnd.js:4-5`): WebView2 имеет issues с HTML5 DnD.

### 3.2 Drag kinds

Только один kind для Exec: `cmd`.

```html
<span class="exec-cmd-grip" data-drag-kind="cmd" data-cmd-id="42">⋮⋮</span>
```

### 3.3 Drop targets

- **Левая панель** (`.exec-cat-item`) — drop = move в эту группу (с `sort_order=0`).
- **Правая панель** (`.exec-cmd-card`) внутри текущей группы — drop = reorder; insertion-line как в Tasks.

### 3.4 Визуал DnD

- **Ghost**: clone карточки, `position:fixed`, opacity 0.7, ниже cursor на 8px.
- **Source**: остаётся в DOM, `opacity:0.4` для отметки откуда взяли.
- **Insertion line** (только в правой панели для reorder): синяя, 2px высоты, между карточками.
- **Drop-target highlight** (левая панель — для move): `outline: 2px dashed var(--accent)` на hover.
- **После успешного drop на группу** (Q3=c): toast «Moved to <Group name>» + 1.5s outline pulse на target-группу в левой панели.

### 3.5 Backend контракт

- Move между группами: `move_exec_command(id, target_category_id, 0)`. После — `loadCommands()` для обновления текущего списка (если переехала из активной группы, она исчезает).
- Reorder в группе: `reorder_exec_commands([id1, id2, id3, ...])`. После — `loadCommands()`.

---

## 4. Run-all алгоритм

### 4.1 Старт

```js
async function onRunAll(group) {
  if (state.runAll.running) return;
  if (commands.length === 0) {
    showToast('No commands in group', 'info');
    return;
  }
  state.runAll = {
    running: true, aborted: false,
    currentIdx: 0, total: commands.length, results: [],
  };
  setRunAllUI(true);    // переключить кнопку, показать progress
  appendConsoleHeader(`══════ Run all started — ${commands.length} commands ══════`);
  for (let i = 0; i < commands.length; i++) {
    if (state.runAll.aborted) break;
    state.runAll.currentIdx = i;
    highlightCard(commands[i].id);
    appendConsoleSectionStart(commands[i], i);
    const t0 = performance.now();
    try {
      const output = await call('run_command', {
        command: commands[i].command,
        shell: commands[i].shell || 'host',
        wslDistro: commands[i].wsl_distro || null,
      });
      const ms = performance.now() - t0;
      appendConsoleSectionEnd(commands[i], 'ok', output, ms);
      state.runAll.results.push({ id: commands[i].id, name: commands[i].name, ok: true, ms });
      autoCollapseLastSuccess();    // через 800ms collapse
    } catch (e) {
      const ms = performance.now() - t0;
      appendConsoleSectionEnd(commands[i], 'fail', String(e), ms);
      state.runAll.results.push({ id: commands[i].id, name: commands[i].name, ok: false, ms, err: String(e) });
      // RA1=a: fail-fast
      appendConsoleHeader(`══════ Sequence stopped at ${i+1}/${commands.length} ══════`);
      break;
    }
  }
  unhighlightCard();
  state.runAll.running = false;
  setRunAllUI(false);
  // На полный успех:
  if (state.runAll.results.every(r => r.ok)) {
    appendConsoleHeader(`✓ All ${commands.length} commands done`);
  }
}
```

### 4.2 Stop

```js
async function onStopAll() {
  state.runAll.aborted = true;
  await call('stop_command');     // убивает текущий child
  showToast('Run-all stopped', 'info');
}
```

После завершения текущей команды (с error от kill'а или ok если успела) цикл проверит `aborted` и не пойдёт дальше.

### 4.3 hide_after_run (RA5=a)

**Проверено**: флаг `hide_after_run` сейчас хранится в БД и редактируется в форме, но **нигде не применяется** — ни во frontend, ни в backend `run_command` (`grep` подтвердил). То есть в текущей реализации это dead column.

**Что делать**: ничего. Спека RA5=a («игнорировать во время run-all») сходится с фактическим поведением. Run-all ничего не хайдит, одиночный run тоже ничего не хайдит. Чтобы не делать регрессии — оставляем поле в форме как есть; реализация настоящего hide-after-run для одиночных команд — отдельная задача, не входит в scope этого релиза.

---

## 5. Rename / i18n

### 5.1 Изменения в `exec.js`

| Сейчас                       | После                          |
|------------------------------|--------------------------------|
| `Categories`                 | `Groups`                       |
| `New Category`               | `New group`                    |
| `Edit Category`              | `Edit group`                   |
| `Delete Category`            | `Delete group`                 |
| `Select a category`          | `Select a group`               |
| `Select a category first`    | `Select a group first`         |
| modal title `Edit Command`   | без изменений                  |
| modal field `Sort order`     | без изменений                  |

DOM-классы остаются: `.exec-cat-item`, `.exec-cat-list` — не переименовываем (внутреннее, не видно пользователю).

### 5.2 `help.js` — i18n

Английская и русская секции про Exec — обновить:
- Слово «category» → «group» (en).
- Слово «категория» → «группа» (ru).
- Добавить: «Drag the ⋮⋮ grip to move a command to another group, or click it for a "Move to…" menu. Use ▶ Run all on a group header to execute all commands sequentially with progress in the bottom console.»

### 5.3 `CHANGELOG.md`

Новая секция сверху:

```markdown
## v1.3.25 (2026-04-27)

**Exec → Command Groups: redesign + DnD + Run-all.**

- **Rename UI:** «Categories» → «Groups». БД-таблицы и колонки не тронуты.
- **DnD:** drag the ⋮⋮ grip on a command card to move it between groups
  (drop on the left panel) or reorder within the same group (drop on
  another card). Click on the grip without drag opens a "Move to…"
  popover for accessibility.
- **Run-all:** new `▶ Run all` button on the group header. Runs every
  command in the group sequentially, fail-fast on the first error, with
  a progress bar + per-command collapsible sections in the bottom
  console. Stop button aborts the whole sequence.
- **Edit modal:** new «Group» dropdown lets you change a command's
  group from the form (alternative to DnD).
- **Visual:** Slack-style auto-letter icon on each group (deterministic
  colour from name). Full UI redesign generated through the
  frontend-design skill (multi-variant exploration).
```

---

## 6. Релиз

- **Tag**: `v1.3.25` (per CLAUDE.md §15).
- **Bump**: `desktop-rust/src-tauri/Cargo.toml`, `tauri.conf.json` → `1.3.25`. Cargo.lock — refresh через `cargo check`.
- **Sanity** (per RELEASES.md §2.1): `cargo check` + `python3 dev-test.py` (14/14 PASS).
- **Push + tag + push tag** + watch CI.

---

## 7. Ревью на opus (CLAUDE.md §13)

Перед коммитом — review через subagent с `model: opus`, фокус:

1. **DnD-логика** (`exec-dnd.js`): pointermove threshold (click vs drag), drop-target detection edge cases (pointer over scrollbar, resize during drag), abort-flow на pointercancel.
2. **Run-all state machine**: race между stop_command и переходом к следующей команде; cleanup при window close mid-run; consistency между UI флагами (`runAll.running`) и реальным процессом.
3. **`move_exec_command` race**: два пользователя не могут двинуть одну команду одновременно (single-user app, не блокер), но FK-check на target_category_id чтобы не словить SQLite-error на удалённой группе.
4. **§10 UTF-8**: имена групп с кириллицей в auto-letter — `name.chars().next()` (char, не byte).
5. **§11 lock_recover**: новые `move_exec_command`, `reorder_exec_commands` — обязательно `db.lock_recover()`.
6. **§12 IPC skew**: новые команды → `v-*` ✓, не `f-*`.

---

## 8. UI-редизайн через `frontend-design` skill

После того как backend + DnD-каркас будут готовы, отдельная фаза с invoke `frontend-design` skill:

- **Инпут для skill**: текущий каркас exec.js + спека секций §2.2–§2.6 + Tasks-стилистика как референс.
- **Output**: 2-3 варианта визуального стиля (S3=b — свободный полёт), показанные через визуальный companion на http://localhost:8765.
- Пользователь выбирает → применяем выбранный вариант → финализируем CSS.

Этот шаг вынесен в отдельную фазу плана, потому что лучше сначала иметь рабочую функциональность, а потом полировать визуал.

---

## 9. Out of scope

- **Параллельный run-all** — только sequential.
- **Saved run-all profiles** (типа «run только эти 3 из группы») — не сейчас, отдельная задача.
- **Цвет группы pickable из UI** — авто-цвет из имени достаточно (пользователь может переименовать чтобы получить другой цвет).
- **Drag-and-drop групп между собой** (изменение `sort_order` категорий через DnD) — в `update_exec_category` уже есть `sort_order`, через UI пока редактируется только в edit-модалке. Не добавляем DnD для групп в этом релизе.
- **Импорт/экспорт групп** — отдельно.
